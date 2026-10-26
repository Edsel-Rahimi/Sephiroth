import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { toHostDTO, validateHost } from "@/lib/net-objects";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Hosts item API
   PATCH  /api/hosts/:id → { host: HostDTO }
   DELETE /api/hosts/:id → { ok: true }
   ============================================================ */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateHost(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }

    const existing = await db.host.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const inbound = await db.inbound.findUnique({
      where: { id: parsed.data.inboundId },
    });
    if (!inbound) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "inboundId", code: "not_found" }] },
        { status: 400 }
      );
    }

    const host = await db.host.update({
      where: { id },
      data: parsed.data,
      include: { inbound: { select: { tag: true } } },
    });

    await logActivity({
      kind: "inbound.updated",
      level: "info",
      actor: admin,
      message: `Host "${parsed.data.remark}" updated`,
      meta: { hostId: id },
    });

    return NextResponse.json({ host: toHostDTO(host) });
  } catch (err) {
    console.error("[hosts:PATCH]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await db.host.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await db.host.delete({ where: { id } });
    await logActivity({
      kind: "inbound.updated",
      level: "warn",
      actor: admin,
      message: `Host "${existing.remark}" deleted`,
      meta: { hostId: id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[hosts:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
