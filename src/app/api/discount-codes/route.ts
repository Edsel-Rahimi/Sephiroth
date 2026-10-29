import { NextResponse } from "next/server";
import { db, type DiscountCode } from "@/lib/db";
import { prismaErrorCode, requireAdmin } from "@/lib/inbounds";
import { logActivity, type ActivityKind } from "@/lib/activity";

/* ============================================================
   Sephiroth · Task 2-d — Discount codes API (admin only)
   GET  /api/discount-codes → { codes: DiscountCodeDTO[] }
   POST /api/discount-codes → { code: DiscountCodeDTO } (201)

   Validation (mirrors the manual validation of the sibling
   routes — no zod): code format ^[A-Z0-9_-]{3,32}$, percentOff
   1..100, maxOff null|int ≥ 0, usageLimit int ≥ 0 (0 = unlimited),
   expiresAt null|parseable date. Activity log: discount.created.
   ============================================================ */

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

type FieldError = { field: string; code: string };

export interface DiscountCodeDTO {
  id: string;
  code: string;
  enabled: boolean;
  percentOff: number;
  maxOff: number | null;
  usageLimit: number;
  usedCount: number;
  usedByCount: number;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export function toDTO(row: DiscountCode): DiscountCodeDTO {
  return {
    id: row.id,
    code: row.code,
    enabled: row.enabled === true,
    percentOff: Math.min(100, Math.max(1, Math.floor(Number(row.percentOff) || 1))),
    maxOff: row.maxOff === null || row.maxOff === undefined ? null : Math.max(0, Math.floor(Number(row.maxOff) || 0)),
    usageLimit: Math.max(0, Math.floor(Number(row.usageLimit) || 0)),
    usedCount: Math.max(0, Math.floor(Number(row.usedCount) || 0)),
    usedByCount: Array.isArray(row.usedBy) ? row.usedBy.length : 0,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    createdBy: String(row.createdBy ?? ""),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** Shared create/update validation — returns normalized fields or field errors. */
export function validateDiscountPayload(
  body: Record<string, unknown>,
  existing?: DiscountCode
): { ok: true; data: Record<string, unknown> } | { ok: false; fields: FieldError[] } {
  const fields: FieldError[] = [];
  const out: Record<string, unknown> = {};

  // code — required on create, immutable on update (keeps usedBy honest)
  if (existing) {
    if (body.code !== undefined && String(body.code).toUpperCase() !== existing.code) {
      fields.push({ field: "code", code: "immutable" });
    }
  } else {
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      fields.push({ field: "code", code: "format" });
    } else {
      out.code = code;
    }
  }

  // percentOff — 1..100
  if (body.percentOff !== undefined) {
    const n = Number(body.percentOff);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      fields.push({ field: "percentOff", code: "range" });
    } else {
      out.percentOff = n;
    }
  } else if (!existing) {
    fields.push({ field: "percentOff", code: "required" });
  }

  // maxOff — null = uncapped; int ≥ 0
  if (body.maxOff !== undefined) {
    if (body.maxOff === null || body.maxOff === "") {
      out.maxOff = null;
    } else {
      const n = Number(body.maxOff);
      if (!Number.isInteger(n) || n < 0) {
        fields.push({ field: "maxOff", code: "range" });
      } else {
        out.maxOff = n;
      }
    }
  } else if (!existing) {
    out.maxOff = null;
  }

  // usageLimit — 0 = unlimited
  if (body.usageLimit !== undefined) {
    const n = Number(body.usageLimit);
    if (!Number.isInteger(n) || n < 0) {
      fields.push({ field: "usageLimit", code: "range" });
    } else {
      out.usageLimit = n;
    }
  } else if (!existing) {
    out.usageLimit = 0;
  }

  // enabled — strict boolean
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      fields.push({ field: "enabled", code: "format" });
    } else {
      out.enabled = body.enabled;
    }
  } else if (!existing) {
    out.enabled = true;
  }

  // expiresAt — null = never; parseable date otherwise
  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === "") {
      out.expiresAt = null;
    } else {
      const raw = String(body.expiresAt);
      const d = new Date(raw.length === 10 ? `${raw}T23:59:59` : raw); // bare date → end of that day
      if (Number.isNaN(d.getTime())) {
        fields.push({ field: "expiresAt", code: "format" });
      } else {
        out.expiresAt = d;
      }
    }
  } else if (!existing) {
    out.expiresAt = null;
  }

  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, data: out };
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const rows = await db.discountCode.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ codes: rows.map(toDTO) });
  } catch (err) {
    console.error("[discount-codes:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateDiscountPayload((body ?? {}) as Record<string, unknown>);
    if (!parsed.ok) {
      return NextResponse.json({ error: "validation", fields: parsed.fields }, { status: 400 });
    }

    try {
      const created = await db.discountCode.create({
        data: { ...parsed.data, createdBy: admin },
      });
      await logActivity({
        kind: "discount.created" as unknown as ActivityKind,
        level: "success",
        actor: admin,
        message: `Discount code ${created.code} created (${created.percentOff}% off${created.maxOff ? `, cap ${created.maxOff}` : ", no cap"}${created.usageLimit ? `, limit ${created.usageLimit}` : ", unlimited"})`,
        meta: { codeId: created.id, code: created.code },
      });
      return NextResponse.json({ code: toDTO(created) }, { status: 201 });
    } catch (err) {
      if (prismaErrorCode(err) === "P2002") {
        return NextResponse.json(
          { error: "validation", fields: [{ field: "code", code: "duplicate" }] },
          { status: 400 }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("[discount-codes:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
