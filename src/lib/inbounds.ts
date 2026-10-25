import { Prisma, type Inbound } from "@prisma/client";
import { parseSessionCookie, verifyToken } from "@/lib/auth";
import { db } from "@/lib/db";

/* ============================================================
   Sephiroth · Phase 3 — Inbounds (server-side helpers)
   - DTO serialization (Dates → ISO strings)
   - admin session guard
   - idempotent flag-guarded inbound seed
   - request payload validation (create + partial update)
   - Prisma unique-constraint error mapping
   ============================================================ */

/* ---------- allowed enum values ---------- */

export const IN_PROTOCOLS = [
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "hysteria2",
] as const;

export const IN_TRANSPORTS = ["tcp", "ws", "grpc", "httpupgrade"] as const;

export const IN_SECURITIES = ["none", "tls", "reality"] as const;

export const IN_STATUSES = ["online", "maintenance", "disabled"] as const;

/* ---------- shared config shapes (stored as JSON columns) ---------- */

export const IN_FLOWS = ["", "xtls-rprx-vision"] as const;

export const IN_SNIFF_DESTS = ["http", "tls", "quic", "fakerd"] as const;

export const IN_TLS_VERSIONS = ["", "1.0", "1.1", "1.2", "1.3"] as const;

export const IN_FINGERPRINTS = [
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "360",
  "qq",
  "random",
] as const;

/** One user account attached to an inbound. */
export interface InboundClient {
  email: string;
  key: string; // uuid (vless/vmess) or password (trojan/ss/hy2)
  subId: string;
  flow: string; // "" | "xtls-rprx-vision"
  ipLimit: number; // 0 = unlimited
  trafficLimitGb: number | null;
  expiryDays: number | null;
  enabled: boolean;
}

export interface InboundSniffing {
  enabled: boolean;
  destOverride: string[]; // subset of IN_SNIFF_DESTS
  routeOnly: boolean;
}

/** Flat key/value bag for transport + security settings. */
export type InboundStream = Record<string, string | number | boolean>;

/** Whitelisted stream keys per transport / security (unknown keys are dropped). */
const STREAM_KEYS: Record<string, { str?: string[]; num?: string[]; bool?: string[] }> = {
  transport: {
    str: [
      "headerType", "requestPath", "requestHost", // tcp/http
      "path", "host", "earlyDataHeaderName", // ws / httpupgrade
      "serviceName", "authority", // grpc
      "fallbacksJson", // serialized fallbacks array
    ],
    num: ["maxEarlyData"],
    bool: ["multiMode", "mux"],
  },
  tls: {
    str: ["sni", "alpn", "fingerprint", "minVer", "maxVer", "certPublic", "certPrivate"],
    bool: ["allowInsecure"],
  },
  reality: {
    str: ["dest", "serverNames", "shortIds", "privateKey", "publicKey", "fingerprint", "spiderX"],
  },
};

const DEFAULT_SNIFFING: InboundSniffing = {
  enabled: false,
  destOverride: ["http", "tls"],
  routeOnly: false,
};

function parseJsonLoose<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/* ---------- DTO ---------- */

export type InboundRow = Inbound;

export interface InboundDTO {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  listen: string;
  transport: string;
  security: string;
  status: string;
  note: string | null;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  clients: InboundClient[];
  sniffing: InboundSniffing;
  stream: InboundStream;
  createdAt: string;
  updatedAt: string;
}

