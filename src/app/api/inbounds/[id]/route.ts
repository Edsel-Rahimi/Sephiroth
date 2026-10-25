import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  mapInboundWriteError,
  prismaErrorCode,
  requireAdmin,
  toDTO,
  validateInbound,
} from "@/lib/inbounds";

/* ============================================================
   Sephiroth · Phase 3 — Inbounds item API
   PATCH  /api/inbounds/:id → { inbound: InboundDTO }
   DELETE /api/inbounds/:id → { ok: true }
   (Next.js 16 App Router: route params are async)
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

    const parsed = validateInbound(body, { partial: true });
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }

    const existing = await db.inbound.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const { tag, port } = parsed.data;

    if (tag !== undefined && tag !== existing.tag) {
      const tagOwner = await db.inbound.findUnique({ where: { tag } });
      if (tagOwner) {
        return NextResponse.json({ error: "duplicate_tag" }, { status: 409 });
      }
    }
    if (port !== undefined && port !== existing.port) {
      const portOwner = await db.inbound.findUnique({ where: { port } });
      if (portOwner) {
        return NextResponse.json({ error: "duplicate_port" }, { status: 409 });
      }
    }

    try {
      const updated = await db.inbound.update({
        where: { id },
        data: parsed.data,
      });
      return NextResponse.json({ inbound: toDTO(updated) });
    } catch (err) {
      const kind = mapInboundWriteError(err); // Prisma P2002 race
      if (kind === "duplicate_tag") {
        return NextResponse.json({ error: "duplicate_tag" }, { status: 409 });
      }
      if (kind === "duplicate_port") {
        return NextResponse.json({ error: "duplicate_port" }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error("[inbounds:PATCH]", err);
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

    try {
      await db.inbound.delete({ where: { id } });
    } catch (err) {
      if (prismaErrorCode(err) === "P2025") {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[inbounds:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
