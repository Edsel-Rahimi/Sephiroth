import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { toOutboundDTO, validateOutbound } from "@/lib/net-objects";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Outbounds item API
   PATCH  /api/outbounds/:id → { outbound: OutboundDTO }
   DELETE /api/outbounds/:id → { ok: true }  (direct/blocked protected)
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

    const parsed = validateOutbound(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const existing = await db.outbound.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (d.tag !== existing.tag) {
      const tagOwner = await db.outbound.findUnique({ where: { tag: d.tag } });
      if (tagOwner) {
        return NextResponse.json({ error: "duplicate_tag" }, { status: 409 });
      }
    }

    const outbound = await db.outbound.update({
      where: { id },
      data: {
        tag: d.tag,
        protocol: d.protocol,
        sendThrough: d.sendThrough,
        domainStrategy: d.domainStrategy,
        settingsJson: JSON.stringify(d.settings),
        streamJson: JSON.stringify(d.stream),
        muxEnabled: d.muxEnabled,
        muxConcurrency: d.muxConcurrency,
      },
    });

    await logActivity({
      kind: "settings.updated",
      level: "info",
      actor: admin,
      message: `Outbound "${d.tag}" updated`,
      meta: { outboundId: id },
    });

    return NextResponse.json({ outbound: toOutboundDTO(outbound) });
  } catch (err) {
    console.error("[outbounds:PATCH]", err);
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
    const existing = await db.outbound.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    /* ship-with defaults are referenced by routing rules — keep them */
    if (existing.tag === "direct" || existing.tag === "blocked") {
      return NextResponse.json({ error: "protected" }, { status: 409 });
    }

    await db.outbound.delete({ where: { id } });
    await logActivity({
      kind: "settings.updated",
      level: "warn",
      actor: admin,
      message: `Outbound "${existing.tag}" deleted`,
      meta: { outboundId: id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[outbounds:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
