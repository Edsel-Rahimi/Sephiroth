import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prismaErrorCode, requireAdmin } from "@/lib/inbounds";
import { logActivity, type ActivityKind } from "@/lib/activity";
import { toDTO, validateDiscountPayload } from "../route";

/* ============================================================
   Sephiroth · Task 2-d — Discount code item API (admin only)
   PATCH  /api/discount-codes/[id] — enable/update (code immutable)
   DELETE /api/discount-codes/[id]
   Activity log: discount.updated / discount.deleted.
   ============================================================ */

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await db.discountCode.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    // partial-friendly: validate the PATCH body against the existing row
    const parsed = validateDiscountPayload((body ?? {}) as Record<string, unknown>, existing);
    if (!parsed.ok) {
      return NextResponse.json({ error: "validation", fields: parsed.fields }, { status: 400 });
    }

    try {
      const updated = await db.discountCode.update({ where: { id }, data: parsed.data });
      await logActivity({
        kind: "discount.updated" as unknown as ActivityKind,
        level: "info",
        actor: admin,
        message: `Discount code ${updated.code} updated (enabled: ${updated.enabled}, ${updated.percentOff}% off, used ${updated.usedCount}${updated.usageLimit ? `/${updated.usageLimit}` : " (unlimited)"})`,
        meta: { codeId: updated.id, code: updated.code },
      });
      return NextResponse.json({ code: toDTO(updated) });
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
    console.error("[discount-codes:PATCH]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await db.discountCode.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await db.discountCode.delete({ where: { id } });
    await logActivity({
      kind: "discount.deleted" as unknown as ActivityKind,
      level: "warn",
      actor: admin,
      message: `Discount code ${existing.code} deleted (was used ${existing.usedCount} time(s))`,
      meta: { codeId: existing.id, code: existing.code },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[discount-codes:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
