import { NextResponse } from "next/server";
import { agentInbounds, isNodeMode, requireNodeSecret } from "@/lib/agent";

/* ============================================================
   Sephiroth · Agent API — GET /api/agent/inbounds  (node mode)

   Current inbound rows, same shape the master panel stores.
   404 in normal (master) mode · 401 on bad/missing secret.
   ============================================================ */

export async function GET(req: Request) {
  if (!isNodeMode()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!requireNodeSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const inbounds = await agentInbounds();
    return NextResponse.json({ inbounds });
  } catch (err) {
    console.error("[agent:inbounds]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
