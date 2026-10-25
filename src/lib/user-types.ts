/* ============================================================
   Sephiroth · Phase 4 — shared user types & pure helpers
   Safe for both client components and server routes (no node
   APIs, no Prisma, no db imports).
   ============================================================ */

/* ---------- embedded client shape (Phase 3 clientsJson mirror) ---------- */

export interface EmbeddedClient {
  email: string;
  key: string;
  subId: string;
  flow: string;
  ipLimit: number;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  enabled: boolean;
  ownerId?: string; // present on entries managed by ClientUser
}

export function parseJsonLoose<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function parseClients(raw: string | null | undefined): EmbeddedClient[] {
  return parseJsonLoose<EmbeddedClient[]>(raw, []).map((c) => ({
    ...c,
    ipLimit: typeof c.ipLimit === "number" ? c.ipLimit : 0,
  }));
}

/* ---------- validation ---------- */

export const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;

export type UserFieldKey =
  | "username"
  | "note"
  | "trafficLimitGb"
  | "expiryDays"
  | "ipLimit"
  | "inboundIds";
export type UserFieldError = { field: UserFieldKey; code: string };

export interface UserWrite {
  username: string;
  note: string;
  enabled: boolean;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  inboundIds: string[];
}

function numField(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function validateUser(
  body: unknown,
  opts: { requireInbounds: boolean; partial?: boolean }
): { ok: true; data: UserWrite } | { ok: false; fields: UserFieldError[] } {
  const fields: UserFieldError[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  const username = typeof b.username === "string" ? b.username.trim() : "";
  if (!(opts.partial && username === "") && !USERNAME_RE.test(username))
    fields.push({ field: "username", code: "format" });

  const note = typeof b.note === "string" ? b.note.slice(0, 200) : "";

  const trafficLimitGb = numField(b.trafficLimitGb);
  if (trafficLimitGb !== null && (Number.isNaN(trafficLimitGb) || trafficLimitGb < 0 || trafficLimitGb > 1_000_000))
    fields.push({ field: "trafficLimitGb", code: "range" });

  const expiryDays = numField(b.expiryDays);
  if (expiryDays !== null && (Number.isNaN(expiryDays) || expiryDays < 0 || expiryDays > 3650))
    fields.push({ field: "expiryDays", code: "range" });

  const ipLimit = numField(b.ipLimit) ?? 0;
  if (Number.isNaN(ipLimit) || ipLimit < 0 || ipLimit > 1000 || !Number.isInteger(ipLimit))
    fields.push({ field: "ipLimit", code: "range" });

  const inboundIds = Array.isArray(b.inboundIds)
    ? b.inboundIds.filter((x): x is string => typeof x === "string")
    : [];
  if (opts.requireInbounds && inboundIds.length === 0)
    fields.push({ field: "inboundIds", code: "required" });

  if (fields.length > 0) return { ok: false, fields };

  return {
    ok: true,
    data: {
      username,
      note,
      enabled: typeof b.enabled === "boolean" ? b.enabled : true,
      trafficLimitGb,
      expiryDays: expiryDays === null ? null : Math.round(expiryDays),
      ipLimit,
      inboundIds,
    },
  };
}

/* ---------- status derivation ---------- */

export type UserStatus = "active" | "expired" | "capped" | "disabled";

export function deriveStatus(u: {
  enabled: boolean;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  usedTrafficGb: number;
  createdAt: Date | string;
  now?: Date;
}): UserStatus {
  if (!u.enabled) return "disabled";
  const now = u.now ?? new Date();
  if (u.expiryDays !== null) {
    const end = new Date(u.createdAt).getTime() + u.expiryDays * 86_400_000;
    if (now.getTime() >= end) return "expired";
  }
  if (u.trafficLimitGb !== null && u.usedTrafficGb >= u.trafficLimitGb) return "capped";
  return "active";
}

/** Deterministic pseudo-usage so fresh users look alive in the preview. */
export function seededUsage(id: string, trafficLimitGb: number | null): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const frac = ((h >>> 0) % 1000) / 1000; // 0..1
  const cap = trafficLimitGb !== null ? Math.min(trafficLimitGb * 0.85, 900) : 640;
  return Math.round(frac * cap * 10) / 10;
}

/** Days remaining before expiry (null = never). Negative = past. */
export function daysLeft(expiryDays: number | null, createdAt: Date | string, now?: Date): number | null {
  if (expiryDays === null) return null;
  const end = new Date(createdAt).getTime() + expiryDays * 86_400_000;
  return Math.ceil((end - (now ?? new Date()).getTime()) / 86_400_000);
}

/* ---------- DTO ---------- */

export interface AccessDTO {
  id: string;
  inboundId: string;
  email: string;
  key: string;
  flow: string;
  inbound: {
    id: string;
    tag: string;
    protocol: string;
    port: number;
    transport: string;
    security: string;
    status: string;
    listen: string;
    streamJson: string;
  };
}

export interface UserDTO {
  id: string;
  username: string;
  subId: string;
  note: string | null;
  enabled: boolean;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  usedTrafficGb: number;
  status: UserStatus;
  resellerId: string | null;
  createdAt: string;
  updatedAt: string;
  accesses: AccessDTO[];
}
