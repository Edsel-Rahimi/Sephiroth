import { getTelegramSettings, getTelegramToken, type TelegramNotify } from "@/lib/settings";
import { sendMessage } from "@/lib/bot/api";
import { botTexts, fmt, fmtDays, fmtGb, type BotLang } from "@/lib/bot/texts";
import { fireWebhook } from "@/lib/webhooks"; // v2.7 — outbound webhook fan-out
import { relayDiscord } from "@/lib/bot/discord-worker"; // v2.7 — Discord relay

/* ============================================================
   Sephiroth · Task 23-a — Bot notification engine (server-only)

   One small engine that every panel event hook calls. Rules:
   • Fires ONLY when the bot is enabled, a token exists and the
     mode is "notify" or "sales" ("console" = test executor, no
     worker → no notifications).
   • Messages go to adminChatIds only, in the configured botLang.
   • Dedupe guard: per (kind + entity) minimum interval so bulk
     operations / cron ticks can never storm the admin chat.
   • Fire-and-forget safe: callers may await but no function ever
     throws — a broken Telegram network never breaks a panel route.
   ============================================================ */

export type NotifyKind =
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

/** Per-kind minimum interval between two messages with the same dedupe key. */
const MIN_INTERVAL_MS: Record<NotifyKind, number> = {
  "user.created": 5_000,
  "user.deleted": 5_000,
  "user.updated": 5_000,
  "user.expired": 30_000,
  "user.near-expiry": 20 * 3_600_000, // at most one “expires soon” ping per user per ~day
  "user.quota": 30_000,
  "user.traffic-reset": 30_000,
  "user.activated": 30_000,
  "user.renewed": 30_000,
  "login.failed": 10 * 60_000, // at most one failed-login alert per (user, ip) per 10 min
  "sales.digest": 60_000,
  "backup.done": 60_000,
  "panel.restart": 0,
  "inbound.created": 5_000,
  "inbound.deleted": 5_000,
};

const lastSent = new Map<string, number>();

function dedupe(kind: NotifyKind, entity: string): boolean {
  const key = `${kind}:${entity}`;
  const min = MIN_INTERVAL_MS[kind] ?? 5_000;
  const now = Date.now();
  const prev = lastSent.get(key) ?? 0;
  if (now - prev < min) return false;
  lastSent.set(key, now);
  // keep the map bounded
  if (lastSent.size > 500) {
    for (const [k, t] of lastSent) {
      if (now - t > 10 * 60_000) lastSent.delete(k);
    }
  }
  return true;
}

/** Which settings toggle (if any) gates this kind. */
const TOGGLE_MAP: Partial<Record<NotifyKind, keyof TelegramNotify>> = {
  "user.created": "userCreated",
  "user.deleted": "userCreated",
  "user.updated": "userCreated",
  "user.traffic-reset": "trafficAlert",
  "user.expired": "userExpired",
  "user.near-expiry": "userExpired",
  "user.quota": "userExpired",
  "user.activated": "userExpired",
  "user.renewed": "userExpired",
  "login.failed": "loginAlert",
  "sales.digest": "dailyDigest",
};

/**
 * Send one admin notification. Returns true when a message was
 * actually dispatched (dedupe + gate passed).
 *
 * v2.7 — dedupe runs first and the same event is relayed to the
 * Discord bot (relayDiscord) even when Telegram itself is off —
 * the two transports are independent.
 */
export async function tgNotify(
  kind: NotifyKind,
  text: string,
  opts?: { dedupeKey?: string }
): Promise<boolean> {
  try {
    if (!dedupe(kind, opts?.dedupeKey ?? "*")) return false;
    void relayDiscord(kind, text, { dedupeKey: opts?.dedupeKey });
    const tg = await getTelegramSettings();
    if (!tg.enabled || tg.botMode === "console" || tg.adminChatIds.length === 0) return false;
    if (TOGGLE_MAP[kind] && !tg.notify[TOGGLE_MAP[kind]!]) return false;
    const token = await getTelegramToken();
    if (!token) return false;
    for (const chatId of tg.adminChatIds) {
      await sendMessage(token, chatId, text, undefined, { proxyUrl: tg.botProxyUrl }).catch(() => {});
    }
    return true;
  } catch {
    return false; // never break the calling route
  }
}

function head(_lang: BotLang): string {
  return "🛰 <b>Sephiroth</b>"; // compact panel header (brand is Latin in every language)
}

function lang(): Promise<BotLang> {
  return getTelegramSettings().then((tg) => tg.botLang as BotLang);
}

/* ---------- typed event helpers (all fire-and-forget) ---------- */

export function notifyUserCreated(u: {
  username: string;
  trafficLimitGb: number | null;
  expiryDays: number | null;
}): Promise<boolean> {
  void fireWebhook("user.created", {
    username: u.username,
    trafficLimitGb: u.trafficLimitGb,
    expiryDays: u.expiryDays,
  });
  return lang().then((l) => {
    const t = botTexts(l);
    return tgNotify(
      "user.created",
      `${head(l)}\n${fmt(t.nUserCreated, { user: u.username, gb: fmtGb(u.trafficLimitGb), days: fmtDays(u.expiryDays) })}`,
      { dedupeKey: u.username }
    );
  });
}

export function notifyUserDeleted(username: string): Promise<boolean> {
  void fireWebhook("user.deleted", { username });
  return lang().then((l) =>
    tgNotify("user.deleted", `${head(l)}\n${fmt(botTexts(l).nUserDeleted, { user: username })}`, {
      dedupeKey: username,
    })
  );
}

