/**
 * Sephiroth core adapter — Xray SERVER config builder (server-only).
 *
 * Builds a real `xray run -c config.json` document from the panel store:
 *   - inbounds  ← Inbound table (+ clientsJson / streamJson / sniffingJson)
 *   - outbounds ← Outbound table (system direct/blocked/warp + custom)
 *   - routing   ← RoutingRule table + the mandatory api door rule
 *   - always    ← stats + api service + policy level-0 user counters + a
 *                 hidden dokodemo-door "api" inbound on 127.0.0.1:<port>
 *
 * This is the runtime counterpart of the client-side Forge preview: it maps
 * every protocol the panel can store onto the shapes Xray-core accepts.
 * Unsupported inbounds (hysteria2 — Xray never had it; wireguard without a
 * secret key) are skipped with a reason instead of failing the whole config.
 */

import net from "node:net";
import dgram from "node:dgram";
import { db } from "@/lib/db";
import type { InboundStream } from "@/lib/inbounds";
import type { InboundClient } from "@/lib/inbounds";
import { parseClients } from "@/lib/user-types";

/* ---------- store row shapes (mirror of db.ts model types) ---------- */

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
  sniffingJson: string;
  streamJson: string;
}

interface OutboundRowLike {
  tag: string;
  protocol: string;
  sendThrough: string;
  domainStrategy: string;
  settingsJson: string;
  streamJson: string;
  muxEnabled: boolean;
  muxConcurrency: number;
  sortOrder: number;
}

interface RoutingRuleRowLike {
  enabled: boolean;
  outboundTag: string;
  domainJson: string;
  ipJson: string;
  port: string;
  network: string;
  protocolJson: string;
  inboundTagJson: string;
  sourceJson: string;
  sortOrder: number;
}

export type XrayJson = Record<string, unknown>;

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
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown): boolean => v === true;

/** "a, b,,c" → ["a","b","c"] */
function csv(v: unknown): string[] {
  return str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---------- free port + preflight ---------- */

/** Ask the kernel for a free loopback port (race-safe enough for the api door). */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

export interface PortConflict {
  tag: string;
  listen: string;
  port: number;
}

/** Transports that listen on UDP only — a TCP probe can never see them. */
export const UDP_ONLY_TRANSPORTS = new Set(["kcp", "wireguard"]);

/** True when a UDP listener can bind listen:port right now (mKCP / WireGuard). */
export function canBindUdp(listen: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const host = listen && listen !== "" ? listen : "0.0.0.0";
    const sock = dgram.createSocket("udp4");
    const done = (ok: boolean): void => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(ok);
    };
    sock.once("error", () => done(false)); // EADDRINUSE / EACCES → not free
    try {
      sock.bind({ port, address: host }, () => done(true));
    } catch {
      done(false);
    }
  });
}

/** True when a TCP listener can bind listen:port right now. */
function canBind(listen: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const host = listen && listen !== "" ? listen : "0.0.0.0";
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host }, () => {
      srv.close(() => resolve(true));
    });
  });
}

/**
 * Pre-flight: is every enabled inbound's port still free? Runs BEFORE spawn
 * so the driver can fail with per-port detail instead of a cryptic xray log.
 */
export async function checkPortsFree(rows: InboundRowLike[]): Promise<PortConflict[]> {
  const conflicts: PortConflict[] = [];
  for (const row of rows) {
    if (row.status !== "online") continue;
    // UDP-only transports (mKCP / WireGuard) never hold a TCP socket —
    // probe the UDP bind instead, or conflicts go undetected until spawn
    const free = UDP_ONLY_TRANSPORTS.has(row.transport)
      ? await canBindUdp(row.listen ?? "", Number(row.port))
      : await canBind(row.listen ?? "", Number(row.port));
    if (!free) conflicts.push({ tag: row.tag, listen: row.listen || "0.0.0.0", port: Number(row.port) });
  }
  return conflicts;
}

/* ---------- inbound mapping ---------- */

interface InboundBuild {
  inbound: XrayJson | null;
  skipReason: string;
}

