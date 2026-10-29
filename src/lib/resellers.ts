import { db, type Reseller, type SaleTemplate } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

/* ============================================================
   Sephiroth · Phase 6 — Reseller system (server-only)
   - validation for resellers + sale templates
   - DTO builders (passwords never leave the server)
   - quota aggregation (users count + allocated traffic)
   ============================================================ */

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;

/* ---------- validation ---------- */

export type ValidatedReseller = {
  username: string;
  password: string;
  note: string;
  enabled: boolean;
  maxUsers: number | null;
  trafficQuotaGb: number | null;
  /** 26-c — white-label identity shown on the reseller's /sub pages. */
  brandName: string | null;
  brandLogo: string | null;
  brandAccent: string | null;
};

export type ValidatedResellerPatch = {
  note?: string;
  enabled?: boolean;
  maxUsers?: number | null;
  trafficQuotaGb?: number | null;
  /** 26-c — white-label identity shown on the reseller's /sub pages. */
  brandName?: string | null;
  brandLogo?: string | null;
  brandAccent?: string | null;
  password?: string; // absent = keep, empty string w/ clearPassword handled by caller
};

type FieldError = { field: string; code: string };

function numOrNull(v: unknown, field: string, errs: FieldError[], min: number, max: number): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) {
    errs.push({ field, code: "range" });
    return undefined;
  }
  return n;
}

export function validateReseller(
  body: unknown
): { ok: true; data: ValidatedReseller } | { ok: false; fields: FieldError[] } {
  const errs: FieldError[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  const username = typeof b.username === "string" ? b.username.trim() : "";
  if (!USERNAME_RE.test(username)) errs.push({ field: "username", code: "format" });

  const password = typeof b.password === "string" ? b.password : "";
  if (password.length < 6 || password.length > 128) {
    errs.push({ field: "password", code: "format" });
  }

  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";

  const maxUsers = numOrNull(b.maxUsers, "maxUsers", errs, 0, 100000);
  const trafficQuotaGb = numOrNull(b.trafficQuotaGb, "trafficQuotaGb", errs, 0, 1000000);

  /* 26-c — white-label fields (all optional) */
  const brandName = typeof b.brandName === "string" ? b.brandName.trim().slice(0, 40) : "";
  const brandLogo = typeof b.brandLogo === "string" ? b.brandLogo.trim().slice(0, 500) : "";
  const brandAccentRaw = typeof b.brandAccent === "string" ? b.brandAccent.trim() : "";
  if (brandAccentRaw && !/^#[0-9a-fA-F]{6}$/.test(brandAccentRaw)) {
    errs.push({ field: "brandAccent", code: "format" });
  }

  if (errs.length) return { ok: false, fields: errs };

  return {
    ok: true,
    data: {
      username,
      password,
      note,
      enabled: b.enabled === undefined ? true : Boolean(b.enabled),
      maxUsers: maxUsers ?? null,
      trafficQuotaGb: trafficQuotaGb ?? null,
      brandName: brandName || null,
      brandLogo: brandLogo || null,
      brandAccent: brandAccentRaw || null,
    },
  };
}

export function validateResellerPatch(
  body: unknown
): { ok: true; data: ValidatedResellerPatch } | { ok: false; fields: FieldError[] } {
  const errs: FieldError[] = [];
  const b = (body ?? {}) as Record<string, unknown>;
  const out: ValidatedResellerPatch = {};

  if (b.note !== undefined) {
    out.note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";
  }
  if (b.enabled !== undefined) out.enabled = Boolean(b.enabled);

  if (b.maxUsers !== undefined) {
    const v = numOrNull(b.maxUsers, "maxUsers", errs, 0, 100000);
    if (v === undefined) return { ok: false, fields: errs };
    out.maxUsers = v;
  }
  if (b.trafficQuotaGb !== undefined) {
    const v = numOrNull(b.trafficQuotaGb, "trafficQuotaGb", errs, 0, 1000000);
    if (v === undefined) return { ok: false, fields: errs };
    out.trafficQuotaGb = v;
  }
  /* 26-c — white-label fields */
  if (b.brandName !== undefined) {
    out.brandName = typeof b.brandName === "string" ? b.brandName.trim().slice(0, 40) || null : null;
  }
  if (b.brandLogo !== undefined) {
    out.brandLogo = typeof b.brandLogo === "string" ? b.brandLogo.trim().slice(0, 500) || null : null;
  }
  if (b.brandAccent !== undefined) {
    const v = typeof b.brandAccent === "string" ? b.brandAccent.trim() : "";
    if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) {
      errs.push({ field: "brandAccent", code: "format" });
    } else {
      out.brandAccent = v || null;
    }
  }
  if (b.password !== undefined && b.password !== "") {
    const pw = typeof b.password === "string" ? b.password : "";
    if (pw.length < 6 || pw.length > 128) {
      errs.push({ field: "password", code: "format" });
    } else {
      out.password = pw;
    }
  }

  if (errs.length) return { ok: false, fields: errs };
  return { ok: true, data: out };
}

