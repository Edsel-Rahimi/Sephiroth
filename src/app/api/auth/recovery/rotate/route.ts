import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { genRecoveryKey } from "@/lib/settings";

/* ============================================================
   Sephiroth · Phase 7 — recovery key rotation (admin).
   SuperJinX-style one-time recovery key: the new key is shown
   exactly once in the response; the old key stops working
   immediately.
   ============================================================ */

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // generate until unique (collision probability is negligible)
    let key = genRecoveryKey();
    for (let i = 0; i < 5; i++) {
      const clash = await db.adminUser.findUnique({ where: { recoveryKey: key } });
      if (!clash) break;
      key = genRecoveryKey();
    }

    await db.adminUser.update({
      where: { username: admin },
      data: { recoveryKey: key },
    });

    return NextResponse.json({ ok: true, recoveryKey: key });
  } catch (err) {
    console.error("[auth:recovery-rotate]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
