import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { getDiscordSettings, getDiscordToken } from "@/lib/settings";
import { dcSendToAdmins, getDiscordWorkerStatus } from "@/lib/bot/discord-worker";

/* ============================================================
   Sephiroth · v2.7 — Discord bot test message (admin)
   POST /api/discord/test  { token?, channelId? }
   Sends a real test message to the announce channel (or admin
   DMs) using posted (unsaved) or stored credentials.
   ============================================================ */

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      /* empty body → test saved config */
    }
    const b = (body ?? {}) as Record<string, unknown>;

    const saved = await getDiscordSettings();
    const token =
      typeof b.token === "string" && b.token.trim() !== "" ? b.token.trim() : await getDiscordToken();
    const channelId =
      typeof b.channelId === "string" && b.channelId.trim() !== ""
        ? b.channelId.trim()
        : saved.announceChannelId;
    const adminIds = Array.isArray(b.adminUserIds)
      ? (b.adminUserIds as unknown[]).map(String).filter((x) => /^\d{15,21}$/.test(x))
      : saved.adminUserIds;

    if (!token) {
      return NextResponse.json({ ok: false, error: "no_token" });
    }
    if (!channelId && adminIds.length === 0) {
      return NextResponse.json({ ok: false, error: "no_target" });
    }

    const started = Date.now();
    const ok = await dcSendToAdmins(
      token,
      adminIds,
      channelId,
      `🛰 **Sephiroth** · webhook-free direct check ✅\nDiscord bot is wired up correctly. (by ${admin})`
    );
    const latencyMs = Date.now() - started;
    const worker = getDiscordWorkerStatus();
    if (ok) {
      return NextResponse.json({ ok: true, latencyMs });
    }
    return NextResponse.json({
      ok: false,
      error: "send_failed",
      detail: worker.lastError ?? "Discord REST rejected the message",
    });
  } catch (err) {
    console.error("[discord:test]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