export function toDTO(row: InboundRow): InboundDTO {
  const clients = parseJsonLoose<InboundClient[]>(row.clientsJson, []);
  return {
    id: row.id,
    tag: row.tag,
    protocol: row.protocol,
    port: row.port,
    listen: row.listen,
    transport: row.transport,
    security: row.security,
    status: row.status,
    note: row.note,
    trafficLimitGb: row.trafficLimitGb,
    expiryDays: row.expiryDays,
    clients: Array.isArray(clients) ? clients : [],
    sniffing: {
      ...DEFAULT_SNIFFING,
      ...parseJsonLoose<Partial<InboundSniffing>>(row.sniffingJson, {}),
    },
    stream: parseJsonLoose<InboundStream>(row.streamJson, {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ---------- admin guard ---------- */

/** Returns the admin username for a valid session, else null. */
export async function requireAdmin(req: Request): Promise<string | null> {
  const username = await verifyToken(parseSessionCookie(req));
  if (!username) return null;
  const admin = await db.adminUser.findUnique({ where: { username } });
  return admin ? username : null;
}

/* ---------- idempotent seed (flag-guarded) ---------- */

const SEED_FLAG_KEY = "inbounds_seeded_v1";

const SEED_INBOUNDS = [
  {
    tag: "vless-main",
    protocol: "vless",
    port: 443,
    transport: "ws",
    security: "tls",
    status: "online",
  },
  {
    tag: "vmess-grpc",
    protocol: "vmess",
    port: 8443,
    transport: "grpc",
    security: "none",
    status: "online",
  },
  {
    tag: "trojan-tls",
    protocol: "trojan",
    port: 2053,
    transport: "tcp",
    security: "tls",
    status: "online",
  },
  {
    tag: "ss-2022",
    protocol: "shadowsocks",
    port: 8388,
    transport: "tcp",
    security: "none",
    status: "online",
  },
  {
    tag: "hy2-edge",
    protocol: "hysteria2",
    port: 36712,
    transport: "tcp",
    security: "none",
    status: "online",
  },
  {
    tag: "legacy-ss",
    protocol: "shadowsocks",
    port: 8888,
    transport: "tcp",
    security: "none",
    status: "maintenance",
  },
] as const;

export async function ensureInboundSeed(): Promise<void> {
  const flag = await db.serverSetting.findUnique({
    where: { key: SEED_FLAG_KEY },
  });
  if (flag?.value === "1") return;

  const count = await db.inbound.count();
  if (count === 0) {
    // deterministic ordering: explicit createdAt offsets
    for (let i = 0; i < SEED_INBOUNDS.length; i++) {
      const row = SEED_INBOUNDS[i];
      await db.inbound.create({
        data: { ...row, createdAt: new Date(Date.now() + i * 1000) },
      });
    }
  }

  await db.serverSetting.upsert({
    where: { key: SEED_FLAG_KEY },
    update: { value: "1" },
    create: { key: SEED_FLAG_KEY, value: "1" },
  });
}

/* ---------- input validation ---------- */

export type InboundFieldKey =
  | "tag"
  | "protocol"
  | "port"
  | "listen"
  | "transport"
  | "security"
  | "status"
  | "note"
  | "trafficLimitGb"
  | "expiryDays"
  | "clients"
  | "sniffing"
  | "stream";

export type InboundFieldError =
  | "required"
  | "tagFormat"
  | "portType"
  | "portRange"
  | "noteLong"
  | "badValue"
  | "invalid"
  | "tooLong"
  | "tooMany"
  | "dupEmail";

/** Prisma-ready write payload (complex fields pre-serialized). */
export interface InboundWrite {
  tag: string;
  protocol: string;
  port: number;
  listen: string;
  transport: string;
  security: string;
  status: string;
  note: string | null;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  clientsJson: string;
  sniffingJson: string;
  streamJson: string;
}

export type InboundValidation =
  | { ok: true; data: InboundWrite }
  | { ok: false; fields: Partial<Record<InboundFieldKey, InboundFieldError>> };

const TAG_PATTERN = /^[a-zA-Z0-9_-]+$/;
const LISTEN_PATTERN = /^[a-zA-Z0-9.:@-]+$/;
const MAX_CLIENTS = 100;
const KNOWN_FIELDS: InboundFieldKey[] = [
  "tag",
  "protocol",
  "port",
  "listen",
  "transport",
  "security",
  "status",
  "note",
  "trafficLimitGb",
  "expiryDays",
  "clients",
  "sniffing",
  "stream",
];

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function checkTag(value: unknown): InboundFieldError | null {
  const tag = (asString(value) ?? "").trim();
  if (!tag) return "required";
  if (tag.length > 32 || !TAG_PATTERN.test(tag)) return "tagFormat";
  return null;
}

function checkEnum(
  value: unknown,
  allowed: readonly string[]
): InboundFieldError | null {
  const v = asString(value);
  if (v === undefined || !allowed.includes(v)) return "badValue";
  return null;
}

function checkPort(value: unknown): InboundFieldError | null {
  if (value === undefined || value === null || value === "") return "portType";
  if (typeof value === "boolean") return "portType";
  const num = Number(value);
  if (Number.isNaN(num)) return "portType";
  if (!Number.isInteger(num) || num < 1 || num > 65535) return "portRange";
  return null;
}

function checkNote(value: unknown): InboundFieldError | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null; // non-string note coerces to null downstream
  if (value.trim().length > 200) return "noteLong";
  return null;
}

function normTag(value: unknown): string {
  return (asString(value) ?? "").trim();
}

function normPort(value: unknown): number {
  return Number(value);
}

function normNote(value: unknown): string | null {
  if (typeof value !== "string") return null; // includes null / undefined
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/* ---------- extended field validators ---------- */

function checkListen(value: unknown): InboundFieldError | null {
  const v = asString(value);
  if (v === undefined) return null; // missing → "" default
  if (v.trim() === "") return null; // "" = all interfaces
  if (v.trim().length > 64 || !LISTEN_PATTERN.test(v.trim())) return "invalid";
  return null;
}

function normListen(value: unknown): string {
  return (asString(value) ?? "").trim();
}

function checkLimitGb(value: unknown): InboundFieldError | null {
  if (value === undefined) return null;
  if (value === null || value === "") return null; // "" → null (unlimited)
  if (typeof value === "boolean") return "invalid";
  const num = Number(value);
  if (Number.isNaN(num) || num < 0 || num > 1_000_000) return "invalid";
  return null;
}

function normLimitGb(value: unknown): number | null {
  if (value === null || value === "" || value === undefined) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : Math.round(num * 100) / 100;
}

function checkExpiryDays(value: unknown): InboundFieldError | null {
  if (value === undefined) return null;
  if (value === null || value === "") return null; // "" → null (never)
  if (typeof value === "boolean") return "invalid";
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isInteger(num) || num < 0 || num > 36500)
    return "invalid";
  return null;
}

function normExpiryDays(value: unknown): number | null {
  if (value === null || value === "" || value === undefined) return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function asBool(value: unknown): boolean {
  return value === true || value === "true";
}

function checkClients(value: unknown): InboundFieldError | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "invalid";
  if (value.length > MAX_CLIENTS) return "tooMany";
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return "invalid";
    const c = item as Record<string, unknown>;
    const email = asString(c.email)?.trim() ?? "";
    if (!email) return "required";
    if (email.length > 64 || /\s/.test(email)) return "invalid";
    if (seen.has(email)) return "dupEmail";
    seen.add(email);
    const key = asString(c.key)?.trim() ?? "";
    if (!key) return "required";
    if (key.length > 128) return "tooLong";
    if (asString(c.subId) !== undefined && (asString(c.subId)?.trim().length ?? 0) > 64)
      return "tooLong";
    const flow = asString(c.flow) ?? "";
    if (!(IN_FLOWS as readonly string[]).includes(flow)) return "invalid";
    if (c.ipLimit !== undefined && c.ipLimit !== null && c.ipLimit !== "") {
      const n = Number(c.ipLimit);
      if (Number.isNaN(n) || !Number.isInteger(n) || n < 0 || n > 999) return "invalid";
    }
    if (c.trafficLimitGb !== undefined) {
      const err = checkLimitGb(c.trafficLimitGb);
      if (err) return "invalid";
    }
    if (c.expiryDays !== undefined) {
      const err = checkExpiryDays(c.expiryDays);
      if (err) return "invalid";
    }
  }
  return null;
}

function normClients(value: unknown): InboundClient[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CLIENTS).map((item) => {
    const c = (item ?? {}) as Record<string, unknown>;
    return {
      email: (asString(c.email) ?? "").trim(),
      key: (asString(c.key) ?? "").trim(),
      subId: (asString(c.subId) ?? "").trim(),
      flow: (asString(c.flow) ?? "").trim(),
      ipLimit:
        c.ipLimit === undefined || c.ipLimit === null || c.ipLimit === ""
          ? 0
          : Math.max(0, Math.min(999, Number(c.ipLimit) || 0)),
      trafficLimitGb: normLimitGb(c.trafficLimitGb),
      expiryDays: normExpiryDays(c.expiryDays),
      enabled: c.enabled === undefined ? true : asBool(c.enabled),
    };
  });
}

function checkSniffing(value: unknown): InboundFieldError | null {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return "invalid";
  const s = value as Record<string, unknown>;
  if (s.enabled !== undefined && typeof s.enabled !== "boolean") return "invalid";
  if (s.routeOnly !== undefined && typeof s.routeOnly !== "boolean") return "invalid";
  if (s.destOverride !== undefined) {
    if (!Array.isArray(s.destOverride)) return "invalid";
    for (const d of s.destOverride) {
      if (!(IN_SNIFF_DESTS as readonly string[]).includes(String(d))) return "invalid";
    }
  }
  return null;
}

function normSniffing(value: unknown): InboundSniffing {
  const s = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const dests = Array.isArray(s.destOverride)
    ? (s.destOverride.map(String).filter((d) => (IN_SNIFF_DESTS as readonly string[]).includes(d)) as string[])
    : DEFAULT_SNIFFING.destOverride;
  return {
    enabled: asBool(s.enabled),
    destOverride: dests,
    routeOnly: asBool(s.routeOnly),
  };
}

function checkStream(value: unknown): InboundFieldError | null {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return "invalid";
  const st = value as Record<string, unknown>;
  const allowed = new Set([
    ...(STREAM_KEYS.transport.str ?? []),
    ...(STREAM_KEYS.transport.num ?? []),
    ...(STREAM_KEYS.transport.bool ?? []),
    ...(STREAM_KEYS.tls.str ?? []),
    ...(STREAM_KEYS.tls.bool ?? []),
    ...(STREAM_KEYS.reality.str ?? []),
  ]);
  for (const [k, v] of Object.entries(st)) {
    if (!allowed.has(k)) continue; // unknown keys dropped silently
    if (typeof v === "string") {
      const limit = k === "fallbacksJson" || k === "certPublic" || k === "certPrivate" ? 8192 : 1024;
      if (v.length > limit) return "tooLong";
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) return "invalid";
    } else if (typeof v !== "boolean") {
      return "invalid";
    }
  }
  return null;
}

