import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { toUserDTO } from "@/lib/users";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Task 23-g — reset sub-portal device registrations
   POST /api/users/:id/reset-devices → { ok: true, user: UserDTO }
   Clears the HWID device list so every client must re-register
   (the first `hwidLimit` devices to fetch the subscription win).
   Resellers may only reset devices of their own users.
   ============================================================ */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await db.clientUser.findUnique({
      where: { id },
      include: { accesses: { include: { inbound: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (actor.role === "reseller" && existing.resellerId !== actor.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await db.clientUser.update({ where: { id }, data: { devices: "[]" } });

    const fresh = await db.clientUser.findUnique({
      where: { id },
      include: { accesses: { include: { inbound: true } } },
    });
    if (!fresh) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await logActivity({
      kind: "user.updated",
      level: "info",
      actor: actor.username,
      message: `Device registrations reset for "${fresh.username}"`,
      meta: { userId: id, username: fresh.username, reason: "devices_reset" },
    });
    return NextResponse.json({ ok: true, user: toUserDTO(fresh) });
  } catch (err) {
    console.error("[users:reset-devices:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
