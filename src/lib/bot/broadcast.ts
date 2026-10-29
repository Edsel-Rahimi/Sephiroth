import { db, type BroadcastJob } from "@/lib/db";
import { getTelegramSettings, getTelegramToken } from "@/lib/settings";
import { setTgApiBase, TgApiError, tgCall } from "@/lib/bot/api";
import { logActivity, type ActivityKind } from "@/lib/activity";

/* ============================================================
   Sephiroth · Task 2-e — Broadcast sender (fire-and-forget)

   Walks the chatId snapshot of a broadcastJob row and delivers
   the admin text to every eligible bot user through the SAME
   transport the sales-worker's apiCall wraps (tgCall — token,
   proxyUrl and botApiBase all come from the telegram settings,
   so a custom API base / HTTPS proxy applies identically).

   Rules:
   • the enqueueing request never awaits this loop
   • ≤20 msg/sec (≥50 ms gap between sends)
   • HTTP 429 → sleep retry_after (tgCall surfaces the HTTP
     status; the numeric parameters.retry_after is best-effort
     parsed from the description the transport preserves —
     "Too Many Requests: retry after N" — with a conservative
     5 s fallback when the number cannot be recovered)
   • the job row is re-read between sends, so /cancel takes
     effect within one message
   • counts are flushed to the store after EVERY send (the
     store's debounced writer coalesces the writes)
   • boot sweep: jobs stuck in "running" from a previous process
     are marked "interrupted" with their counts so far
   ============================================================ */

const SEND_GAP_MS = 50; // ≤20 msg/sec — Telegram's documented global cap
const RATE_LIMIT_FALLBACK_MS = 5_000; // 429 without a parseable retry_after
const KEEP_JOBS = 50; // history cap (mirrors the webhookDead cap-100 hygiene)

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** "Too Many Requests: retry after 26" → 26000 (0 = not parseable). */
function retryAfterFrom(err: unknown): number {
  if (err instanceof TgApiError && err.status === 429) {
    const m = /retry after (\d+)/i.exec(err.description ?? "");
    if (m) return Math.min(3600, Number(m[1]) || 0) * 1000;
    return RATE_LIMIT_FALLBACK_MS;
  }
  return 0;
}

/**
 * Called on worker boot (sales-worker.startSalesWorker): any job left in
 * "running" by a previous process is marked "interrupted" with its counts
 * so far — the UI then shows it as an honestly incomplete run.
 */
export async function markInterruptedBroadcasts(): Promise<number> {
  try {
    const stuck = await db.broadcastJob.findMany({ where: { status: "running" } });
    for (const job of stuck) {
      await db.broadcastJob.update({
        where: { id: job.id },
        data: { status: "interrupted", finishedAt: new Date() },
      });
    }
    return stuck.length;
  } catch (err) {
    console.warn("[telegram-broadcast] boot sweep failed:", err);
    return 0;
  }
}

