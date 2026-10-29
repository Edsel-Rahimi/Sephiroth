import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { getActiveBackend } from "@/lib/core/registry";

/* ============================================================
   Sephiroth · v2.7 Phase 2 (task 2-b) — live session drill-down
   GET /api/system/online-sessions
     → { live, windowMinutes, serverNow, note?, users: [
          { email, username, userId, enabled, ipLimit,
            ips: [{ ip, lastSeenMs, stale }] } ] }

   The Xray driver's access-log IpTracker keeps (email, ip) →
   lastSeen epoch-ms inside a sliding window (default 10 min,
   pruned on every observation). This route surfaces that map —
   the ONLY timestamped per-(user, ip) session data that exists —
   plus the db owner join (username / enabled / ipLimit) so the
   Online Users view can render the IP ↔ user mapping in both
   directions.

   Semantics:
   • everything returned is inside the window (the tracker prunes
     older observations) — "stale" marks pairs last observed in the
     OLDER HALF of the window (still counted, but quiet);
   • firstSeen is honestly omitted — the tracker stores only the
     most recent observation per (email, ip) pair;
   • per-IP byte counters do not exist in the Xray stats API, so
     traffic stays a user-level figure (the view labels it as such).

   Simulator core (or an unreadable tracker shape): live=false
   with an empty list — the view keeps its honest empty state.
   ============================================================ */

interface SessionIp {
  ip: string;
  lastSeenMs: number;
  stale: boolean;
}

interface SessionUser {
  email: string;
  username: string;
  userId: string | null;
  enabled: boolean;
  /** 0 = unlimited */
  ipLimit: number;
  /** newest observation first */
  ips: SessionIp[];
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const backend = getActiveBackend();
    const serverNow = Date.now();

    if (!backend || backend.kind !== "xray") {
      return NextResponse.json({
        live: false,
        windowMinutes: 10,
        serverNow,
        note: "sim-core — no access log; switch the core driver to Xray for live session tracking",
        users: [] as SessionUser[],
      });
    }

    // `ipTracker` is a private field on the XrayDriver — reached the same
    // way the ip-usage route reaches `ipSnapshot`. The tracker's `entries`
    // map is the only timestamped session source; defensive runtime shape
    // check so a driver refactor degrades to the honest empty state
    // instead of a 500.
    const tracker = (backend as unknown as {
      ipTracker?: { entries?: unknown; windowMs?: unknown };
    }).ipTracker;
    const raw =
      tracker?.entries instanceof Map
        ? (tracker.entries as Map<string, Map<string, number>>)
        : null;
    const windowMs =
      typeof tracker?.windowMs === "number" && tracker.windowMs > 0
        ? tracker.windowMs
        : 10 * 60_000;

    if (!raw) {
      return NextResponse.json({
        live: false,
        windowMinutes: Math.round(windowMs / 60_000),
        serverNow,
        note: "tracker-unavailable",
        users: [] as SessionUser[],
      });
    }

    // windowed observations, newest first — same semantics as
    // IpTracker.snapshot() but keeping the timestamps
    const staleCutoff = serverNow - windowMs / 2;
    const observed: Array<{ email: string; ips: SessionIp[] }> = [];
    for (const [email, ips] of raw) {
      if (!(ips instanceof Map)) continue;
      const list: SessionIp[] = [];
      for (const [ip, seen] of ips) {
        if (typeof seen !== "number" || seen < serverNow - windowMs) continue;
        list.push({ ip, lastSeenMs: seen, stale: seen < staleCutoff });
      }
      if (list.length > 0) {
        list.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
        observed.push({ email, ips: list });
      }
    }

    // owner join (username / enabled / ipLimit) — mirrors the ip-usage route
    const users = await db.clientUser.findMany({
      select: { id: true, username: true, enabled: true, ipLimit: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    const accessRows = await db.userInboundAccess.findMany({
      select: { email: true, userId: true },
    });
    const ownerByEmail = new Map<string, string>();
    for (const a of accessRows) {
      if (userById.has(a.userId)) ownerByEmail.set(a.email, a.userId);
    }

    const out: SessionUser[] = observed.map(({ email, ips }) => {
      const userId = ownerByEmail.get(email) ?? null;
      const owner = userId ? userById.get(userId) : undefined;
      return {
        email,
        username: owner?.username ?? email.split("@")[0] ?? email,
        userId,
        enabled: owner?.enabled ?? true,
        ipLimit: owner?.ipLimit ?? 0,
        ips,
      };
    });
    out.sort((a, b) => b.ips.length - a.ips.length || a.email.localeCompare(b.email));

    return NextResponse.json({
      live: true,
      windowMinutes: Math.round(windowMs / 60_000),
      serverNow,
      users: out,
    });
  } catch (err) {
    console.error("[system:online-sessions:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
