import { NextResponse } from "next/server";
import { agentTraffic, isNodeMode, requireNodeSecret } from "@/lib/agent";

/* ============================================================
   Sephiroth · Agent API — GET /api/agent/traffic  (node mode)

   Per-inbound traffic (from the ACTIVE core) + per-user
   accounting rows. sim = honest zeros, xray = real counters.
   404 in master mode · 401 on bad/missing secret.
   ============================================================ */

export async function GET(req: Request) {
  if (!isNodeMode()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!requireNodeSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await agentTraffic());
  } catch (err) {
    console.error("[agent:traffic]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
