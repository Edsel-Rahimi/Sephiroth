import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { stripUserEverywhere, syncUserProjection } from "@/lib/user-sync";
import { notifyTrafficReset } from "@/lib/bot/notify"; // Task 23-a — bot alert

/* ============================================================
   Sephiroth · Phase 4 — Users bulk API
   Phase 6 — role-scoped: resellers may only bulk-act on their
   own users (id set is intersected with resellerId).
   POST /api/users/bulk
     body: { action: "enable" | "disable" | "delete" | "resetTraffic",
             ids: string[] }
   → { ok: true, affected: number }
   ============================================================ */

const ACTIONS = new Set(["enable", "disable", "delete", "resetTraffic"]);

export async function POST(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor) {
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
      where: {
        id: { in: ids },
        ...(actor.role === "reseller" ? { resellerId: actor.id } : {}),
      },
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
      // Task 23-a — one deduped bot alert per reset user (bulk storm-safe)
      const names = await db.clientUser.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
        select: { username: true },
      });
      for (const n of names.slice(0, 10)) {
        void notifyTrafficReset(n.username, "manual");
      }
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
