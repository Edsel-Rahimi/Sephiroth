import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { simulateOutboundTest } from "@/lib/net-objects";

/* ============================================================
   Sephiroth · Outbound connectivity test (admin only)
   POST /api/outbounds/:id/test
   → { ok, latencyMs, checkedAt, endpoint, mode, error }
   Real TCP connect against the outbound's resolved endpoint;
   local-egress protocols (freedom/blackhole/dns) report ok.
   ============================================================ */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const row = await db.outbound.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const result = await simulateOutboundTest({
      protocol: row.protocol,
      settingsJson: row.settingsJson,
      streamJson: row.streamJson,
      tag: row.tag,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[outbounds:test]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
