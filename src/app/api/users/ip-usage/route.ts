import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveBackend } from "@/lib/core/registry";

/* ============================================================
   Sephiroth · Task 23-g — per-user concurrent-IP usage
   GET  /api/users/ip-usage
     → { windowMinutes, live, note?, usage: [
          { email, userId, username, ips: string[], count, limit, breach }
        ] }
   Merged from the Xray driver's access-log tracker (10-minute
   window, in-memory only). With the simulator core there is no
   access log — the route answers honestly with an empty list and
   a note. Resellers are scoped to their own users.
   ============================================================ */

interface IpUsageEntry {
  email: string;
  userId: string | null;
  username: string;
  ips: string[];
  count: number;
  limit: number;
  breach: boolean;
}

function driverSnapshot(): { ips: Record<string, string[]>; windowMinutes: number } | null {
  const backend = getActiveBackend();
  if (!backend || backend.kind !== "xray") return null;
  // ipSnapshot / ipWindowMinutes are getters on the XrayDriver class
  const driver = backend as unknown as { ipSnapshot?: Record<string, string[]>; ipWindowMinutes?: number };
  const snap = driver.ipSnapshot;
  if (!snap || typeof snap !== "object") return null;
  return { ips: snap, windowMinutes: driver.ipWindowMinutes ?? 10 };
}

export async function GET(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const snap = driverSnapshot();
    if (!snap) {
      return NextResponse.json({
        windowMinutes: 10,
        live: false,
        note: "sim-core — no access log; switch the core driver to Xray for live IP tracking",
        usage: [] as IpUsageEntry[],
      });
    }

    // email → owner row (resellers only see their own users' entries)
    const users = await db.clientUser.findMany({
      where: actor.role === "reseller" ? { resellerId: actor.id } : {},
      select: { id: true, username: true, ipLimit: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    const accessRows = await db.userInboundAccess.findMany({
      select: { email: true, userId: true },
    });
    const ownerByEmail = new Map<string, string>();
    for (const a of accessRows) {
      if (userById.has(a.userId)) ownerByEmail.set(a.email, a.userId);
    }

    const usage: IpUsageEntry[] = [];
    for (const [email, ips] of Object.entries(snap.ips)) {
      const userId = ownerByEmail.get(email) ?? null;
      const owner = userId ? userById.get(userId) : undefined;
      const limit = owner?.ipLimit ?? 0;
      const count = ips.length;
      usage.push({
        email,
        userId,
        username: owner?.username ?? email.split("@")[0] ?? email,
        ips,
        count,
        limit,
        breach: limit > 0 && count > limit,
      });
    }
    usage.sort((a, b) => b.count - a.count || a.email.localeCompare(b.email));

    return NextResponse.json({
      windowMinutes: snap.windowMinutes,
      live: true,
      usage,
    });
  } catch (err) {
    console.error("[users:ip-usage:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
