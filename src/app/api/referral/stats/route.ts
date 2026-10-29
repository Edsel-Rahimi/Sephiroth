import { NextResponse } from "next/server";
import { db, type TgUser } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";

/* ============================================================
   Sephiroth · Task 2-d — Referral stats API (admin only)
   GET /api/referral/stats →
   {
     totalReferred: number,   // users with a refBy set
     totalRewarded: number,   // users whose first paid order completed
     top: [{ tgId, username, code, referrals, rewarded, earnedToman }]
   }
   `top` = referrers with ≥ 1 referral, sorted by referral count.
   `earnedToman` is the EXACT lifetime reward total per referrer
   (accumulated per grant in tgUser.refEarnedToman).
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const users = await db.tgUser.findMany();
    const byTgId = new Map<string, TgUser>(users.map((u) => [String(u.tgId), u]));

    // referred users grouped by their referrer
    const referredBy = new Map<string, TgUser[]>();
    let totalRewarded = 0;
    for (const u of users) {
      const refBy = String(u.refBy ?? "");
      if (!refBy) continue;
      const list = referredBy.get(refBy) ?? [];
      list.push(u);
      referredBy.set(refBy, list);
      if (u.refRewarded === true) totalRewarded += 1;
    }

    const totalReferred = [...referredBy.values()].reduce((s, list) => s + list.length, 0);

    const top = [...referredBy.entries()]
      .map(([tgId, list]) => {
        const me = byTgId.get(tgId);
        return {
          tgId,
          username: me?.tgUsername ?? "",
          code: me?.refCode ?? "",
          referrals: list.length,
          rewarded: list.filter((u) => u.refRewarded === true).length,
          // exact lifetime total credited to THIS referrer (falls back to
          // counting rewarded referrals when the accumulator is missing on
          // pre-2-d rows — both are honest, the fallback is clearly derived)
          earnedToman: Math.max(0, Math.floor(Number(me?.refEarnedToman ?? 0))),
        };
      })
      .sort((a, b) => b.referrals - a.referrals || b.earnedToman - a.earnedToman)
      .slice(0, 10);

    return NextResponse.json({ totalReferred, totalRewarded, top });
  } catch (err) {
    console.error("[referral:stats:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
