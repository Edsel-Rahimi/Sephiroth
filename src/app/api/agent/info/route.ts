import { NextResponse } from "next/server";
import { agentInfo, isNodeMode, requireNodeSecret } from "@/lib/agent";

/* ============================================================
   Sephiroth · Agent API — GET /api/agent/info  (node mode only)

   404 in normal (master) mode — the surface does not exist.
   401 when the x-node-secret header is missing or wrong.
   ============================================================ */

export async function GET(req: Request) {
  if (!isNodeMode()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!requireNodeSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(agentInfo());
  } catch (err) {
    console.error("[agent:info]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
