/**
 * Sephiroth core adapter — SECONDARY sing-box core (server-only). [Task 23-c]
 *
 * Xray-core has no hysteria2 or tuic inbound (protocol gap report §1), so a
 * single `sing-box run -c config.json` process serves ALL enabled
 * hysteria2 + tuic inbounds NEXT TO the Xray core:
 *
 *   config   generated from the store at db/core/singbox/config.json
 *              hysteria2  users [{name,email→password,key}], up/down Mbps,
 *                         salamander obfs, optional masquerade (sing-box ≥1.14)
 *              tuic       users [{name, uuid, password}] — the client key IS
 *                         the wire composite "uuid:password" (same form the
 *                         tuic:// URI carries), congestion bbr/cubic/new_reno
 *              tls        managed PEM/paths from the stream, else a generated
 *                         self-signed cert (db/certs, same DER generator the
 *                         hysteria sidecar uses — E2E-proven)
 *   validate `sing-box check -c` (also reads the cert files — strict schema)
 *   spawn    pre-flight UDP port probe → `sing-box run -c` → wait for the
 *            QUIC listeners → exit watch with 3/10/30s backoff (max 5)
 *   stats    clash_api door on 127.0.0.1:<apiPort> (the release build has NO
 *            v2ray stats gRPC — gap report §2):
 *              /connections → cumulative uploadTotal/downloadTotal (exact)
 *              + per-connection metadata.inbound attribution (best-effort —
 *              connections that close between polls are invisible)
 *   gating   runs ONLY when the core driver is "xray" (the simulator never
 *            spawns cores) and set_core_singbox_enabled is not "0"
 *   coexist  while this driver serves hysteria2, the per-inbound hysteria
 *            sidecars stand down (same UDP ports would collide); TUIC has
 *            never had another engine
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db";
import type { ActivityEvent, SingboxStatus } from "@/lib/core/types";
import { generateSelfSignedCert } from "@/lib/core/sidecars";
import { ensureSingboxBinary } from "@/lib/core/bin-manager";
import { findFreePort } from "@/lib/core/config-builder";
import { parseClients } from "@/lib/user-types";
import type { InboundClient, InboundStream } from "@/lib/inbounds";

const LOG_CAP = 200;
const LOG_TAIL = 8;
const PORT_WAIT_MS = 12_000;
const STOP_GRACE_MS = 5_000;
const REGEN_DEBOUNCE_MS = 1_500;
const RESTART_BACKOFF_MS = [3_000, 10_000, 30_000];
const RESTART_MAX = 5;
const STATS_INTERVAL_DEFAULT_MS = 10_000;
const STATS_HTTP_TIMEOUT_MS = 6_000;
/** expert log level (xray names) → sing-box log levels */
const LOG_LEVEL_MAP: Record<string, string> = {
  none: "fatal",
  warning: "warn",
  info: "info",
  debug: "debug",
};

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

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function parseLoose<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as T;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function safeTag(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "inbound";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function writeIfChanged(p: string, content: string): void {
  try {
    if (existsSync(p) && readFileSync(p, "utf8") === content) return;
  } catch {
    /* rewrite below */
  }
  writeFileSync(p, content, { mode: 0o600 });
}

function hashStr(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

/** Host used for the self-signed certificate CN/SAN (never a wildcard bind). */
function certHost(stream: InboundStream, listen: string): string {
  const sni = str(stream.sni).trim();
  if (sni) return sni;
  const host = (listen || "").trim();
  if (host && host !== "0.0.0.0" && host !== "::") return host;
  return "localhost";
}

/** csv("a, b,,c") → ["a","b","c"] */
function csv(v: unknown): string[] {
  return str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface TlsMaterial {
  certPath: string;
  keyPath: string;
  source: "managed" | "self-signed";
}

/** UDP "is it listening" probe — BIND the port; EADDRINUSE = someone there. */
function udpTaken(port: number): Promise<boolean> {
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
      sock.bind({ port, address: "0.0.0.0" }, () => done(false));
    } catch {
      done(false);
    }
  });
}

async function waitUdpPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await udpTaken(port)) return true;
    await sleep(400);
  }
  return false;
}

/* ------------------------------------------------------- config document */

interface BuiltSbInbound {
  inbound: Record<string, unknown>;
  tag: string;
  port: number;
  protocol: string;
  tls: TlsMaterial;
  users: number;
}

