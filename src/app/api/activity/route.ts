import { NextResponse } from "next/server";
import { db, Prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Activity log API (admin only)
   GET    /api/activity?level=&kind=&q=&page=&pageSize=
            → { items, total, page, pageSize }
   DELETE /api/activity → { ok: true } (clears history)
   ============================================================ */

const KIND_GROUPS: Record<string, string[]> = {
  auth: ["auth.login", "auth.failed", "auth.password", "auth.recovery", "auth.sessions"],
  inbound: ["inbound.created", "inbound.updated", "inbound.deleted"],
  user: ["user.created", "user.updated", "user.deleted"],
  sub: ["sub.created", "sub.updated", "sub.deleted"],
  reseller: ["reseller.created", "reseller.updated", "reseller.deleted"],
  system: ["settings.updated", "backup.exported", "backup.restored", "system.cleared"],
};

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const level = url.searchParams.get("level") ?? "";
    const group = url.searchParams.get("kind") ?? "";
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      100,
      Math.max(10, Number(url.searchParams.get("pageSize") ?? "25") || 25)
    );

    const kinds = KIND_GROUPS[group];
    const where: Prisma.ActivityLogWhereInput = {};
    if (["info", "success", "warn", "error"].includes(level)) where.level = level;
    if (kinds) where.kind = { in: kinds };
    else if (group.includes(".")) where.kind = group; // Task 23-b — exact-kind drill-down (e.g. sub.hwidBlocked)
    if (q) {
      where.OR = [
        { message: { contains: q } },
        { actor: { contains: q } },
        { kind: { contains: q } },
      ];
    }

    const [total, rows] = await Promise.all([
      db.activityLog.count({ where }),
      db.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        level: r.level,
        actor: r.actor,
        message: r.message,
        meta: safeParse(r.metaJson),
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("[activity:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    await db.activityLog.deleteMany({});
    await logActivity({
      kind: "system.cleared",
      level: "warn",
      actor: admin,
      message: "Activity history cleared",
      meta: {},
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[activity:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
