import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { toNodeDTO, validateNode } from "@/lib/net-objects";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Nodes item API
   PATCH  /api/nodes/:id → { node: NodeDTO }
   DELETE /api/nodes/:id → { ok: true }
   ============================================================ */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;

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

    const existing = await db.node.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const node = await db.node.update({
      where: { id },
      data: {
        name: d.name,
        scheme: d.scheme,
        address: d.address,
        port: d.port,
        basePath: d.basePath,
        apiToken: d.token === undefined ? existing.apiToken : (d.token ?? ""),
        enable: d.enable,
        syncAll: d.syncAll,
        inboundTags: JSON.stringify(d.inboundTags),
        outboundTag: d.outboundTag,
        tlsVerify: d.tlsVerify,
      },
    });

    await logActivity({
      kind: "settings.updated",
      level: "info",
      actor: admin,
      message: `Node "${d.name}" updated`,
      meta: { nodeId: id },
    });

    return NextResponse.json({ node: toNodeDTO(node) });
  } catch (err) {
    console.error("[nodes:PATCH]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await db.node.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await db.node.delete({ where: { id } });
    await logActivity({
      kind: "settings.updated",
      level: "warn",
      actor: admin,
      message: `Node "${existing.name}" deleted`,
      meta: { nodeId: id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[nodes:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
