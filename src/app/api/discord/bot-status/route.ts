import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { getDiscordWorkerStatus } from "@/lib/bot/discord-worker";
import { getDiscordSettings } from "@/lib/settings";

/* ============================================================
   Sephiroth · v2.7 — Discord bot live status (admin)
   GET /api/discord/bot-status
   Mirrors /api/telegram/bot-status for the Discord gateway worker.
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const worker = getDiscordWorkerStatus();
    const settings = await getDiscordSettings();
    return NextResponse.json({
      enabled: settings.enabled,
      running: worker.running,
      gateway: worker.gateway,
      startedAt: worker.startedAt,
      lastHeartbeatAt: worker.lastHeartbeatAt,
      lastEventAt: worker.lastEventAt,
      handled: worker.handled,
      errors: worker.errors,
      lastError: worker.lastError,
      adminUserIds: settings.adminUserIds.length,
      announceChannelId: settings.announceChannelId ? "set" : "",
      tokenConfigured: settings.tokenConfigured,
      botLang: settings.botLang,
      prefix: settings.prefix,
    });
  } catch (err) {
    console.error("[discord:bot-status]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
