import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { listOutbounds } from "@/lib/net-objects";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Outbound traffic reset (admin only, simulator data)
   POST /api/outbounds/traffic-reset → { outbounds: OutboundDTO[] }
   ============================================================ */

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    await db.outbound.updateMany({ data: { upBytes: 0, downBytes: 0 } });
    await logActivity({
      kind: "settings.updated",
      level: "info",
      actor: admin,
      message: "Outbound traffic counters reset",
      meta: { scope: "outbounds" },
    });

    const outbounds = await listOutbounds();
    return NextResponse.json({ outbounds });
  } catch (err) {
    console.error("[outbounds:traffic-reset]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