export function notifyUserUpdated(username: string): Promise<boolean> {
  void fireWebhook("user.updated", { username });
  return lang().then((l) =>
    tgNotify("user.updated", `${head(l)}\n${fmt(botTexts(l).nUserUpdated, { user: username })}`, {
      dedupeKey: username,
    })
  );
}

export function notifyUserExpired(username: string): Promise<boolean> {
  void fireWebhook("user.expired", { username });
  return lang().then((l) =>
    tgNotify("user.expired", `${head(l)}\n${fmt(botTexts(l).nUserExpired, { user: username })}`, {
      dedupeKey: username,
    })
  );
}

export function notifyQuotaCapped(username: string, usedGb: number, limitGb: number): Promise<boolean> {
  void fireWebhook("user.quota", { username, usedGb, limitGb });
  return lang().then((l) => {
    const t = botTexts(l);
    return tgNotify(
      "user.quota",
      `${head(l)}\n${fmt(t.nQuotaCapped, { user: username, used: (Math.round(usedGb * 10) / 10).toString(), limit: fmtGb(limitGb) })}`,
      { dedupeKey: username }
    );
  });
}

export function notifyTrafficReset(username: string, period: string): Promise<boolean> {
  void fireWebhook("user.traffic-reset", { username, period });
  return lang().then((l) =>
    tgNotify("user.traffic-reset", `${head(l)}\n${fmt(botTexts(l).nTrafficReset, { user: username, period })}`, {
      dedupeKey: username,
    })
  );
}

export function notifyBackupDone(file: string, sizeBytes: number): Promise<boolean> {
  void fireWebhook("backup.done", { file, sizeBytes });
  return lang().then((l) =>
    tgNotify(
      "backup.done",
      `${head(l)}\n${fmt(botTexts(l).nBackupDone, { file, kb: String(Math.max(1, Math.round(sizeBytes / 1024))) })}`,
      { dedupeKey: file }
    )
  );
}

export function notifyPanelRestarted(version: string): Promise<boolean> {
  void fireWebhook("panel.restart", { version });
  return lang().then((l) =>
    tgNotify("panel.restart", `${head(l)}\n${fmt(botTexts(l).nRestart, { ver: version })}`)
  );
}

export function notifyInboundCreated(tag: string, proto: string, port: number): Promise<boolean> {
  void fireWebhook("inbound.created", { tag, protocol: proto, port });
  return lang().then((l) =>
    tgNotify("inbound.created", `${head(l)}\n${fmt(botTexts(l).nInboundCreated, { tag, proto, port })}`, {
      dedupeKey: tag,
    })
  );
}

export function notifyInboundDeleted(tag: string): Promise<boolean> {
  void fireWebhook("inbound.deleted", { tag });
  return lang().then((l) =>
    tgNotify("inbound.deleted", `${head(l)}\n${fmt(botTexts(l).nInboundDeleted, { tag })}`, {
      dedupeKey: tag,
    })
  );
}

/* ---------- wave 2 (26-a): login fail / near expiry / digest / on-hold / autorenew ---------- */

/** Fired from the login route on bad credentials / bad TOTP (gated by loginAlert). */
export function notifyLoginFailed(username: string, ip: string): Promise<boolean> {
  void fireWebhook("login.failed", { username, ip });
  return lang().then((l) =>
    tgNotify("login.failed", `${head(l)}\n${fmt(botTexts(l).nLoginFailed, { user: username || "?", ip })}`, {
      dedupeKey: `${username}@${ip}`,
    })
  );
}

/** Proactive “expires soon” ping — maintenance calls it with the whole-day remainder. */
export function notifyUserExpiringSoon(username: string, daysLeft: number): Promise<boolean> {
  void fireWebhook("user.near-expiry", { username, daysLeft });
  return lang().then((l) =>
    tgNotify("user.near-expiry", `${head(l)}\n${fmt(botTexts(l).nNearExpiry, { user: username, days: String(Math.max(1, daysLeft)) })}`, {
      dedupeKey: username,
    })
  );
}

/** Daily 24h digest — completed orders, revenue and new users (gated by dailyDigest). */
export function notifyDailyDigest(orders: number, revenueToman: number, newUsers: number): Promise<boolean> {
  void fireWebhook("sales.digest", { orders, revenueToman, newUsers });
  return lang().then((l) =>
    tgNotify(
      "sales.digest",
      `${head(l)}\n${fmt(botTexts(l).nDigest, {
        orders: String(orders),
        revenue: revenueToman.toLocaleString("en-US"),
        users: String(newUsers),
      })}`,
      { dedupeKey: "daily" }
    )
  );
}

/** On-hold user crossed their first connection — the clock started. */
export function notifyUserActivated(username: string, expiryDays: number): Promise<boolean> {
  void fireWebhook("user.activated", { username, expiryDays });
  return lang().then((l) =>
    tgNotify("user.activated", `${head(l)}\n${fmt(botTexts(l).nUserActivated, { user: username, days: fmtDays(expiryDays) })}`, {
      dedupeKey: username,
    })
  );
}

/** Auto-renew rolled the subscription window forward. */
export function notifyUserRenewed(username: string, renewals: number): Promise<boolean> {
  void fireWebhook("user.renewed", { username, renewals });
  return lang().then((l) =>
    tgNotify("user.renewed", `${head(l)}\n${fmt(botTexts(l).nUserRenewed, { user: username, renewals: String(renewals) })}`, {
      dedupeKey: username,
    })
  );
}
