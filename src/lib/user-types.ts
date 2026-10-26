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
  | "resetPeriod"
  | "inboundIds";
export type UserFieldError = { field: UserFieldKey; code: string };

export interface UserWrite {
  username: string;
  note: string;
  enabled: boolean;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  resetPeriod: string | null;
  inboundIds: string[];
}

function numField(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export const RESET_PERIODS = ["none", "daily", "weekly", "monthly"] as const;

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

  const resetPeriod = normalizeResetPeriod(b.resetPeriod);
  if (resetPeriod === "invalid") fields.push({ field: "resetPeriod", code: "format" });

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
      resetPeriod: resetPeriod === "invalid" ? null : resetPeriod,
      inboundIds,
    },
  };
}

function normalizeResetPeriod(v: unknown): string | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  return (RESET_PERIODS as readonly string[]).includes(String(v)) ? String(v) : "invalid";
}

/* ---------- partial PATCH validation ---------- */

/**
 * Sparse shape for PATCH /api/users/:id — ONLY the keys present in the
 * request body appear in the result, so the route can merge onto the
 * existing row instead of resetting omitted fields to defaults.
 */
export type UserPatch = Partial<{
  note: string | null;
  enabled: boolean;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  resetPeriod: string | null;
  inboundIds: string[];
}>;

export function validateUserPatch(
  body: unknown
): { ok: true; data: UserPatch } | { ok: false; fields: UserFieldError[] } {
  const fields: UserFieldError[] = [];
  const b = (body ?? {}) as Record<string, unknown>;
  const out: UserPatch = {};

  if ("note" in b) {
    if (b.note === null) out.note = null;
    else if (typeof b.note === "string") out.note = b.note.slice(0, 200);
    else fields.push({ field: "note", code: "format" });
  }
  if ("enabled" in b) {
    if (typeof b.enabled !== "boolean") fields.push({ field: "note", code: "format" });
    else out.enabled = b.enabled;
  }
  if ("trafficLimitGb" in b) {
    const v = numField(b.trafficLimitGb);
    if (v === null) out.trafficLimitGb = null;
    else if (Number.isNaN(v) || v < 0 || v > 1_000_000)
      fields.push({ field: "trafficLimitGb", code: "range" });
    else out.trafficLimitGb = v;
  }
  if ("expiryDays" in b) {
    const v = numField(b.expiryDays);
    if (v === null) out.expiryDays = null;
    else if (Number.isNaN(v) || v < 0 || v > 3650)
      fields.push({ field: "expiryDays", code: "range" });
    else out.expiryDays = Math.round(v);
  }
  if ("ipLimit" in b) {
    const v = numField(b.ipLimit) ?? 0;
    if (Number.isNaN(v) || v < 0 || v > 1000 || !Number.isInteger(v))
      fields.push({ field: "ipLimit", code: "range" });
    else out.ipLimit = v;
  }
  if ("resetPeriod" in b) {
    const v = normalizeResetPeriod(b.resetPeriod);
    if (v === "invalid") fields.push({ field: "resetPeriod", code: "format" });
    else out.resetPeriod = v;
  }
  if ("inboundIds" in b) {
    out.inboundIds = Array.isArray(b.inboundIds)
      ? b.inboundIds.filter((x): x is string => typeof x === "string")
      : [];
  }

  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, data: out };
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
  /** WireGuard per-client keypair (empty for non-WG protocols). */
  wgPrivateKey: string;
  wgPublicKey: string;
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
  resetPeriod: string | null;
  status: UserStatus;
  resellerId: string | null;
  createdAt: string;
  updatedAt: string;
  accesses: AccessDTO[];
}
