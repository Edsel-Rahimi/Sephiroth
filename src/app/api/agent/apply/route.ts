import { NextResponse } from "next/server";
import { applyAgentInbounds, isNodeMode, requireNodeSecret } from "@/lib/agent";

/* ============================================================
   Sephiroth · Agent API — POST /api/agent/apply  (node mode)

   Body: { inbounds: InboundDTO[] }  (users projection = v2)
   Atomically REPLACES the agent's inbound table with the pushed
   set, then nudges the core. 404 in master mode · 401 on secret.
   ============================================================ */

export async function POST(req: Request) {
  if (!isNodeMode()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!requireNodeSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }
    const result = await applyAgentInbounds(body);
    if (result.error) {
      return NextResponse.json(
        { error: result.error, applied: result.applied, coreReloaded: result.coreReloaded },
        { status: 400 }
      );
    }
    return NextResponse.json({
      applied: result.applied,
      coreReloaded: result.coreReloaded,
    });
  } catch (err) {
    console.error("[agent:apply]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
