/**
 * Sephiroth core adapter — SIDECAR engine manager (server-only). [v2.5]
 *
 * Runs one real OS process per ENABLED sidecar-served inbound, NEXT TO (not
 * inside) the Xray core — protocols Xray cannot or no longer serves:
 *
 *   hysteria2 (v2.5) — Xray never had a hysteria inbound
 *   mtproto   (25-a) — Xray-core removed its mtproto inbound in v24.10+;
 *                      served by the 9seconds/mtg v2 daemon instead
 *
 * For every such inbound the panel:
 *
 *   config   generates the engine config at db/core/sidecars/<tag>.<ext>
 *              hysteria2 → <tag>.yaml   listen :<port> (+ host when the row
 *                         pins one), auth password (single client) | userpass
 *                         map (multiple), tls managed PEM from the stream
 *                         (certPublic/certPrivate) or a generated self-signed
 *                         cert (node:crypto, CN=host, 10y) stored at
 *                         db/certs/<tag>-self.{crt,key}, obfs salamander when
 *                         stream.obfsPassword is set, bandwidth up/down Mbps
 *                         from stream.upMbps/downMbps, trafficStats
 *                         {enabled, secret} — per-user counters, quic
 *                         documented defaults
 *              mtproto   → <tag>.toml   secret (the first enabled client's
 *                         key — mtg v2 `ee<hex>[domain]` form), bind-to
 *                         <listen>:<port>, log-level info
 *   spawn    `hysteria server -c <yaml>` | `mtg run <toml>` with a log ring
 *            buffer per tag
 *   health   UDP port probe for hysteria (bind 0.0.0.0 → EADDRINUSE =
 *            listening); TCP connect probe for mtproto (mtg is plain TCP)
 *   reload   hash-diff per tag on the 2s mirror loop — restart only the
 *            processes whose config actually changed (xray.ts mirrorDb pattern)
 *   crash    auto-restart 3s/10s/30s backoff (max 5 attempts) per sidecar
 *   stats    hysteria: polls the REAL trafficStats HTTP API on the listener
 *            port: GET http://127.0.0.1:<port>/traffic/<secret>
 *            → JSON map { "<auth user>": {"tx": <bytes>, "rx": <bytes>} }
 *            (verified against the shipped binary — tx = client→server,
 *             rx = server→client). Deltas accumulate into ClientUser
 *             .usedTrafficGb (same store field the xray driver writes) and
 *            into the per-sidecar session rx/tx mirror surfaced via
 *            /api/system/core-status (`sidecars: [...]`).
 *            mtproto: no traffic API in mtg v2 — counters stay 0 and the
 *            stats poller skips these entries entirely.
 *
 * The manager is driver-agnostic: it runs with the simulator OR the real
 * Xray core, and is torn down on panel shutdown (server.ts).
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
} from "node:crypto";
import dgram from "node:dgram";
import { execFile as nodeExecFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";

import { db } from "@/lib/db";
import type { ActivityEvent } from "@/lib/core/types";
import type { SidecarStatus } from "@/lib/core/types";
import { asInboundStatus } from "@/lib/core/host-metrics";
import { parseClients } from "@/lib/user-types";
import type { InboundClient, InboundStream } from "@/lib/inbounds";
import { ensureHysteriaBinary, ensureMtgBinary } from "@/lib/core/bin-manager";
import { isValidMtpSecret } from "@/lib/mtp-secret";

const BYTES_PER_GB = 1024 ** 3;
const LOG_CAP = 200;
const LOG_TAIL = 8;
const PORT_WAIT_MS = 12_000;
const STOP_GRACE_MS = 5_000;
const REGEN_DEBOUNCE_MS = 1_500;
const RESTART_BACKOFF_MS = [3_000, 10_000, 30_000];
const RESTART_MAX = 5;
const STATS_INTERVAL_DEFAULT_MS = 10_000;
const STATS_HTTP_TIMEOUT_MS = 6_000;

/* -------------------------------------------------------- YAML generation */

/** YAML double-quoted scalar — JSON string escapes are valid YAML. */
function ys(v: unknown): string {
  return JSON.stringify(String(v ?? ""));
}

export interface SidecarBuild {
  yaml: string;
  yamlHash: string;
  port: number;
  listenHost: string;
  certPath: string;
  keyPath: string;
  certSource: "managed" | "self-signed";
  statsSecret: string;
  authEmails: string[]; // clients served by this sidecar (store mapping)
  passwordAuth: boolean;
}

interface InboundRowLike {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  listen: string;
  transport: string;
  security: string;
  status: string;
  clientsJson: string;
  streamJson: string;
}

function parseLoose<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as T;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Port-only listen → ":port"; pinned host → "host:port" (0.0.0.0 stays empty). */
function listenLine(listen: string, port: number): string {
  const host = (listen || "").trim();
  if (!host || host === "0.0.0.0" || host === "::") return `:${port}`;
  return `${host}:${port}`;
}

/** Host used for the self-signed certificate CN/SAN (never a wildcard bind). */
function certHost(stream: InboundStream, listen: string): string {
  const sni = str(stream.sni).trim();
  if (sni) return sni;
  const host = (listen || "").trim();
  if (host && host !== "0.0.0.0" && host !== "::") return host;
  return "localhost";
}

/* ------------------------------------------------ self-signed certificate */

/* Minimal DER encoder — no external dependency, works on every host. */
function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}

function derSeq(...children: Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(children));
}

function derSet(...children: Buffer[]): Buffer {
  return derTlv(0x31, Buffer.concat(children));
}

function derOid(oid: string): Buffer {
  const parts = oid.split(".").map((p) => Number.parseInt(p, 10));
  const out: number[] = [parts[0]! * 40 + parts[1]!];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i]!;
    const stack: number[] = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    out.push(...stack);
  }
  return derTlv(0x06, Buffer.from(out));
}

