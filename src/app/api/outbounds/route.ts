import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import {
  ensureNetSeeds,
  listOutbounds,
  toOutboundDTO,
  validateOutbound,
} from "@/lib/net-objects";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Outbounds API (admin only) — xray outbound proxies
   GET  /api/outbounds   → { outbounds: OutboundDTO[] }
   POST /api/outbounds   → { outbound: OutboundDTO }
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    await ensureNetSeeds();
    const outbounds = await listOutbounds();
    return NextResponse.json({ outbounds });
  } catch (err) {
    console.error("[outbounds:GET]", err);
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

    const parsed = validateOutbound(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const tagOwner = await db.outbound.findUnique({ where: { tag: d.tag } });
    if (tagOwner) {
      return NextResponse.json({ error: "duplicate_tag" }, { status: 409 });
    }

    const count = await db.outbound.count();
    const outbound = await db.outbound.create({
      data: {
        tag: d.tag,
        protocol: d.protocol,
        sendThrough: d.sendThrough,
        domainStrategy: d.domainStrategy,
        settingsJson: JSON.stringify(d.settings),
        streamJson: JSON.stringify(d.stream),
        muxEnabled: d.muxEnabled,
        muxConcurrency: d.muxConcurrency,
        sortOrder: d.sortOrder || count,
      },
    });

    await logActivity({
      kind: "settings.updated",
      level: "success",
      actor: admin,
      message: `Outbound "${d.tag}" created (${d.protocol})`,
      meta: { outboundId: outbound.id },
    });

    return NextResponse.json({ outbound: toOutboundDTO(outbound) }, { status: 201 });
  } catch (err) {
    console.error("[outbounds:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
