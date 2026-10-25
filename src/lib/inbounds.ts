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

export const IN_SECURITIES = ["none", "tls"] as const;

export const IN_STATUSES = ["online", "maintenance", "disabled"] as const;

/* ---------- DTO ---------- */

export type InboundRow = Inbound;

export interface InboundDTO {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  transport: string;
  security: string;
  status: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toDTO(row: InboundRow): InboundDTO {
  return {
    id: row.id,
    tag: row.tag,
    protocol: row.protocol,
    port: row.port,
    transport: row.transport,
    security: row.security,
    status: row.status,
    note: row.note,
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
  | "transport"
  | "security"
  | "status"
  | "note";

export type InboundFieldError =
  | "required"
  | "tagFormat"
  | "portType"
  | "portRange"
  | "noteLong"
  | "badValue";

export interface InboundInput {
  tag: string;
  protocol: string;
  port: number;
  transport: string;
  security: string;
  status: string;
  note: string | null;
}

export type InboundValidation =
  | { ok: true; data: InboundInput }
  | { ok: false; fields: Partial<Record<InboundFieldKey, InboundFieldError>> };

const TAG_PATTERN = /^[a-zA-Z0-9_-]+$/;
const KNOWN_FIELDS: InboundFieldKey[] = [
  "tag",
  "protocol",
  "port",
  "transport",
  "security",
  "status",
  "note",
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

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    data: {
      tag: normTag(raw.tag),
      protocol: String(raw.protocol),
      port: normPort(raw.port),
      transport: String(raw.transport),
      security: String(raw.security),
      status: String(raw.status),
      note: normNote(raw.note),
    },
  };
}

/** Patch mode: validate only PROVIDED fields; untouched fields pass through. */
function validatePartial(raw: Record<string, unknown>): InboundValidation {
  const provided = KNOWN_FIELDS.some((key) => raw[key] !== undefined);
  if (!provided) {
    // no known field present → generic error surface (client shows a message)
    return { ok: false, fields: { tag: "required" } };
  }

  const fields: Partial<Record<InboundFieldKey, InboundFieldError>> = {};
  const data: Partial<InboundInput> = {};

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

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  // runtime value only carries the provided fields
  return { ok: true, data: data as InboundInput };
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
