import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { groupPasswordHash, toGroupDTO, validateGroup } from "@/lib/sub-groups";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Phase 5 — Sub Group item API (admin)
   PATCH  /api/sub/groups/[id] — partial update; member list is
          replaced wholesale; password: "" clears, string sets,
          null/absent keeps. { clearPassword: true } also clears.
   DELETE /api/sub/groups/[id] — cascade deletes members
   ============================================================ */

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await db.subGroup.findUnique({
      where: { id },
      include: { members: { include: { user: { select: { id: true } } } } },
    });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateGroup(body, { partial: true });
    if (!parsed.ok) {
      return NextResponse.json({ error: "validation", fields: parsed.fields }, { status: 400 });
    }
    const data = parsed.data;

    if (body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).memberIds)) {
      if (data.memberIds.length > 0) {
        const found = await db.clientUser.count({ where: { id: { in: data.memberIds } } });
        if (found !== data.memberIds.length) {
          return NextResponse.json(
            { error: "validation", fields: [{ field: "memberIds", code: "unknown" }] },
            { status: 400 }
          );
        }
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const bodyObj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      // true partial merge: infoLine/enabled only change when the key was
      // actually sent — toggling `enabled` no longer wipes infoLine
      const base: { name?: string; infoLine?: string | null; enabled?: boolean; passwordHash?: string | null } = {};
      if (data.name !== "") base.name = data.name;
      if ("infoLine" in bodyObj) base.infoLine = data.infoLine || null;
      if ("enabled" in bodyObj) base.enabled = data.enabled;
      if (data.password === "") base.passwordHash = null;
      else if (typeof data.password === "string" && data.password.length >= 4)
        base.passwordHash = groupPasswordHash(data.password);

      await tx.subGroup.update({ where: { id }, data: base });

      // memberIds provided → replace the member set wholesale
      const memberIdsProvided =
        body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).memberIds);
      if (memberIdsProvided) {
        await tx.subGroupMember.deleteMany({ where: { groupId: id } });
        if (data.memberIds.length > 0) {
          await tx.subGroupMember.createMany({
            data: data.memberIds.map((userId) => ({ groupId: id, userId })),
          });
        }
      }

      return tx.subGroup.findUnique({
        where: { id },
        include: { members: { include: { user: { select: { id: true } } } } },
      });
    });

    if (!updated) return NextResponse.json({ error: "server_error" }, { status: 500 });
    return NextResponse.json({ group: toGroupDTO(updated) });
  } catch (err) {
    console.error("[sub/groups:id:PATCH]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await db.subGroup.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await db.subGroup.delete({ where: { id } }); // members cascade
    await logActivity({
      kind: "sub.deleted",
      level: "warn",
      actor: admin,
      message: `Sub group deleted (id ${id})`,
      meta: { groupId: id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sub/groups:id:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