function buildInbound(row: InboundRowLike): InboundBuild {
  // Task 23-b — a client whose owning user is disabled (enabled:false is
  // written by the admin toggle AND by the core's IP-limit auto-disable)
  // must not appear in the generated config; undefined stays included so
  // manual Phase-3 entries without the flag keep working.
  const clients = (
    parseClients(row.clientsJson) as (InboundClient & { ownerId?: string })[]
  ).filter((c) => c.enabled !== false);
  const st = parseLoose<InboundStream>(row.streamJson, {});
  const sniff = parseLoose<{ enabled?: boolean; destOverride?: string[]; routeOnly?: boolean }>(
    row.sniffingJson,
    { enabled: false, destOverride: ["http", "tls"], routeOnly: false }
  );

  const protocol = row.protocol;
  let settings: XrayJson = {};

  switch (protocol) {
    case "vless": {
      settings = {
        clients: clients.map((c) => ({
          id: c.key,
          email: c.email,
          level: 0,
          ...(c.flow ? { flow: c.flow } : {}),
        })),
        decryption: "none",
      };
      break;
    }
    case "vmess": {
      settings = {
        clients: clients.map((c) => ({ id: c.key, email: c.email, level: 0, alterId: 0 })),
      };
      break;
    }
    case "trojan": {
      settings = {
        clients: clients.map((c) => ({ password: c.key, email: c.email, level: 0 })),
      };
      break;
    }
    case "shadowsocks": {
      const method = str(st.method) || "chacha20-poly1305";
      if (method.startsWith("2022-blake3-")) {
        // SS2022 is served from a single SERVER-LEVEL method+password pair —
        // the core rejects per-client `method` fields for 2022 ciphers
        // ("unsupported cipher method" at infra/conf). Xray's shadowsocks
        // inbound has exactly one server key, so the first client's key is it.
        const password = clients[0]?.key ?? "";
        if (!password) {
          return {
            inbound: null,
            skipReason: `${row.tag}: ss2022 inbound has no client key to use as the server password — skipped`,
          };
        }
        settings = { method, password, network: "tcp,udp" };
      } else if (clients.length > 0) {
        // multi-client shape (per-client method+password)
        settings = {
          clients: clients.map((c) => ({
            method,
            password: c.key,
            email: c.email,
            level: 0,
          })),
          network: "tcp,udp",
        };
      } else {
        settings = {
          method,
          password: "",
          network: "tcp,udp",
        };
      }
      break;
    }
    case "socks": {
      settings = {
        auth: clients.length > 0 ? "password" : "noauth",
        ...(clients.length > 0
          ? {
              accounts: clients.map((c) => ({
                user: c.email,
                pass: c.key,
                // harmless when the core ignores it, gold for per-user stats
                // when the core honors it
                email: c.email,
              })),
            }
          : {}),
        udp: st.socksUdp === undefined ? true : bool(st.socksUdp),
      };
      break;
    }
    case "http": {
      settings = {
        ...(clients.length > 0
          ? { accounts: clients.map((c) => ({ user: c.email, pass: c.key })) }
          : {}),
        allowTransparent: false,
      };
      break;
    }
    case "dokodemo-door": {
      settings = {
        address: str(st.dokoAddress) || "127.0.0.1",
        port: num(st.dokoPort, 0) || undefined,
        network: str(st.dokoNetwork) || "tcp,udp",
        followRedirect: false,
      };
      if (!settings.port) delete settings.port;
      break;
    }
    case "wireguard": {
      const secretKey = str(st.wgSecretKey);
      if (!secretKey) {
        return {
          inbound: null,
          skipReason: `${row.tag}: wireguard inbound has no secret key — skipped`,
        };
      }
      settings = {
        secretKey,
        address: ["172.16.0.1/32"],
        ...(num(st.wgMtu, 0) > 0 ? { mtu: num(st.wgMtu, 1280) } : { mtu: 1280 }),
        peers: clients.map((c, i) => ({
          publicKey: c.key,
          allowedIPs: [`172.16.0.${i + 2}/32`],
        })),
      };
      break;
    }
    default: {
      // hysteria2 and tuic are not Xray protocols — they are served by the
      // SECONDARY sing-box core (src/lib/core/singbox.ts, Task 23-c), one
      // process next to the Xray core.
      return {
        inbound: null,
        skipReason:
          protocol === "hysteria2" || protocol === "tuic"
            ? `${row.tag}: ${protocol} is served by the secondary sing-box core — not part of the Xray config`
            : `${row.tag}: ${protocol} is not an Xray-core inbound — skipped`,
      };
    }
  }

  /* ---------- streamSettings ---------- */
  const transport = row.transport || "tcp";
  const security = row.security || "none";
  const stream: XrayJson = { network: transport, security };

  if (security === "tls") {
    const tls: XrayJson = {};
    if (str(st.sni)) tls.serverName = str(st.sni);
    const alpn = csv(st.alpn);
    if (alpn.length > 0) tls.alpn = alpn;
    if (str(st.minVer)) tls.minVersion = str(st.minVer);
    if (str(st.maxVer)) tls.maxVersion = str(st.maxVer);
    if (str(st.certPublic) && str(st.certPrivate)) {
      const pub = str(st.certPublic).trim();
      const priv = str(st.certPrivate).trim();
      // Task 23-f — managed-cert picker fills the fields with absolute file
      // paths (single line, no PEM armor) → emit certificateFile/keyFile so
      // Xray loads straight from db/certs; pasted PEM keeps the legacy
      // inline line-array form.
      const isPath = (v: string): boolean =>
        !v.includes("-----BEGIN") && !v.includes("\n") && v.startsWith("/");
      tls.certificates = [
        isPath(pub) && isPath(priv)
          ? { certificateFile: pub, keyFile: priv }
          : {
              certificate: pub.split("\n").filter(Boolean),
              key: priv.split("\n").filter(Boolean),
            },
      ];
    }
    stream.tlsSettings = tls;
  } else if (security === "reality") {
    stream.realitySettings = {
      show: false,
      dest: str(st.dest) || "",
      serverNames: csv(st.serverNames),
      shortIds: csv(st.shortIds),
      privateKey: str(st.privateKey),
    };
  }

  if (transport === "tcp") {
    if (str(st.headerType) === "http") {
      const req: XrayJson = { version: "1.1" };
      const path = str(st.requestPath) || "/";
      req.path = path.split(",").map((p) => p.trim()).filter(Boolean);
      const host = csv(st.requestHost);
      if (host.length > 0) req.headers = { Host: host };
      stream.tcpSettings = { header: { type: "http", request: req } };
    }
  } else if (transport === "ws") {
    const ws: XrayJson = { path: str(st.path) || "/" };
    const host = csv(st.host);
    if (host.length > 0) ws.headers = { Host: host };
    if (num(st.maxEarlyData, 0) > 0) {
      ws.maxEarlyData = num(st.maxEarlyData, 0);
      if (str(st.earlyDataHeaderName)) ws.earlyDataHeaderName = str(st.earlyDataHeaderName);
    }
    stream.wsSettings = ws;
  } else if (transport === "grpc") {
    stream.grpcSettings = {
      serviceName: str(st.serviceName) || "",
      multiMode: bool(st.multiMode),
    };
  } else if (transport === "httpupgrade") {
    const hu: XrayJson = { path: str(st.path) || "/" };
    const host = csv(st.host);
    if (host.length > 0) hu.host = host[0]!;
    stream.httpupgradeSettings = hu;
  } else if (transport === "xhttp") {
    const xh: XrayJson = { path: str(st.path) || "/" };
    const host = csv(st.host);
    if (host.length > 0) xh.host = host[0]!;
    if (str(st.mode)) xh.mode = str(st.mode);
    stream.xhttpSettings = xh;
  } else if (transport === "kcp") {
    // mKCP rides UDP — panel exposes header.type + seed; the rest stays at
    // Xray defaults (mtu 1350 / tti 50 / 5 Mbps up+down / no congestion ctl)
    const kcp: XrayJson = {
      mtu: 1350,
      tti: 50,
      uplinkCapacity: 5,
      downlinkCapacity: 5,
      congestion: false,
      readBufferSize: 2,
      writeBufferSize: 2,
      header: { type: str(st.headerType) || "none" },
    };
    if (str(st.kcpSeed)) kcp.seed = str(st.kcpSeed);
    stream.kcpSettings = kcp;
  }

  const fallbacks = parseLoose<unknown[]>(str(st.fallbacksJson) ? String(st.fallbacksJson) : "", []);
  if (Array.isArray(fallbacks) && fallbacks.length > 0) stream.fallbacks = fallbacks;

  const inbound: XrayJson = {
    tag: row.tag,
    ...(row.listen ? { listen: row.listen } : {}),
    port: Number(row.port),
    protocol,
    settings,
    streamSettings: stream,
    sniffing: {
      enabled: sniff.enabled === true,
      destOverride: Array.isArray(sniff.destOverride) ? sniff.destOverride : ["http", "tls"],
      routeOnly: sniff.routeOnly === true,
    },
  };
  return { inbound, skipReason: "" };
}

