import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { runDailySalesDigest } from "@/lib/digest-job";

/* ============================================================
   Sephiroth · 26-b — Telegram digest test (admin)
   POST /api/telegram/digest-test
   Runs the daily sales digest with force=true — bypasses BOTH
   the dailyDigest toggle and the 23h last-run key, because the
   admin explicitly pressed "Send test digest" in settings.
   The digest job itself never throws; the try/catch below is a
   belt-and-braces guard so the route always answers JSON.
   ============================================================ */

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const result = await runDailySalesDigest(true);
    if (!result.ran) {
      // real conditions only (telegram_off / no_admin_chat / error) —
      // force mode already skips the toggle and the not_due gate
      return NextResponse.json({ ok: false, reason: result.reason ?? "error" });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telegram:digest-test]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
