import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

/* ============================================================
   Sephiroth · 26-b — Users JSON export (migration out)
   GET /api/users/export
   → attachment users-sephiroth-<stamp>.json

   Full portability snapshot: every client user with its limits,
   lifecycle flags (onHold/autoRenew) and per-inbound accesses
   (tag + email + key + flow) so another Sephiroth (or the import
   endpoint below / other panels' converters) can rebuild them.
   Admin-only.
   ============================================================ */

export async function GET(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const rows = await db.clientUser.findMany({
      include: { accesses: { include: { inbound: true } } },
      orderBy: [{ createdAt: "asc" }],
    });

    const payload = {
      format: "sephiroth-users",
      version: 1,
      exportedAt: new Date().toISOString(),
      users: rows.map((u) => ({
        username: u.username,
        note: u.note,
        enabled: u.enabled,
        trafficLimitGb: u.trafficLimitGb,
        expiryDays: u.expiryDays,
        ipLimit: u.ipLimit,
        resetPeriod: u.resetPeriod,
        onHold: u.onHold === true,
        autoRenew: u.autoRenew === true,
        // 26-a — lifecycle anchor + counters so a migration keeps the clock
        startedAt: u.startedAt ? new Date(u.startedAt).toISOString() : null,
        renewals: Number(u.renewals) || 0,
        inbounds: u.accesses.map((a) => ({
          tag: a.inbound.tag,
          protocol: a.inbound.protocol,
          email: a.email,
          key: a.key,
          flow: a.flow,
        })),
      })),
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="users-sephiroth-${stamp}.json"`,
      },
    });
  } catch (err) {
    console.error("[users:export]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