/** Job DTO the API returns (dates serialized, targets trimmed for the UI). */
export function jobView(job: BroadcastJob): {
  id: string;
  text: string;
  parseMode: string;
  total: number;
  sent: number;
  failed: number;
  status: string;
  lastError: string;
  createdAt: string;
  finishedAt: string | null;
} {
  return {
    id: job.id,
    text: job.text,
    parseMode: job.parseMode,
    total: Array.isArray(job.targets) ? job.targets.length : 0,
    sent: Number(job.sent) || 0,
    failed: Number(job.failed) || 0,
    status: job.status,
    lastError: job.lastError ?? "",
    createdAt: new Date(job.createdAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
  };
}

/**
 * The async sender. Fire-and-forget — callers do `void runBroadcast(id)`.
 * Never throws (final failure is written into the job row instead).
 */
export async function runBroadcast(jobId: string): Promise<void> {
  let job: BroadcastJob | null = null;
  try {
    job = await db.broadcastJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    // honesty gate — the SAME enabled/mode/token checks the notify engine uses
    const tg = await getTelegramSettings();
    const token = await getTelegramToken();
    if (!tg.enabled || !token) {
      await db.broadcastJob.update({
        where: { id: jobId },
        data: {
          sent: 0,
          failed: job.targets.length,
          status: "done",
          lastError: "bot not configured",
          finishedAt: new Date(),
        },
      });
      await logActivity({
        kind: "broadcast.done" as unknown as ActivityKind,
        level: "error",
        actor: "bot",
        message: `Broadcast failed — bot not configured (${job.targets.length} targets)`,
        meta: { sent: 0, failed: job.targets.length, total: job.targets.length, reason: "bot_not_configured" },
      });
      return;
    }

    // transport parity with the worker: same botApiBase + proxy plumbing
    setTgApiBase(tg.botApiBase);

    const targets = Array.isArray(job.targets) ? job.targets : [];
    let sent = 0;
    let failed = 0;
    let lastError = "";

    for (const chatId of targets) {
      // cancellation is honored between sends (cancel endpoint flips the row)
      const fresh = await db.broadcastJob.findUnique({ where: { id: jobId } });
      if (!fresh || fresh.status !== "running") {
        await db.broadcastJob.update({
          where: { id: jobId },
          data: { sent, failed, ...(fresh?.finishedAt ? {} : { finishedAt: new Date() }) },
        }).catch(() => {});
        await logActivity({
          kind: "broadcast.done" as unknown as ActivityKind,
          level: "info",
          actor: "bot",
          message: `Broadcast ${fresh?.status ?? "stopped"} early — sent ${sent}, failed ${failed} of ${targets.length}`,
          meta: { sent, failed, total: targets.length, cancelled: true },
        });
        return;
      }

      try {
        await tgCall(token, "sendMessage", {
          chat_id: chatId,
          text: job.text,
          disable_web_page_preview: true,
          ...(job.parseMode === "MarkdownV2" ? { parse_mode: "MarkdownV2" } : {}),
        }, { proxyUrl: tg.botProxyUrl, timeoutMs: 15_000 });
        sent += 1;
      } catch (err) {
        failed += 1;
        lastError = err instanceof Error ? err.message : String(err);
        // one retry-after pause per 429, then keep going
        const waitMs = retryAfterFrom(err);
        if (waitMs > 0) {
          await db.broadcastJob.update({ where: { id: jobId }, data: { sent, failed, lastError } }).catch(() => {});
          await sleep(waitMs);
          continue;
        }
      }

      // flush counts every send (store writer debounces/coalesces)
      await db.broadcastJob.update({ where: { id: jobId }, data: { sent, failed, lastError } }).catch(() => {});
      await sleep(SEND_GAP_MS);
    }

    await db.broadcastJob.update({
      where: { id: jobId },
      data: { sent, failed, lastError, status: "done", finishedAt: new Date() },
    });
    await logActivity({
      kind: "broadcast.done" as unknown as ActivityKind,
      level: failed === 0 ? "success" : sent === 0 ? "error" : "warn",
      actor: "bot",
      message: `Broadcast done — sent ${sent}, failed ${failed} of ${targets.length}`,
      meta: { sent, failed, total: targets.length, parseMode: job.parseMode },
    });

    // history hygiene — keep only the newest KEEP_JOBS finished jobs
    const all = await db.broadcastJob.findMany({ orderBy: { createdAt: "desc" } });
    const stale = all.slice(KEEP_JOBS);
    for (const old of stale) {
      if (old.status !== "running") {
        await db.broadcastJob.delete({ where: { id: old.id } }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn("[telegram-broadcast] sender crashed:", err);
    try {
      await db.broadcastJob.update({
        where: { id: jobId },
        data: {
          status: "done",
          finishedAt: new Date(),
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
    } catch {
      /* row may be gone — nothing else to do */
    }
  }
}