function normStream(value: unknown): InboundStream {
  const out: InboundStream = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  const st = value as Record<string, unknown>;
  const groups = [
    { keys: STREAM_KEYS.transport.str ?? [], type: "str" as const },
    { keys: STREAM_KEYS.tls.str ?? [], type: "str" as const },
    { keys: STREAM_KEYS.reality.str ?? [], type: "str" as const },
    { keys: STREAM_KEYS.transport.num ?? [], type: "num" as const },
    { keys: STREAM_KEYS.transport.bool ?? [], type: "bool" as const },
    { keys: STREAM_KEYS.tls.bool ?? [], type: "bool" as const },
  ];
  for (const g of groups) {
    for (const k of g.keys) {
      if (st[k] === undefined || st[k] === null || st[k] === "") continue;
      if (g.type === "str" && typeof st[k] === "string") out[k] = st[k] as string;
      if (g.type === "num" && typeof st[k] === "number") out[k] = st[k];
      if (g.type === "bool" && typeof st[k] === "boolean") out[k] = st[k];
    }
  }
  return out;
}

export function validateInbound(
  body: unknown,
  opts: { partial?: boolean } = {}
): InboundValidation {
  const raw: Record<string, unknown> =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  return opts.partial ? validatePartial(raw) : validateFull(raw);
}

