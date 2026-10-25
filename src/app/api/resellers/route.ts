import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import {
  listResellerDTOs,
  resellerCreateData,
  toResellerDTO,
  validateReseller,
} from "@/lib/resellers";

/* ============================================================
   Sephiroth · Phase 6 — Resellers collection API (admin)
   GET  /api/resellers → { resellers: ResellerDTO[] } (with usage)
   POST /api/resellers → { reseller: ResellerDTO } (201)
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const resellers = await listResellerDTOs();
    return NextResponse.json({ resellers });
  } catch (err) {
    console.error("[resellers:GET]", err);
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

    const parsed = validateReseller(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }
    const data = parsed.data;

    // username must be free across admins, resellers and client users
    const [adminTaken, resellerTaken, userTaken] = await Promise.all([
      db.adminUser.findUnique({ where: { username: data.username }, select: { id: true } }),
      db.reseller.findUnique({ where: { username: data.username }, select: { id: true } }),
      db.clientUser.findUnique({ where: { username: data.username }, select: { id: true } }),
    ]);
    if (adminTaken || resellerTaken || userTaken) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "username", code: "taken" }] },
        { status: 409 }
      );
    }

    const created = await db.reseller.create({
      data: resellerCreateData(data),
      include: { users: { select: { trafficLimitGb: true, usedTrafficGb: true } } },
    });
    return NextResponse.json({ reseller: toResellerDTO(created) }, { status: 201 });
  } catch (err) {
    console.error("[resellers:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
