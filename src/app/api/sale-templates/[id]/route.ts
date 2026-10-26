import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { toTemplateDTO, validateTemplate } from "@/lib/resellers";

/* ============================================================
   Sephiroth · Phase 6 — Sale template item API (admin)
   PATCH  /api/sale-templates/[id] — name/limits/enabled
   DELETE /api/sale-templates/[id]
   ============================================================ */

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await db.saleTemplate.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    // partial-friendly: merge with existing then validate whole
    const merged = {
      name: (body as Record<string, unknown>).name ?? existing.name,
      trafficLimitGb:
        (body as Record<string, unknown>).trafficLimitGb !== undefined
          ? (body as Record<string, unknown>).trafficLimitGb
          : existing.trafficLimitGb,
      expiryDays:
        (body as Record<string, unknown>).expiryDays !== undefined
          ? (body as Record<string, unknown>).expiryDays
          : existing.expiryDays,
      ipLimit:
        (body as Record<string, unknown>).ipLimit !== undefined
          ? (body as Record<string, unknown>).ipLimit
          : existing.ipLimit,
    };

    const parsed = validateTemplate(merged);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }

    const enabledRaw = (body as Record<string, unknown>).enabled;
    const enabled =
      typeof enabledRaw === "boolean" ? enabledRaw : existing.enabled;

    const updated = await db.saleTemplate.update({
      where: { id },
      data: { ...parsed.data, enabled },
    });
    return NextResponse.json({ template: toTemplateDTO(updated) });
  } catch (err) {
    console.error("[sale-templates:PATCH]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await db.saleTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await db.saleTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sale-templates:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
