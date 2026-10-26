import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ensureInboundSeed,
  mapInboundWriteError,
  requireAdmin,
  toDTO,
  validateInbound,
} from "@/lib/inbounds";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Phase 3 — Inbounds collection API
   GET  /api/inbounds  → { inbounds: InboundDTO[] }
   POST /api/inbounds  → { inbound: InboundDTO } (201)
   ============================================================ */

export async function GET(req: Request) {
  try {
    /* Phase 6 — any signed-in role may list inbounds (resellers
       need the tag list for the user create dialog); mutations stay admin. */
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    await ensureInboundSeed();

    const rows = await db.inbound.findMany({
      orderBy: [{ createdAt: "asc" }, { tag: "asc" }],
    });
    return NextResponse.json({ inbounds: rows.map(toDTO) });
  } catch (err) {
    console.error("[inbounds:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    await ensureInboundSeed();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateInbound(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }

    // duplicate checks before insert (friendly 409s for the common race)
    const tagOwner = await db.inbound.findUnique({
      where: { tag: parsed.data.tag },
    });
    if (tagOwner) {
      return NextResponse.json({ error: "duplicate_tag" }, { status: 409 });
    }

    const portOwner = await db.inbound.findUnique({
      where: { port: parsed.data.port },
    });
    if (portOwner) {
      return NextResponse.json({ error: "duplicate_port" }, { status: 409 });
    }

    try {
      const created = await db.inbound.create({ data: parsed.data });
      await logActivity({
        kind: "inbound.created",
        level: "success",
        actor: admin,
        message: `Inbound "${created.tag}" created (${created.protocol} :${created.port})`,
        meta: { inboundId: created.id, tag: created.tag },
      });
      return NextResponse.json({ inbound: toDTO(created) }, { status: 201 });
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
    console.error("[inbounds:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
