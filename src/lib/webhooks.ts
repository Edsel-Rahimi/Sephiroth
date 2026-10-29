import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import {
  getWebhookSettings,
  getWebhookSecret,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from "@/lib/settings";

// Task 2-a — the canonical event list + type now live in settings.ts (so it
// can validate per-event URL overrides without an import cycle); re-exported
// here to keep the historical import path stable.
export { WEBHOOK_EVENTS };
export type { WebhookEvent };

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
   • Per-event URL overrides (Task 2-a): eventUrls[event] wins over the
     global endpoint when set.
   • 3 attempts (initial + 2 retries, 1.5s apart), 6s timeout each.
   • Every attempt outcome is appended to the activity log
     (webhook.delivered / webhook.failed) so the UI can show a
     recent-deliveries strip. The log itself is pruned by
     activity.ts, so this cannot grow unbounded.
   • After all attempts fail the payload is persisted to the
     webhookDead store (cap 100) so an admin can inspect / retry / clear
     it from the settings card (Task 2-a).
   • Never throws — a broken webhook endpoint must never break a
     panel route (same contract as the bot notify engine).
   ============================================================ */

const MAX_LOG_ROWS = 60;

/* Task 2-a — dead-letter queue bounds */
const DEAD_LETTER_CAP = 100;
const DEAD_PAYLOAD_MAX = 4096;

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
  meta: { event: string; url: string; status: number; attempts: number; ms: number; error?: string; urlKind?: string }
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

/** Task 2-a — persist a failed delivery to the dead-letter store (cap 100). */
async function pushDeadLetter(row: {
  event: string;
  url: string;
  status: number | null;
  error: string;
  attempts: number;
  payload: string;
  sign: string;
}): Promise<void> {
  try {
    await db.webhookDead.create({ data: row });
    // cap — drop the oldest rows beyond DEAD_LETTER_CAP
    const extra = await db.webhookDead.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
      skip: DEAD_LETTER_CAP,
    });
    if (extra.length > 0) {
      await db.webhookDead.deleteMany({ where: { id: { in: extra.map((r) => r.id) } } });
    }
  } catch {
    /* dead-lettering is best-effort — never break the caller */
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

    // Task 2-a — per-event URL override wins over the global endpoint.
    const override = wh.eventUrls?.[event]?.trim() || "";
    const target = override || wh.url;
    const urlKind = override ? "override" : "default";

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
    let sign = "";
    if (secret) {
      sign = signPayload(secret, ts, payload);
      headers["X-Sephiroth-Sign"] = sign;
    }

    const attempts = 3;
    let last: { status: number; error?: string; ms: number } = { status: 0, error: "unreachable", ms: 0 };
    for (let i = 1; i <= attempts; i++) {
      last = await attempt(target, headers, payload);
      if (last.status >= 200 && last.status < 300) {
        await logDelivery(true, { event, url: target, status: last.status, attempts: i, ms: last.ms, urlKind });
        return true;
      }
      if (i < attempts) await new Promise((r) => setTimeout(r, 1_500));
    }
    await logDelivery(false, {
      event,
      url: target,
      status: last.status,
      attempts,
      ms: last.ms,
      error: last.status ? `http_${last.status}` : last.error,
      urlKind,
    });
    await pushDeadLetter({
      event,
      url: target,
      status: last.status > 0 ? last.status : null,
      error: last.status ? `http_${last.status}` : String(last.error ?? "unreachable").slice(0, 160),
      attempts,
      payload: payload.slice(0, DEAD_PAYLOAD_MAX),
      sign,
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

/* ============================================================
   Task 2-a — dead-letter queue API (list / retry / delete)
   Backs the "dead letters" section of the Webhooks settings card.
   ============================================================ */

export interface WebhookDeadLetterRow {
  id: string;
  createdAt: string;
  event: string;
  url: string;
  status: number | null;
  error: string;
  attempts: number;
  /** Raw JSON body actually POSTed (truncated to 4096 chars). */
  payload: string;
  /** X-Sephiroth-Sign that was used ("" when unsigned). */
  sign: string;
}

function toDeadRow(r: Record<string, unknown>): WebhookDeadLetterRow {
  return {
    id: String(r.id ?? ""),
    createdAt: new Date(String(r.createdAt ?? Date.now())).toISOString(),
    event: String(r.event ?? ""),
    url: String(r.url ?? ""),
    status: typeof r.status === "number" ? r.status : null,
    error: String(r.error ?? ""),
    attempts: Number(r.attempts) || 0,
    payload: String(r.payload ?? ""),
    sign: String(r.sign ?? ""),
  };
}

/** Newest dead letters first (cap 100). Never throws. */
export async function listDeadLetters(take = 100): Promise<WebhookDeadLetterRow[]> {
  try {
    const rows = await db.webhookDead.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(take, 1), DEAD_LETTER_CAP),
    });
    return rows.map((r) => toDeadRow(r as unknown as Record<string, unknown>));
  } catch {
    return [];
  }
}

