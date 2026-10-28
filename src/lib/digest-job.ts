import { db } from "@/lib/db";
import { notifyDailyDigest } from "@/lib/bot/notify";
import { getTelegramSettings } from "@/lib/settings";

/* ============================================================
   Sephiroth · 26-a — Daily sales digest (server-only)

   Once per 24h, aggregates the last 24 hours and pings the
   admin chat(s):
     • completed shop orders (tgOrder.status = "completed")
     • revenue (sum of amountToman over those orders)
     • new client users created in the window

   Mirrors backup-job.ts: guarded by a serverSetting timestamp
   so calling it every minute from the maintenance ticker is
   cheap (two indexed finds + one KV read when not due).
   Fire-and-forget safe — never throws.
   ============================================================ */

const DIGEST_LAST_KEY = "set_daily_digest_last";
const DAY_MS = 24 * 3_600_000;
/** small guard so clock jumps cannot double-send within the same hour */
const MIN_GAP_MS = 23 * 3_600_000;

export async function runDailySalesDigest(force = false): Promise<{ ran: boolean; reason?: string }> {
  try {
    const tg = await getTelegramSettings();
    if (!tg.enabled || tg.botMode === "console") return { ran: false, reason: "telegram_off" };
    if (!tg.notify.dailyDigest && !force) return { ran: false, reason: "toggle_off" };
    if (tg.adminChatIds.length === 0) return { ran: false, reason: "no_admin_chat" };

    const lastIso =
      (await db.serverSetting.findUnique({ where: { key: DIGEST_LAST_KEY } }))?.value ?? "";
    const last = lastIso ? Date.parse(lastIso) : 0;
    if (!force && last && Date.now() - last < MIN_GAP_MS) {
      return { ran: false, reason: "not_due" };
    }

    const since = new Date(Date.now() - DAY_MS);
    const [orders, newUsers] = await Promise.all([
      db.tgOrder.findMany({ where: { status: "completed", updatedAt: { gte: since } } }),
      db.clientUser.count({ where: { createdAt: { gte: since } } }),
    ]);

    const revenue = orders.reduce((sum, o) => sum + (Number(o.amountToman) || 0), 0);
    await notifyDailyDigest(orders.length, revenue, newUsers);
    await db.serverSetting.upsert({
      where: { key: DIGEST_LAST_KEY },
      create: { key: DIGEST_LAST_KEY, value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    });
    return { ran: true };
  } catch (err) {
    console.warn("[digest] daily sales digest failed:", err);
    return { ran: false, reason: "error" };
  }
}
