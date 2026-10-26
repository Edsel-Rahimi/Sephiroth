import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import {
  ensureNetSeeds,
  listNodes,
  toNodeDTO,
  validateNode,
} from "@/lib/net-objects";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Nodes API (admin only) — remote panel nodes
   GET  /api/nodes   → { nodes: NodeDTO[] }
   POST /api/nodes   → { node: NodeDTO }
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    await ensureNetSeeds();
    const nodes = await listNodes();
    return NextResponse.json({ nodes });
  } catch (err) {
    console.error("[nodes:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateNode(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const node = await db.node.create({
      data: {
        name: d.name,
        scheme: d.scheme,
        address: d.address,
        port: d.port,
        basePath: d.basePath,
        apiToken: d.token ?? "",
        enable: d.enable,
        syncAll: d.syncAll,
        inboundTags: JSON.stringify(d.inboundTags),
        outboundTag: d.outboundTag,
        tlsVerify: d.tlsVerify,
      },
    });

    await logActivity({
      kind: "settings.updated",
      level: "success",
      actor: admin,
      message: `Node "${d.name}" created (${d.scheme}://${d.address}:${d.port})`,
      meta: { nodeId: node.id },
    });

    return NextResponse.json({ node: toNodeDTO(node) }, { status: 201 });
  } catch (err) {
    console.error("[nodes:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
