import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAdmin } from "@/lib/inbounds";
import { toTemplateDTO, validateTemplate } from "@/lib/resellers";

/* ============================================================
   Sephiroth · Phase 6 — Sale templates API
   GET  /api/sale-templates → { templates: TemplateDTO[] }
        (any signed-in role; resellers see enabled only)
   POST /api/sale-templates → { template } (201, admin only)
   ============================================================ */

export async function GET(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const rows = await db.saleTemplate.findMany({
      where: actor.role === "reseller" ? { enabled: true } : {},
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ templates: rows.map(toTemplateDTO) });
  } catch (err) {
    console.error("[sale-templates:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = await validateTemplate(body); // task 3-1 — await (resellerId existence check)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }

    const created = await db.saleTemplate.create({ data: parsed.data });
    return NextResponse.json({ template: toTemplateDTO(created) }, { status: 201 });
  } catch (err) {
    console.error("[sale-templates:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