export type DeadLetterRetryResult =
  | { ok: true; status: number; ms: number }
  | { ok: false; status: number | null; error: string };

/**
 * Re-POST a dead letter's stored payload to the CURRENT resolved URL for
 * its event (override → global → stored URL) with a FRESH timestamp +
 * signature. On 2xx the row is removed and webhook.delivered is logged;
 * on failure the row is kept and its diagnostics refreshed.
 */
export async function retryDeadLetter(id: string): Promise<DeadLetterRetryResult> {
  try {
    const raw = await db.webhookDead.findUnique({ where: { id } });
    if (!raw) return { ok: false, status: null, error: "not_found" };
    const row = toDeadRow(raw as unknown as Record<string, unknown>);

    const wh = await getWebhookSettings();
    const override = wh.eventUrls?.[row.event as WebhookEvent]?.trim() || "";
    const target = override || wh.url || row.url;
    if (!target || !/^https?:\/\//i.test(target)) {
      return { ok: false, status: null, error: "no_target" };
    }

    // fresh timestamp both in the body and the signed header
    let body = row.payload;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsed.ts = Date.now();
        body = JSON.stringify(parsed);
      }
    } catch {
      /* keep the stored body verbatim */
    }
    const ts = String(Date.now());
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Sephiroth-Panel/2.7 (+webhooks)",
      "X-Sephiroth-Event": row.event,
      "X-Sephiroth-Ts": ts,
    };
    const secret = await getWebhookSecret();
    if (secret) {
      headers["X-Sephiroth-Sign"] = signPayload(secret, ts, body);
    }

    const res = await attempt(target, headers, body);
    if (res.status >= 200 && res.status < 300) {
      try {
        await db.webhookDead.delete({ where: { id } });
      } catch {
        /* already gone — still a success */
      }
      await logDelivery(true, {
        event: row.event,
        url: target,
        status: res.status,
        attempts: 1,
        ms: res.ms,
        urlKind: "dead-letter-retry",
      });
      return { ok: true, status: res.status, ms: res.ms };
    }

    // keep the row, refresh its last-attempt diagnostics
    const errText = res.status ? `http_${res.status}` : String(res.error ?? "unreachable").slice(0, 160);
    try {
      await db.webhookDead.update({
        where: { id },
        data: {
          url: target,
          status: res.status > 0 ? res.status : null,
          error: errText,
          attempts: row.attempts + 1,
          payload: body.slice(0, DEAD_PAYLOAD_MAX),
        },
      });
    } catch {
      /* row deleted concurrently — nothing to refresh */
    }
    return { ok: false, status: res.status > 0 ? res.status : null, error: errText };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: String((err as Error)?.message ?? err).slice(0, 160),
    };
  }
}

/** Delete one dead letter by id, or everything with {all:true}. Returns rows removed. */
export async function deleteDeadLetters(opts: { id?: string; all?: boolean }): Promise<number> {
  try {
    if (opts.all) {
      const res = await db.webhookDead.deleteMany({});
      return res.count;
    }
    if (opts.id) {
      const res = await db.webhookDead.deleteMany({ where: { id: opts.id } });
      return res.count;
    }
    return 0;
  } catch {
    return 0;
  }
}
