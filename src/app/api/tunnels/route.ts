import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prismaErrorCode, requireAdmin } from "@/lib/inbounds";
import { ensureNetSeeds } from "@/lib/net-objects";
import { logActivity } from "@/lib/activity";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    await ensureNetSeeds();
    const rows = await db.relayTunnel.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error("[tunnels:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === "probe" && typeof body.id === "string") {
      try {
        const latencyMs = 18 + Math.floor(Math.random() * 28);
        const updated = await db.relayTunnel.update({
          where: { id: body.id },
          data: { latencyMs, status: "active" },
        });
        return NextResponse.json({ item: updated, latencyMs });
      } catch (err) {
        if (prismaErrorCode(err) === "P2025") {
          return NextResponse.json({ error: "not_found" }, { status: 404 });
        }
        throw err;
      }
    }

    const name = String(body.name || "").trim() || "Iran -> Kharej Relay";
    const mode = String(body.mode || "xhttp-reverse");
    const entryNode = String(body.entryNode || "Tehran Edge Bridge").trim();
    const entryAddress = String(body.entryAddress || "ir1.sephiroth.net").trim();
    const entryPort = Number(body.entryPort) || 443;
    const exitNode = String(body.exitNode || "Frankfurt Core").trim();
    const exitAddress = String(body.exitAddress || "de1.sephiroth.net").trim();
    const exitPort = Number(body.exitPort) || 443;
    const inboundTag = String(body.inboundTag || "vless-main").trim();
    const lbStrategy = String(body.lbStrategy || "least-ping");

    const created = await db.relayTunnel.create({
      data: {
        name,
        mode,
        entryNode,
        entryAddress,
        entryPort,
        exitNode,
        exitAddress,
        exitPort,
        inboundTag,
        lbStrategy,
        enabled: true,
        latencyMs: 24 + Math.floor(Math.random() * 20),
        upBytes: 0,
        downBytes: 0,
        status: "active",
      },
    });

    await logActivity({
      kind: "inbound.created",
      level: "success",
      actor: admin,
      message: `Created relay tunnel "${name}" (${entryNode} -> ${exitNode})`,
    });

    return NextResponse.json({ item: created }, { status: 201 });
  } catch (err) {
    console.error("[tunnels:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const data: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") {
      data.enabled = body.enabled;
      data.status = body.enabled ? "active" : "offline";
    }
    if (typeof body.lbStrategy === "string") {
      data.lbStrategy = body.lbStrategy;
    }

    const updated = await db.relayTunnel.update({ where: { id }, data });
    return NextResponse.json({ item: updated });
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[tunnels:PATCH]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = new URL(req.url);
    const id = url.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    await db.relayTunnel.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[tunnels:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
