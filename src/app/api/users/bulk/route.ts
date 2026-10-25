import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { stripUserEverywhere, syncUserProjection } from "@/lib/user-sync";

/* ============================================================
   Sephiroth · Phase 4 — Users bulk API
   POST /api/users/bulk
     body: { action: "enable" | "disable" | "delete" | "resetTraffic",
             ids: string[] }
   → { ok: true, affected: number }
   ============================================================ */

const ACTIONS = new Set(["enable", "disable", "delete", "resetTraffic"]);

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

    const b = (body ?? {}) as { action?: unknown; ids?: unknown };
    const action = typeof b.action === "string" ? b.action : "";
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [];

    if (!ACTIONS.has(action) || ids.length === 0) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const rows = await db.clientUser.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        trafficLimitGb: true,
        expiryDays: true,
        ipLimit: true,
        enabled: true,
      },
    });

    let affected = 0;

    if (action === "delete") {
      for (const row of rows) {
        await stripUserEverywhere(row.id);
        await db.clientUser.delete({ where: { id: row.id } });
        affected++;
      }
    } else if (action === "resetTraffic") {
      await db.clientUser.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { usedTrafficGb: 0 } });
      affected = rows.length;
    } else {
      const enabled = action === "enable";
      for (const row of rows) {
        if (row.enabled !== enabled) {
          await db.clientUser.update({ where: { id: row.id }, data: { enabled } });
        }
        await syncUserProjection(row.id, {
          ipLimit: row.ipLimit,
          trafficLimitGb: row.trafficLimitGb,
          expiryDays: row.expiryDays,
          enabled,
        });
        affected++;
      }
    }

    return NextResponse.json({ ok: true, affected });
  } catch (err) {
    console.error("[users:bulk]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
