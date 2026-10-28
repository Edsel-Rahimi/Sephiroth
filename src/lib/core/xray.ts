/**
 * Sephiroth core adapter — REAL Xray driver (server-only).
 *
 * Runs an actual `xray` process built from the panel store:
 *   lifecycle  ensure binary → generate config → `run -test` → pre-flight
 *              port check → spawn → wait for listeners → poll stats
 *   stats      `xray api statsquery --server=127.0.0.1:<apiPort> -pattern ""`
 *              every set_core_stats_interval; DELTAS (the counters are
 *              cumulative) are written straight into the store:
 *                user>>>email>>>uplink/downlink → ClientUser.usedTrafficGb
 *                outbound>>>tag>>>uplink/downlink → Outbound.upBytes/downBytes
 *                inbound>>>tag>>>uplink/downlink → per-tag session traffic
 *   online     a user is "online" while its counters kept moving during the
 *              last 2 poll windows (replaces the simulator's random churn)
 *   telemetry  host cpu/ram/disk/net measured for real (same code as core-sim)
 *   resilience crash → auto-restart with 3s/10s/30s backoff (max 5 attempts);
 *              process-exit/SIGTERM cleanup so no xray orphan survives
 */

import { spawn, type ChildProcess } from "node:child_process";
import dgram from "node:dgram";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { IpTracker, parseAccessIps } from "@/lib/ip-limit";
import { logActivity } from "@/lib/activity";
import { notifyUserActivated } from "@/lib/bot/notify"; // 26-a — bot alert on first connect
import { syncUserProjection } from "@/lib/user-sync"; // Task 23-b — flip embedded clients on auto-disable
import type {
  ActivityEvent,
  CoreBackend,
  CoreBackendStatus,
  CoreInbound,
  CoreInboundsPayload,
  CoreSnapshot,
  CoreTick,
  CoreUserStat,
} from "@/lib/core/types";
import {
  asInboundStatus,
  clamp,
  composeProto,
  cpuTimes,
  diskPct,
  pushRing,
  ramPct,
  readNetCounters,
  round1,
  round2,
  round4,
  type CpuTimes,
  type NetSample,
} from "@/lib/core/host-metrics";
import {
  buildXrayServerConfig,
  checkPortsFree,
  findFreePort,
  UDP_ONLY_TRANSPORTS,
  type PortConflict,
} from "@/lib/core/config-builder";
import { ensureXrayBinary } from "@/lib/core/bin-manager";

const BYTES_PER_GB = 1024 ** 3;
const SERIES_LEN = 60;
const MAX_EVENTS = 120;
const SNAPSHOT_EVENTS = 24;
const LOG_CAP = 500;
const STATS_INTERVAL_DEFAULT_MS = 10_000;
const ONLINE_WINDOW_MULTIPLIER = 2;
const PORT_WAIT_MS = 10_000;
const STOP_GRACE_MS = 5_000;
const REGEN_DEBOUNCE_MS = 1_500;
const RESTART_BACKOFF_MS = [3_000, 10_000, 30_000];
const RESTART_MAX = 5;

/** Task 23-g — access-log tail cadence + read cap (bytes per poll). */
const ACCESS_POLL_MS = 5_000;
const ACCESS_MAX_CHUNK = 512 * 1024;
/** Settings key — concurrent-IP auto-disable kill switch (default ON, "0" = warn only). */
const ENFORCE_IP_LIMIT_KEY = "set_enforce_ip_limit";

/**
 * Exact CLI syntax for the stats API (flags verified against the real
 * binary; only the server host:port is substituted per call).
 */
const STATS_ARGS = ["api", "statsquery", "--server=127.0.0.1", "-pattern", ""];

interface StatEntry {
  name: string;
  value: string | number;
}

interface FullInboundRow {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  listen: string;
  transport: string;
  security: string;
  status: string;
  clientsJson: string;
  sniffingJson: string;
  streamJson: string;
}

interface StoreCoreStats {
  usersTotal: number;
  groupsTotal: number;
  limitedCount: number;
  monthTxGb: number;
  topUsers: Array<{
    uid: string;
    user: string;
    protoBase: { protocol: string; transport: string; security: string } | null;
    gb: number;
    expiresAtMs: number | null;
    usagePct: number | null;
  }>;
}

export interface XrayDriverOptions {
  /** binary override (settings · set_core_xray_bin) */
  binPath?: string;
  /** release tag pin, "" = latest (settings · set_core_xray_version) */
  versionPin?: string;
  /** stats poll interval ms (settings · set_core_stats_interval) */
  statsIntervalMs?: number;
  /** config/log/pid dir, defaults to <cwd>/db/core */
  stateDir?: string;
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

function firstLines(s: string, n: number): string {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n)
    .join(" | ")
    .slice(0, 400);
}

function countClients(clientsJson: string): number {
  try {
    const arr = JSON.parse(clientsJson) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Rows the built Xray config actually serves (by tag) — used for the port
 * pre-flight and the spawn wait so sidecar-only protocols (hysteria2, v2.5)
 * never stall or fail the core lifecycle.
 */
function servedInboundRows(
  rows: FullInboundRow[],
  built: { config: { inbounds?: unknown } }
): FullInboundRow[] {
  const inb = built.config?.inbounds;
  const tags = new Set<string>(
    Array.isArray(inb)
      ? inb
          .map((i) => (i && typeof i === "object" ? String((i as { tag?: unknown }).tag ?? "") : ""))
          .filter(Boolean)
      : []
  );
  return rows.filter((r) => tags.has(r.tag));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function tcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * UDP "is it listening" probe: UDP has no connect, so we try to BIND the
 * port — EADDRINUSE means another socket (the core) already holds it.
 * Binding 0.0.0.0 is the superset probe: it conflicts with any UDP bind
 * of that port on any address.
 */
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
      sock.bind({ port, address: "0.0.0.0" }, () => done(false)); // bound fine → nobody there
    } catch {
      done(false);
    }
  });
}