/** Create mode: every required field must be present and valid. */
function validateFull(raw: Record<string, unknown>): InboundValidation {
  const fields: Partial<Record<InboundFieldKey, InboundFieldError>> = {};

  const tagError = checkTag(raw.tag);
  if (tagError) fields.tag = tagError;

  const protocolError = checkEnum(raw.protocol, IN_PROTOCOLS);
  if (protocolError) fields.protocol = protocolError;

  const portError = checkPort(raw.port);
  if (portError) fields.port = portError;

  const transportError = checkEnum(raw.transport, IN_TRANSPORTS);
  if (transportError) fields.transport = transportError;

  const securityError = checkEnum(raw.security, IN_SECURITIES);
  if (securityError) fields.security = securityError;

  const statusError = checkEnum(raw.status, IN_STATUSES);
  if (statusError) fields.status = statusError;

  const noteError = checkNote(raw.note);
  if (noteError) fields.note = noteError;

  const listenError = checkListen(raw.listen);
  if (listenError) fields.listen = listenError;

  const limitError = checkLimitGb(raw.trafficLimitGb);
  if (limitError) fields.trafficLimitGb = limitError;

  const expiryError = checkExpiryDays(raw.expiryDays);
  if (expiryError) fields.expiryDays = expiryError;

  const clientsError = checkClients(raw.clients);
  if (clientsError) fields.clients = clientsError;

  const sniffingError = checkSniffing(raw.sniffing);
  if (sniffingError) fields.sniffing = sniffingError;

  const streamError = checkStream(raw.stream);
  if (streamError) fields.stream = streamError;

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  const data: InboundWrite = {
    tag: normTag(raw.tag),
    protocol: String(raw.protocol),
    port: normPort(raw.port),
    listen: normListen(raw.listen),
    transport: String(raw.transport),
    security: String(raw.security),
    status: String(raw.status),
    note: normNote(raw.note),
    trafficLimitGb: normLimitGb(raw.trafficLimitGb),
    expiryDays: normExpiryDays(raw.expiryDays),
    clientsJson: JSON.stringify(normClients(raw.clients)),
    sniffingJson: JSON.stringify(normSniffing(raw.sniffing)),
    streamJson: JSON.stringify(normStream(raw.stream)),
  };
  return { ok: true, data };
}