interface SbBuild {
  json: string;
  hash: string;
  apiPort: number;
  configPath: string;
  inboundCount: number;
  ports: number[];
  protocols: Record<string, number>;
  users: number;
  tlsByTag: Map<string, TlsMaterial>;
  skipped: string[];
}

export interface SingboxDriverOptions {
  /** clash_api poll interval ms (mirrors the core stats interval setting) */
  statsIntervalMs?: number;
  /** config/state dir, defaults to <cwd>/db/core/singbox */
  stateDir?: string;
  /** cert dir, defaults to <cwd>/db/certs */
  certDir?: string;
}

export class SingboxDriver {
  private readonly stateDir: string;
  private readonly certDir: string;
  private statsIntervalMs = STATS_INTERVAL_DEFAULT_MS;

  private binaryPath = "";
  private binaryVersion = "";

  private proc: ChildProcess | null = null;
  private pid: number | null = null;
  private running = false;
  private stopping = false;
  private wantRunning = false;

  private configPath = "";
  private configHash = "";
  private apiPort: number | null = null;
  private ports: number[] = [];
  private protocols: Record<string, number> = {};
  private userCount = 0;
  private lastError = "";
  private idleReason = "";
  private restartCount = 0; // manual + auto restarts of the ONE process
  private autoAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private logBuf: string[] = [];

  private regenTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private statsBusy = false;
  private startLock: Promise<void> | null = null;
  private bootedAt = Date.now();
  private eventCounter = 0;

  // traffic accounting (clash_api)
  private txBytes = 0;
  private rxBytes = 0;
  private prevTotals: { up: number; down: number } | null = null;
  private readonly connPrev = new Map<string, { up: number; down: number }>();
  private perInbound: Record<string, { txBytes: number; rxBytes: number }> = {};
  private liveConnections = 0;
  private lastStatsAt = 0;
  private lastStatsError = "";

  /** Optional event sink wired by server.ts (socket activity feed). */
  onEvent: ((event: ActivityEvent) => void) | null = null;