/* ---------- outbounds + routing ---------- */

function buildOutbounds(): { outbounds: XrayJson[]; skipped: string[] } {
  const rows = db._syncReadOutbounds() as OutboundRowLike[];
  const outbounds: XrayJson[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row.tag || seen.has(row.tag)) continue;
    seen.add(row.tag);
    const settings = parseLoose<XrayJson>(row.settingsJson, {});
    const stream = parseLoose<XrayJson>(row.streamJson, {});
    const ob: XrayJson = { tag: row.tag, protocol: row.protocol };
    if (row.sendThrough) ob.sendThrough = row.sendThrough;

    if (row.protocol === "freedom" || row.protocol === "blackhole") {
      ob.settings = { ...settings };
    } else {
      ob.settings = settings;
      if (Object.keys(stream).length > 0) ob.streamSettings = stream;
    }
    if (row.protocol === "freedom" && !("domainStrategy" in settings)) {
      ob.settings = { ...settings, domainStrategy: row.domainStrategy || "AsIs" };
    }
    if (row.muxEnabled && row.protocol !== "freedom" && row.protocol !== "blackhole") {
      ob.mux = { enabled: true, concurrency: Number(row.muxConcurrency) || 8 };
    }
    outbounds.push(ob);
  }

  // the panel cannot function without direct + blocked
  if (!seen.has("direct")) {
    outbounds.push({ tag: "direct", protocol: "freedom", settings: { domainStrategy: "AsIs" } });
  }
  if (!seen.has("blocked")) {
    outbounds.push({ tag: "blocked", protocol: "blackhole", settings: { response: { type: "none" } } });
  }
  return { outbounds, skipped };
}