/* ---------- sale templates ---------- */

export type ValidatedTemplate = {
  name: string;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  /** Price in Toman; 0 = free / trial template (Task 23-c sales bot). */
  priceToman: number;
  /** Whether the template is listed in the Telegram sales-bot shop. */
  botVisible: boolean;
  /** task 3-1 — catalog scoping: "" = owner's global catalog; a reseller id
   *  lists the template ONLY in that reseller's bot shop. */
  resellerId: string;
};

/** task 3-1 — now async: a non-empty resellerId is existence-checked against
 *  the reseller table (both sale-templates routes await this). */
export async function validateTemplate(
  body: unknown
): Promise<{ ok: true; data: ValidatedTemplate } | { ok: false; fields: FieldError[] }> {
  const errs: FieldError[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim().slice(0, 48) : "";
  if (name.length < 1) errs.push({ field: "name", code: "format" });

  const trafficLimitGb = numOrNull(b.trafficLimitGb, "trafficLimitGb", errs, 0, 1000000);
  const expiryDays = numOrNull(b.expiryDays, "expiryDays", errs, 0, 3650);

  let ipLimit = 0;
  if (b.ipLimit !== undefined && b.ipLimit !== null && b.ipLimit !== "") {
    const n = typeof b.ipLimit === "number" ? b.ipLimit : Number(b.ipLimit);
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      errs.push({ field: "ipLimit", code: "range" });
    } else {
      ipLimit = n;
    }
  }

  let priceToman = 0;
  if (b.priceToman !== undefined && b.priceToman !== null && b.priceToman !== "") {
    const n = typeof b.priceToman === "number" ? b.priceToman : Number(b.priceToman);
    if (!Number.isFinite(n) || n < 0 || n > 100000000 || !Number.isInteger(n)) {
      errs.push({ field: "priceToman", code: "range" });
    } else {
      priceToman = n;
    }
  }

  const botVisible = b.botVisible === undefined ? false : Boolean(b.botVisible);

  /* task 3-1 — optional reseller assignment ("" = owner's global catalog).
     Any non-empty value must reference an EXISTING reseller row so a typo
     can never orphan a template out of every shop. */
  let resellerId = "";
  if (b.resellerId !== undefined && b.resellerId !== null) {
    const rid = typeof b.resellerId === "string" ? b.resellerId.trim() : "";
    if (rid) {
      const known = await db.reseller.findUnique({ where: { id: rid }, select: { id: true } });
      if (!known) {
        errs.push({ field: "resellerId", code: "not_found" });
      } else {
        resellerId = rid;
      }
    }
  }

  if (errs.length) return { ok: false, fields: errs };
  return {
    ok: true,
    data: {
      name,
      trafficLimitGb: trafficLimitGb ?? null,
      expiryDays: expiryDays ?? null,
      ipLimit,
      priceToman,
      botVisible,
      resellerId,
    },
  };
}

export type TemplateDTO = {
  id: string;
  name: string;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  enabled: boolean;
  priceToman: number;
  botVisible: boolean;
  /** task 3-1 — "" = owner's global catalog; a reseller id = scoped to that bot shop. */
  resellerId: string;
  createdAt: string;
  updatedAt: string;
};

