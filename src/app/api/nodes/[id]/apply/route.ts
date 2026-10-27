import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { listNodes } from "@/lib/net-objects";
import { applyToNode, type NodeRow } from "@/lib/nodes-sync";

/* ============================================================
   Sephiroth · Multi-node — push config to a node (admin only)
   POST /api/nodes/:id/apply
   → { ok, applied, coreReloaded, error?, node: NodeDTO | null }

   Replaces the node's inbounds with this panel's inbound set
   (scoped by the node's syncAll / inboundTags settings).
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
    const node = await db.node.findUnique({ where: { id } });
    if (!node) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const result = await applyToNode(node as NodeRow);
    const nodes = await listNodes();
    const dto = nodes.find((n) => n.id === id) ?? null;

    return NextResponse.json({
      ok: result.ok,
      applied: result.applied,
      coreReloaded: result.coreReloaded,
      error: result.error ?? null,
      node: dto,
    });
  } catch (err) {
    console.error("[nodes:apply]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