function buildRouting(apiPort: number): XrayJson {
  const rows = db._syncReadRoutingRules() as RoutingRuleRowLike[];
  const outboundTags = new Set<string>(
    (db._syncReadOutbounds() as OutboundRowLike[]).map((r) => r.tag)
  );
  outboundTags.add("direct");
  outboundTags.add("blocked");
  outboundTags.add("api");

  const rules: XrayJson[] = [];
  // the stats api door comes FIRST so it always wins
  rules.push({ type: "field", inboundTag: ["api"], outboundTag: "api" });

  let skipped = 0;
  for (const row of rows) {
    if (!row.enabled) continue;
    if (!outboundTags.has(row.outboundTag)) {
      skipped += 1;
      continue;
    }
    const domain = parseLoose<string[]>(row.domainJson, []);
    const ip = parseLoose<string[]>(row.ipJson, []);
    const protocol = parseLoose<string[]>(row.protocolJson, []);
    const inboundTag = parseLoose<string[]>(row.inboundTagJson, []);
    const source = parseLoose<string[]>(row.sourceJson, []);
    const rule: XrayJson = { type: "field", outboundTag: row.outboundTag };
    if (domain.length) rule.domain = domain;
    if (ip.length) rule.ip = ip;
    if (row.port) rule.port = row.port;
    if (row.network) rule.network = row.network;
    if (protocol.length) rule.protocol = protocol;
    if (inboundTag.length) rule.inboundTag = inboundTag;
    if (source.length) rule.source = source;
    // at least one real matcher besides outboundTag
    if (Object.keys(rule).length <= 2) {
      skipped += 1;
      continue;
    }
    rules.push(rule);
  }
  void skipped;

  return {
    domainStrategy: "AsIs",
    rules,
  };
}

