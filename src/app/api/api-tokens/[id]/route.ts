import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, isReadOnlyActor, isMutatingMethod } from "@/lib/auth"; // task 3-b
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Phase 27 — single public-API token
   PATCH  { enabled: boolean }  → toggle without deleting
   DELETE                      → revoke permanently
   ============================================================ */

type Ctx = { params: Promise<{ id: string }> };

async function requireAdmin(req: Request) {
  const actor = await getSession(req);
  if (!actor || actor.role !== "admin") return null;
  // task 3-b — viewer admins are READ-ONLY; token toggle/revoke rejects (401 via null)
  if (isReadOnlyActor(actor) && isMutatingMethod(req)) return null;
  return actor;
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const actor = await requireAdmin(req);
    if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await ctx.params;

    let body: { enabled?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "validation" }, { status: 400 });
    }

    const row = await db.apiToken.update({
      where: { id },
      data: { enabled: body.enabled },
    });
    await logActivity({
      kind: "settings.updated",
      level: body.enabled ? "info" : "warn",
      actor: actor.username,
      message: `Public API token "${row.name}" ${body.enabled ? "enabled" : "disabled"}`,
      meta: { tokenId: row.id, enabled: body.enabled },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const actor = await requireAdmin(req);
    if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await ctx.params;

    const row = await db.apiToken.delete({ where: { id } });
    await logActivity({
      kind: "settings.updated",
      level: "warn",
      actor: actor.username,
      message: `Public API token "${row.name}" revoked (${row.prefix})`,
      meta: { tokenId: row.id, prefix: row.prefix },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
