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
};

export function validateTemplate(
  body: unknown
): { ok: true; data: ValidatedTemplate } | { ok: false; fields: FieldError[] } {
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
