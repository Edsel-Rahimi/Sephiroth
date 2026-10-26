import { db } from "@/lib/db";
import type { FieldError } from "@/lib/settings";

/* ============================================================
   Sephiroth · Core network objects (server-only)
   Hosts / Nodes / Outbounds / Routing rules — modeled on the
   3x-ui panel's data structures, adapted to Sephiroth's
   ServerSetting + SQLite world. Complex sub-objects ride in
   JSON string columns exactly like Inbound.clientsJson.
   ============================================================ */

function parseJsonLoose<T>(raw: string, fallback: T): T {
  try {
    const v = JSON.parse(raw) as T;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/* ---------- Hosts ---------- */

export interface HostDTO {
  id: string;
  inboundId: string;
  inboundTag: string;
  remark: string;
  address: string;
  port: number; // 0 = inherit inbound port
  security: "same" | "tls" | "none" | "reality";
  sni: string;
  hostHeader: string;
  path: string;
  alpn: string;
  fingerprint: string;
  enable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function toHostDTO(
  row: {
    id: string; inboundId: string; remark: string; address: string; port: number;
    security: string; sni: string; hostHeader: string; path: string; alpn: string;
    fingerprint: string; enable: boolean; sortOrder: number;
    createdAt: Date; updatedAt: Date; inbound?: { tag: string } | null;
  }
): HostDTO {
  return {
    id: row.id,
    inboundId: row.inboundId,
    inboundTag: row.inbound?.tag ?? "",
    remark: row.remark,
    address: row.address,
    port: row.port,
    security: (["same", "tls", "none", "reality"].includes(row.security)
      ? row.security
      : "same") as HostDTO["security"],
    sni: row.sni,
    hostHeader: row.hostHeader,
    path: row.path,
    alpn: row.alpn,
    fingerprint: row.fingerprint,
    enable: row.enable,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DOMAIN_RE = /^[a-zA-Z0-9._*-]{1,200}$/; // covers geo domains & wildcards lightly

export interface HostInput {
  inboundId: string;
  remark: string;
  address: string;
  port: number;
  security: HostDTO["security"];
  sni: string;
  hostHeader: string;
  path: string;
  alpn: string;
  fingerprint: string;
  enable: boolean;
  sortOrder: number;
}

export function validateHost(body: unknown): { ok: true; data: HostInput } | { ok: false; fields: FieldError[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields: FieldError[] = [];

  const inboundId = typeof b.inboundId === "string" ? b.inboundId.trim() : "";
  const remark = typeof b.remark === "string" ? b.remark.trim() : "";
  const address = typeof b.address === "string" ? b.address.trim() : "";
  const port = Number(b.port ?? 0);
  const security = typeof b.security === "string" ? b.security : "same";
  const sni = typeof b.sni === "string" ? b.sni.trim() : "";
  const hostHeader = typeof b.hostHeader === "string" ? b.hostHeader.trim() : "";
  const path = typeof b.path === "string" ? b.path.trim() : "";
  const alpn = typeof b.alpn === "string" ? b.alpn.trim() : "";
  const fingerprint = typeof b.fingerprint === "string" ? b.fingerprint.trim() : "";
  const sortOrder = Number(b.sortOrder ?? 0);

  if (!inboundId) fields.push({ field: "inboundId", code: "required" });
  if (!remark || remark.length > 64) fields.push({ field: "remark", code: "range" });
  if (!address || address.length > 253) fields.push({ field: "address", code: "format" });
  else if (!/^[a-zA-Z0-9.:-]+$/.test(address)) fields.push({ field: "address", code: "format" });
  if (!Number.isInteger(port) || port < 0 || port > 65535) fields.push({ field: "port", code: "range" });
  if (!["same", "tls", "none", "reality"].includes(security)) fields.push({ field: "security", code: "format" });
  if (sni && !/^[a-zA-Z0-9.*-]{1,200}$/.test(sni)) fields.push({ field: "sni", code: "format" });
  if (path && !path.startsWith("/")) fields.push({ field: "path", code: "format" });
  if (remark && !DOMAIN_RE.test(remark) && remark.length > 64) fields.push({ field: "remark", code: "range" });

  if (fields.length) return { ok: false, fields };
  return {
    ok: true,
    data: {
      inboundId, remark, address, port,
      security: security as HostInput["security"],
      sni, hostHeader, path, alpn, fingerprint,
      enable: b.enable === undefined ? true : Boolean(b.enable),
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    },
  };
}

export async function listHosts(): Promise<HostDTO[]> {
  const rows = await db.host.findMany({
    orderBy: [{ inboundId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: { inbound: { select: { tag: true } } },
  });
  return rows.map(toHostDTO);
}

/* ---------- Nodes ---------- */

export interface NodeDTO {
  id: string;
  name: string;
  scheme: "http" | "https";
  address: string;
  port: number;
  basePath: string;
  tokenConfigured: boolean;
  tokenMasked: string;
  enable: boolean;
  syncAll: boolean;
  inboundTags: string[];
  outboundTag: string;
  tlsVerify: "verify" | "skip";
  status: "online" | "offline" | "unknown";
  latencyMs: number;
  xrayVersion: string;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}

export function toNodeDTO(row: {
  id: string; name: string; scheme: string; address: string; port: number;
  basePath: string; apiToken: string; enable: boolean; syncAll: boolean;
  inboundTags: string; outboundTag: string; tlsVerify: string;
  status: string; latencyMs: number; xrayVersion: string; lastSeen: Date | null;
  createdAt: Date; updatedAt: Date;
}): NodeDTO {
  return {
    id: row.id,
    name: row.name,
    scheme: row.scheme === "http" ? "http" : "https",
    address: row.address,
    port: row.port,
    basePath: row.basePath,
    tokenConfigured: row.apiToken.length > 0,
    tokenMasked: maskToken(row.apiToken),
    enable: row.enable,
    syncAll: row.syncAll,
    inboundTags: parseJsonLoose<string[]>(row.inboundTags, []),
    outboundTag: row.outboundTag,
    tlsVerify: row.tlsVerify === "skip" ? "skip" : "verify",
    status: (["online", "offline", "unknown"].includes(row.status)
      ? row.status
      : "unknown") as NodeDTO["status"],
    latencyMs: row.latencyMs,
    xrayVersion: row.xrayVersion,
    lastSeen: row.lastSeen ? row.lastSeen.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface NodeInput {
  name: string;
  scheme: "http" | "https";
  address: string;
  port: number;
  basePath: string;
  token: string | null | undefined; // undefined = keep, null = clear, string = replace
  enable: boolean;
  syncAll: boolean;
  inboundTags: string[];
  outboundTag: string;
  tlsVerify: "verify" | "skip";
}

export function validateNode(body: unknown): { ok: true; data: NodeInput } | { ok: false; fields: FieldError[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields: FieldError[] = [];

  const name = typeof b.name === "string" ? b.name.trim() : "";
  const scheme = b.scheme === "http" ? "http" : "https";
  const address = typeof b.address === "string" ? b.address.trim() : "";
  const port = Number(b.port ?? 443);
  let basePath = typeof b.basePath === "string" ? b.basePath.trim() : "/";
  const tlsVerify = b.tlsVerify === "skip" ? "skip" : "verify";
  const syncAll = b.syncAll === undefined ? true : Boolean(b.syncAll);
  const inboundTags = isStrArray(b.inboundTags) ? b.inboundTags : [];
  const outboundTag = typeof b.outboundTag === "string" ? b.outboundTag.trim() : "";

  if (!name || name.length > 48) fields.push({ field: "name", code: "range" });
  if (!address || address.length > 253) fields.push({ field: "address", code: "format" });
  else if (!/^[a-zA-Z0-9.:-]+$/.test(address)) fields.push({ field: "address", code: "format" });
  if (!Number.isInteger(port) || port < 1 || port > 65535) fields.push({ field: "port", code: "range" });
  if (!basePath.startsWith("/")) basePath = `/${basePath}`;
  if (basePath.length > 120) fields.push({ field: "basePath", code: "range" });

  let token: string | null | undefined = undefined;
  if (b.token === null) token = null;
  else if (typeof b.token === "string" && b.token.trim() !== "") token = b.token.trim();

  if (fields.length) return { ok: false, fields };
  return {
    ok: true,
    data: {
      name, scheme: scheme as NodeInput["scheme"], address, port, basePath, token,
      enable: b.enable === undefined ? true : Boolean(b.enable),
      syncAll, inboundTags, outboundTag,
      tlsVerify: tlsVerify as NodeInput["tlsVerify"],
    },
  };
}

export async function listNodes(): Promise<NodeDTO[]> {
  const rows = await db.node.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toNodeDTO);
}

/** Simulator probe — decorates status/latency. Preview mode only. */
export async function probeNode(id: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const node = await db.node.findUnique({ where: { id } });
  if (!node) return { ok: false, latencyMs: 0, error: "not_found" };
  const online = Math.random() > 0.12;
  const latencyMs = 18 + Math.floor(Math.random() * 160);
  await db.node.update({
    where: { id },
    data: {
      status: node.enable ? (online ? "online" : "offline") : "offline",
      latencyMs: online ? latencyMs : 0,
      xrayVersion: online ? "25.8.29" : "",
      lastSeen: new Date(),
    },
  });
  return online
    ? { ok: true, latencyMs }
    : { ok: false, latencyMs, error: "unreachable" };
}

/* ---------- Outbounds ---------- */

export const OUTBOUND_PROTOCOLS = [
  "freedom", "blackhole", "dns", "socks", "http",
  "vmess", "vless", "trojan", "shadowsocks", "wireguard",
] as const;
export type OutboundProtocol = (typeof OUTBOUND_PROTOCOLS)[number];

export interface OutboundDTO {
  id: string;
  tag: string;
  protocol: OutboundProtocol;
  sendThrough: string;
  domainStrategy: string;
  settings: Record<string, unknown>;
  stream: Record<string, unknown>;
  muxEnabled: boolean;
  muxConcurrency: number;
  sortOrder: number;
  upBytes: number;
  downBytes: number;
  createdAt: string;
  updatedAt: string;
}

export function toOutboundDTO(row: {
  id: string; tag: string; protocol: string; sendThrough: string;
  domainStrategy: string; settingsJson: string; streamJson: string;
  muxEnabled: boolean; muxConcurrency: number; sortOrder: number;
  upBytes: number; downBytes: number; createdAt: Date; updatedAt: Date;
}): OutboundDTO {
  return {
    id: row.id,
    tag: row.tag,
    protocol: (OUTBOUND_PROTOCOLS.includes(row.protocol as OutboundProtocol)
      ? row.protocol
      : "freedom") as OutboundProtocol,
    sendThrough: row.sendThrough,
    domainStrategy: row.domainStrategy,
    settings: parseJsonLoose<Record<string, unknown>>(row.settingsJson, {}),
    stream: parseJsonLoose<Record<string, unknown>>(row.streamJson, {}),
    muxEnabled: row.muxEnabled,
    muxConcurrency: row.muxConcurrency,
    sortOrder: row.sortOrder,
    upBytes: row.upBytes,
    downBytes: row.downBytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface OutboundInput {
  tag: string;
  protocol: OutboundProtocol;
  sendThrough: string;
  domainStrategy: string;
  settings: Record<string, unknown>;
  stream: Record<string, unknown>;
  muxEnabled: boolean;
  muxConcurrency: number;
  sortOrder: number;
}

const TAG_RE = /^[a-zA-Z0-9_-]{1,42}$/;

export function validateOutbound(body: unknown): { ok: true; data: OutboundInput } | { ok: false; fields: FieldError[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields: FieldError[] = [];

  const tag = typeof b.tag === "string" ? b.tag.trim() : "";
  const protocol = typeof b.protocol === "string" ? b.protocol : "";
  const sendThrough = typeof b.sendThrough === "string" ? b.sendThrough.trim() : "";
  const domainStrategy = typeof b.domainStrategy === "string" ? b.domainStrategy : "AsIs";
  const muxConcurrency = Number(b.muxConcurrency ?? 8);
  const sortOrder = Number(b.sortOrder ?? 0);

  if (!tag || !TAG_RE.test(tag)) fields.push({ field: "tag", code: "format" });
  if (!OUTBOUND_PROTOCOLS.includes(protocol as OutboundProtocol)) {
    fields.push({ field: "protocol", code: "format" });
  }
  if (!["AsIs", "UseIP", "UseIPv4", "UseIPv6"].includes(domainStrategy)) {
    fields.push({ field: "domainStrategy", code: "format" });
  }
  if (!Number.isInteger(muxConcurrency) || muxConcurrency < 1 || muxConcurrency > 128) {
    fields.push({ field: "muxConcurrency", code: "range" });
  }

  let settings: Record<string, unknown> = {};
  if (b.settings !== undefined) {
    if (typeof b.settings !== "object" || b.settings === null || Array.isArray(b.settings)) {
      fields.push({ field: "settings", code: "format" });
    } else {
      settings = b.settings as Record<string, unknown>;
    }
  }
  let stream: Record<string, unknown> = {};
  if (b.stream !== undefined && b.stream !== null) {
    if (typeof b.stream !== "object" || Array.isArray(b.stream)) {
      fields.push({ field: "stream", code: "format" });
    } else {
      stream = b.stream as Record<string, unknown>;
    }
  }

  if (fields.length) return { ok: false, fields };
  return {
    ok: true,
    data: {
      tag,
      protocol: protocol as OutboundProtocol,
      sendThrough,
      domainStrategy,
      settings, stream,
      muxEnabled: Boolean(b.muxEnabled),
      muxConcurrency: Number.isInteger(muxConcurrency) ? muxConcurrency : 8,
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    },
  };
}

export async function listOutbounds(): Promise<OutboundDTO[]> {
  const rows = await db.outbound.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toOutboundDTO);
}

/** Simulated connectivity test (preview mode — no real dial). */
export function simulateOutboundTest(): { ok: boolean; latencyMs: number } {
  const ok = Math.random() > 0.1;
  return { ok, latencyMs: 25 + Math.floor(Math.random() * 240) };
}

/* ---------- Routing rules ---------- */

export interface RoutingRuleDTO {
  id: string;
  enabled: boolean;
  comment: string;
  outboundTag: string;
  domain: string[];
  ip: string[];
  port: string;
  network: string; // "" | tcp | udp | tcp,udp
  protocol: string[];
  inboundTag: string[];
  source: string[];
  sortOrder: number;
}

export function toRuleDTO(row: {
  id: string; enabled: boolean; comment: string; outboundTag: string;
  domainJson: string; ipJson: string; port: string; network: string;
  protocolJson: string; inboundTagJson: string; sourceJson: string;
  sortOrder: number;
}): RoutingRuleDTO {
  return {
    id: row.id,
    enabled: row.enabled,
    comment: row.comment,
    outboundTag: row.outboundTag,
    domain: parseJsonLoose<string[]>(row.domainJson, []),
    ip: parseJsonLoose<string[]>(row.ipJson, []),
    port: row.port,
    network: row.network,
    protocol: parseJsonLoose<string[]>(row.protocolJson, []),
    inboundTag: parseJsonLoose<string[]>(row.inboundTagJson, []),
    source: parseJsonLoose<string[]>(row.sourceJson, []),
    sortOrder: row.sortOrder,
  };
}

export interface RoutingState {
  domainStrategy: string;
  rules: RoutingRuleDTO[];
}

export async function getRoutingState(): Promise<RoutingState> {
  const [rows, strat] = await Promise.all([
    db.routingRule.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.serverSetting.findUnique({ where: { key: "set_xray_domain_strategy" } }),
  ]);
  const domainStrategy = strat?.value ?? "AsIs";
  return { domainStrategy, rules: rows.map(toRuleDTO) };
}

export interface RuleInput {
  enabled: boolean;
  comment: string;
  outboundTag: string;
  domain: string[];
  ip: string[];
  port: string;
  network: string;
  protocol: string[];
  inboundTag: string[];
  source: string[];
}

export function validateRule(body: unknown): { ok: true; data: RuleInput } | { ok: false; fields: FieldError[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields: FieldError[] = [];

  const outboundTag = typeof b.outboundTag === "string" ? b.outboundTag.trim() : "";
  const comment = typeof b.comment === "string" ? b.comment.trim().slice(0, 80) : "";
  const port = typeof b.port === "string" ? b.port.trim() : "";
  const network = typeof b.network === "string" ? b.network.trim() : "";
  const enabled = b.enabled === undefined ? true : Boolean(b.enabled);

  const domain = isStrArray(b.domain) ? b.domain.filter((s) => s.trim()) : [];
  const ip = isStrArray(b.ip) ? b.ip.filter((s) => s.trim()) : [];
  const protocol = isStrArray(b.protocol) ? b.protocol.filter((s) => s.trim()) : [];
  const inboundTag = isStrArray(b.inboundTag) ? b.inboundTag.filter((s) => s.trim()) : [];
  const source = isStrArray(b.source) ? b.source.filter((s) => s.trim()) : [];

  if (!outboundTag || !TAG_RE.test(outboundTag)) {
    fields.push({ field: "outboundTag", code: "format" });
  }
  if (port && !/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(port)) {
    fields.push({ field: "port", code: "format" });
  }
  if (network && !/^(tcp|udp|tcp,udp|udp,tcp)$/.test(network)) {
    fields.push({ field: "network", code: "format" });
  }
  /* at least one match condition */
  if (!domain.length && !ip.length && !port && !network && !protocol.length && !inboundTag.length && !source.length) {
    fields.push({ field: "conditions", code: "required" });
  }
  /* unknown protocols guard */
  const KNOWN = ["http", "tls", "quic", "bittorrent"];
  if (protocol.some((p) => !KNOWN.includes(p))) {
    fields.push({ field: "protocol", code: "format" });
  }

  if (fields.length) return { ok: false, fields };
  return { ok: true, data: { enabled, comment, outboundTag, domain, ip, port, network, protocol, inboundTag, source } };
}

export async function saveRoutingState(
  domainStrategy: string,
  rules: RuleInput[]
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.routingRule.deleteMany({});
    await tx.routingRule.createMany({
      data: rules.map((r, i) => ({
        enabled: r.enabled,
        comment: r.comment,
        outboundTag: r.outboundTag,
        domainJson: JSON.stringify(r.domain),
        ipJson: JSON.stringify(r.ip),
        port: r.port,
        network: r.network,
        protocolJson: JSON.stringify(r.protocol),
        inboundTagJson: JSON.stringify(r.inboundTag),
        sourceJson: JSON.stringify(r.source),
        sortOrder: i,
      })),
    });
    await tx.serverSetting.upsert({
      where: { key: "set_xray_domain_strategy" },
      update: { value: domainStrategy },
      create: { key: "set_xray_domain_strategy", value: domainStrategy },
    });
  });
}

/* ---------- idempotent seeds ---------- */

export async function ensureNetSeeds(): Promise<void> {
  const obCount = await db.outbound.count();
  if (obCount === 0) {
    await db.outbound.createMany({
      data: [
        {
          tag: "direct",
          protocol: "freedom",
          domainStrategy: "AsIs",
          settingsJson: JSON.stringify({ domainStrategy: "AsIs" }),
          sortOrder: 0,
          upBytes: 182_536_110_000,
          downBytes: 1_284_992_470_000,
        },
        {
          tag: "blocked",
          protocol: "blackhole",
          settingsJson: JSON.stringify({ response: { type: "none" } }),
          sortOrder: 1,
          upBytes: 9_240_000,
          downBytes: 0,
        },
        {
          tag: "warp",
          protocol: "wireguard",
          domainStrategy: "UseIPv4",
          settingsJson: JSON.stringify({
            secretKey: "aGVsbG9zZXBoaXJvdGh3YXJwcHJpdmF0ZWtleTMyYnl0ZXM=",
            address: ["172.16.0.2/32", "2606:4700:110:8a3f::2/128"],
            peers: [
              {
                publicKey: "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
                endpoint: "engage.cloudflareclient.com:2408",
              },
            ],
            mtu: 1280,
            reserved: [142, 88, 21],
          }),
          sortOrder: 2,
          upBytes: 42_190_400_000,
          downBytes: 318_640_900_000,
        },
      ],
    });
  }

  const ruleCount = await db.routingRule.count();
  if (ruleCount === 0) {
    await db.routingRule.createMany({
      data: [
        {
          enabled: true,
          comment: "Block BitTorrent traffic",
          outboundTag: "blocked",
          protocolJson: JSON.stringify(["bittorrent"]),
          sortOrder: 0,
        },
        {
          enabled: true,
          comment: "Block private & LAN addresses",
          outboundTag: "blocked",
          ipJson: JSON.stringify(["geoip:private"]),
          sortOrder: 1,
        },
        {
          enabled: true,
          comment: "OpenAI, Google & Streaming via Cloudflare WARP",
          outboundTag: "warp",
          domainJson: JSON.stringify([
            "geosite:openai",
            "geosite:google",
            "geosite:netflix",
            "geosite:spotify",
          ]),
          sortOrder: 2,
        },
        {
          enabled: true,
          comment: "Iran domestic traffic direct bypass",
          outboundTag: "direct",
          domainJson: JSON.stringify(["geosite:category-ir", "regexp:.*\\.ir$"]),
          ipJson: JSON.stringify(["geoip:ir"]),
          sortOrder: 3,
        },
      ],
    });
  }

  const nodeCount = await db.node.count();
  if (nodeCount === 0) {
    await db.node.createMany({
      data: [
        {
          name: "Orbit Relay 01 · Frankfurt",
          scheme: "https",
          address: "de1.sephiroth.net",
          port: 2087,
          basePath: "/panel/",
          apiToken: "seph-node-de1-9988776655",
          enable: true,
          syncAll: true,
          inboundTags: "[]",
          outboundTag: "direct",
          tlsVerify: "verify",
          status: "online",
          latencyMs: 28,
          xrayVersion: "25.8.29",
          lastSeen: new Date(),
        },
        {
          name: "Tehran Edge Bridge · Asiatech",
          scheme: "https",
          address: "ir1.sephiroth.net",
          port: 2096,
          basePath: "/bridge/",
          apiToken: "seph-node-ir1-1122334455",
          enable: true,
          syncAll: true,
          inboundTags: "[]",
          outboundTag: "warp",
          tlsVerify: "verify",
          status: "online",
          latencyMs: 12,
          xrayVersion: "25.8.29",
          lastSeen: new Date(),
        },
        {
          name: "Amsterdam Core 02 · Leaseweb",
          scheme: "https",
          address: "nl1.sephiroth.net",
          port: 8443,
          basePath: "/panel/",
          apiToken: "seph-node-nl1-5566778899",
          enable: true,
          syncAll: false,
          inboundTags: JSON.stringify(["vless-main", "trojan-tls"]),
          outboundTag: "direct",
          tlsVerify: "verify",
          status: "online",
          latencyMs: 35,
          xrayVersion: "25.8.29",
          lastSeen: new Date(),
        },
      ],
    });
  }

  const tunnelCount = await db.relayTunnel.count();
  if (tunnelCount === 0) {
    await db.relayTunnel.createMany({
      data: [
        {
          name: "Tehran -> Frankfurt Reality Relay",
          mode: "xhttp-reverse",
          entryNode: "Tehran Edge Bridge · Asiatech",
          entryAddress: "ir1.sephiroth.net",
          entryPort: 443,
          exitNode: "Orbit Relay 01 · Frankfurt",
          exitAddress: "de1.sephiroth.net",
          exitPort: 443,
          inboundTag: "vless-main",
          lbStrategy: "least-ping",
          enabled: true,
          latencyMs: 31,
          upBytes: 84_200_000_000,
          downBytes: 612_400_000_000,
          status: "active",
        },
        {
          name: "Shiraz -> Amsterdam gRPC Multiplex",
          mode: "grpc-mux",
          entryNode: "Shiraz Respina Entry",
          entryAddress: "ir2.sephiroth.net",
          entryPort: 8443,
          exitNode: "Amsterdam Core 02 · Leaseweb",
          exitAddress: "nl1.sephiroth.net",
          exitPort: 8443,
          inboundTag: "vmess-grpc",
          lbStrategy: "round-robin",
          enabled: true,
          latencyMs: 39,
          upBytes: 29_100_000_000,
          downBytes: 214_800_000_000,
          status: "active",
        },
      ],
    });
  }
}
