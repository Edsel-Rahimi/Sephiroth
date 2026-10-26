import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { prismaErrorCode, requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import { toResellerDTO, validateResellerPatch } from "@/lib/resellers";

/* ============================================================
   Sephiroth · Phase 6 — Reseller item API (admin)
   PATCH  /api/resellers/[id] — note/enabled/quotas; password
          optional (≥6 chars); username immutable.
   DELETE /api/resellers/[id] — releases owned users
          (resellerId → null via SetNull cascade), never deletes them.
   ============================================================ */

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await db.reseller.findUnique({
      where: { id },
      include: { users: { select: { trafficLimitGb: true, usedTrafficGb: true } } },
    });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateResellerPatch(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const updated = await db.reseller.update({
      where: { id },
      data: {
        note: data.note,
        enabled: data.enabled,
        maxUsers: data.maxUsers,
        trafficQuotaGb: data.trafficQuotaGb,
        ...(data.password ? { passwordHash: hashPassword(data.password) } : {}),
      },
      include: { users: { select: { trafficLimitGb: true, usedTrafficGb: true } } },
    });
    await logActivity({
      kind: "reseller.updated",
      level: "info",
      actor: admin,
      message: `Reseller "${updated.username}" updated`,
      meta: { resellerId: id },
    });
    return NextResponse.json({ reseller: toResellerDTO(updated) });
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[resellers:PATCH]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await db.reseller.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await db.reseller.delete({ where: { id } }); // users keep existing via SetNull
    await logActivity({
      kind: "reseller.deleted",
      level: "warn",
      actor: admin,
      message: `Reseller deleted (id ${id})`,
      meta: { resellerId: id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[resellers:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
