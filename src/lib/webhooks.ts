import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getWebhookSettings, getWebhookSecret } from "@/lib/settings";

/* ============================================================
   Sephiroth · v2.7 — Outbound webhook dispatcher (server-only)

   Fire-and-forget event fan-out to an external HTTPS endpoint
   (n8n / Discord relay / custom automation). Contract:

     POST <url>
     X-Sephiroth-Event:  user.created        (event name)
     X-Sephiroth-Ts:     1730000000000       (ms epoch)
     X-Sephiroth-Sign:   hex hmac-sha256(`${ts}.${rawBody}`, secret)
     Content-Type:       application/json
     body: { event, ts, data }

   Rules:
   • Fires only when enabled + a valid HTTPS URL is configured.
   • Per-event opt-in via settings.events (default: all on).
   • 3 attempts (initial + 2 retries, 1.5s apart), 6s timeout each.
   • Every attempt outcome is appended to the activity log
     (webhook.delivered / webhook.failed) so the UI can show a
     recent-deliveries strip. The log itself is pruned by
     activity.ts, so this cannot grow unbounded.
   • Never throws — a broken webhook endpoint must never break a
     panel route (same contract as the bot notify engine).
   ============================================================ */

export type WebhookEvent =
  | "user.created"
  | "user.deleted"
  | "user.updated"
  | "user.expired"
  | "user.near-expiry"
  | "user.quota"
  | "user.traffic-reset"
  | "user.activated"
  | "user.renewed"
  | "login.failed"
  | "sales.digest"
  | "backup.done"
  | "panel.restart"
  | "inbound.created"
  | "inbound.deleted";

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  "user.created",
  "user.deleted",
  "user.updated",
  "user.expired",
  "user.near-expiry",
  "user.quota",
  "user.traffic-reset",
  "user.activated",
  "user.renewed",
  "login.failed",
  "sales.digest",
  "backup.done",
  "panel.restart",
  "inbound.created",
  "inbound.deleted",
];

const MAX_LOG_ROWS = 60;

export function signPayload(secret: string, ts: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
}

/** Constant-time signature check — exposed for receivers / tests. */
export function verifySignature(secret: string, ts: string, rawBody: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(secret, ts, rawBody));
  const given = Buffer.from(String(signature ?? ""));
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

async function logDelivery(
  ok: boolean,
  meta: { event: string; url: string; status: number; attempts: number; ms: number; error?: string }
): Promise<void> {
  await logActivity({
    kind: ok ? "webhook.delivered" : "webhook.failed",
    level: ok ? "success" : "error",
    actor: "webhooks",
    message: ok
      ? `Webhook ${meta.event} → ${meta.status} (${meta.ms}ms, attempt ${meta.attempts})`
      : `Webhook ${meta.event} failed after ${meta.attempts} attempt(s): ${meta.error ?? "unreachable"}`,
    meta: { ...meta, url: meta.url.replace(/\/\/[^/]*@/, "//") },
  });
  // activity log already prunes to 500 global rows; keep the webhook
  // slice small too so the settings card strip stays fast on busy panels.
  try {
    const rows = await db.activityLog.findMany({
      where: { kind: { in: ["webhook.delivered", "webhook.failed"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
      skip: MAX_LOG_ROWS,
    });
    if (rows.length > 0) {
      await db.activityLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    }
  } catch {
    /* pruning is best-effort */
  }
}

/** One POST attempt. Returns status code (0 = network/timeout error). */
async function attempt(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; error?: string; ms: number }> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(6_000),
    });
    // drain a tiny chunk so keep-alive sockets close cleanly
    await res.text().catch(() => "");
    return { status: res.status, ms: Date.now() - started };
  } catch (err) {
    const e = err as Error;
    return {
      status: 0,
      error: e?.name === "TimeoutError" ? "timeout" : String(e?.message ?? e).slice(0, 160),
      ms: Date.now() - started,
    };
  }
}

/**
 * Fire one webhook event. Returns true when at least one attempt
 * got a 2xx. Dedupe is intentionally NOT applied here (the caller
 * — notify helpers — already dedupes; webhooks are machine-to-
 * machine and consumers usually want every event).
 */
export async function fireWebhook(event: WebhookEvent, data: Record<string, unknown>): Promise<boolean> {
  try {
    const wh = await getWebhookSettings();
    if (!wh.enabled || !wh.url) return false;
    if (wh.events[event] === false) return false;
    const secret = await getWebhookSecret();

    const payload = JSON.stringify({
      event,
      ts: Date.now(),
      panel: "sephiroth",
      data,
    });
    const ts = String(Date.now());
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Sephiroth-Panel/2.7 (+webhooks)",
      "X-Sephiroth-Event": event,
      "X-Sephiroth-Ts": ts,
    };
    if (secret) {
      headers["X-Sephiroth-Sign"] = signPayload(secret, ts, payload);
    }

    const attempts = 3;
    let last: { status: number; error?: string; ms: number } = { status: 0, error: "unreachable", ms: 0 };
    for (let i = 1; i <= attempts; i++) {
      last = await attempt(wh.url, headers, payload);
      if (last.status >= 200 && last.status < 300) {
        await logDelivery(true, { event, url: wh.url, status: last.status, attempts: i, ms: last.ms });
        return true;
      }
      if (i < attempts) await new Promise((r) => setTimeout(r, 1_500));
    }
    await logDelivery(false, {
      event,
      url: wh.url,
      status: last.status,
      attempts,
      ms: last.ms,
      error: last.status ? `http_${last.status}` : last.error,
    });
    return false;
  } catch {
    return false; // never break the calling route
  }
}

export interface WebhookDeliveryRow {
  id: string;
  createdAt: string;
  ok: boolean;
  event: string;
  message: string;
  status: number | null;
  attempts: number | null;
  ms: number | null;
}

/** Newest webhook delivery attempts for the settings card strip. */
export async function recentWebhookDeliveries(take = 12): Promise<WebhookDeliveryRow[]> {
  try {
    const rows = await db.activityLog.findMany({
      where: { kind: { in: ["webhook.delivered", "webhook.failed"] } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(take, 1), 50),
    });
    return rows.map((r) => {
      let meta: { status?: number; attempts?: number; ms?: number; event?: string } = {};
      try {
        meta = JSON.parse(r.metaJson ?? "{}") as typeof meta;
      } catch {
        /* keep empty meta */
      }
      return {
        id: r.id,
        createdAt: new Date(r.createdAt).toISOString(),
        ok: r.kind === "webhook.delivered",
        event: String(meta.event ?? ""),
        message: r.message,
        status: typeof meta.status === "number" ? meta.status : null,
        attempts: typeof meta.attempts === "number" ? meta.attempts : null,
        ms: typeof meta.ms === "number" ? meta.ms : null,
      };
    });
  } catch {
    return [];
  }
}