/* ---------- full document ---------- */

export interface BuiltCoreConfig {
  config: XrayJson;
  apiPort: number;
  skipped: string[];
  json: string;
}

export interface BuildCoreOptions {
  /**
   * Task 23-g — absolute access-log path written into the log section so the
   * driver can tail per-connection records for IP-limit tracking. Empty =
   * omit (no file access log).
   */
  accessLogPath?: string;
}

/** Deep-merge `base` under `over` (arrays/over-values win). */
function deepMerge(base: XrayJson, over: XrayJson): XrayJson {
  const out: XrayJson = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const cur = out[k];
    if (
      v && typeof v === "object" && !Array.isArray(v) &&
      cur && typeof cur === "object" && !Array.isArray(cur)
    ) {
      out[k] = deepMerge(cur as XrayJson, v as XrayJson);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Build the complete server config document. Synchronous — every read goes
 * through the in-process store snapshot, same as the simulator's mirrorDb.
 */
export function buildXrayServerConfig(apiPort: number, opts: BuildCoreOptions = {}): BuiltCoreConfig {
  const inboundRows = db._syncReadInboundsFull() as InboundRowLike[];
  const expert = buildExpertSnapshot();

  const inbounds: XrayJson[] = [];
  const skipped: string[] = [];

  for (const row of inboundRows) {
    if (row.status !== "online") continue; // offline/maintenance → not served
    const built = buildInbound(row);
    if (built.inbound) inbounds.push(built.inbound);
    else skipped.push(built.skipReason);
  }

  // hidden stats-api door — enables `xray api statsquery` without a gRPC dep
  inbounds.push({
    tag: "api",
    listen: "127.0.0.1",
    port: apiPort,
    protocol: "dokodemo-door",
    settings: { address: "127.0.0.1" },
  });

  const { outbounds } = buildOutbounds();

  const config: XrayJson = {
    log: {
      // Task 23-g — file access log feeds the IP-limit tracker. The access
      // logger is separate from the error log in Xray-core: accepted-connection
      // records land in the file regardless of the (error-log) loglevel.
      ...(opts.accessLogPath ? { access: opts.accessLogPath } : {}),
      loglevel: expert.logLevel,
    },
    ...(expert.dnsServers.length > 0 ? { dns: { servers: expert.dnsServers } } : {}),
    stats: {},
    api: { tag: "api", services: ["HandlerService", "LoggerService", "StatsService"] },
    policy: {
      levels: {
        "0": { statsUserUplink: true, statsUserDownlink: true },
      },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true,
      },
    },
    inbounds,
    outbounds,
    routing: buildRouting(apiPort),
  };

  // expert raw template fills gaps only — generated fields always win
  if (expert.rawJson) {
    try {
      const raw = JSON.parse(expert.rawJson) as XrayJson;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return finalize(deepMerge(raw, config), apiPort, skipped);
      }
    } catch {
      // invalid raw template is ignored (validated at save time anyway)
    }
  }
  return finalize(config, apiPort, skipped);
}

function finalize(config: XrayJson, apiPort: number, skipped: string[]): BuiltCoreConfig {
  const json = JSON.stringify(config, null, 2) + "\n";
  return { config, apiPort, skipped, json };
}

interface ExpertSnapshot {
  logLevel: string;
  dnsServers: string[];
  rawJson: string;
  domainStrategy: string;
}

/** Sync snapshot of the expert settings via the store's setting reader. */
function buildExpertSnapshot(): ExpertSnapshot {
  const read = (key: string): string | undefined => db._syncReadSetting(key);
  const levels = ["none", "warning", "info", "debug"];
  const rawLevel = read("set_xray_log_level");
  const dns = (read("set_xray_dns_servers") ?? "1.1.1.1\n8.8.8.8")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    logLevel: rawLevel && levels.includes(rawLevel) ? rawLevel : "warning",
    dnsServers: dns,
    rawJson: read("set_xray_raw_json") ?? "",
    domainStrategy: read("set_xray_domain_strategy") ?? "AsIs",
  };
}