/** true when /proc/<pid>/cmdline (linux) mentions xray — avoids killing a recycled pid */
function pidLooksLikeXray(pid: number): boolean {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return /xray/i.test(cmd);
  } catch {
    return false; // not running (or not linux) — don't touch it
  }
}

export class XrayDriver implements CoreBackend {
  readonly kind = "xray" as const;

  // process state
  private proc: ChildProcess | null = null;
  private pid: number | null = null;
  private binaryPath = "";
  private binaryVersion = "";
  private apiPort = 0;
  private configPath = "";
  private running = false;
  private stopping = false;
  private wantRunning = false;
  private startLock: Promise<void> | null = null;
  private lastError = "";
  private restartCount = 0;
  private autoAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private readonly bootedAt = Date.now();

  // options
  private readonly stateDir: string;
  private readonly binPathOpt: string;
  private readonly versionPinOpt: string;
  private statsIntervalMs = STATS_INTERVAL_DEFAULT_MS;

  // stats polling
  private statsTimer: NodeJS.Timeout | null = null;
  private statsBusy = false;
  private lastStatsAt = 0;

  // traffic accounting (deltas vs the previous cumulative poll)
  private userPrev = new Map<string, number>();
  private userDeltaHist = new Map<string, number[]>(); // email → last 8 deltas
  private lastUserDelta = new Map<string, number>(); // email → bytes, last poll
  private userLastSeen = new Map<string, number>(); // email → epoch ms of last movement
  private outboundPrev = new Map<string, number>();
  private inboundPrev = new Map<string, number>();
  private inboundTxBytes = new Map<string, number>(); // tag → session bytes

  // telemetry (same shape as CoreSim)
  private cpu = 0;
  private ram = 0;
  private ramUsedMb = 0;
  private readonly ramTotalMb = Math.round(os.totalmem() / 1048576);
  private disk = 0;
  private netIn = 0;
  private netOut = 0;
  private peakToday = 0;
  private avgToday = 0;
  private lastCpu: CpuTimes = cpuTimes();
  private lastNet: NetSample = readNetCounters();
  private lastNetAt = Date.now();
  private tickCount = 0;
  private statsAt = 0;

  // store-derived aggregates
  private monthTxGb = 0;
  private usersTotal = 0;
  private groupsTotal = 0;
  private limitedCount = 0;
  private topUsers: CoreUserStat[] = [];

  // series + mirror state
  private readonly sCpu: number[] = [];
  private readonly sRam: number[] = [];
  private readonly sNetIn: number[] = [];
  private readonly sNetOut: number[] = [];
  private inbounds: CoreInbound[] = [];
  private readonly events: ActivityEvent[] = [];
  private eventCounter = 0;
  private readonly protoOverrides = new Map<string, string>([
    ["ss-2022", "Shadowsocks · 2022"],
    ["hy2-edge", "Hysteria2 · UDP"],
    ["legacy-ss", "Shadowsocks · legacy"],
  ]);

  // logs + config fingerprint + housekeeping
  private readonly logBuf: string[] = [];
  private lastConfigHash = "";
  private regenTimer: NodeJS.Timeout | null = null;
  private readonly distribution = { connectedPct: 0, idlePct: 0, limitedPct: 0 };
  private readonly processListeners: Array<() => void> = [];

  // Task 23-g — concurrent-IP tracking from the file access log
  private readonly ipTracker = new IpTracker();
  private accessLogPath = "";
  private accessOffset = 0;
  private accessTimer: NodeJS.Timeout | null = null;
  private ipAccessBusy = false;
  private readonly ipBreached = new Set<string>();

  constructor(opts: XrayDriverOptions = {}) {
    this.stateDir = opts.stateDir ?? path.resolve(process.cwd(), "db", "core");
    this.accessLogPath = path.join(this.stateDir, "access.log");
    this.binPathOpt = opts.binPath ?? "";
    this.versionPinOpt = opts.versionPin ?? "";
    if (opts.statsIntervalMs && opts.statsIntervalMs >= 5_000 && opts.statsIntervalMs <= 120_000) {
      this.statsIntervalMs = opts.statsIntervalMs;
    }
    this.refreshStoreStats();

    // honest flat series — real values arrive with the ticks
    this.measureHost(true);
    for (let i = 0; i < SERIES_LEN; i++) {
      pushRing(this.sCpu, this.cpu, SERIES_LEN);
      pushRing(this.sRam, this.ram, SERIES_LEN);
      pushRing(this.sNetIn, 0, SERIES_LEN);
      pushRing(this.sNetOut, 0, SERIES_LEN);
    }

    // orphan protection — sync kill on process exit, async dispose otherwise
    const onExit = (): void => this.killChildSync();
    process.on("exit", onExit);
    process.on("beforeExit", onExit);
    this.processListeners.push(() => {
      process.removeListener("exit", onExit);
      process.removeListener("beforeExit", onExit);
    });
  }

  /* ------------------------------------------------------------ lifecycle */

  /** Build + validate + spawn the real core. Throws with human reasons. */
  start(): Promise<void> {
    if (this.startLock) return this.startLock;
    this.startLock = this.doStart().finally(() => {
      this.startLock = null;
    });
    return this.startLock;
  }