  constructor(opts: SingboxDriverOptions = {}) {
    this.stateDir = opts.stateDir ?? path.resolve(process.cwd(), "db", "core", "singbox");
    this.certDir = opts.certDir ?? path.resolve(process.cwd(), "db", "certs");
    if (opts.statsIntervalMs && opts.statsIntervalMs >= 5_000 && opts.statsIntervalMs <= 120_000) {
      this.statsIntervalMs = opts.statsIntervalMs;
    }

    // orphan protection — sync kill on process exit (same as the xray driver)
    const onExit = (): void => {
      if (this.pid) {
        try {
          process.kill(this.pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
    };
    process.on("exit", onExit);
  }

  /* ------------------------------------------------------------ lifecycle */

  /** Resolve the binary once, then reconcile against the store. */
  start(): Promise<void> {
    if (this.startLock) return this.startLock;
    this.startLock = (async () => {
      this.idleReason = "";
      if (!this.shouldRun()) {
        this.idleReason = this.gateReason();
        return;
      }
      await this.ensureBinary();
      await this.reconcile(true);
      this.startStatsTimer();
    })().finally(() => {
      this.startLock = null;
    });
    return this.startLock;
  }

  async stop(): Promise<void> {
    this.wantRunning = false;
    this.stopStatsTimer();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    await this.killProcess("admin stop");
    this.idleReason = "stopped by admin";
  }

  async restart(): Promise<void> {
    await this.stop();
    this.idleReason = "";
    await this.start();
  }

  /** Regen config from the store; restart only when it changed. */
  async reload(): Promise<void> {
    if (!this.shouldRun()) {
      await this.stop();
      this.idleReason = this.gateReason();
      return;
    }
    await this.ensureBinary();
    await this.reconcile(true);
    this.startStatsTimer();
  }

  async dispose(): Promise<void> {
    this.wantRunning = false;
    this.stopRegenTimer();
    this.stopStatsTimer();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    await this.killProcess("dispose");
  }

  /** server.ts calls this every 2s — debounced store diff + reconcile. */
  mirrorDb(): void {
    this.scheduleRegen();
  }

  version(): string {
    return this.binaryVersion;
  }

  /* ------------------------------------------------------------- gating */

  /** sing-box only rides the REAL xray driver (the simulator spawns no cores). */
  private driverActive(): boolean {
    try {
      return db._syncReadSetting("set_core_driver") === "xray";
    } catch {
      return false;
    }
  }

  private singboxEnabled(): boolean {
    try {
      return db._syncReadSetting("set_core_singbox_enabled") !== "0";
    } catch {
      return true;
    }
  }

  private shouldRun(): boolean {
    return this.driverActive() && this.singboxEnabled();
  }

  private gateReason(): string {
    if (!this.driverActive()) return "idle — core driver is the simulator";
    if (!this.singboxEnabled()) return "disabled in settings (set_core_singbox_enabled)";
    return "";
  }

  /* ----------------------------------------------------------- mirroring */

  private scheduleRegen(): void {
    if (this.regenTimer) return;
    this.regenTimer = setTimeout(() => {
      this.regenTimer = null;
      void this.reconcile(false).catch((err) => {
        this.log(`reconcile error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, REGEN_DEBOUNCE_MS);
  }

  private stopRegenTimer(): void {
    if (this.regenTimer) {
      clearTimeout(this.regenTimer);
      this.regenTimer = null;
    }
  }

  private async ensureBinary(): Promise<void> {
    if (this.binaryPath && this.binaryVersion && existsSync(this.binaryPath)) return;
    const bin = await ensureSingboxBinary({ log: (m) => this.log(m) });
    this.binaryPath = bin.path;
    this.binaryVersion = bin.version;
    this.log(`binary: ${bin.path} (${bin.version}, source: ${bin.source})`);
  }

  /**
   * Sync the ONE sing-box process with the store's hysteria2 + tuic rows:
   *   config changed → check + pre-flight + restart the process
   *   nothing to serve → stop the process
   */
  private async reconcile(force: boolean): Promise<void> {
    if (!this.shouldRun()) {
      if (this.proc || this.running) await this.killProcess("gate changed");
      this.idleReason = this.gateReason();
      return;
    }

    let rows: InboundRowLike[] = [];
    try {
      rows = (db._syncReadInboundsFull() as InboundRowLike[]).filter(
        (r) => (r.protocol === "hysteria2" || r.protocol === "tuic") && r.status === "online"
      );
    } catch {
      return;
    }

    const built = await this.buildConfig(rows);
    if (built.skipped.length > 0) {
      for (const s of built.skipped) this.log(s);
    }

    if (built.hash === this.configHash && this.running && !force) {
      return; // unchanged — nothing to do
    }
    if (built.inboundCount === 0) {
      // nothing to serve → tear down (also covers rows-all-offline)
      if (this.proc || this.running) await this.killProcess("no hy2/tuic inbounds");
      this.configHash = built.hash;
      this.idleReason = "no enabled hysteria2/tuic inbound";
      return;
    }

    this.configHash = built.hash;
    this.configPath = built.configPath;
    this.ports = built.ports;
    this.protocols = built.protocols;
    this.userCount = built.users;

    try {
      await this.spawnProcess();
      this.onEvent?.(
        this.makeEvent("inbound.updated", "success", {
          inbound: built.ports.join("+"),
          port: built.ports[0] ?? 0,
          detail: `sing-box core ${force ? "reloaded" : "started"} (${built.inboundCount} hy2/tuic)`,
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.running = false;
      this.log(`start failed: ${msg}`);
      this.onEvent?.(
        this.makeEvent("inbound.updated", "warn", {
          inbound: "sing-box",
          port: built.ports[0] ?? 0,
          detail: "sing-box core failed",
        })
      );
      throw err;
    }
  }

  /* ------------------------------------------------------- config builder */

  /** TLS material: managed PEM / managed paths from the stream, else self-signed. */
  private resolveTls(tag: string, stream: InboundStream, listen: string): TlsMaterial {
    mkdirSync(this.certDir, { recursive: true });
    const t = safeTag(tag);
    const certPem = str(stream.certPublic).trim();
    const keyPem = str(stream.certPrivate).trim();
    const isPem = (v: string): boolean => v.includes("-----BEGIN");
    const isPath = (v: string): boolean => v.startsWith("/") && !v.includes("\n") && !v.includes("-----BEGIN");

    if (isPem(certPem) && isPem(keyPem)) {
      const certPath = path.join(this.certDir, `${t}-managed.crt`);
      const keyPath = path.join(this.certDir, `${t}-managed.key`);
      writeIfChanged(certPath, certPem.endsWith("\n") ? certPem : certPem + "\n");
      writeIfChanged(keyPath, keyPem.endsWith("\n") ? keyPem : keyPem + "\n");
      return { certPath, keyPath, source: "managed" };
    }
    // Task 23-f managed-cert picker stores absolute file paths
    if (isPath(certPem) && isPath(keyPem) && existsSync(certPem) && existsSync(keyPem)) {
      return { certPath: certPem, keyPath: keyPem, source: "managed" };
    }
    const certPath = path.join(this.certDir, `${t}-self.crt`);
    const keyPath = path.join(this.certDir, `${t}-self.key`);
    if (!existsSync(certPath) || !existsSync(keyPath)) {
      const host = certHost(stream, listen);
      const { certPem: c, keyPem: k } = generateSelfSignedCert(host);
      writeIfChanged(certPath, c);
      writeIfChanged(keyPath, k);
      this.log(`${tag}: self-signed certificate generated (CN=${host}, 10y)`);
    }
    return { certPath, keyPath, source: "self-signed" };
  }

  private async buildConfig(rows: InboundRowLike[]): Promise<SbBuild> {
    mkdirSync(this.stateDir, { recursive: true });

    const inbounds: Record<string, unknown>[] = [];
    const ports: number[] = [];
    const protocols: Record<string, number> = {};
    const tlsByTag = new Map<string, TlsMaterial>();
    const skipped: string[] = [];
    let users = 0;

    for (const row of rows) {
      const stream = parseLoose<InboundStream>(row.streamJson, {});
      const clients = (parseClients(row.clientsJson) as (InboundClient & { ownerId?: string })[])
        .filter((c) => c.enabled !== false && c.email && c.key);

      if (clients.length === 0) {
        skipped.push(`${row.tag}: no enabled client with a key — skipped`);
        continue;
      }

      const tls = this.resolveTls(row.tag, stream, row.listen);
      const tlsObj: Record<string, unknown> = {
        enabled: true,
        certificate_path: tls.certPath,
        key_path: tls.keyPath,
      };

      if (row.protocol === "hysteria2") {
        const sbUsers = clients.map((c) => ({ name: c.email, password: c.key }));
        const inbound: Record<string, unknown> = {
          type: "hysteria2",
          tag: row.tag,
          listen: (row.listen || "").trim() || "0.0.0.0",
          listen_port: Number(row.port),
          users: sbUsers,
          ignore_client_bandwidth: false,
          tls: tlsObj,
        };
        const up = num(stream.upMbps);
        const down = num(stream.downMbps);
        if (up > 0) inbound.up_mbps = up;
        if (down > 0) inbound.down_mbps = down;
        const obfsPassword = str(stream.obfsPassword).trim();
        if (obfsPassword) {
          inbound.obfs = { type: "salamander", password: obfsPassword };
        }
        const masquerade = str(stream.hy2Masquerade).trim();
        if (masquerade) {
          inbound.masquerade = masquerade; // verified: accepted field in sing-box ≥1.14
        }
        inbounds.push(inbound);
        ports.push(Number(row.port));
        protocols.hysteria2 = (protocols.hysteria2 ?? 0) + 1;
        tlsByTag.set(row.tag, tls);
        users += sbUsers.length;
      } else if (row.protocol === "tuic") {
        const sbUsers: Array<{ name: string; uuid: string; password: string }> = [];
        for (const c of clients) {
          // the client key IS the wire composite "uuid:password" (tuic:// form)
          const sep = c.key.indexOf(":");
          const uuid = sep > 0 ? c.key.slice(0, sep).trim() : "";
          const password = sep > 0 ? c.key.slice(sep + 1).trim() : "";
          if (!uuid || !password) {
            skipped.push(
              `${row.tag}: client "${c.email}" key must be uuid:password for TUIC — skipped`
            );
            continue;
          }
          sbUsers.push({ name: c.email, uuid, password });
        }
        if (sbUsers.length === 0) {
          skipped.push(`${row.tag}: no usable tuic user (need uuid:password keys) — skipped`);
          continue;
        }
        const ccRaw = str(stream.tuicCongestion).trim();
        const congestion = ["bbr", "cubic", "new_reno"].includes(ccRaw) ? ccRaw : "bbr";
        const alpn = csv(stream.alpn);
        tlsObj.alpn = alpn.length > 0 ? alpn : ["h3"];
        const inbound: Record<string, unknown> = {
          type: "tuic",
          tag: row.tag,
          listen: (row.listen || "").trim() || "0.0.0.0",
          listen_port: Number(row.port),
          users: sbUsers,
          congestion_control: congestion,
          auth_timeout: "3s",
          zero_rtt_handshake: false,
          heartbeat: "10s",
          tls: tlsObj,
        };
        inbounds.push(inbound);
        ports.push(Number(row.port));
        protocols.tuic = (protocols.tuic ?? 0) + 1;
        tlsByTag.set(row.tag, tls);
        users += sbUsers.length;
      } else {
        skipped.push(`${row.tag}: ${row.protocol} is not a sing-box inbound — skipped`);
      }
    }

    // loopback stats door — stable across restarts (persisted like the sidecar secret)
    const apiPort = await this.resolveApiPort();

    const rawLevel = db._syncReadSetting("set_xray_log_level") ?? "";
    const logLevel = LOG_LEVEL_MAP[rawLevel] ?? "warn";

    const doc: Record<string, unknown> = {
      log: { level: logLevel, timestamp: true },
      inbounds,
      outbounds: [{ type: "direct", tag: "direct" }],
      experimental: {
        clash_api: {
          external_controller: `127.0.0.1:${apiPort}`,
          default_mode: "rule",
        },
      },
    };

    const json = JSON.stringify(doc, null, 2) + "\n";
    const configPath = path.join(this.stateDir, "config.json");
    writeIfChanged(configPath, json);

    return {
      json,
      hash: hashStr(json),
      apiPort,
      configPath,
      inboundCount: inbounds.length,
      ports,
      protocols,
      users,
      tlsByTag,
      skipped,
    };
  }

  private async resolveApiPort(): Promise<number> {
    const marker = path.join(this.stateDir, "clash-api.port");
    try {
      if (existsSync(marker)) {
        const p = Number(readFileSync(marker, "utf8").trim());
        if (Number.isInteger(p) && p > 1024 && p < 65536) return p;
      }
    } catch {
      /* re-resolve below */
    }
    const p = await findFreePort();
    try {
      writeFileSync(marker, String(p), { mode: 0o644 });
    } catch {
      /* non-fatal */
    }
    return p;
  }

  /* ------------------------------------------------------------- spawning */

  private async spawnProcess(): Promise<void> {
    if (!this.binaryPath) throw new Error("sing-box binary not resolved yet");
    if (!this.configPath || !existsSync(this.configPath)) {
      throw new Error("sing-box config not generated yet");
    }
    this.wantRunning = true;
    this.lastError = "";

    // free a stale sibling from a crashed panel first (same pattern as sidecars)
    await this.killStaleFromPidFile();

    // 1) validate — `sing-box check -c` (strict schema + reads the cert files)
    const check = await this.runBinary(["check", "-c", this.configPath]);
    if (check.code !== 0) {
      const msg = `config rejected by 'sing-box check': ${
        (check.stderr || check.stdout || "exit " + check.code).split("\n")[0]?.slice(0, 300)
      }`;
      this.log(msg);
      throw new Error(msg);
    }

    // 2) UDP pre-flight — hy2/tuic are QUIC (UDP); a taken port fails loudly here
    for (const port of this.ports) {
      if (!(await udpTaken(port))) continue;
      const msg = `sing-box UDP port ${port} is already in use`;
      this.log(msg);
      throw new Error(msg);
    }

    // 3) spawn
    const child = spawn(this.binaryPath, ["run", "-c", this.configPath], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.proc = child;
    this.pid = child.pid ?? null;
    this.writePidFile();
    this.attachLogPipe(child);

    child.on("error", (err) => {
      this.lastError = err.message;
      this.log(`spawn error: ${err.message}`);
    });
    child.on("exit", (code, signal) => {
      const wasRunning = this.running;
      this.running = false;
      this.pid = null;
      this.proc = null;
      this.removePidFile();
      if (this.stopping) {
        this.log(`sing-box stopped (code=${code ?? "-"} signal=${signal ?? "-"})`);
        return;
      }
      this.log(`sing-box exited unexpectedly (code=${code ?? "-"} signal=${signal ?? "-"})`);
      if (wasRunning || this.wantRunning) {
        this.restartCount += 1;
        this.scheduleAutoRestart();
      }
    });

    // 4) health: wait for the UDP listeners (QUIC)
    for (const port of this.ports) {
      const ok = await waitUdpPort(port, PORT_WAIT_MS);
      if (!ok) {
        const msg = `sing-box did not open UDP port ${port} within ${PORT_WAIT_MS / 1000}s`;
        this.log(msg);
        await this.killProcess("port wait failed");
        throw new Error(msg);
      }
    }
    this.running = true;
    this.bootedAt = Date.now();
    this.autoAttempts = 0;
    this.lastStatsError = "";
    this.prevTotals = null;
    this.connPrev.clear();
    this.log(`sing-box running (pid ${this.pid}, udp ${this.ports.join("+")}, api ${this.apiPort})`);
  }

  private scheduleAutoRestart(): void {
    if (!this.wantRunning) return;
    if (this.autoAttempts >= RESTART_MAX) {
      this.lastError = `sing-box keeps exiting — gave up after ${RESTART_MAX} restart attempts`;
      this.log(this.lastError);
      return;
    }
    const delay = RESTART_BACKOFF_MS[Math.min(this.autoAttempts, RESTART_BACKOFF_MS.length - 1)] ?? 30_000;
    this.autoAttempts += 1;
    this.log(`auto-restart ${this.autoAttempts}/${RESTART_MAX} in ${delay / 1000}s`);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.wantRunning || this.proc) return;
      void this.spawnProcess()
        .then(() => {
          this.lastError = "";
          this.autoAttempts = 0;
          this.log(`sing-box recovered (pid ${this.pid})`);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.lastError = msg;
          this.log(`auto-restart failed: ${msg}`);
          this.scheduleAutoRestart();
        });
    }, delay);
  }

  private runBinary(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(this.binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
        resolve({ code: -1, stdout, stderr: stderr + "\ntimeout" });
      }, 30_000);
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: String(err) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
  }

  private async killProcess(reason: string): Promise<void> {
    const child = this.proc;
    if (!child) {
      this.running = false;
      return;
    }
    this.stopping = true;
    try {
      await new Promise<void>((resolve) => {
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
      this.log(`sing-box stopped (${reason})`);
    } finally {
      this.stopping = false;
      this.running = false;
      this.proc = null;
      this.pid = null;
      this.removePidFile();
    }
  }

  /* -------------------------------------------------------------- pid file */

  private pidFilePath(): string {
    return path.join(this.stateDir, "sing-box.pid");
  }

  private writePidFile(): void {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      if (this.pid) writeFileSync(this.pidFilePath(), String(this.pid), { mode: 0o644 });
    } catch {
      /* non-fatal */
    }
  }

  private removePidFile(): void {
    try {
      rmSync(this.pidFilePath(), { force: true });
    } catch {
      /* non-fatal */
    }
  }

  /** true when /proc/<pid>/cmdline (linux) mentions sing-box — avoids a recycled pid */
  private pidLooksLikeSingbox(pid: number): boolean {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return /sing-box/i.test(cmd);
    } catch {
      return false;
    }
  }

  private async killStaleFromPidFile(): Promise<void> {
    try {
      const p = this.pidFilePath();
      if (!existsSync(p)) return;
      const pid = Number(readFileSync(p, "utf8").trim());
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
      if (!this.pidLooksLikeSingbox(pid)) return;
      this.log(`killing stale sing-box from a previous run (pid ${pid})`);
      process.kill(pid, "SIGTERM");
      await sleep(700);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* gone */
      }
      this.removePidFile();
    } catch {
      /* best effort */
    }
  }

  /* -------------------------------------------------------------- logging */

  private log(line: string): void {
    const ts = new Date().toISOString().slice(11, 19);
    this.logBuf.push(`[${ts}] ${line}`);
    if (this.logBuf.length > LOG_CAP) this.logBuf.shift();
  }

  private attachLogPipe(child: ChildProcess): void {
    const pump = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream) return;
      let acc = "";
      stream.on("data", (chunk: Buffer) => {
        acc += chunk.toString();
        let idx = acc.indexOf("\n");
        while (idx !== -1) {
          const line = acc.slice(0, idx).replace(/\r$/, "");
          if (line.trim()) this.log(line);
          acc = acc.slice(idx + 1);
          idx = acc.indexOf("\n");
        }
        if (acc.length > 8000) acc = "";
      });
    };
    pump(child.stdout);
    pump(child.stderr);
  }

  /* ---------------------------------------------------------------- stats */

  private startStatsTimer(): void {
    this.stopStatsTimer();
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

  /**
   * clash_api /connections — the ONLY stats surface in the official release
   * build (no with_v2ray_api tag). uploadTotal/downloadTotal are cumulative
   * session bytes (exact); per-connection `metadata.inbound` attribution is
   * best-effort (connections that close between polls are invisible).
   */
  private async pollStats(): Promise<void> {
    if (this.statsBusy || !this.running || !this.apiPort) return;
    this.statsBusy = true;
    try {
      const res = await fetch(`http://127.0.0.1:${this.apiPort}/connections`, {
        headers: { "User-Agent": "Sephiroth-Panel" },
        signal: AbortSignal.timeout(STATS_HTTP_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.lastStatsError = `clash api HTTP ${res.status}`;
        return;
      }
      const data = (await res.json()) as {
        connections?: Array<{
          id?: string;
          upload?: number;
          download?: number;
          metadata?: { inbound?: string };
        }> | null;
        uploadTotal?: number;
        downloadTotal?: number;
      };

      // global cumulative totals → window deltas
      const up = Math.max(0, Number(data.uploadTotal ?? 0) || 0);
      const down = Math.max(0, Number(data.downloadTotal ?? 0) || 0);
      if (this.prevTotals) {
        const dUp = up >= this.prevTotals.up ? up - this.prevTotals.up : up;
        const dDown = down >= this.prevTotals.down ? down - this.prevTotals.down : down;
        if (dUp > 0) this.txBytes += dUp;
        if (dDown > 0) this.rxBytes += dDown;
      }
      this.prevTotals = { up, down };

      // per-inbound attribution from open connections
      const conns = Array.isArray(data.connections) ? data.connections : [];
      this.liveConnections = conns.length;
      const seenIds = new Set<string>();
      for (const conn of conns) {
        const id = String(conn.id ?? "");
        if (!id) continue;
        seenIds.add(id);
        const cu = Math.max(0, Number(conn.upload ?? 0) || 0);
        const cd = Math.max(0, Number(conn.download ?? 0) || 0);
        const prev = this.connPrev.get(id) ?? { up: 0, down: 0 };
        const dUp = cu >= prev.up ? cu - prev.up : cu;
        const dDown = cd >= prev.down ? cd - prev.down : cd;
        this.connPrev.set(id, { up: cu, down: cd });
        if (dUp <= 0 && dDown <= 0) continue;
        const inbound = String(conn.metadata?.inbound ?? "").trim();
        if (!inbound) continue;
        const agg = (this.perInbound[inbound] ??= { txBytes: 0, rxBytes: 0 });
        agg.txBytes += dUp;
        agg.rxBytes += dDown;
      }
      for (const id of [...this.connPrev.keys()]) {
        if (!seenIds.has(id)) this.connPrev.delete(id); // closed — its tail bytes are lost (documented)
      }

      this.lastStatsAt = Date.now();
      this.lastStatsError = "";
    } catch (err) {
      this.lastStatsError = `clash api poll failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.statsBusy = false;
    }
  }

  /* --------------------------------------------------------------- status */

  status(): SingboxStatus {
    return {
      running: this.running,
      version: this.binaryVersion,
      pid: this.pid,
      startedAt: this.bootedAt,
      uptimeMs: this.running ? Date.now() - this.bootedAt : 0,
      apiPort: this.apiPort,
      ports: [...this.ports],
      protocols: { ...this.protocols },
      users: this.userCount,
      lastError: this.lastError,
      restarts: this.restartCount,
      logTail: this.logBuf.slice(-LOG_TAIL),
      configPath: this.configPath,
      idleReason: this.running ? "" : this.idleReason || this.gateReason(),
      txBytes: this.txBytes,
      rxBytes: this.rxBytes,
      perInbound: Object.fromEntries(
        Object.entries(this.perInbound).map(([tag, v]) => [tag, { ...v }])
      ),
      liveConnections: this.liveConnections,
      lastStatsAt: this.lastStatsAt,
      lastStatsError: this.lastStatsError,
    };
  }

  private makeEvent(
    kind: ActivityEvent["kind"],
    level: ActivityEvent["level"],
    params: Record<string, string | number>
  ): ActivityEvent {
    this.eventCounter++;
    return { id: `sb-${this.eventCounter}`, ts: Date.now(), level, kind, params };
  }
}
