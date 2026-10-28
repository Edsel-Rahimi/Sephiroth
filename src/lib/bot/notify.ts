import { getTelegramSettings, getTelegramToken, type TelegramNotify } from "@/lib/settings";
import { sendMessage } from "@/lib/bot/api";
import { botTexts, fmt, fmtDays, fmtGb, type BotLang } from "@/lib/bot/texts";

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
  | "user.quota"
  | "user.traffic-reset"
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
  "user.quota": 30_000,
  "user.traffic-reset": 30_000,
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
  "user.quota": "userExpired",
};

/**
 * Send one admin notification. Returns true when a message was
 * actually dispatched (dedupe + gate passed).
 */
export async function tgNotify(
  kind: NotifyKind,
  text: string,
  opts?: { dedupeKey?: string }
): Promise<boolean> {
  try {
    const tg = await getTelegramSettings();
    if (!tg.enabled || tg.botMode === "console" || tg.adminChatIds.length === 0) return false;
    if (TOGGLE_MAP[kind] && !tg.notify[TOGGLE_MAP[kind]!]) return false;
    const token = await getTelegramToken();
    if (!token) return false;
    if (!dedupe(kind, opts?.dedupeKey ?? "*")) return false;
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
  return lang().then((l) =>
    tgNotify("user.deleted", `${head(l)}\n${fmt(botTexts(l).nUserDeleted, { user: username })}`, {
      dedupeKey: username,
    })
  );
}

export function notifyUserUpdated(username: string): Promise<boolean> {
  return lang().then((l) =>
    tgNotify("user.updated", `${head(l)}\n${fmt(botTexts(l).nUserUpdated, { user: username })}`, {
      dedupeKey: username,
    })
  );
}

export function notifyUserExpired(username: string): Promise<boolean> {
  return lang().then((l) =>
    tgNotify("user.expired", `${head(l)}\n${fmt(botTexts(l).nUserExpired, { user: username })}`, {
      dedupeKey: username,
    })
  );
}

export function notifyQuotaCapped(username: string, usedGb: number, limitGb: number): Promise<boolean> {
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
  return lang().then((l) =>
    tgNotify("user.traffic-reset", `${head(l)}\n${fmt(botTexts(l).nTrafficReset, { user: username, period })}`, {
      dedupeKey: username,
    })
  );
}

export function notifyBackupDone(file: string, sizeBytes: number): Promise<boolean> {
  return lang().then((l) =>
    tgNotify(
      "backup.done",
      `${head(l)}\n${fmt(botTexts(l).nBackupDone, { file, kb: String(Math.max(1, Math.round(sizeBytes / 1024))) })}`,
      { dedupeKey: file }
    )
  );
}

export function notifyPanelRestarted(version: string): Promise<boolean> {
  return lang().then((l) =>
    tgNotify("panel.restart", `${head(l)}\n${fmt(botTexts(l).nRestart, { ver: version })}`)
  );
}

export function notifyInboundCreated(tag: string, proto: string, port: number): Promise<boolean> {
  return lang().then((l) =>
    tgNotify("inbound.created", `${head(l)}\n${fmt(botTexts(l).nInboundCreated, { tag, proto, port })}`, {
      dedupeKey: tag,
    })
  );
}

export function notifyInboundDeleted(tag: string): Promise<boolean> {
  return lang().then((l) =>
    tgNotify("inbound.deleted", `${head(l)}\n${fmt(botTexts(l).nInboundDeleted, { tag })}`, {
      dedupeKey: tag,
    })
  );
}
