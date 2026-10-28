import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  mapInboundWriteError,
  prismaErrorCode,
  requireAdmin,
  toDTO,
  validateInbound,
} from "@/lib/inbounds";
import { reprojectInbound } from "@/lib/user-sync";
import { logActivity } from "@/lib/activity";
import { notifyInboundDeleted } from "@/lib/bot/notify"; // Task 23-a — bot alert

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
      // the Phase-3 editor serializes clients without ownerId — re-merge
      // every ClientUser's projected entries so user configs survive
      await reprojectInbound(id);
      const fresh = await db.inbound.findUnique({ where: { id } });
      await logActivity({
        kind: "inbound.updated",
        level: "info",
        actor: admin,
        message: `Inbound "${updated.tag}" updated`,
        meta: { inboundId: id, tag: updated.tag },
      });
      return NextResponse.json({ inbound: toDTO(fresh ?? updated) });
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
      const existing = await db.inbound.findUnique({ where: { id } });
      await db.inbound.delete({ where: { id } });
      if (existing) {
        await logActivity({
          kind: "inbound.deleted",
          level: "warn",
          actor: admin,
          message: `Inbound "${existing.tag}" deleted`,
          meta: { inboundId: id, tag: existing.tag },
        });
        void notifyInboundDeleted(existing.tag); // Task 23-a — bot alert
      }
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
