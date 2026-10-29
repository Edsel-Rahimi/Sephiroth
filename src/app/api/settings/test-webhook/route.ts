import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { getWebhookSecret, getWebhookSettings } from "@/lib/settings";
import { signPayload } from "@/lib/webhooks";

/* ============================================================
   Sephiroth · v2.7 — Webhook test delivery (admin)
   POST /api/settings/test-webhook  { url?, secret? }
   Sends one real signed POST to the configured (or posted)
   endpoint with a sample payload. Single attempt, 6s timeout,
   mirrors the test-telegram route contract:
     { ok, status, latencyMs } | { ok: false, error, detail? }
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

    const saved = await getWebhookSettings();
    const url =
      typeof b.url === "string" && b.url.trim() !== ""
        ? b.url.trim()
        : saved.url;
    const secret =
      typeof b.secret === "string" && b.secret.trim() !== ""
        ? b.secret.trim()
        : await getWebhookSecret();

    if (!url) {
      return NextResponse.json({ ok: false, error: "no_url" });
    }
    if (!/^https:\/\/\S+$/.test(url)) {
      return NextResponse.json({ ok: false, error: "bad_url", detail: "HTTPS only" });
    }

    const ts = String(Date.now());
    const payload = JSON.stringify({
      event: "webhook.test",
      ts: Date.now(),
      panel: "sephiroth",
      data: { message: "Sephiroth panel · webhook test ✅", by: admin },
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Sephiroth-Panel/2.7 (+webhooks)",
      "X-Sephiroth-Event": "webhook.test",
      "X-Sephiroth-Ts": ts,
    };
    if (secret) {
      headers["X-Sephiroth-Sign"] = signPayload(secret, ts, payload);
    }

    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.text().catch(() => "");
      const latencyMs = Date.now() - started;
      if (res.status >= 200 && res.status < 300) {
        return NextResponse.json({ ok: true, status: res.status, latencyMs });
      }
      return NextResponse.json({
        ok: false,
        error: "http_error",
        detail: `HTTP ${res.status}`,
        latencyMs,
      });
    } catch (err) {
      const networkErr = err as Error;
      const isTimeout = networkErr?.name === "TimeoutError" || networkErr?.name === "AbortError";
      return NextResponse.json({
        ok: false,
        error: isTimeout ? "timeout" : "network",
        detail: isTimeout ? undefined : String(networkErr?.message ?? "").slice(0, 160),
      });
    }
  } catch (err) {
    console.error("[settings:test-webhook]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
