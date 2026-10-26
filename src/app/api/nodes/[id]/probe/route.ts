import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { listNodes, probeNode } from "@/lib/net-objects";

/* ============================================================
   Sephiroth · Node probe (admin only, simulator-decorated)
   POST /api/nodes/:id/probe → { ok, node: NodeDTO }
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
    const result = await probeNode(id);
    if (!result.ok && result.error === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const nodes = await listNodes();
    const node = nodes.find((n) => n.id === id) ?? null;

    return NextResponse.json({
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.error ?? null,
      node,
    });
  } catch (err) {
    console.error("[nodes:probe]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
