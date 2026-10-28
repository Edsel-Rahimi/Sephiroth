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
  | "hwidLimit"
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
  hwidLimit: number | null;
  resetPeriod: string | null;
  /** 26-a — expiry clock starts at first connect instead of creation. */
  onHold: boolean;
  /** 26-a — roll the window forward on expiry instead of disabling. */
  autoRenew: boolean;
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

  // Task 23-g — sub-portal device limit (null/empty = unlimited)
  const hwidLimit = numField(b.hwidLimit);
  if (hwidLimit !== null && (Number.isNaN(hwidLimit) || hwidLimit < 0 || hwidLimit > 1000 || !Number.isInteger(hwidLimit)))
    fields.push({ field: "hwidLimit", code: "range" });

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
      hwidLimit: hwidLimit === null ? null : Math.round(hwidLimit),
      resetPeriod: resetPeriod === "invalid" ? null : resetPeriod,
      onHold: b.onHold === true,
      autoRenew: b.autoRenew === true,
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
  hwidLimit: number | null;
  resetPeriod: string | null;
  /** 26-a — toggling onHold back ON clears the anchor so the clock restarts. */
  onHold: boolean;
  autoRenew: boolean;
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
  if ("hwidLimit" in b) {
    const v = numField(b.hwidLimit);
    if (v === null) out.hwidLimit = null;
    else if (Number.isNaN(v) || v < 0 || v > 1000 || !Number.isInteger(v))
      fields.push({ field: "hwidLimit", code: "range" });
    else out.hwidLimit = Math.round(v);
  }
  if ("resetPeriod" in b) {
    const v = normalizeResetPeriod(b.resetPeriod);
    if (v === "invalid") fields.push({ field: "resetPeriod", code: "format" });
    else out.resetPeriod = v;
  }
  if ("onHold" in b) {
    if (typeof b.onHold !== "boolean") fields.push({ field: "note", code: "format" });
    else out.onHold = b.onHold;
  }
  if ("autoRenew" in b) {
    if (typeof b.autoRenew !== "boolean") fields.push({ field: "note", code: "format" });
    else out.autoRenew = b.autoRenew;
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

export type UserStatus = "active" | "expired" | "capped" | "disabled" | "onhold";

export function deriveStatus(u: {
  enabled: boolean;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  usedTrafficGb: number;
  createdAt: Date | string;
  /** 26-a — on-hold anchor; null + onHold ⇒ clock not started yet. */
  startedAt?: Date | string | null;
  now?: Date;
}): UserStatus {
  if (!u.enabled) return "disabled";
  if (u.startedAt === null && u.startedAt !== undefined) return "onhold";
  const now = u.now ?? new Date();
  if (u.expiryDays !== null) {
    const end = new Date(u.startedAt ?? u.createdAt).getTime() + u.expiryDays * 86_400_000;
    if (now.getTime() >= end) return "expired";
  }
  if (u.trafficLimitGb !== null && u.usedTrafficGb >= u.trafficLimitGb) return "capped";
  return "active";
}

/** Days remaining before expiry (null = never). Negative = past. */
export function daysLeft(
  expiryDays: number | null,
  anchor: Date | string,
  now?: Date
): number | null {
  if (expiryDays === null) return null;
  const end = new Date(anchor).getTime() + expiryDays * 86_400_000;
  return Math.ceil((end - (now ?? new Date()).getTime()) / 86_400_000);
}

/** 26-a — the timestamp the expiry clock is measured from. */
export function expiryAnchor(startedAt?: Date | string | null, createdAt?: Date | string): Date | string {
  return startedAt ?? createdAt ?? new Date();
}

/* ---------- usage forecast (burn-rate) ---------- */

export interface UsageForecast {
  /** Average GB/day consumed since account creation (≥0, rounded 2dp). */
  gbPerDay: number;
  /** Estimated whole days until the traffic cap is hit. null = unlimited, no velocity, or already capped. */
  daysToCap: number | null;
  /** Estimated calendar day the cap will be reached (ISO). null = unknown. */
  capEta: string | null;
}

/**
 * Projects when a user's traffic quota will be exhausted based on their
 * average burn-rate since creation (used ÷ age). Pure arithmetic — no
 * history tables needed. Unique among Xray panels: turns the dumb
 * "used / limit" bar into a real forecast.
 */
export function forecastUsage(
  u: Pick<UserDTO, "trafficLimitGb" | "usedTrafficGb" | "createdAt">,
  now?: Date
): UsageForecast {
  const created = new Date(u.createdAt).getTime();
  const t = (now ?? new Date()).getTime();
  const ageDays = Math.max(1, (t - created) / 86_400_000);
  const gbPerDay = Math.round((u.usedTrafficGb / ageDays) * 100) / 100;

  if (u.trafficLimitGb === null || u.trafficLimitGb <= 0 || u.usedTrafficGb >= u.trafficLimitGb) {
    return { gbPerDay, daysToCap: null, capEta: null };
  }
  const remaining = u.trafficLimitGb - u.usedTrafficGb;
  if (gbPerDay <= 0) return { gbPerDay: 0, daysToCap: null, capEta: null };
  const daysToCap = Math.ceil(remaining / gbPerDay);
  const capEta = new Date(t + daysToCap * 86_400_000).toISOString();
  return { gbPerDay, daysToCap, capEta };
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
  /** Task 23-g — sub-portal HWID device limit (null/0 = unlimited). */
  hwidLimit: number | null;
  /** Task 23-g — parsed sub-portal device registrations. */
  devices: { id: string; ua: string; firstSeen: string; lastSeen: string }[];
  usedTrafficGb: number;
  resetPeriod: string | null;
  /** 26-a — on-hold subscription (clock starts at first connect). */
  onHold: boolean;
  /** 26-a — first-connect timestamp (null = not started). */
  startedAt: string | null;
  /** 26-a — auto-renew the window instead of disabling on expiry. */
  autoRenew: boolean;
  /** 26-a — completed auto-renewals so far. */
  renewals: number;
  status: UserStatus;
  resellerId: string | null;
  createdAt: string;
  updatedAt: string;
  accesses: AccessDTO[];
}
