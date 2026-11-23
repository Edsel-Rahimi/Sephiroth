import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { listNodes } from "@/lib/net-objects";
import { pullNodeTraffic, type NodeRow } from "@/lib/nodes-sync";
import { getCachedNodeTraffic } from "@/lib/node-sync-worker";

/* ============================================================
   Sephiroth · Multi-node — traffic snapshot from a node (admin)
   GET /api/nodes/:id/stats
   → { ok, traffic?: NodeTrafficSnapshot, error?, node: NodeDTO | null }
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

    const result = await pullNodeTraffic(node as NodeRow);
    // The 60 s node-sync worker keeps a cached snapshot; if the agent is
    // briefly unreachable, serve the fresh cache instead of an error.
    const cached = result.ok ? null : getCachedNodeTraffic(id);

    const nodes = await listNodes();
    const dto = nodes.find((n) => n.id === id) ?? null;

    return NextResponse.json({
      ok: result.ok || cached !== null,
      traffic: result.ok ? result.traffic : cached,
      cached: !result.ok && cached !== null ? true : undefined,
      error: result.ok ? null : (cached ? null : result.error),
      node: dto,
    });
  } catch (err) {
    console.error("[nodes:stats]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