export function toTemplateDTO(row: SaleTemplate): TemplateDTO {
  return {
    id: row.id,
    name: row.name,
    trafficLimitGb: row.trafficLimitGb,
    expiryDays: row.expiryDays,
    ipLimit: row.ipLimit,
    enabled: row.enabled,
    priceToman: row.priceToman ?? 0,
    botVisible: Boolean(row.botVisible),
    resellerId: row.resellerId ?? "",
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/* ---------- reseller DTO + quota aggregation ---------- */

export type ResellerDTO = {
  id: string;
  username: string;
  note: string | null;
  enabled: boolean;
  maxUsers: number | null;
  trafficQuotaGb: number | null;
  /** 26-c — white-label identity for the reseller's /sub pages. */
  brandName: string | null;
  brandLogo: string | null;
  brandAccent: string | null;
  usersCount: number;
  allocatedGb: number; // sum of per-user trafficLimitGb (null limits count as 0)
  usedGb: number; // sum of usedTrafficGb
  createdAt: string;
  updatedAt: string;
};

export function toResellerDTO(
  row: Reseller & { users: { trafficLimitGb: number | null; usedTrafficGb: number }[] }
): ResellerDTO {
  return {
    id: row.id,
    username: row.username,
    note: row.note,
    enabled: row.enabled,
    maxUsers: row.maxUsers,
    trafficQuotaGb: row.trafficQuotaGb,
    brandName: row.brandName ?? null,
    brandLogo: row.brandLogo ?? null,
    brandAccent: row.brandAccent ?? null,
    usersCount: row.users.length,
    allocatedGb:
      Math.round(
        row.users.reduce((s, u) => s + (u.trafficLimitGb ?? 0), 0) * 10
      ) / 10,
    usedGb:
      Math.round(row.users.reduce((s, u) => s + u.usedTrafficGb, 0) * 10) / 10,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function listResellerDTOs(): Promise<ResellerDTO[]> {
  const rows = await db.reseller.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      users: { select: { trafficLimitGb: true, usedTrafficGb: true } },
    },
  });
  return rows.map(toResellerDTO);
}

/** Quota state for a reseller — used to gate user creation. */
export async function resellerQuota(resellerId: string): Promise<{
  maxUsers: number | null;
  trafficQuotaGb: number | null;
  usersCount: number;
  allocatedGb: number;
}> {
  const r = await db.reseller.findUnique({
    where: { id: resellerId },
    select: {
      maxUsers: true,
      trafficQuotaGb: true,
      users: { select: { trafficLimitGb: true } },
    },
  });
  if (!r) {
    return { maxUsers: null, trafficQuotaGb: null, usersCount: 0, allocatedGb: 0 };
  }
  return {
    maxUsers: r.maxUsers,
    trafficQuotaGb: r.trafficQuotaGb,
    usersCount: r.users.length,
    allocatedGb:
      Math.round(r.users.reduce((s: number, u: any) => s + (u.trafficLimitGb ?? 0), 0) * 10) / 10,
  };
}

/** Build a Prisma create payload from validated data. */
export function resellerCreateData(data: ValidatedReseller) {
  return {
    username: data.username,
    passwordHash: hashPassword(data.password),
    note: data.note || null,
    enabled: data.enabled,
    maxUsers: data.maxUsers,
    trafficQuotaGb: data.trafficQuotaGb,
    brandName: data.brandName,
    brandLogo: data.brandLogo,
    brandAccent: data.brandAccent,
  };
}

/* ============================================================
   task 3-1 — per-reseller Telegram bot (own token, own shop)

   Scoping model (discovered + implemented here):
   • catalog    = saleTemplate rows whose resellerId == this reseller
     ("" templates stay in the OWNER's main-bot shop only);
   • customers  = tgUser rows whose resellerId == this reseller
     (set on the FIRST /start through THIS bot; "" = main bot);
   • orders     = tgOrder rows whose resellerId == this reseller
     (stamped at creation by the reseller worker).
   Payment NEVER falls back to the owner's gateway: the reseller row
   carries its own card/holder/zarinpal merchant; when unset the bot
   shows an honest "payment not configured" and takes no orders.
   ============================================================ */

/** Head/tail mask for the reseller bot token + gateway secrets — mirrors the
 *  settings-API masking (maskBotToken / maskSecretValue): the raw secret never
 *  echoes back; "" (unset) stays "". */
export function maskResellerSecret(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  if (s.length < 12) return "••••••••";
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

/** Telegram bot token shape — same sane subset the main bot settings accept. */
export const RESELLER_BOT_TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/;

/** PUT /api/resellers/[id]/bot body (validated): absent = keep, "" = keep for
 *  the token (bullet-carrying masked echo also = keep), fresh value replaces. */
export type ValidatedResellerBotPatch = {
  botToken?: string; // fresh token (validated shape) — only present when replacing
  botEnabled?: boolean;
  payCardNumber?: string; // "" = clear, bullet-echo = keep (absent here)
  payCardHolder?: string;
  payZarinpalMerchant?: string; // "" = clear, bullet-echo = keep (absent here)
};

export function validateResellerBotPatch(
  body: unknown
): { ok: true; data: ValidatedResellerBotPatch } | { ok: false; fields: FieldError[] } {
  const errs: FieldError[] = [];
  const b = (body ?? {}) as Record<string, unknown>;
  const out: ValidatedResellerBotPatch = {};

  if (b.botToken !== undefined) {
    const t = typeof b.botToken === "string" ? b.botToken.trim() : "";
    // "" = keep the stored token; a masked echo (carries •) = keep too
    if (t !== "" && !t.includes("•")) {
      if (!RESELLER_BOT_TOKEN_RE.test(t)) {
        errs.push({ field: "botToken", code: "format" });
      } else {
        out.botToken = t;
      }
    }
  }
  if (b.botEnabled !== undefined) out.botEnabled = Boolean(b.botEnabled);

  /* gateway secrets: "" = clear, masked echo (•) = keep (omitted from the
     patch so the stored value survives), anything fresh = replace */
  for (const key of ["payCardNumber", "payCardHolder", "payZarinpalMerchant"] as const) {
    if (b[key] !== undefined) {
      const v = typeof b[key] === "string" ? (b[key] as string).trim() : "";
      if (v.includes("•")) continue; // masked echo — keep
      out[key] = v.slice(0, 200);
    }
  }

  if (errs.length) return { ok: false, fields: errs };
  return { ok: true, data: out };
}

/** GET /api/resellers/[id]/bot payload — the token NEVER echoes (masked hint
 *  only) and every figure is computed live from the scoped store rows. */
export type ResellerBotDTO = {
  resellerId: string;
  botUsername: string;
  botEnabled: boolean;
  tokenConfigured: boolean;
  tokenMasked: string;
  status: {
    state: "running" | "stopped" | "error";
    reason: string;
    startedAt: string | null;
    lastPollAt: string | null;
    handledUpdates: number;
  };
  customers: number;
  ordersTotal: number;
  ordersCompleted: number;
  salesToday: { count: number; sumToman: number };
  salesWeek: { count: number; sumToman: number };
  catalogCount: number;
  payCardConfigured: boolean;
  payZarinConfigured: boolean;
  payCardMasked: string;
  payCardHolder: string;
  payZarinMasked: string;
};

/** Live shop stats for ONE reseller — counts + today/7d completed sums. */
export async function resellerBotStats(resellerId: string): Promise<{
  customers: number;
  ordersTotal: number;
  ordersCompleted: number;
  salesToday: { count: number; sumToman: number };
  salesWeek: { count: number; sumToman: number };
  catalogCount: number;
}> {
  const [customers, ordersTotal, ordersCompleted, catalogCount] = await Promise.all([
    db.tgUser.count({ where: { resellerId } }),
    db.tgOrder.count({ where: { resellerId } }),
    db.tgOrder.count({ where: { resellerId, status: "completed" } }),
    db.saleTemplate.count({ where: { resellerId } }),
  ]);
  const completed = await db.tgOrder.findMany({
    where: { resellerId, status: "completed" },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const weekAgo = Date.now() - 7 * 86_400_000;
  const today = completed.filter((o) => new Date(o.updatedAt).getTime() >= startOfDay);
  const week = completed.filter((o) => new Date(o.updatedAt).getTime() >= weekAgo);
  return {
    customers,
    ordersTotal,
    ordersCompleted,
    salesToday: { count: today.length, sumToman: today.reduce((s, o) => s + (o.amountToman || 0), 0) },
    salesWeek: { count: week.length, sumToman: week.reduce((s, o) => s + (o.amountToman || 0), 0) },
    catalogCount,
  };
}
