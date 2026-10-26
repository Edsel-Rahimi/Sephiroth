import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { ensureNetSeeds, listHosts, validateHost } from "@/lib/net-objects";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Hosts API (admin only) — per-inbound link overrides
   GET  /api/hosts   → { hosts: HostDTO[] }
   POST /api/hosts   → { host: HostDTO }
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    await ensureNetSeeds();
    const hosts = await listHosts();
    return NextResponse.json({ hosts });
  } catch (err) {
    console.error("[hosts:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

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

    const inbound = await db.inbound.findUnique({
      where: { id: parsed.data.inboundId },
    });
    if (!inbound) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "inboundId", code: "not_found" }] },
        { status: 400 }
      );
    }

    const count = await db.host.count({ where: { inboundId: inbound.id } });
    const host = await db.host.create({
      data: { ...parsed.data, sortOrder: parsed.data.sortOrder || count },
      include: { inbound: { select: { tag: true } } },
    });

    await logActivity({
      kind: "inbound.updated",
      level: "success",
      actor: admin,
      message: `Host "${parsed.data.remark}" created for inbound ${inbound.tag}`,
      meta: { hostId: host.id, inboundTag: inbound.tag },
    });

    return NextResponse.json({ host }, { status: 201 });
  } catch (err) {
    console.error("[hosts:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
