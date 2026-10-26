import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { getTelegramSettings, getTelegramToken } from "@/lib/settings";

/* ============================================================
   Sephiroth · Phase 7 — Telegram bot test (admin)
   POST /api/settings/test-telegram  { token?, chatId? }
   Sends a real "test message" through api.telegram.org using
   either the posted credentials (unsaved form) or the stored
   bot configuration. Network failures degrade to a plain
   error — never a crash.
   ============================================================ */

const TIMEOUT_MS = 6000;

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

    const token = typeof b.token === "string" && b.token.trim() !== ""
      ? b.token.trim()
      : await getTelegramToken();
    const saved = await getTelegramSettings();
    const chatId = typeof b.chatId === "string" && b.chatId.trim() !== ""
      ? b.chatId.trim()
      : saved.chatId;

    if (!token) {
      return NextResponse.json({ ok: false, error: "no_token" });
    }
    if (!chatId) {
      return NextResponse.json({ ok: false, error: "no_chat" });
    }

    const started = Date.now();
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "Sephiroth panel · test message ✅\nYour Telegram notifications are wired up correctly.",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const latencyMs = Date.now() - started;
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
      };
      if (res.ok && data.ok) {
        return NextResponse.json({ ok: true, latencyMs });
      }
      return NextResponse.json({
        ok: false,
        error: "telegram_error",
        detail: data.description ?? `HTTP ${res.status}`,
      });
    } catch (err) {
      const networkErr = err as Error;
      const isTimeout =
        networkErr?.name === "TimeoutError" || networkErr?.name === "AbortError";
      return NextResponse.json({
        ok: false,
        error: isTimeout ? "timeout" : "network",
      });
    }
  } catch (err) {
    console.error("[settings:test-telegram]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