/** Patch mode: validate only PROVIDED fields; untouched fields pass through. */
function validatePartial(raw: Record<string, unknown>): InboundValidation {
  const provided = KNOWN_FIELDS.some((key) => raw[key] !== undefined);
  if (!provided) {
    // no known field present → generic error surface (client shows a message)
    return { ok: false, fields: { tag: "required" } };
  }

  const fields: Partial<Record<InboundFieldKey, InboundFieldError>> = {};
  const data: Partial<InboundWrite> = {};

  if (raw.tag !== undefined) {
    const err = checkTag(raw.tag);
    if (err) fields.tag = err;
    else data.tag = normTag(raw.tag);
  }
  if (raw.protocol !== undefined) {
    const err = checkEnum(raw.protocol, IN_PROTOCOLS);
    if (err) fields.protocol = err;
    else data.protocol = String(raw.protocol);
  }
  if (raw.port !== undefined) {
    const err = checkPort(raw.port);
    if (err) fields.port = err;
    else data.port = normPort(raw.port);
  }
  if (raw.transport !== undefined) {
    const err = checkEnum(raw.transport, IN_TRANSPORTS);
    if (err) fields.transport = err;
    else data.transport = String(raw.transport);
  }
  if (raw.security !== undefined) {
    const err = checkEnum(raw.security, IN_SECURITIES);
    if (err) fields.security = err;
    else data.security = String(raw.security);
  }
  if (raw.status !== undefined) {
    const err = checkEnum(raw.status, IN_STATUSES);
    if (err) fields.status = err;
    else data.status = String(raw.status);
  }
  if (raw.note !== undefined) {
    const err = checkNote(raw.note);
    if (err) fields.note = err;
    else data.note = normNote(raw.note);
  }
  if (raw.listen !== undefined) {
    const err = checkListen(raw.listen);
    if (err) fields.listen = err;
    else data.listen = normListen(raw.listen);
  }
  if (raw.trafficLimitGb !== undefined) {
    const err = checkLimitGb(raw.trafficLimitGb);
    if (err) fields.trafficLimitGb = err;
    else data.trafficLimitGb = normLimitGb(raw.trafficLimitGb);
  }
  if (raw.expiryDays !== undefined) {
    const err = checkExpiryDays(raw.expiryDays);
    if (err) fields.expiryDays = err;
    else data.expiryDays = normExpiryDays(raw.expiryDays);
  }
  if (raw.clients !== undefined) {
    const err = checkClients(raw.clients);
    if (err) fields.clients = err;
    else data.clientsJson = JSON.stringify(normClients(raw.clients));
  }
  if (raw.sniffing !== undefined) {
    const err = checkSniffing(raw.sniffing);
    if (err) fields.sniffing = err;
    else data.sniffingJson = JSON.stringify(normSniffing(raw.sniffing));
  }
  if (raw.stream !== undefined) {
    const err = checkStream(raw.stream);
    if (err) fields.stream = err;
    else data.streamJson = JSON.stringify(normStream(raw.stream));
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  // runtime value only carries the provided fields
  return { ok: true, data: data as InboundWrite };
}

/* ---------- Prisma write-error mapping ---------- */

export function prismaErrorCode(err: unknown): string | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code;
  return null;
}

export type InboundWriteErrorKind =
  | "duplicate_tag"
  | "duplicate_port"
  | "unknown";

/** Maps a failed create/update to its duplicate kind, or "unknown". */
export function mapInboundWriteError(err: unknown): InboundWriteErrorKind {
  if (prismaErrorCode(err) === "P2002") {
    const target = (err as { meta?: { target?: unknown } }).meta?.target;
    const joined = Array.isArray(target) ? target.join(",") : String(target ?? "");
    if (joined.includes("tag")) return "duplicate_tag";
    if (joined.includes("port")) return "duplicate_port";
  }
  return "unknown";
}
