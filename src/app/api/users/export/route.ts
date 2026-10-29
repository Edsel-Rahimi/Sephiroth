import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { stringifyCsv } from "@/lib/csv";

/* ============================================================
   Sephiroth · 26-b — Users JSON export (migration out)
   GET /api/users/export            → users-sephiroth-<stamp>.json
   GET /api/users/export?format=csv → users-sephiroth-<stamp>.csv  (v2.7)

   Full portability snapshot: every client user with its limits,
   lifecycle flags (onHold/autoRenew) and per-inbound accesses
   (tag + email + key + flow) so another Sephiroth (or the import
   endpoint below / other panels' converters) can rebuild them.
   The CSV dialect mirrors the JSON fields 1:1 (snake_case headers,
   `;`-joined inbound lists) and round-trips through the CSV import
   variant of POST /api/users/import. Admin-only.
   ============================================================ */

export async function GET(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const wantCsv = (url.searchParams.get("format") ?? "").toLowerCase() === "csv";

    const rows = await db.clientUser.findMany({
      include: { accesses: { include: { inbound: true } } },
      orderBy: [{ createdAt: "asc" }],
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    if (wantCsv) {
      const csvRows: (string | number | boolean | null)[][] = [
        [
          "username", "note", "enabled", "traffic_limit_gb", "expiry_days", "ip_limit",
          "reset_period", "on_hold", "auto_renew", "started_at", "renewals",
          "used_traffic_gb", "inbounds", "emails", "keys", "flows",
        ],
      ];
      for (const u of rows) {
        csvRows.push([
          u.username,
          u.note,
          u.enabled,
          u.trafficLimitGb,
          u.expiryDays,
          u.ipLimit,
          u.resetPeriod,
          u.onHold === true,
          u.autoRenew === true,
          u.startedAt ? new Date(u.startedAt).toISOString() : null,
          Number(u.renewals) || 0,
          Number(u.usedTrafficGb) || 0,
          u.accesses.map((a) => a.inbound.tag).join(";"),
          u.accesses.map((a) => a.email).join(";"),
          u.accesses.map((a) => a.key).join(";"),
          u.accesses.map((a) => a.flow).join(";"),
        ]);
      }
      return new NextResponse(stringifyCsv(csvRows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="users-sephiroth-${stamp}.csv"`,
        },
      });
    }

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
        // 26-a — consumed usage travels with the export so quota + on-hold
        // state survive the move (import accepts it back, GB-precision)
        usedTrafficGb: Number(u.usedTrafficGb) || 0,
        inbounds: u.accesses.map((a) => ({
          tag: a.inbound.tag,
          protocol: a.inbound.protocol,
          email: a.email,
          key: a.key,
          flow: a.flow,
        })),
      })),
    };

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
