import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import {
  ensureSubSeed,
  genGroupToken,
  groupPasswordHash,
  toGroupDTO,
  validateGroup,
} from "@/lib/sub-groups";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Phase 5 — Sub Groups collection API (admin)
   GET  /api/sub/groups → { groups: GroupDTO[] }
   POST /api/sub/groups → { group: GroupDTO } (201)
      body: { name, infoLine?, password?, enabled?, memberIds[] }
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    await ensureSubSeed();
    const rows = await db.subGroup.findMany({
      orderBy: { createdAt: "desc" },
      include: { members: { include: { user: { select: { id: true } } } } },
    });
    return NextResponse.json({ groups: rows.map(toGroupDTO) });
  } catch (err) {
    console.error("[sub/groups:GET]", err);
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

    const parsed = validateGroup(body, {});
    if (!parsed.ok) {
      return NextResponse.json({ error: "validation", fields: parsed.fields }, { status: 400 });
    }
    const data = parsed.data;

    if (data.memberIds.length > 0) {
      const found = await db.clientUser.count({ where: { id: { in: data.memberIds } } });
      if (found !== data.memberIds.length) {
        return NextResponse.json(
          { error: "validation", fields: [{ field: "memberIds", code: "unknown" }] },
          { status: 400 }
        );
      }
    }

    const created = await db.$transaction(async (tx) => {
      return tx.subGroup.create({
        data: {
          name: data.name,
          token: genGroupToken(),
          passwordHash: data.password ? groupPasswordHash(data.password) : null,
          infoLine: data.infoLine || null,
          enabled: data.enabled,
          members: {
            create: data.memberIds.map((userId) => ({ userId })),
          },
        },
        include: { members: { include: { user: { select: { id: true } } } } },
      });
    });

    await logActivity({
      kind: "sub.created",
      level: "success",
      actor: admin,
      message: `Sub group "${data.name}" created (${data.memberIds.length} members)`,
      meta: { groupId: created.id, name: data.name },
    });

    return NextResponse.json({ group: toGroupDTO(created) }, { status: 201 });
  } catch (err) {
    console.error("[sub/groups:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
