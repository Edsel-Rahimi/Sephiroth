import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { getTelegramSettings } from "@/lib/settings";
import { getSalesWorkerStatus } from "@/lib/bot/sales-worker";

/* ============================================================
   Sephiroth · Task 23-c/23-a — Bot worker status (admin)
   GET /api/telegram/bot-status →
   { mode, running, lastPollAt, handledUpdates, errors, lastError,
     adminChatIds, tokenConfigured, botLang, salesPayMode }
   Polled by the Settings → Telegram Bot card for the live pill.
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const tg = await getTelegramSettings();
    const status = getSalesWorkerStatus();
    return NextResponse.json({
      // the worker snapshots its mode on start; when idle, echo the saved one
      mode: status.running ? status.mode : tg.botMode,
      running: status.running,
      startedAt: status.startedAt,
      lastPollAt: status.lastPollAt,
      handledUpdates: status.handledUpdates,
      errors: status.errors,
      lastError: status.lastError,
      adminChatIds: tg.adminChatIds.length,
      tokenConfigured: tg.tokenConfigured,
      botLang: tg.botLang,
      salesPayMode: tg.salesPayMode,
    });
  } catch (err) {
    console.error("[telegram:bot-status]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
