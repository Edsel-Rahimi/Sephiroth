import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { listNodes } from "@/lib/net-objects";
import { nodeInfo, type NodeRow } from "@/lib/nodes-sync";

/* ============================================================
   Sephiroth · Multi-node — real agent info probe (admin only)
   GET /api/nodes/:id/info
   → { ok, info?: AgentInfoPayload, latencyMs, error?, node: NodeDTO | null }

   Upgrades the plain TCP probe: when the node has a secret
   configured this calls GET /api/agent/info on the node and
   persists version/coreKind/status on the row.
   ============================================================ */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const node = await db.node.findUnique({ where: { id } });
    if (!node) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const result = await nodeInfo(node as NodeRow);
    const nodes = await listNodes();
    const dto = nodes.find((n) => n.id === id) ?? null;

    return NextResponse.json({
      ok: result.ok,
      info: result.ok ? result.info : null,
      latencyMs: result.latencyMs,
      error: result.ok ? null : result.error,
      node: dto,
    });
  } catch (err) {
    console.error("[nodes:info]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