function derInt(value: Buffer): Buffer {
  // strip leading zero bytes but keep one when the high bit would signal negative
  let i = 0;
  while (i < value.length - 1 && value[i] === 0) i++;
  let body = value.subarray(i);
  if (body[0]! & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return derTlv(0x02, body);
}

function derBitString(body: Buffer): Buffer {
  return derTlv(0x03, Buffer.concat([Buffer.from([0]), body]));
}

function derOctet(body: Buffer): Buffer {
  return derTlv(0x04, body);
}

function derNull(): Buffer {
  return Buffer.from([0x05, 0x00]);
}

function derUtf8(s: string): Buffer {
  return derTlv(0x0c, Buffer.from(s, "utf8"));
}

function derUtcTime(date: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, "0");
  const s =
    `${String(date.getUTCFullYear()).slice(2)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return derTlv(0x17, Buffer.from(s, "ascii"));
}

function derCtx(tag: number, body: Buffer): Buffer {
  return derTlv(tag | 0xa0, body);
}

const OID_CN = "2.5.4.3";
const OID_RSA = "1.2.840.113549.1.1.1";
const OID_SHA256_RSA = "1.2.840.113549.1.1.11";
const OID_SAN = "2.5.29.17";

function derName(cn: string): Buffer {
  return derSeq(derSet(derSeq(derOid(OID_CN), derUtf8(cn))));
}

/** IPv4 dotted-quad → 4 bytes (IPv6 literals fall back to the DNS entry). */
function ipToBytes(ip: string): Buffer | null {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return null;
  const bytes = v4.slice(1).map((s) => Number.parseInt(s, 10));
  if (bytes.some((b) => Number.isNaN(b) || b > 255)) return null;
  return Buffer.from(bytes);
}

/**
 * Self-signed TLS certificate, RSA-2048 + SHA-256, 10-year validity.
 * CN + SAN carry the inbound host (DNS name or IP as appropriate).
 * Verified against `openssl x509 -noout -text` and by the real hysteria
 * server/client accepting the chain during the E2E.
 */
export function generateSelfSignedCert(host: string): { certPem: string; keyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyObj = createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }) as string);

  const now = new Date();
  const notAfter = new Date(now.getTime() + 10 * 365.25 * 86_400_000);

  const serial = derInt(randomBytes(16));
  const algId = derSeq(derOid(OID_SHA256_RSA), derNull());
  const validity = derSeq(derUtcTime(now), derUtcTime(notAfter));
  const name = derName(host);

  const pubKeySeq = (() => {
    // RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }
    const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
    const b64u = (s: string): Buffer => Buffer.from(s, "base64url");
    const rsaPk = derSeq(derInt(b64u(jwk.n)), derInt(b64u(jwk.e)));
    return derSeq(derSeq(derOid(OID_RSA), derNull()), derBitString(rsaPk));
  })();

  const sanEntries: Buffer[] = [];
  const ipBytes = ipToBytes(host);
  if (ipBytes) {
    sanEntries.push(derTlv(0x87, ipBytes)); // [7] iPAddress
  } else {
    sanEntries.push(derTlv(0x82, Buffer.from(host, "ascii"))); // [2] dNSName
  }
  const san = derSeq(derSeq(derOid(OID_SAN), derOctet(derSeq(...sanEntries))));
  // [3] EXPLICIT { SEQUENCE OF Extension } — the SEQUENCE OF IS `san`
  const extensions = derCtx(3, san);

  const tbs = derSeq(
    derCtx(0, derInt(Buffer.from([2]))), // version v3
    serial,
    algId,
    name, // issuer (self)
    validity,
    name, // subject (self)
    pubKeySeq,
    extensions
  );

  const signature = cryptoSign("sha256", tbs, keyObj);
  const certDer = derSeq(tbs, algId, derBitString(signature));

  const b64 = certDer.toString("base64").replace(/(.{64})/g, "$1\n").trimEnd();
  const certPem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return { certPem, keyPem };
}

/* -------------------------------------------------------- traffic secrets */

function safeTag(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "inbound";
}

/* ----------------------------------------------------------- sidecar row */

interface SidecarEntry {
  tag: string;
  /** which engine this sidecar serves (hysteria2 | mtproto, Task 25-a) */
  protocol: "hysteria2" | "mtproto";
  port: number;
  listen: string;
  status: string; // inbound store status
  wantRunning: boolean;
  running: boolean;
  stopping: boolean;
  proc: ChildProcess | null;
  pid: number | null;
  configPath: string;
  configHash: string;
  lastError: string;
  restartCount: number; // auto-restarts for THIS sidecar
  autoAttempts: number;
  restartTimer: NodeJS.Timeout | null;
  logBuf: string[];
  certPath: string;
  certSource: "managed" | "self-signed";
  statsSecret: string;
  authEmails: string[];
  // cumulative per-user counters from the last poll (authUser → tx/rx)
  userPrev: Map<string, { tx: number; rx: number }>;
  // session totals (deltas accumulated)
  txBytes: number;
  rxBytes: number;
  lastStatsAt: number;
  statsError: string;
}

export interface SidecarManagerOptions {
  /** traffic poll interval ms (mirrors the core stats interval setting) */
  statsIntervalMs?: number;
  /** config/state dir, defaults to <cwd>/db/core/sidecars */
  stateDir?: string;
  /** cert dir, defaults to <cwd>/db/certs */
  certDir?: string;
  /** settings override for the hysteria binary resolution */
  binPath?: string;
  versionPin?: string;
}

export class SidecarManager {
  private readonly stateDir: string;
  private readonly certDir: string;
  private binPathOpt: string;
  private versionPinOpt: string;
  private statsIntervalMs = STATS_INTERVAL_DEFAULT_MS;

  private binaryPath = "";
  private binaryVersion = "";
  private binaryResolved = false;

  // mtg (mtproto) engine — resolved lazily, only when an mtproto row exists
  private mtgPath = "";
  private mtgVersion = "";
  private mtgResolved = false;

  private readonly entries = new Map<string, SidecarEntry>();
  private regenTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private statsBusy = false;
  private startLock: Promise<void> | null = null;
  private bootedAt = Date.now();
  private eventCounter = 0;
  private readonly processListeners: Array<() => void> = [];

  constructor(opts: SidecarManagerOptions = {}) {
    this.stateDir = opts.stateDir ?? path.resolve(process.cwd(), "db", "core", "sidecars");
    this.certDir = opts.certDir ?? path.resolve(process.cwd(), "db", "certs");
    this.binPathOpt = opts.binPath ?? "";
    this.versionPinOpt = opts.versionPin ?? "";
    if (opts.statsIntervalMs && opts.statsIntervalMs >= 5_000 && opts.statsIntervalMs <= 120_000) {
      this.statsIntervalMs = opts.statsIntervalMs;
    }

    // orphan protection — sync kill on process exit (same as the xray driver)
    const onExit = (): void => this.killAllSync();
    process.on("exit", onExit);
    process.on("beforeExit", onExit);
    this.processListeners.push(() => {
      process.removeListener("exit", onExit);
      process.removeListener("beforeExit", onExit);
    });
  }

  /** Update runtime options between reconciles (settings changes). */
  updateOptions(opts: SidecarManagerOptions): void {
    if (opts.binPath !== undefined) this.binPathOpt = opts.binPath;
    if (opts.versionPin !== undefined) this.versionPinOpt = opts.versionPin;
    if (opts.statsIntervalMs && opts.statsIntervalMs >= 5_000 && opts.statsIntervalMs <= 120_000) {
      this.statsIntervalMs = opts.statsIntervalMs;
    }
  }

  /* ------------------------------------------------------------ lifecycle */

  /** Resolve the binary once, then reconcile against the store. */
  start(): Promise<void> {
    if (this.startLock) return this.startLock;
    this.startLock = (async () => {
      await this.ensureBinary();
      await this.reconcile(true);
      this.startStatsTimer();
    })().finally(() => {
      this.startLock = null;
    });
    return this.startLock;
  }

  private async ensureBinary(): Promise<void> {
    if (this.binaryPath && this.binaryVersion) {
      // re-verify cheaply — a deleted binary file falls through to re-resolve
      if (existsSync(this.binaryPath)) return;
    }
    // admin overrides live in the settings store (read synchronously — the
    // store is in-process; "" = PATH → auto-install)
    const binOverride =
      this.binPathOpt || db._syncReadSetting("set_sidecar_hysteria_bin") || "";
    const pin = this.versionPinOpt || db._syncReadSetting("set_sidecar_hysteria_version") || "";
    const bin = await ensureHysteriaBinary({
      binPath: binOverride,
      versionPin: pin,
      log: (m) => this.log("engine", m),
    });
    this.binaryPath = bin.path;
    this.binaryVersion = bin.version;
    this.binaryResolved = true;
    this.log("engine", `binary: ${bin.path} (${bin.version}, source: ${bin.source})`);
  }

  /**
   * Resolve the mtg binary for mtproto sidecars. NEVER throws — a missing
   * binary only surfaces as a failed mtproto sidecar ("binary missing" in
   * its lastError), never as a manager-wide failure (hysteria sidecars must
   * keep running). When the binary first becomes available, mtproto entries
   * have their config hash cleared so the same reconcile respawns them.
   */
  private async ensureMtg(): Promise<void> {
    if (this.mtgPath && this.mtgVersion && existsSync(this.mtgPath)) return;
    try {
      const bin = await ensureMtgBinary({ log: (m) => this.log("engine", m) });
      const isNew = !this.mtgResolved;
      this.mtgPath = bin.path;
      this.mtgVersion = bin.version;
      this.mtgResolved = true;
      this.log("engine", `mtg binary: ${bin.path} (${bin.version}, source: ${bin.source})`);
      if (isNew) {
        // force the mtproto sidecars to re-run their spawn on this reconcile
        for (const entry of this.entries.values()) {
          if (entry.protocol === "mtproto") entry.configHash = "";
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log("engine", `mtg binary unavailable: ${msg}`);
    }
  }

  /** Engine binary for a sidecar kind ("" when not resolved yet). */
  private binFor(protocol: "hysteria2" | "mtproto"): string {
    return protocol === "mtproto" ? this.mtgPath : this.binaryPath;
  }

  async stopAll(): Promise<void> {
    this.clearRegenTimer();
    this.stopStatsTimer();
    await Promise.all([...this.entries.values()].map((e) => this.stopEntry(e)));
  }

  async restartAll(): Promise<void> {
    await this.stopAll();
    await this.start();
  }

  /** Regen configs from the store; restart only what changed (force ignored). */
  async reload(): Promise<void> {
    await this.ensureBinary();
    await this.reconcile(true);
    this.startStatsTimer();
  }

  async dispose(): Promise<void> {
    this.clearRegenTimer();
    this.stopStatsTimer();
    for (const off of this.processListeners) off();
    await Promise.all([...this.entries.values()].map((e) => this.stopEntry(e)));
  }

  /* ------------------------------------------------------------ mirroring */

  /** server.ts calls this every 2s — debounced store diff + reconcile. */
  mirrorDb(): ActivityEvent[] {
    this.scheduleRegen();
    return []; // events are emitted by reconcile itself
  }

  private scheduleRegen(): void {
    if (this.regenTimer) return;
    this.regenTimer = setTimeout(() => {
      this.regenTimer = null;
      void this.reconcile(false).catch((err) => {
        this.log("engine", `reconcile error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, REGEN_DEBOUNCE_MS);
  }

  private clearRegenTimer(): void {
    if (this.regenTimer) {
      clearTimeout(this.regenTimer);
      this.regenTimer = null;
    }
  }

  /**
   * Task 23-c — when the REAL xray driver runs and the sing-box secondary
   * core is enabled (default), hysteria2 inbounds are served by sing-box;
   * the per-inbound sidecars would double-bind the same UDP ports, so they
   * stand down entirely. They resume automatically when sing-box is
   * disabled via settings or the driver returns to the simulator.
   */
  private shouldStandDown(): boolean {
    try {
      return (
        db._syncReadSetting("set_core_driver") === "xray" &&
        db._syncReadSetting("set_core_singbox_enabled") !== "0"
      );
    } catch {
      return false;
    }
  }

  /**
   * Sync the sidecar set with ENABLED sidecar-served inbounds
   * (hysteria2 + mtproto, Task 25-a):
   *   new/changed → (re)build config + (re)spawn
   *   removed/disabled/offline → stop + drop
   */
  private async reconcile(force: boolean): Promise<void> {
    let rows: InboundRowLike[] = [];
    try {
      rows = db
        ._syncReadInboundsFull()
        .filter((r) => r.protocol === "hysteria2" || r.protocol === "mtproto");
    } catch {
      return;
    }

    // Task 23-c stand-down — when the REAL xray driver runs and the sing-box
    // secondary core is enabled, hysteria2 inbounds are served by sing-box;
    // the per-inbound hysteria sidecars would double-bind the same UDP ports,
    // so they stand down. mtproto is NOT a sing-box protocol (Task 25-a) —
    // its mtg sidecars keep running and reconcile as usual.
    if (this.shouldStandDown()) {
      rows = rows.filter((r) => r.protocol !== "hysteria2");
      for (const [tag, entry] of [...this.entries]) {
        if (entry.protocol !== "hysteria2") continue;
        await this.stopEntry(entry);
        this.entries.delete(tag);
        this.log(tag, "sidecar stood down (sing-box secondary core serves hysteria2)");
        this.onEvent?.(
          this.makeEvent("inbound.updated", "info", {
            inbound: tag,
            port: entry.port,
            detail: "sidecar stood down (sing-box core)",
          })
        );
      }
      if (rows.length === 0) return;
    }

    // resolve the engines each kind needs (hysteria binary may throw — the
    // established contract; mtg never throws, see ensureMtg)
    if (rows.some((r) => r.protocol === "hysteria2")) await this.ensureBinary();
    if (rows.some((r) => r.protocol === "mtproto")) await this.ensureMtg();

    const served = rows.filter((r) => r.status === "online");
    const seen = new Set<string>();
    const emitted: ActivityEvent[] = [];

    for (const row of served) {
      seen.add(row.tag);
      const built = this.buildSidecar(row);
      if (!built) continue;

      let entry = this.entries.get(row.tag);
      if (entry && entry.configHash === built.yamlHash) {
        // unchanged — refresh the cheap mirrors
        entry.status = row.status;
        entry.authEmails = built.authEmails;
        continue;
      }

      if (entry) {
        // config changed → restart with the new document
        await this.stopEntry(entry);
      } else {
        entry = this.blankEntry(
          row.tag,
          row.port,
          row.listen,
          row.protocol === "mtproto" ? "mtproto" : "hysteria2"
        );
        this.entries.set(row.tag, entry);
      }
      entry.status = row.status;
      entry.configPath = built.configPath;
      entry.configHash = built.yamlHash;
      entry.certPath = built.certPath;
      entry.certSource = built.certSource;
      entry.statsSecret = built.statsSecret;
      entry.authEmails = built.authEmails;
      entry.port = built.port;
      entry.listen = row.listen;
      this.log(row.tag, `config written (${built.certSource} tls, port ${built.port})`);
      try {
        await this.spawnEntry(entry);
        emitted.push(
          this.makeEvent("inbound.updated", "success", {
            inbound: row.tag,
            port: built.port,
            detail: force ? "sidecar reloaded" : "sidecar started",
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entry.lastError = msg;
        entry.running = false;
        entry.pid = null;
        this.log(row.tag, `start failed: ${msg}`);
        emitted.push(
          this.makeEvent("inbound.updated", "warn", {
            inbound: row.tag,
            port: built.port,
            detail: "sidecar failed",
          })
        );
      }
    }

    // removed / disabled / offline → stop + drop
    for (const [tag, entry] of [...this.entries]) {
      if (seen.has(tag)) continue;
      await this.stopEntry(entry);
      this.entries.delete(tag);
      this.log(tag, "sidecar removed (inbound disabled, offline or deleted)");
      emitted.push(
        this.makeEvent("inbound.updated", "info", {
          inbound: tag,
          port: entry.port,
          detail: "sidecar stopped",
        })
      );
    }

    for (const e of emitted) this.onEvent?.(e);
  }

  /** Optional event sink wired by server.ts (socket activity feed). */
  onEvent: ((event: ActivityEvent) => void) | null = null;

  private blankEntry(
    tag: string,
    port: number,
    listen: string,
    protocol: "hysteria2" | "mtproto"
  ): SidecarEntry {
    return {
      tag,
      protocol,
      port,
      listen,
      status: "online",
      wantRunning: false,
      running: false,
      stopping: false,
      proc: null,
      pid: null,
      configPath: "",
      configHash: "",
      lastError: "",
      restartCount: 0,
      autoAttempts: 0,
      restartTimer: null,
      logBuf: [],
      certPath: "",
      certSource: "self-signed",
      statsSecret: "",
      authEmails: [],
      userPrev: new Map(),
      txBytes: 0,
      rxBytes: 0,
      lastStatsAt: 0,
      statsError: "",
    };
  }

  /* ------------------------------------------------------- config builder */

  /**
   * Build the engine config for one inbound row. Writes the config file
   * (+ cert files for hysteria, only when contents changed) and returns the
   * hash. Returns null when the row cannot be served (no enabled client /
   * invalid mtproto secret).
   */
  private buildSidecar(row: InboundRowLike): {
    yaml: string;
    yamlHash: string;
    configPath: string;
    certPath: string;
    certSource: "managed" | "self-signed";
    statsSecret: string;
    authEmails: string[];
    port: number;
  } | null {
    if (row.protocol === "mtproto") return this.buildMtpSidecar(row);
    return this.buildHysteriaSidecar(row);
  }

  /**
   * mtproto (mtg v2) sidecar config — Task 25-a. Minimal TOML: the secret
   * comes from the FIRST enabled client's key (mtg carries a single secret
   * per listener; additional enabled clients are counted in `users` but
   * cannot be served by one mtg port — surfaced honestly in the logs).
   */
  private buildMtpSidecar(row: InboundRowLike): {
    yaml: string;
    yamlHash: string;
    configPath: string;
    certPath: string;
    certSource: "managed" | "self-signed";
    statsSecret: string;
    authEmails: string[];
    port: number;
  } | null {
    const clients = (parseClients(row.clientsJson) as (InboundClient & { ownerId?: string })[])
      .filter((c) => c.enabled !== false && c.email && c.key);

    if (clients.length === 0) {
      this.log(row.tag, "no enabled client with a secret — sidecar skipped");
      return null;
    }

    const secret = clients[0]!.key.trim();
    if (!isValidMtpSecret(secret)) {
      this.log(
        row.tag,
        "client secret is not a valid MTProto secret (need ee/dd + 32 hex) — sidecar skipped"
      );
      return null;
    }
    if (clients.length > 1) {
      // mtg v2 serves ONE secret per listener — extra clients are decorative
      this.log(
        row.tag,
        `mtproto serves a single secret per port — using "${clients[0]!.email}" (${clients.length - 1} more enabled client(s) ignored by mtg)`
      );
    }

    mkdirSync(this.stateDir, { recursive: true });
    const t = safeTag(row.tag);

    // mtg needs host:port — bare ":port" is not a valid bind-to
    const host = (row.listen || "").trim();
    const bindTo =
      !host || host === "0.0.0.0" || host === "::" ? `0.0.0.0:${row.port}` : `${host}:${row.port}`;

    const toml = [
      `secret = "${secret}"`,
      `bind-to = "${bindTo}"`,
      `log-level = "info"`,
      "",
    ].join("\n");
    const configPath = path.join(this.stateDir, `${t}.toml`);
    writeIfChanged(configPath, toml);

    return {
      yaml: toml,
      yamlHash: hashStr(toml),
      configPath,
      certPath: "",
      certSource: "self-signed",
      statsSecret: "", // mtg v2 has no traffic API — stats stay 0
      authEmails: clients.map((c) => c.email),
      port: Number(row.port),
    };
  }

  /**
   * Build the hysteria server YAML for one inbound row. Writes the config
   * file + cert files (only when contents changed) and returns the hash.
   * Returns null when the row cannot be served (no enabled client).
   */
  private buildHysteriaSidecar(row: InboundRowLike): {
    yaml: string;
    yamlHash: string;
    configPath: string;
    certPath: string;
    certSource: "managed" | "self-signed";
    statsSecret: string;
    authEmails: string[];
    port: number;
  } | null {
    const stream = parseLoose<InboundStream>(row.streamJson, {});
    const clients = (parseClients(row.clientsJson) as (InboundClient & { ownerId?: string })[])
      .filter((c) => c.enabled !== false && c.email && c.key);

    if (clients.length === 0) {
      this.log(row.tag, "no enabled client with a key — sidecar skipped");
      return null;
    }

    mkdirSync(this.stateDir, { recursive: true });
    mkdirSync(this.certDir, { recursive: true });
    const t = safeTag(row.tag);

    // ---- TLS material: managed PEM from the stream, else self-signed
    let certPath: string;
    let keyPath: string;
    let certSource: "managed" | "self-signed";
    const certPem = str(stream.certPublic).trim();
    const keyPem = str(stream.certPrivate).trim();
    if (
      certPem.includes("-----BEGIN CERTIFICATE-----") &&
      (keyPem.includes("-----BEGIN PRIVATE KEY-----") ||
        keyPem.includes("-----BEGIN RSA PRIVATE KEY-----") ||
        keyPem.includes("-----BEGIN EC PRIVATE KEY-----"))
    ) {
      certSource = "managed";
      certPath = path.join(this.certDir, `${t}-managed.crt`);
      keyPath = path.join(this.certDir, `${t}-managed.key`);
      writeIfChanged(certPath, certPem + "\n");
      writeIfChanged(keyPath, keyPem.endsWith("\n") ? keyPem : keyPem + "\n");
    } else {
      certSource = "self-signed";
      certPath = path.join(this.certDir, `${t}-self.crt`);
      keyPath = path.join(this.certDir, `${t}-self.key`);
      if (!existsSync(certPath) || !existsSync(keyPath)) {
        const host = certHost(stream, row.listen);
        const { certPem: c, keyPem: k } = generateSelfSignedCert(host);
        writeIfChanged(certPath, c);
        writeIfChanged(keyPath, k);
        this.log(row.tag, `self-signed certificate generated (CN=${host}, 10y)`);
      }
    }

    // ---- trafficStats secret (persisted per tag)
    const secretPath = path.join(this.stateDir, `${t}.secret`);
    let secret = "";
    try {
      if (existsSync(secretPath)) {
        secret = readFileSync(secretPath, "utf8").trim();
      }
    } catch {
      /* re-generate below */
    }
    if (!/^[0-9a-f]{32,64}$/i.test(secret)) {
      secret = randomBytes(16).toString("hex");
      writeFileSync(secretPath, secret, { mode: 0o600 });
    }

    // ---- auth: password (single) | userpass map (multiple)
    const authBlock =
      clients.length === 1
        ? ["auth:", `  type: password`, `  password: ${ys(clients[0]!.key)}`]
        : [
            "auth:",
            `  type: userpass`,
            `  user:`,
            ...clients.map((c) => `    ${ys(c.email)}: ${ys(c.key)}`),
          ];

    const obfsPassword = str(stream.obfsPassword).trim();
    const upMbps = num(stream.upMbps);
    const downMbps = num(stream.downMbps);

    const lines: string[] = [
      `listen: ${ys(listenLine(row.listen, Number(row.port)))}`,
      "tls:",
      `  cert: ${ys(certPath)}`,
      `  key: ${ys(keyPath)}`,
      ...authBlock,
    ];
    if (obfsPassword) {
      lines.push("obfs:", `  type: salamander`, `  password: ${ys(obfsPassword)}`);
    }
    if (upMbps > 0 || downMbps > 0) {
      lines.push("bandwidth:");
      if (upMbps > 0) lines.push(`  up: ${ys(`${upMbps} mbps`)}`);
      if (downMbps > 0) lines.push(`  down: ${ys(`${downMbps} mbps`)}`);
    }
    lines.push(
      "trafficStats:",
      `  enabled: true`,
      `  secret: ${ys(secret)}`,
      // documented QUIC defaults (hysteria2 wiki) — explicit beats implicit
      "quic:",
      `  initStreamReceiveWindow: 8388608`,
      `  maxStreamReceiveWindow: 8388608`,
      `  initConnReceiveWindow: 20971520`,
      `  maxConnReceiveWindow: 20971520`,
      `  maxIdleTimeout: 30s`,
      `  keepAlivePeriod: 10s`,
      `  disablePathMTUDiscovery: false`
    );

    const yaml = lines.join("\n") + "\n";
    const configPath = path.join(this.stateDir, `${t}.yaml`);
    writeIfChanged(configPath, yaml);

    return {
      yaml,
      yamlHash: hashStr(yaml),
      configPath,
      certPath,
      certSource,
      statsSecret: secret,
      authEmails: clients.map((c) => c.email),
      port: Number(row.port),
    };
  }

  /* ------------------------------------------------------------- spawning */

  private async spawnEntry(entry: SidecarEntry): Promise<void> {
    const binPath = this.binFor(entry.protocol);
    if (!binPath) {
      throw new Error(
        entry.protocol === "mtproto"
          ? "mtg binary not resolved (download failed / unreachable)"
          : "hysteria binary not resolved yet"
      );
    }
    entry.wantRunning = true;
    entry.lastError = "";

    // free the port first — a stale sibling from a crashed panel would EADDRINUSE
    await this.killStaleFromPidFile(entry);

    const args =
      entry.protocol === "mtproto"
        ? ["run", entry.configPath]
        : ["server", "-c", entry.configPath];
    const child = spawn(binPath, args, {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    entry.proc = child;
    entry.pid = child.pid ?? null;
    this.writePidFile(entry);
    this.attachLogPipe(entry, child);

    child.on("error", (err) => {
      entry.lastError = err.message;
      this.log(entry.tag, `spawn error: ${err.message}`);
    });
    child.on("exit", (code, signal) => {
      const wasRunning = entry.running;
      entry.running = false;
      entry.pid = null;
      entry.proc = null;
      this.removePidFile(entry);
      if (entry.stopping) {
        this.log(entry.tag, `sidecar stopped (code=${code ?? "-"} signal=${signal ?? "-"})`);
        return;
      }
      this.log(entry.tag, `sidecar exited unexpectedly (code=${code ?? "-"} signal=${signal ?? "-"})`);
      if (wasRunning || entry.wantRunning) {
        entry.restartCount += 1;
        this.scheduleAutoRestart(entry);
      }
    });

    // health: hysteria listens on QUIC (UDP bind probe); mtg is plain TCP
    // (connect probe to 127.0.0.1)
    const ok =
      entry.protocol === "mtproto"
        ? await this.waitTcpPort(entry.port, PORT_WAIT_MS)
        : await this.waitUdpPort(entry.port, PORT_WAIT_MS);
    if (!ok) {
      const msg =
        entry.protocol === "mtproto"
          ? `mtg did not open TCP port ${entry.port} within ${PORT_WAIT_MS / 1000}s`
          : `hysteria did not open UDP port ${entry.port} within ${PORT_WAIT_MS / 1000}s`;
      this.log(entry.tag, msg);
      await this.stopEntry(entry);
      throw new Error(msg);
    }
    entry.running = true;
    entry.autoAttempts = 0;
    entry.statsError = "";
    this.log(
      entry.tag,
      `sidecar running (pid ${entry.pid}, ${entry.protocol === "mtproto" ? "tcp" : "udp"} ${entry.port})`
    );
  }

  async stopEntry(entry: SidecarEntry): Promise<void> {
    entry.wantRunning = false;
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }
    if (!entry.proc) {
      entry.running = false;
      return;
    }
    entry.stopping = true;
    try {
      await this.killChild(entry);
      this.log(entry.tag, "sidecar stopped by admin");
    } finally {
      entry.stopping = false;
    }
  }

  private scheduleAutoRestart(entry: SidecarEntry): void {
    if (!entry.wantRunning) return;
    if (entry.autoAttempts >= RESTART_MAX) {
      entry.lastError = `sidecar keeps exiting — gave up after ${RESTART_MAX} restart attempts`;
      this.log(entry.tag, entry.lastError);
      return;
    }
    const delay =
      RESTART_BACKOFF_MS[Math.min(entry.autoAttempts, RESTART_BACKOFF_MS.length - 1)] ?? 30_000;
    entry.autoAttempts += 1;
    this.log(entry.tag, `auto-restart ${entry.autoAttempts}/${RESTART_MAX} in ${delay / 1000}s`);
    if (entry.restartTimer) clearTimeout(entry.restartTimer);
    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = null;
      if (!entry.wantRunning || entry.proc) return;
      void this.spawnEntry(entry)
        .then(() => {
          entry.lastError = "";
          entry.autoAttempts = 0;
          this.log(entry.tag, `sidecar recovered (pid ${entry.pid})`);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          entry.lastError = msg;
          this.log(entry.tag, `auto-restart failed: ${msg}`);
          this.scheduleAutoRestart(entry);
        });
    }, delay);
  }

  private killChild(entry: SidecarEntry): Promise<void> {
    const child = entry.proc;
    if (!child) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      child.once("exit", finish);
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
      setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        setTimeout(finish, 300);
      }, STOP_GRACE_MS);
    });
  }

  private killAllSync(): void {
    for (const entry of this.entries.values()) {
      try {
        if (entry.proc && entry.pid) process.kill(entry.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }

  /* ------------------------------------------------------------ pid files */

  private pidFilePath(entry: SidecarEntry): string {
    return path.join(this.stateDir, `${safeTag(entry.tag)}.pid`);
  }

  private writePidFile(entry: SidecarEntry): void {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      if (entry.pid) writeFileSync(this.pidFilePath(entry), String(entry.pid), { mode: 0o644 });
    } catch {
      /* non-fatal */
    }
  }

  private removePidFile(entry: SidecarEntry): void {
    try {
      rmSync(this.pidFilePath(entry), { force: true });
    } catch {
      /* non-fatal */
    }
  }

  /** true when /proc/<pid>/cmdline (linux) matches the engine — avoids killing a recycled pid */
  private pidLooksLikeEngine(pid: number, protocol: "hysteria2" | "mtproto"): boolean {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return protocol === "mtproto" ? /mtg/i.test(cmd) : /hysteria/i.test(cmd);
    } catch {
      return false;
    }
  }

  private async killStaleFromPidFile(entry: SidecarEntry): Promise<void> {
    try {
      const p = this.pidFilePath(entry);
      if (!existsSync(p)) return;
      const pid = Number(readFileSync(p, "utf8").trim());
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
      if (!this.pidLooksLikeEngine(pid, entry.protocol)) return;
      this.log(
        entry.tag,
        `killing stale ${entry.protocol === "mtproto" ? "mtg" : "hysteria"} from a previous run (pid ${pid})`
      );
      process.kill(pid, "SIGTERM");
      await sleep(700);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* gone */
      }
      this.removePidFile(entry);
    } catch {
      /* best effort */
    }
  }

  /* -------------------------------------------------------------- logging */

  private log(tag: string, line: string): void {
    const entry = this.entries.get(tag);
    const ts = new Date().toISOString().slice(11, 19);
    const text = `[${ts}] ${line}`;
    if (entry) {
      entry.logBuf.push(text);
      if (entry.logBuf.length > LOG_CAP) entry.logBuf.shift();
    }
  }

  private attachLogPipe(entry: SidecarEntry, child: ChildProcess): void {
    const pump = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream) return;
      let acc = "";
      stream.on("data", (chunk: Buffer) => {
        acc += chunk.toString();
        let idx = acc.indexOf("\n");
        while (idx !== -1) {
          const line = acc.slice(0, idx).replace(/\r$/, "");
          if (line.trim()) this.log(entry.tag, line);
          acc = acc.slice(idx + 1);
          idx = acc.indexOf("\n");
        }
        if (acc.length > 8000) acc = "";
      });
    };
    pump(child.stdout);
    pump(child.stderr);
  }

  /* ----------------------------------------------------------- health check */

  /**
   * UDP "is it listening" probe: UDP has no connect, so try to BIND the
   * port — EADDRINUSE means another socket (the sidecar) already holds it.
   */
  private udpTaken(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = dgram.createSocket("udp4");
      const done = (taken: boolean): void => {
        try {
          sock.close();
        } catch {
          /* already closed */
        }
        resolve(taken);
      };
      sock.once("error", (err) => done((err as NodeJS.ErrnoException).code === "EADDRINUSE"));
      try {
        sock.bind({ port, address: "0.0.0.0" }, () => done(false)); // bound fine → nobody there
      } catch {
        done(false);
      }
    });
  }

  private async waitUdpPort(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.udpTaken(port)) return true;
      await sleep(400);
    }
    return false;
  }

  /**
   * TCP connect probe (Task 25-a) — mtg has no UDP listener; a successful
   * 127.0.0.1 connect means the daemon is accepting connections.
   */
  private tcpAlive(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = net.connect({ port, host: "127.0.0.1" });
      const done = (ok: boolean): void => {
        sock.destroy();
        resolve(ok);
      };
      sock.once("connect", () => done(true));
      sock.once("error", () => done(false));
      setTimeout(() => done(false), 1_200).unref();
    });
  }

  private async waitTcpPort(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.tcpAlive(port)) return true;
      await sleep(400);
    }
    return false;
  }

  /* ---------------------------------------------------------------- stats */

  private startStatsTimer(): void {
    this.stopStatsTimer();
    // first poll quickly so the UI fills, then settle into the interval
    this.statsTimer = setTimeout(() => {
      void this.pollStats();
      this.statsTimer = setInterval(() => void this.pollStats(), this.statsIntervalMs);
    }, 2_500);
  }

  private stopStatsTimer(): void {
    if (this.statsTimer) {
      clearTimeout(this.statsTimer);
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private async pollStats(): Promise<void> {
    if (this.statsBusy) return;
    // mtproto sidecars have no traffic API — only hysteria entries poll
    const running = [...this.entries.values()].filter(
      (e) => e.running && e.statsSecret && e.protocol === "hysteria2"
    );
    if (running.length === 0) return;
    this.statsBusy = true;
    try {
      await Promise.all(running.map((e) => this.pollEntryStats(e)));
    } finally {
      this.statsBusy = false;
    }
  }

  /**
   * Real Hysteria2 trafficStats API:
   *   GET https://127.0.0.1:<listenPort>/traffic/<secret>   (HTTP/3 over QUIC!)
   *   → 200 JSON { "<auth user>": { "tx": <bytes>, "rx": <bytes> } }
   * tx = uploaded by the user (client→server), rx = downloaded (server→client).
   * The endpoint lives on the SAME UDP/QUIC listener as the proxy — plain
   * TCP fetch can never reach it, so we poll through `curl --http3-only`
   * (present on modern distros; when the local curl lacks working HTTP/3 we
   * surface an honest statsError instead of pretending the counter is 0).
   * With password auth every user key maps to the single client; with
   * userpass the key IS the email.
   */
  private async pollEntryStats(entry: SidecarEntry): Promise<void> {
    const url = `https://127.0.0.1:${entry.port}/traffic/${entry.statsSecret}`;
    let body: string;
    try {
      const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        nodeExecFile(
          "curl",
          [
            "-sk",
            "--http3-only",
            "-m",
            String(Math.ceil(STATS_HTTP_TIMEOUT_MS / 1000)),
            url,
          ],
          { timeout: STATS_HTTP_TIMEOUT_MS + 2_000 },
          (err, stdout, stderr) => {
            if (!err) resolve({ code: 0, stdout: String(stdout), stderr: "" });
            else
              resolve({
                code: typeof err.code === "number" ? err.code : 1,
                stdout: String(stdout ?? ""),
                stderr: String(stderr ?? "") || (err.killed ? "timeout" : err.message),
              });
          }
        );
      });
      if (r.code !== 0 || !r.stdout.trim()) {
        entry.statsError =
          "traffic api unreachable — polling needs curl with HTTP/3 support " +
          `(exit ${r.code}${r.stderr ? `: ${r.stderr.split("\n")[0]?.slice(0, 120)}` : ""})`;
        return;
      }
      body = r.stdout;
    } catch (err) {
      entry.statsError = `traffic api poll failed: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    try {
      const parsed = JSON.parse(body) as Record<string, { tx?: number; rx?: number }>;
      const now = Date.now();
      let totalTx = 0;
      let totalRx = 0;
      const perUser: Array<{ email: string; delta: number }> = [];

      for (const [authUser, counters] of Object.entries(parsed ?? {})) {
        const tx = Math.max(0, Number(counters?.tx ?? 0) || 0);
        const rx = Math.max(0, Number(counters?.rx ?? 0) || 0);
        const prev = entry.userPrev.get(authUser) ?? { tx: 0, rx: 0 };
        // counters are cumulative since sidecar start → deltas per poll
        const dTx = tx >= prev.tx ? tx - prev.tx : tx;
        const dRx = rx >= prev.rx ? rx - prev.rx : rx;
        entry.userPrev.set(authUser, { tx, rx });
        if (dTx <= 0 && dRx <= 0) continue;
        totalTx += dTx;
        totalRx += dRx;
        // map the auth user → store client email
        const email =
          entry.authEmails.length === 1
            ? entry.authEmails[0]!
            : entry.authEmails.includes(authUser)
              ? authUser
              : "";
        if (email) perUser.push({ email, delta: dTx + dRx });
      }

      entry.txBytes += totalTx;
      entry.rxBytes += totalRx;
      entry.lastStatsAt = now;
      entry.statsError = "";

      if (perUser.length > 0) {
        const accessByEmail = new Map<string, string>();
        for (const a of db._syncReadAccessEmails()) {
          if (a.email) accessByEmail.set(a.email, a.userId);
        }
        for (const { email, delta } of perUser) {
          const userId = accessByEmail.get(email);
          if (!userId) continue;
          const gb = delta / BYTES_PER_GB;
          void db.clientUser
            .findUnique({ where: { id: userId }, select: { usedTrafficGb: true } })
            .then((row) => {
              const cur = Number(row?.usedTrafficGb) || 0;
              return db.clientUser.update({
                where: { id: userId },
                data: { usedTrafficGb: cur + gb },
              });
            })
            .catch(() => {
              /* user deleted mid-poll — skip */
            });
        }
      }
    } catch (err) {
      entry.statsError = err instanceof Error ? err.message : String(err);
    }
  }

  /* --------------------------------------------------------------- status */

  version(): string {
    return this.binaryVersion;
  }

  binarySource(): string {
    return this.binaryPath;
  }

  statusList(): SidecarStatus[] {
    return [...this.entries.values()].map((e) => ({
      tag: e.tag,
      protocol: e.protocol,
      running: e.running,
      pid: e.pid,
      version: e.protocol === "mtproto" ? this.mtgVersion : this.binaryVersion,
      port: e.port,
      lastError: e.lastError || e.statsError,
      restarts: e.restartCount,
      logTail: e.logBuf.slice(-LOG_TAIL),
      rxBytes: e.rxBytes,
      txBytes: e.txBytes,
      users: e.authEmails.length,
      lastStatsAt: e.lastStatsAt,
      configPath: e.configPath,
      certPath: e.certPath,
      certSource: e.certSource,
    }));
  }

  private makeEvent(
    kind: ActivityEvent["kind"],
    level: ActivityEvent["level"],
    params: Record<string, string | number>
  ): ActivityEvent {
    this.eventCounter++;
    return { id: `sc-${this.eventCounter}`, ts: Date.now(), level, kind, params };
  }
}

/* ------------------------------------------------------------ shared utils */

function hashStr(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

function writeIfChanged(p: string, content: string): void {
  try {
    if (existsSync(p) && readFileSync(p, "utf8") === content) return;
  } catch {
    /* rewrite below */
  }
  writeFileSync(p, content, { mode: 0o600 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Store row status → wire status (kept for parity with the xray driver). */
export function sidecarInboundStatus(raw: string): "online" | "maintenance" | "disabled" {
  return asInboundStatus(raw);
}