  private async doStart(): Promise<void> {
    this.wantRunning = true;
    this.lastError = "";
    try {
      await this.spawnCore();
      this.autoAttempts = 0;
      this.log(`core started (pid ${this.pid})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.log(`start failed: ${msg}`);
      throw err;
    }
  }

  private async spawnCore(): Promise<void> {
    // 0) never leave an orphan from a previous crashed panel behind
    await this.killStaleFromPidFile();

    // 1) binary
    this.log("resolving xray binary…");
    const bin = await ensureXrayBinary({
      binPath: this.binPathOpt,
      versionPin: this.versionPinOpt,
      log: (m) => this.log(m),
    });
    this.binaryPath = bin.path;
    this.binaryVersion = bin.version;
    this.log(`binary: ${bin.path} (${bin.version}, source: ${bin.source})`);

    // 2) stats-api door port
    this.apiPort = await findFreePort();

    // 3) config + pre-flight port check (only meaningful before we own ports).
    //    IMPORTANT: only inbounds the built config actually serves are probed
    //    (v2.5 — hysteria2 rows are sidecar-served, skipped by the builder, and
    //    must NOT block or stall the core start).
    const built = buildXrayServerConfig(this.apiPort, {
      // Task 23-b — the access log is only written while at least one user has
      // an IP limit (the tracker has nothing to enforce otherwise).
      accessLogPath: this.accessLogActive() ? this.accessLogPath : undefined,
    });
    for (const s of built.skipped) this.log(`config: ${s}`);
    const enabledRows = db._syncReadInboundsFull().filter((r) => r.status === "online");
    const servedRows = servedInboundRows(enabledRows, built);
    const conflicts: PortConflict[] = this.running ? [] : await checkPortsFree(servedRows);
    if (conflicts.length > 0) {
      const detail = conflicts
        .map((c) => `${c.tag} → ${c.listen}:${c.port} occupied`)
        .join("; ");
      throw new Error(`port(s) already in use: ${detail}`);
    }

    mkdirSync(this.stateDir, { recursive: true });
    this.configPath = path.join(this.stateDir, "config.json");
    writeFileSync(this.configPath, built.json, { mode: 0o600 });

    // 4) config validation via the real binary
    const test = await this.runBinary(["run", "-test", "-c", this.configPath], 20_000);
    if (test.code !== 0) {
      throw new Error(`config rejected by xray: ${firstLines(test.stderr || test.stdout, 6)}`);
    }
    this.lastConfigHash = hash(built.json);

    // 5) spawn (in-process child — dies with us unless we deliberately detach)
    this.log(`spawning: xray run -c ${this.configPath}`);
    const child = spawn(this.binaryPath, ["run", "-c", this.configPath], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.proc = child;
    this.pid = child.pid ?? null;
    this.writePidFile();
    this.attachLogPipe(child);

    child.on("error", (err) => {
      this.log(`spawn error: ${err.message}`);
      this.lastError = err.message;
    });
    child.on("exit", (code, signal) => {
      const wasRunning = this.running;
      this.running = false;
      this.pid = null;
      this.proc = null;
      this.removePidFile();
      this.stopStatsTimer();
      this.stopAccessTail();
      if (this.stopping) {
        this.log(`core stopped (code=${code ?? "-"} signal=${signal ?? "-"})`);
        return;
      }
      this.log(`core exited unexpectedly (code=${code ?? "-"} signal=${signal ?? "-"})`);
      if (wasRunning || this.wantRunning) {
        this.restartCount += 1;
        this.scheduleAutoRestart();
      }
    });

    // 6) wait until every served inbound port is open — TCP ports are
    //    connect-probed; UDP-only transports (mKCP / WireGuard) are probed by
    //    trying to bind their port (EADDRINUSE = the core is listening).
    //    Sidecar-served rows (hysteria2) never appear here — v2.5.
    const tcpRows = servedRows.filter((r) => !UDP_ONLY_TRANSPORTS.has(r.transport));
    const udpRows = servedRows.filter((r) => UDP_ONLY_TRANSPORTS.has(r.transport));
    const ports = tcpRows.map((r) => Number(r.port));
    const udpPorts = udpRows.map((r) => Number(r.port));
    const ok = await this.waitPorts(ports, udpPorts, PORT_WAIT_MS);
    if (!ok) {
      const msg = `core did not open port(s) [${[...ports, ...udpPorts].join(", ")}] within ${PORT_WAIT_MS / 1000}s`;
      this.log(msg);
      await this.killChild();
      throw new Error(msg);
    }

    this.running = true;
    this.startedAt = Date.now();
    this.startStatsTimer();
    this.startAccessTail();
  }

  /** SIGTERM → grace → SIGKILL. Resolves when the process is really gone. */
  async stop(): Promise<void> {
    this.wantRunning = false;
    this.clearRestartTimer();
    this.stopAccessTail();
    if (!this.proc && !this.running) {
      this.running = false;
      return;
    }
    this.stopping = true;
    try {
      await this.killChild();
      this.log("core stopped by admin");
    } finally {
      this.stopping = false;
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Regen config from the store; restart only when the document changed. */
  async reload(): Promise<void> {
    await this.applyConfig(true);
  }

  async dispose(): Promise<void> {
    this.wantRunning = false;
    this.clearRestartTimer();
    this.stopAccessTail();
    if (this.regenTimer) {
      clearTimeout(this.regenTimer);
      this.regenTimer = null;
    }
    this.stopStatsTimer();
    for (const off of this.processListeners) off();
    if (this.proc) {
      this.stopping = true;
      try {
        await this.killChild();
      } finally {
        this.stopping = false;
      }
    }
    this.removePidFile();
  }

  /* ------------------------------------------------------- status + logs */

  status(): CoreBackendStatus {
    return {
      kind: this.kind,
      running: this.running,
      version: this.binaryVersion,
      pid: this.pid,
      startedAt: this.startedAt || this.bootedAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      apiPort: this.apiPort || null,
      configPath: this.configPath || null,
      lastError: this.lastError,
      restarts: this.restartCount,
    };
  }

  tailLog(n: number): string[] {
    const count = Math.max(1, Math.min(LOG_CAP, n));
    return this.logBuf.slice(-count);
  }

  /* ---------------------------------------- Task 23-g · per-user IP limit */

  /** email → distinct source IPs seen in the last window (newest first). */
  get ipSnapshot(): Record<string, string[]> {
    return this.ipTracker.snapshot();
  }

  /** Tracker window length in minutes (surfaced by /api/users/ip-usage). */
  get ipWindowMinutes(): number {
    return this.ipTracker.windowMinutes;
  }

  /**
   * Task 23-b — the file access log only feeds the IP-limit tracker, so it is
   * enabled exactly while some ClientUser carries ipLimit > 0. Setting a limit
   * rewrites clientsJson (ipLimit is projected per client) → mirrorDb diff →
   * regen → this re-evaluates and the config hash changes → core restart.
   */
  private accessLogActive(): boolean {
    try {
      return db._syncReadClientUsers().some((u) => u.ipLimit > 0);
    } catch {
      return false; // store read raced a write — skip the log this build
    }
  }

  private startAccessTail(): void {
    this.stopAccessTail();
    // fresh process → fresh window (in-memory only; breach events persist in
    // the activity log)
    this.ipTracker.clear();
    this.ipBreached.clear();
    // Task 23-b — xray opens the access log in APPEND mode (never truncates),
    // so the read offset is PRESERVED across core restarts. Replaying the
    // whole file after every config regen would re-observe old connections as
    // fresh pairs and instantly re-disable a user the admin just restored.
    // Genuine rotation/truncation (size < offset) is still detected per poll.
    if (!existsSync(this.accessLogPath)) this.accessOffset = 0;
    this.accessTimer = setInterval(() => void this.pollAccessLog(), ACCESS_POLL_MS);
    this.accessTimer.unref?.();
  }

  private stopAccessTail(): void {
    if (this.accessTimer) {
      clearInterval(this.accessTimer);
      this.accessTimer = null;
    }
  }

  /**
   * Tail db/core/access.log by byte offset (size-poll, no fs.watch churn).
   * Handles truncation/rotation (size < offset → restart from 0) and caps
   * each read so a hot log can never stall the event loop.
   */
  private pollAccessLog(): void {
    if (this.ipAccessBusy) return;
    this.ipAccessBusy = true;
    try {
      if (!existsSync(this.accessLogPath)) {
        this.accessOffset = 0;
        return;
      }
      const size = statSync(this.accessLogPath).size;
      if (size < this.accessOffset) this.accessOffset = 0; // truncated / rotated
      if (size === this.accessOffset) return;
      const start = this.accessOffset;
      const end = Math.min(size, start + ACCESS_MAX_CHUNK);
      const chunk = readFileSync(this.accessLogPath)
        .subarray(start, end)
        .toString("utf8");
      // only advance past COMPLETE lines — a torn tail is re-read next poll
      const lastNl = chunk.lastIndexOf("\n");
      if (lastNl === -1) {
        if (end - start >= ACCESS_MAX_CHUNK) this.accessOffset = end; // pathological
        return;
      }
      this.accessOffset = start + lastNl + 1;
      const now = Date.now();
      const touched = new Set<string>();
      for (const line of chunk.slice(0, lastNl).split("\n")) {
        const rec = parseAccessIps(line);
        if (rec && this.ipTracker.observe(rec.email, rec.ip, now)) {
          touched.add(rec.email);
        }
      }
      void this.enforceIpLimits([...touched], now);
    } catch (err) {
      this.log(`access-log poll failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.ipAccessBusy = false;
    }
  }

  /**
   * Enforcement hook — every email whose distinct-IP set grew this poll:
   *   always        logActivity warn (breach list lives in the audit trail)
   *   enforce ON    (set_enforce_ip_limit != "0", default) → auto-disable the
   *                 user (row + clientsJson projection so the config regen
   *                 really drops the client) + hash-diff restart. The panel
   *                 never re-enables automatically — an admin does.
   */
  private async enforceIpLimits(emails: string[], now: number): Promise<void> {
    if (emails.length === 0) return;
    try {
      const accessByEmail = new Map(db._syncReadAccessEmails().map((a) => [a.email, a.userId]));
      const users = new Map(db._syncReadClientUsers().map((u) => [u.id, u]));
      const enforce = db._syncReadSetting(ENFORCE_IP_LIMIT_KEY) !== "0";
      for (const email of emails) {
        const userId = accessByEmail.get(email);
        const user = userId ? users.get(userId) : undefined;
        if (!user) continue; // manual client without an owner row
        const over = this.ipTracker.overLimit(email, user.ipLimit, now);
        if (over && !this.ipBreached.has(email)) {
          this.ipBreached.add(email);
          const ips = this.ipTracker.ips(email, now);
          this.log(`ip-limit breach: ${email} — ${ips.length} IPs > limit ${user.ipLimit}`);
          void logActivity({
            kind: "user.ipLimitExceeded",
            level: "warn",
            actor: "core",
            message: `IP limit exceeded for "${user.username}" (${ips.length} distinct IPs in ${this.ipTracker.windowMinutes}m > limit ${user.ipLimit})`,
            meta: { userId: user.id, username: user.username, reason: "ip_limit", ips, count: ips.length, limit: user.ipLimit },
          });
          if (enforce && user.enabled) {
            await db.clientUser
              .update({ where: { id: user.id }, data: { enabled: false } })
              .then(async () => {
                // mirror the admin-disable path exactly: embedded client entries
                // flip to enabled:false so the next regen drops them from xray
                await syncUserProjection(user.id, {
                  ipLimit: user.ipLimit,
                  trafficLimitGb: user.trafficLimitGb,
                  expiryDays: user.expiryDays,
                  enabled: false,
                });
                this.log(`ip-limit enforce: user "${user.username}" disabled`);
                void logActivity({
                  kind: "user.updated",
                  level: "warn",
                  actor: "core",
                  message: `User "${user.username}" auto-disabled — concurrent-IP limit enforcement`,
                  meta: { userId: user.id, username: user.username, reason: "ip_limit_enforce" },
                });
              })
              .catch(() => undefined);
            // mirrorDb path — regen + (hash-diff) restart to drop the user
            this.scheduleRegen();
          }
        } else if (!over && this.ipBreached.has(email)) {
          this.ipBreached.delete(email); // back under the limit inside the window
        }
      }
    } catch {
      /* store read raced a write — next poll retries */
    }
  }

  /* -------------------------------------------------------- core backend */

  tick(): CoreTick {
    const ts = Date.now();
    this.tickCount++;
    this.measureHost(false);
    this.refreshStoreStats();
    this.pushSeries();
    return {
      ts,
      metrics: this.metricsSnapshot(ts),
      topUsers: this.publicUsers(),
      goal: this.goalSnapshot(),
    };
  }

  inboundsPayload(): CoreInboundsPayload {
    return {
      ts: Date.now(),
      inbounds: this.inbounds.map((ib) => ({ ...ib })),
      distribution: { ...this.distribution },
    };
  }

  snapshot(): CoreSnapshot {
    const ts = Date.now();
    return {
      ts,
      core: {
        version: this.binaryVersion || "xray",
        status: this.running ? "running" : "stopped",
        startedAt: this.startedAt || this.bootedAt,
      },
      metrics: this.metricsSnapshot(ts),
      totals: { users: this.usersTotal, groups: this.groupsTotal },
      series: {
        cpu: [...this.sCpu],
        ram: [...this.sRam],
        netIn: [...this.sNetIn],
        netOut: [...this.sNetOut],
        hist24: { dl: zeroSet(24), ul: zeroSet(24) },
        hist7: { dl: zeroSet(7), ul: zeroSet(7) },
        hist30: { dl: zeroSet(10), ul: zeroSet(10) },
      },
      topUsers: this.publicUsers(),
      inbounds: this.inbounds.map((ib) => ({ ...ib })),
      events: this.events.slice(-SNAPSHOT_EVENTS).map((e) => ({ ...e, params: { ...e.params } })),
      goal: this.goalSnapshot(),
      distribution: { ...this.distribution },
    };
  }

  /**
   * Diff the store's Inbound table (same logic as CoreSim) + debounce a
   * config regen — server.ts calls this every 2s. The xray process restarts
   * only when the freshly built document actually differs (hash compare).
   */
  mirrorDb(): ActivityEvent[] {
    const emitted = this.diffInbounds();
    this.scheduleRegen();
    return emitted;
  }

  /* ----------------------------------------------------------- internals */

  private async applyConfig(force: boolean): Promise<void> {
    if (!this.binaryPath) return; // never started — nothing to apply yet
    const built = buildXrayServerConfig(this.apiPort, {
      accessLogPath: this.accessLogActive() ? this.accessLogPath : undefined, // Task 23-b — when needed
    });
    for (const s of built.skipped) this.log(`config: ${s}`);
    const hashNew = hash(built.json);
    if (!force && hashNew === this.lastConfigHash) return;

    if (!this.running) {
      // pre-flight again (we don't own any port right now) — sidecar-served
      // rows (hysteria2, v2.5) are excluded, they never belong to this process
      const enabledRows = db._syncReadInboundsFull().filter((r) => r.status === "online");
      const conflicts = await checkPortsFree(servedInboundRows(enabledRows, built));
      if (conflicts.length > 0) {
        const detail = conflicts.map((c) => `${c.tag}:${c.port}`).join(", ");
        this.lastError = `start blocked — port(s) in use: ${detail}`;
        this.log(this.lastError);
        return;
      }
    }

    writeFileSync(this.configPath, built.json, { mode: 0o600 });
    const test = await this.runBinary(["run", "-test", "-c", this.configPath], 20_000);
    if (test.code !== 0) {
      const msg = `reload aborted — config rejected: ${firstLines(test.stderr || test.stdout, 4)}`;
      this.log(msg);
      this.lastError = msg;
      return;
    }
    this.lastConfigHash = hashNew;
    if (this.running) {
      this.log("config changed — restarting core to apply");
      await this.restart();
    }
  }

  private scheduleRegen(): void {
    if (this.regenTimer) return;
    this.regenTimer = setTimeout(() => {
      this.regenTimer = null;
      void this.applyConfig(false).catch((err) => {
        this.log(`regen error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, REGEN_DEBOUNCE_MS);
  }

  private scheduleAutoRestart(): void {
    if (!this.wantRunning) return;
    if (this.autoAttempts >= RESTART_MAX) {
      this.lastError = `core keeps exiting — gave up after ${RESTART_MAX} restart attempts`;
      this.log(this.lastError);
      return;
    }
    const delay = RESTART_BACKOFF_MS[Math.min(this.autoAttempts, RESTART_BACKOFF_MS.length - 1)] ?? 30_000;
    this.autoAttempts += 1;
    this.log(`auto-restart ${this.autoAttempts}/${RESTART_MAX} in ${delay / 1000}s`);
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.wantRunning || this.proc) return;
      void this.spawnCore()
        .then(() => {
          this.lastError = "";
          this.autoAttempts = 0;
          this.log(`core recovered (pid ${this.pid})`);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.lastError = msg;
          this.log(`auto-restart failed: ${msg}`);
          this.scheduleAutoRestart();
        });
    }, delay);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private killChild(): Promise<void> {
    const child = this.proc;
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

  private killChildSync(): void {
    try {
      if (this.proc && this.pid) {
        process.kill(this.pid, "SIGTERM");
      }
    } catch {
      /* already gone */
    }
  }

  /* ---------- stale-pid protection (crash of a previous panel run) ---------- */

  private get pidFilePath(): string {
    return path.join(this.stateDir, "xray.pid");
  }

  private writePidFile(): void {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      if (this.pid) writeFileSync(this.pidFilePath, String(this.pid), { mode: 0o644 });
    } catch {
      /* non-fatal */
    }
  }

  private removePidFile(): void {
    try {
      rmSync(this.pidFilePath, { force: true });
    } catch {
      /* non-fatal */
    }
  }

  private async killStaleFromPidFile(): Promise<void> {
    try {
      if (!existsSync(this.pidFilePath)) return;
      const pid = Number(readFileSync(this.pidFilePath, "utf8").trim());
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
      if (!pidLooksLikeXray(pid)) return;
      this.log(`killing stale xray from a previous run (pid ${pid})`);
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

  /* ------------------------------------------------------------ logging */

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

  /* -------------------------------------------------------------- stats */

  private startStatsTimer(): void {
    this.stopStatsTimer();
    // first poll quickly so the UI fills, then settle into the interval
    this.statsTimer = setTimeout(() => {
      void this.pollStats();
      this.statsTimer = setInterval(() => void this.pollStats(), this.statsIntervalMs);
    }, 2_000);
  }

  private stopStatsTimer(): void {
    if (this.statsTimer) {
      clearTimeout(this.statsTimer);
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  /** Run `xray api statsquery` and parse the stat array. */
  private async statsQuery(): Promise<StatEntry[]> {
    if (!this.binaryPath || !this.apiPort) return [];
    const args = STATS_ARGS.map((a) =>
      a === "--server=127.0.0.1" ? `--server=127.0.0.1:${this.apiPort}` : a
    );
    const r = await this.runBinary(args, 8_000);
    if (r.code !== 0) {
      throw new Error(firstLines(r.stderr || r.stdout, 2) || `statsquery exit ${r.code}`);
    }
    const parsed = JSON.parse(r.stdout) as { stat?: StatEntry[] };
    return Array.isArray(parsed.stat) ? parsed.stat : [];
  }

  private runBinary(
    args: string[],
    timeoutMs: number
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn(this.binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            child.kill("SIGKILL");
          } catch {
            /* gone */
          }
          resolve({ code: -1, stdout, stderr: stderr + "\ntimeout" });
        }
      }, timeoutMs);
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ code: -1, stdout, stderr: String(err) });
        }
      });
      child.on("close", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ code: code ?? -1, stdout, stderr });
        }
      });
    });
  }

  private async pollStats(): Promise<void> {
    if (!this.running || this.statsBusy) return;
    this.statsBusy = true;
    try {
      const stats = await this.statsQuery();
      this.applyStats(stats);
      this.lastStatsAt = Date.now();
    } catch (err) {
      this.log(`stats poll failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.statsBusy = false;
    }
  }

  /** last completed stats poll (epoch ms) — surfaced for the status route */
  get lastPollAt(): number {
    return this.lastStatsAt;
  }

  /**
   * Convert one statsquery dump into store writes + wire aggregates.
   * Counters are cumulative since core start → DELTAS per poll.
   */
  private applyStats(stats: StatEntry[]): void {
    const now = Date.now();

    // email → userId (rebuilt per poll; cheap on the in-process store)
    const accessByEmail = new Map<string, string>();
    for (const a of db._syncReadAccessEmails()) {
      if (a.email) accessByEmail.set(a.email, a.userId);
    }

    const userDelta = new Map<string, number>(); // email → bytes this poll
    const outboundDelta = new Map<string, number>(); // tag → bytes this poll

    for (const entry of stats) {
      const name = String(entry.name ?? "");
      const value = Number(entry.value ?? 0) || 0;
      // Xray stat name shapes:
      //   user>>><email>>>uplink                (older cores)
      //   user>>><email>>>traffic>>>uplink      (newer cores)
      //   inbound>>><tag>>>(traffic>>>)uplink
      //   outbound>>><tag>>>(traffic>>>)uplink
      const parts = name.split(">>>");
      if (parts.length < 3) continue;
      const scope = parts[0]!;
      const key = parts[1]!;
      const dir = parts[parts.length - 1]!;

      if (scope === "user") {
        const prev = this.userPrev.get(key) ?? 0;
        const delta = value >= prev ? value - prev : value; // counter reset → count from scratch
        this.userPrev.set(key, value);
        if (delta > 0) {
          userDelta.set(key, (userDelta.get(key) ?? 0) + delta);
          this.userLastSeen.set(key, now);
        }
      } else if (
        (scope === "inbound" || scope === "outbound") &&
        (dir === "uplink" || dir === "downlink")
      ) {
        const full = name; // per-direction key keeps up/down independent
        const prevMap = scope === "inbound" ? this.inboundPrev : this.outboundPrev;
        const prev = prevMap.get(full) ?? 0;
        const delta = value >= prev ? value - prev : value;
        prevMap.set(full, value);
        if (delta <= 0) continue;
        if (scope === "inbound") {
          this.inboundTxBytes.set(key, (this.inboundTxBytes.get(key) ?? 0) + delta);
        } else {
          outboundDelta.set(key, (outboundDelta.get(key) ?? 0) + delta);
        }
      }
    }

    // remember this window's per-user movement (drives online + top-users)
    this.lastUserDelta = userDelta;
    for (const [email, bytes] of userDelta) {
      const hist = this.userDeltaHist.get(email) ?? [];
      hist.push(bytes);
      if (hist.length > 8) hist.shift();
      this.userDeltaHist.set(email, hist);
    }

    // ---- users: write the exact sum (full precision; the UI rounds for
    //      display). External resets simply set the store lower — only NEW
    //      bytes are ever added, so reset flows are honored naturally.
    for (const [email, bytes] of userDelta) {
      const userId = accessByEmail.get(email);
      if (!userId) continue; // manual client without an owner row
      const gb = bytes / BYTES_PER_GB;
      void db.clientUser
        .findUnique({
          where: { id: userId },
          select: { usedTrafficGb: true, username: true, expiryDays: true, onHold: true, startedAt: true },
        })
        .then((row) => {
          if (!row) return null;
          const cur = Number(row.usedTrafficGb) || 0;
          // 26-a — instant on-hold activation: the expiry clock starts at the
          // FIRST observed traffic (per-poll, seconds after the first connect)
          // instead of waiting up to a minute for the maintenance cron, which
          // remains as the idempotent fallback (agent/nodes flows).
          if (row.onHold === true && row.startedAt === null) {
            const startedAt = new Date();
            void logActivity({
              kind: "user.updated",
              level: "info",
              actor: "system",
              message: `On-hold user "${row.username}" activated on first connection`,
              meta: { userId, username: row.username, startedAt: startedAt.toISOString() },
            });
            void notifyUserActivated(row.username, row.expiryDays ?? 0);
            return db.clientUser.update({
              where: { id: userId },
              data: { usedTrafficGb: cur + gb, startedAt },
            });
          }
          return db.clientUser.update({
            where: { id: userId },
            data: { usedTrafficGb: cur + gb },
          });
        })
        .catch(() => {
          /* user deleted mid-poll — skip */
        });
    }

    // ---- outbounds: real up/down bytes into the store rows
    for (const [tag, bytes] of outboundDelta) {
      void db.outbound
        .findUnique({ where: { tag }, select: { id: true, upBytes: true, downBytes: true } })
        .then((row) => {
          if (!row) return;
          return db.outbound.update({
            where: { tag },
            data: {
              upBytes: Number(row.upBytes) + bytes,
              downBytes: Number(row.downBytes) + bytes,
            },
          });
        })
        .catch(() => {
          /* row deleted mid-poll — skip */
        });
    }
  }

  /* ------------------------------------------------- inbound diff mirror */

  private diffInbounds(): ActivityEvent[] {
    let rows: FullInboundRow[] = [];
    try {
      rows = db._syncReadInboundsFull();
    } catch {
      return [];
    }

    const now = Date.now();
    const emitted: ActivityEvent[] = [];
    const rebuilt: CoreInbound[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      seen.add(row.tag);
      const existing = this.inbounds.find((i) => i.tag === row.tag);
      const proto =
        this.protoOverrides.get(row.tag) ?? composeProto(row.protocol, row.transport, row.security);
      const clientsCount = countClients(row.clientsJson);
      const txGb = round4((this.inboundTxBytes.get(row.tag) ?? 0) / BYTES_PER_GB);

      if (existing) {
        const nextStatus = asInboundStatus(row.status, existing.status);
        const statusChanged = existing.status !== nextStatus;
        const portChanged = existing.port !== row.port;
        const protoChanged = existing.proto !== proto;
        existing.users = clientsCount;
        existing.txGb = txGb;
        if (statusChanged) {
          existing.status = nextStatus;
          existing.port = row.port;
          existing.proto = proto;
          emitted.push(
            this.makeEvent(
              nextStatus === "online" ? "inbound.online" : "inbound.offline",
              nextStatus === "online" ? "success" : "warn",
              now,
              { inbound: row.tag, port: row.port }
            )
          );
        } else if (portChanged || protoChanged) {
          existing.port = row.port;
          existing.proto = proto;
          emitted.push(this.makeEvent("inbound.updated", "info", now, { inbound: row.tag, port: row.port }));
        }
        rebuilt.push(existing);
      } else {
        rebuilt.push({
          tag: row.tag,
          proto,
          port: row.port,
          status: asInboundStatus(row.status),
          users: clientsCount,
          txGb,
        });
        emitted.push(this.makeEvent("inbound.created", "success", now, { inbound: row.tag, port: row.port }));
      }
    }

    for (const ib of this.inbounds) {
      if (!seen.has(ib.tag)) {
        emitted.push(this.makeEvent("inbound.deleted", "warn", now, { inbound: ib.tag, port: ib.port }));
      }
    }

    this.inbounds = rebuilt;
    for (const e of emitted) this.pushEvent(e);
    return emitted;
  }

  private makeEvent(
    kind: ActivityEvent["kind"],
    level: ActivityEvent["level"],
    ts: number,
    params: Record<string, string | number>
  ): ActivityEvent {
    this.eventCounter++;
    return { id: `evt-${this.eventCounter}`, ts, level, kind, params };
  }

  private pushEvent(event: ActivityEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  /* ------------------------------------------------- telemetry + metrics */

  private measureHost(initial: boolean): void {
    const nowCpu = cpuTimes();
    const dTotal = nowCpu.total - this.lastCpu.total;
    const dUsed = nowCpu.used - this.lastCpu.used;
    this.lastCpu = nowCpu;
    if (!initial && dTotal > 0) {
      this.cpu = round1(clamp((dUsed / dTotal) * 100, 0, 100));
    } else if (initial && this.lastCpu.total > 0) {
      this.cpu = round1(clamp((this.lastCpu.used / this.lastCpu.total) * 100, 0, 100));
    }

    const ram = ramPct();
    this.ram = ram.pct;
    this.ramUsedMb = ram.usedMb;

    if (this.tickCount % 10 === 0 || initial) {
      this.disk = diskPct();
    }

    const nowNet = readNetCounters();
    const now = Date.now();
    const dt = (now - this.lastNetAt) / 1000;
    if (!initial && dt >= 0.5) {
      const rxKbps = (nowNet.rx - this.lastNet.rx) / 1024 / dt;
      const txKbps = (nowNet.tx - this.lastNet.tx) / 1024 / dt;
      this.netIn = round1(clamp(rxKbps, 0, 10_000_000));
      this.netOut = round1(clamp(txKbps, 0, 10_000_000));
      const total = this.netIn + this.netOut;
      this.peakToday = round1(Math.max(this.peakToday, total));
      this.avgToday = round1(this.avgToday + (total - this.avgToday) * 0.01);
    }
    this.lastNet = nowNet;
    this.lastNetAt = now;
  }

  private refreshStoreStats(): void {
    const now = Date.now();
    if (now - this.statsAt < 10_000 && this.statsAt !== 0) return;
    this.statsAt = now;
    try {
      const stats = db._syncReadCoreStats() as StoreCoreStats;
      this.usersTotal = stats.usersTotal;
      this.groupsTotal = stats.groupsTotal;
      this.limitedCount = Number(stats.limitedCount) || 0;
      this.monthTxGb = stats.monthTxGb;

      // real per-user deltas: sum this window's per-email bytes by owner name
      const deltaByName = new Map<string, number>();
      for (const [email, bytes] of this.lastUserDelta) {
        const at = email.lastIndexOf("@");
        const name = at > 0 ? email.slice(0, at) : email;
        deltaByName.set(name, (deltaByName.get(name) ?? 0) + bytes);
      }
      this.topUsers = stats.topUsers.map((u) => {
        const deltaBytes = deltaByName.get(u.user) ?? 0;
        return {
          uid: u.uid,
          user: u.user,
          proto: u.protoBase
            ? composeProto(u.protoBase.protocol, u.protoBase.transport, u.protoBase.security)
            : "—",
          gb: u.gb,
          delta: round4(deltaBytes / BYTES_PER_GB),
          up: deltaBytes > 0,
          spark: this.sparkFor(u.user),
          expiresInH:
            u.expiresAtMs !== null ? round2(Math.max(0, (u.expiresAtMs - now) / 3_600_000)) : null,
          usagePct: u.usagePct,
        };
      });
    } catch {
      /* keep last known */
    }
  }

  /** last 8 normalized per-user samples 0-100 (relative to the user's max) */
  private sparkFor(username: string): number[] {
    let hist: number[] | undefined;
    for (const [email, bytes] of this.userDeltaHist) {
      const at = email.lastIndexOf("@");
      const name = at > 0 ? email.slice(0, at) : email;
      if (name === username) {
        hist = hist ? hist.map((v, i) => v + (bytes[i] ?? 0)) : [...bytes];
      }
    }
    if (!hist || hist.length === 0) return zeroSet(8);
    const max = Math.max(1, ...hist);
    return hist.map((v) => Math.round((v / max) * 100));
  }

  private pushSeries(): void {
    pushRing(this.sCpu, this.cpu, SERIES_LEN);
    pushRing(this.sRam, this.ram, SERIES_LEN);
    pushRing(this.sNetIn, this.netIn, SERIES_LEN);
    pushRing(this.sNetOut, this.netOut, SERIES_LEN);
  }

  private onlineUsers(): number {
    const windowMs = this.statsIntervalMs * ONLINE_WINDOW_MULTIPLIER;
    const cutoff = Date.now() - windowMs;
    let n = 0;
    for (const ts of this.userLastSeen.values()) {
      if (ts >= cutoff) n++;
    }
    return n;
  }

  private computeDistribution(): void {
    const online = this.onlineUsers();
    const total = this.usersTotal;
    const connectedPct = total > 0 ? clamp(Math.round((online / total) * 100), 0, 100) : 0;
    const limitedPct =
      total > 0 ? clamp(Math.round((this.limitedCount / total) * 100), 0, 100) : 0;
    this.distribution.connectedPct = connectedPct;
    this.distribution.limitedPct = limitedPct;
    this.distribution.idlePct = clamp(100 - connectedPct - limitedPct, 0, 100);
  }

  private metricsSnapshot(ts: number) {
    this.computeDistribution();
    return {
      ts,
      cpu: this.cpu,
      ram: this.ram,
      ramUsedMb: this.ramUsedMb,
      ramTotalMb: this.ramTotalMb,
      disk: this.disk,
      netIn: this.netIn,
      netOut: this.netOut,
      activeUsers: this.onlineUsers(),
      sessions: 0, // per-connection counts are not exposed by the stats API
      monthTxTb: round4(this.monthTxGb / 1024),
      peakToday: this.peakToday,
      avgToday: this.avgToday,
      errorsToday: 0,
      saturatedPct: 0,
    };
  }

  private goalSnapshot() {
    return {
      currentGb: this.monthTxGb,
      targetGb: 0,
      delivered: 0,
      inProg: 0,
      pending: 0,
    };
  }

  private publicUsers(): CoreUserStat[] {
    return this.topUsers.map((u) => ({
      uid: u.uid,
      user: u.user,
      proto: u.proto,
      gb: u.gb,
      delta: u.delta,
      up: u.up,
      spark: [...u.spark],
      expiresInH: u.expiresInH,
      usagePct: u.usagePct,
    }));
  }

  /* ------------------------------------------------------------ helpers */

  private async waitPorts(tcpPorts: number[], udpPorts: number[], timeoutMs: number): Promise<boolean> {
    if (tcpPorts.length === 0 && udpPorts.length === 0) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let allOpen = true;
      for (const port of tcpPorts) {
        if (!(await tcpOpen("127.0.0.1", port, 700))) {
          allOpen = false;
          break;
        }
      }
      if (allOpen) {
        for (const port of udpPorts) {
          if (!(await udpTaken(port))) {
            allOpen = false;
            break;
          }
        }
      }
      if (allOpen) return true;
      await sleep(400);
    }
    return false;
  }
}

function zeroSet(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}
