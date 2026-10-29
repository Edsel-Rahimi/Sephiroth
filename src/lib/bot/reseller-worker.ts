import { db, type SaleTemplate, type TgUser } from "@/lib/db";
import {
  getGeneralSettings,
  getTelegramSettings,
} from "@/lib/settings";
import { logActivity, type ActivityKind } from "@/lib/activity";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  sendPhoto,
  setTgApiBase,
  tgApiBase,
  tgCall,
  type InlineKeyboard,
} from "@/lib/bot/api";
import {
  isProvisioningClaim,
  logOrderEvent,
  transitionOrder,
  consumeDiscountForOrder,
} from "@/lib/bot/orders";
import { provisionAndDeliverClaimed } from "@/lib/bot/sales-worker"; // task 3-1 — SAME delivery engine
import {
  BOT_LANG_LABELS,
  botTexts,
  fmt,
  fmtDays,
  fmtGb,
  fmtToman,
  type BotLang,
} from "@/lib/bot/texts";
import { zarinpalRequest, zarinpalStartPayUrl, zarinpalVerify } from "@/lib/bot/zarinpal";
import { ProxyAgent, fetch as undiciFetch } from "undici";

/* ============================================================
   Sephiroth · task 3-1 — Reseller bot worker (one bot PER reseller)

   Each reseller can plug their OWN bot token into the panel; this
   worker runs ONE long-poll instance per enabled reseller bot so
   they sell THEIR catalog (saleTemplate.resellerId) to THEIR
   customers (tgUser.resellerId) with THEIR payment gateway
   (reseller.pay* — never the owner's), while the owner keeps the
   main bot (sales-worker.ts — untouched, byte-identical behavior).

   Architecture (mirrors the main worker):
   • per-instance generation counters — settings changes kill the
     old loop at its next checkpoint, polls never crash the panel;
   • per-instance in-memory getUpdates offset + deleteWebhook
     drop on start (a restart never replays handled updates);
   • ctx reloaded per update (panel edits go live immediately);
   • 1s idle / 1s→5s→30s error backoff;
   • delivery/provisioning reuses provisionAndDeliverClaimed()
     imported from the main worker (SAME engine paths);
   • honest states everywhere: no token → stopped, bad token →
     error+getMe reason, no gateway → buy disabled + honest message.

   Scoping rules (see src/lib/resellers.ts):
   • catalog   = saleTemplate where resellerId == this reseller
   • customers = tgUser where resellerId == this reseller
   • orders    = tgOrder where resellerId == this reseller
   The owner's sweeps/receipt matcher filter resellerId:"" so the
   two commerce streams never cross-contaminate.

   Deliberately NOT in the reseller bot: admin dashboard, referral
   program, cart, crypto/Stars/wallet payments (reseller gateway =
   card-to-card + ZarinPal only), owner referral rewards. Reseller
   admins manage everything from the panel; receipt review lands in
   the OWNER's admin chats (only place an approval can live).
   ============================================================ */

/* ---------- per-reseller context ---------- */

/** Full sales-WorkerCtx shape (so the imported delivery engine accepts it)
 *  plus the reseller scoping fields. Crypto/Stars/wallet are zeroed: a
 *  reseller bot never offers methods its own gateway can't settle. */
type RBotCtx = {
  token: string;
  proxyUrl: string;
  adminChatIds: string[];
  botLang: BotLang;
  publicHost: string;
  supportUrl: string;
  cardNumber: string;
  cardHolder: string;
  zarinpalMerchant: string;
  salesTemplateId: string;
  salesPayMode: "manual" | "zarinpal";
  nowpaymentsEnabled: boolean;
  nowpaymentsApiKey: string;
  nowpaymentsSandbox: boolean;
  nowpaymentsTomanPerUsd: number;
  starsEnabled: boolean;
  starsTomanPerStar: number;
  /* reseller scoping */
  resellerId: string;
  shopName: string; // brandName || reseller username — shown in branded texts
};

/** Load the context for one reseller bot (fresh on EVERY update so panel
 *  edits apply instantly). Returns null when the bot must not run: row gone,
 *  reseller disabled, botEnabled false or no token. */
async function loadRBotCtx(resellerId: string): Promise<RBotCtx | null> {
  const [row, tg, general] = await Promise.all([
    db.reseller.findUnique({ where: { id: resellerId } }),
    getTelegramSettings(),
    getGeneralSettings(),
  ]);
  if (!row || !row.enabled) return null;
  const token = (row.botToken ?? "").trim();
  if (!row.botEnabled || !token) return null;
  // the Bot API base setting is process-global (23-a) — keep it in sync even
  // when the owner's main worker is idle
  setTgApiBase(tg.botApiBase);
  return {
    token,
    proxyUrl: tg.botProxyUrl,
    // owner admins receive reseller receipt reviews ONLY (gated callbacks)
    adminChatIds: tg.adminChatIds,
    botLang: tg.botLang as BotLang,
    publicHost: general.publicHost.replace(/\/+$/, ""),
    supportUrl: general.subSupportUrl,
    cardNumber: row.payCardNumber ?? "",
    cardHolder: row.payCardHolder ?? "",
    zarinpalMerchant: row.payZarinpalMerchant ?? "",
    salesTemplateId: "",
    salesPayMode: "manual",
    nowpaymentsEnabled: false,
    nowpaymentsApiKey: "",
    nowpaymentsSandbox: false,
    nowpaymentsTomanPerUsd: 0,
    starsEnabled: false,
    starsTomanPerStar: 0,
    resellerId,
    shopName: (row.brandName || row.username || "Shop").slice(0, 48),
  };
}

/** ctx for the imported delivery engine — identical object (RBotCtx carries
 *  every WorkerCtx field, so no conversion is needed). */
function asDeliveryCtx(ctx: RBotCtx) {
  return ctx;
}

/* ---------- instance registry + honest status ---------- */

interface RInstance {
  gen: number; // bumped on every stop — kills in-flight loops at checkpoints
  stop: boolean;
  running: boolean;
  token: string;
  startedAt: string | null;
  lastPollAt: string | null;
  handled: number;
  errors: number;
  lastError: string;
  offset: number;
}

const instances = new Map<string, RInstance>();
let booting = false;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

const SWEEP_MS = 60_000;

export interface ResellerBotStatus {
  state: "running" | "stopped" | "error";
  reason: string;
  startedAt: string | null;
  lastPollAt: string | null;
  handledUpdates: number;
}

/** Honest status for the panel: stopped when disabled/no token (with the
 *  reason), error when getMe rejected the token or polling keeps failing. */
export function getResellerBotStatus(resellerId: string): ResellerBotStatus {
  const inst = instances.get(resellerId);
  if (!inst) {
    return { state: "stopped", reason: "not_started", startedAt: null, lastPollAt: null, handledUpdates: 0 };
  }
  if (inst.running) {
    return {
      state: "running",
      reason: inst.errors > 0 ? inst.lastError : "",
      startedAt: inst.startedAt,
      lastPollAt: inst.lastPollAt,
      handledUpdates: inst.handled,
    };
  }
  if (inst.lastError) {
    return { state: "error", reason: inst.lastError, startedAt: null, lastPollAt: inst.lastPollAt, handledUpdates: inst.handled };
  }
  return { state: "stopped", reason: "stopped", startedAt: null, lastPollAt: inst.lastPollAt, handledUpdates: inst.handled };
}

function logBot(
  kind: "reseller.bot.started" | "reseller.bot.stopped" | "reseller.bot.error" | "reseller.sale.completed",
  level: "info" | "success" | "warn" | "error",
  message: string,
  meta: Record<string, unknown>
): void {
  void logActivity({
    kind: kind as unknown as ActivityKind,
    level,
    actor: "reseller-bot",
    message,
    meta,
  }).catch(() => {});
}

/* ---------- lifecycle ---------- */

/**
 * Start (or restart) the bot of ONE reseller: probe the token with getMe
 * (caching the username on success, surfacing an honest error on failure),
 * then start the long-poll loop. Safe to call repeatedly — an existing
 * healthy instance with the same token is left alone.
 */
export async function startResellerBot(resellerId: string, opts?: { force?: boolean }): Promise<void> {
  const existing = instances.get(resellerId);
  const ctx = await loadRBotCtx(resellerId);
  const row = await db.reseller.findUnique({ where: { id: resellerId } });
  if (!row) {
    if (existing) stopResellerBot(resellerId, "deleted");
    return;
  }
  if (!ctx) {
    if (existing) stopResellerBot(resellerId, !row.botEnabled ? "disabled" : "no_token");
    return;
  }
  if (existing && existing.running && existing.token === ctx.token && !opts?.force) return;
  if (existing) stopResellerBot(resellerId, "restarting");

  // probe: getMe validates the token AND caches the @username for the panel
  let botUsername = "";
  try {
    const me = await tgCall(ctx.token, "getMe", {}, { proxyUrl: ctx.proxyUrl, timeoutMs: 12_000 });
    botUsername = typeof me?.username === "string" ? me.username : "";
    await db.reseller.update({ where: { id: resellerId }, data: { botUsername } });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    instances.set(resellerId, {
      gen: (existing?.gen ?? 0) + 1,
      stop: true,
      running: false,
      token: ctx.token,
      startedAt: null,
      lastPollAt: null,
      handled: 0,
      errors: 1,
      lastError: `getMe failed: ${reason}`,
      offset: 0,
    });
    logBot("reseller.bot.error", "error", `Reseller bot "${row.username}" failed to start: getMe rejected the token (${reason})`, {
      resellerId,
      reason,
    });
    return;
  }

  // officially drop any webhook backlog so a restart never replays old commands
  try {
    await tgCall(ctx.token, "deleteWebhook", { drop_pending_updates: true }, { proxyUrl: ctx.proxyUrl });
  } catch {
    /* fine — polling still works */
  }

  const gen = (existing?.gen ?? 0) + 1;
  instances.set(resellerId, {
    gen,
    stop: false,
    running: true,
    token: ctx.token,
    startedAt: new Date().toISOString(),
    lastPollAt: null,
    handled: 0,
    errors: 0,
    lastError: "",
    offset: 0,
  });
  logBot("reseller.bot.started", "success", `Reseller bot "${row.username}" (@${botUsername}) started polling (generation ${gen})`, {
    resellerId,
    botUsername,
    generation: gen,
  });
  void pollLoop(resellerId, gen);
  ensureSweepTimer();
}

/** Stop one instance (generation bump kills the loop at its next checkpoint). */
export function stopResellerBot(resellerId: string, reason: string): void {
  const inst = instances.get(resellerId);
  if (!inst) return;
  inst.stop = true;
  inst.running = false;
  inst.gen += 1;
  instances.set(resellerId, inst);
  if (reason !== "restarting" && reason !== "deleted") {
    logBot("reseller.bot.stopped", "info", `Reseller bot instance stopped (${reason})`, { resellerId, reason });
  }
}

/** Boot hook — start every reseller bot that is enabled + has a token. */
export async function resellerBotsBoot(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    const rows = await db.reseller.findMany({ where: { botEnabled: true } });
    for (const row of rows) {
      if (!(row.botToken ?? "").trim()) continue;
      await startResellerBot(row.id).catch((err) =>
        console.warn(`[reseller-bot] boot failed for ${row.username}:`, err)
      );
    }
    ensureSweepTimer();
  } finally {
    booting = false;
  }
}

/** Shutdown hook — kill every instance. */
export function resellerBotsShutdown(): void {
  for (const id of Array.from(instances.keys())) stopResellerBot(id, "shutdown");
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  console.log("[reseller-bot] all instances stopped");
}

/* ---------- long-poll loop (per instance) ---------- */

async function pollLoop(resellerId: string, gen: number): Promise<void> {
  let backoffMs = 0;
  let consecutiveErrors = 0;
  for (;;) {
    const inst = instances.get(resellerId);
    if (!inst || inst.stop || gen !== inst.gen) return;
    try {
      const ctx = await loadRBotCtx(resellerId);
      if (!ctx) {
        // settings flipped off mid-flight — die cleanly like a generation stop
        stopResellerBot(resellerId, "settings_changed");
        return;
      }
      const updates = await getUpdatesBatch(ctx, inst.offset);
      const inst2 = instances.get(resellerId);
      if (!inst2 || inst2.stop || gen !== inst2.gen) return;
      inst2.lastPollAt = new Date().toISOString();
      if (consecutiveErrors > 0) {
        consecutiveErrors = 0;
        backoffMs = 0;
      }
      for (const update of updates) {
        const cur = instances.get(resellerId);
        if (!cur || cur.stop || gen !== cur.gen) return;
        try {
          await handleUpdateFor(ctx, update);
        } catch (err) {
          console.warn("[reseller-bot] update handling error:", err);
        } finally {
          const c2 = instances.get(resellerId);
          if (c2) {
            c2.handled += 1;
            if (typeof update.update_id === "number" && update.update_id >= 0) {
              c2.offset = update.update_id + 1;
            }
          }
        }
      }
      await sleep(backoffMs || 1000);
    } catch (err) {
      consecutiveErrors += 1;
      const cur = instances.get(resellerId);
      if (cur) {
        cur.errors += 1;
        cur.lastError = err instanceof Error ? err.message : String(err);
      }
      // 1s → 5s → 30s → 30s … — never crash the panel
      backoffMs = consecutiveErrors === 1 ? 1000 : consecutiveErrors === 2 ? 5000 : 30_000;
      console.warn(`[reseller-bot] poll error (x${consecutiveErrors}) — retry in ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
}

async function getUpdatesBatch(ctx: RBotCtx, offset: number): Promise<TgUpdate[]> {
  const params = new URLSearchParams({
    timeout: "25",
    offset: String(offset),
    allowed_updates: '["message","callback_query"]', // reseller shops take no Stars pre-checkouts
  });
  const url = `${tgApiBase()}/bot${ctx.token}/getUpdates?${params.toString()}`;
  const dispatcher = proxyFor(ctx.proxyUrl);
  const init: Record<string, unknown> = { signal: AbortSignal.timeout(35_000) };
  if (dispatcher) init.dispatcher = dispatcher;
  const res = await (dispatcher
    ? undiciFetch(url, init as Parameters<typeof undiciFetch>[1])
    : fetch(url, init as RequestInit));
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: TgUpdate[];
  };
  if (!res.ok || !data.ok) {
    throw new Error(`getUpdates failed: HTTP ${res.status}${data.description ? ` (${data.description})` : ""}`);
  }
  return Array.isArray(data.result) ? data.result : [];
}

/* --- proxy-aware fetch (same pattern as api.ts / sales-worker) --- */

const agentCache = new Map<string, ProxyAgent>();
function proxyFor(proxyUrl: string): ProxyAgent | undefined {
  const url = proxyUrl.trim();
  if (!url) return undefined;
  let agent = agentCache.get(url);
  if (!agent) {
    agent = new ProxyAgent(url);
    agentCache.set(url, agent);
  }
  return agent;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------- Telegram update shapes (subset, mirrors sales-worker) ---------- */

interface TgUserFrom {
  id: number;
  username?: string;
  first_name?: string;
  is_bot?: boolean;
}
interface TgMessage {
  message_id: number;
  from?: TgUserFrom;
  chat: { id: number; type?: string };
  text?: string;
  photo?: { file_id: string }[];
}
interface TgCallback {
  id: string;
  from: TgUserFrom;
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
}

/* ---------- tgUser (scoped) ---------- */

/** Upsert the bot-side profile. NEW rows are stamped with THIS reseller id;
 *  existing rows keep their owner (first attribution wins — the main bot or
 *  another reseller shop never loses a customer to a later /start). */
async function upsertTgUser(ctx: RBotCtx, from: TgUserFrom): Promise<[TgUser, boolean]> {
  const tgId = String(from.id);
  const existing = await db.tgUser.findUnique({ where: { tgId } });
  if (existing) {
    const username = from.username ? `@${from.username}` : from.first_name || existing.tgUsername;
    if (username !== existing.tgUsername) {
      await db.tgUser.update({ where: { tgId }, data: { tgUsername: username } });
    }
    return [existing, false];
  }
  const row = await db.tgUser.create({
    data: {
      tgId,
      tgUsername: from.username ? `@${from.username}` : from.first_name || "",
      lang: ctx.botLang,
      banned: false,
      resellerId: ctx.resellerId,
    },
  });
  return [row, true];
}

/* ---------- helpers ---------- */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function menuBackKeyboard(backLabel: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: backLabel, callback_data: "menu" }]] };
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Catalog scoping — ONLY this reseller's templates reach their shop. */
async function shopTemplates(ctx: RBotCtx): Promise<SaleTemplate[]> {
  return db.saleTemplate.findMany({
    where: { enabled: true, botVisible: true, resellerId: ctx.resellerId },
    orderBy: { createdAt: "asc" },
  });
}

/** True when the reseller's own gateway can settle SOMETHING (never the
 *  owner's — no silent fallback, ever). */
function gatewayReady(ctx: RBotCtx): boolean {
  return Boolean(ctx.zarinpalMerchant) || Boolean(ctx.cardNumber && ctx.cardHolder);
}

/* ---------- update router ---------- */

async function handleUpdateFor(ctx: RBotCtx, update: TgUpdate): Promise<void> {
  // (stars never exist in reseller shops — pre_checkout updates are not even subscribed)
  const cb = update.callback_query;
  const msg = update.message;
  const from = cb?.from ?? msg?.from;
  if (!from || from.is_bot) return;

  const fromId = String(from.id);
  const chatId = String(cb?.message?.chat?.id ?? msg?.chat?.id ?? from.id);

  const [tgUser, isNew] = await upsertTgUser(ctx, from);

  // minimal abuse gate — banned users get one notice then silence (the
  // force-channel membership rule is the owner's main-bot policy)
  if (tgUser.banned) {
    const t = botTexts(((tgUser.lang as BotLang) ?? ctx.botLang) as BotLang);
    const text = tgUser.banReason ? fmt(t.abuseBannedReason, { reason: tgUser.banReason }) : t.abuseBanned;
    await sendMessage(ctx.token, chatId, text, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    return;
  }

  if (cb) {
    await answerCallbackQuery(ctx.token, cb.id, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    await handleCallback(ctx, cb, fromId, isNew);
    return;
  }
  if (msg) {
    await handleMessage(ctx, msg, fromId, chatId, isNew);
  }
}

/* ---------- message handling ---------- */

const ADMIN_COMMANDS = new Set([
  "/admin",
  "/help",
  "/status",
  "/users",
  "/inbounds",
  "/user",
  "/backup_now",
  "/adduser",
  "/credit",
]);

async function handleMessage(
  ctx: RBotCtx,
  msg: TgMessage,
  fromId: string,
  chatId: string,
  isNewTgUser: boolean
): Promise<void> {
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const lang = ((tgRow?.lang as BotLang) ?? ctx.botLang) as BotLang;
  const t = botTexts(lang);

  // receipt photo for a pending card order (scoped to THIS shop)
  if (msg.photo && msg.photo.length > 0) {
    await handleReceiptPhoto(ctx, msg, fromId, chatId, lang);
    return;
  }

  const text = (msg.text ?? "").trim();
  const firstToken = text.split(/[\s@]+/, 1)[0] ?? "";
  const isCommand = firstToken.startsWith("/") && ADMIN_COMMANDS.has(firstToken.split("@")[0] ?? firstToken);
  if (isCommand) {
    // honest refusal — the reseller bot has no admin flows (panel only)
    await sendMessage(ctx.token, chatId, t.notAuthorized, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }

  if (text.startsWith("/start")) {
    if (!tgRow || isNewTgUser) {
      await sendLangPicker(ctx, chatId);
      return;
    }
    await sendMenu(ctx, chatId, lang);
    return;
  }

  // any other text → the menu (gentle, no state machine needed)
  await sendMenu(ctx, chatId, lang);
}

async function sendLangPicker(ctx: RBotCtx, chatId: string): Promise<void> {
  const t = botTexts(ctx.botLang);
  const entries = Object.entries(BOT_LANG_LABELS) as [BotLang, string][];
  await sendMessage(
    ctx.token,
    chatId,
    t.pickLang,
    {
      inline_keyboard: [
        entries.slice(0, 3).map(([code, label]) => ({ text: label, callback_data: `lang:${code}` })),
        entries.slice(3).map(([code, label]) => ({ text: label, callback_data: `lang:${code}` })),
      ],
    },
    { proxyUrl: ctx.proxyUrl }
  );
}

/** Branded main menu — shop / subs / wallet / support. NO admin dashboard,
 *  NO referral (reseller admins use the panel; the program is the owner's). */
async function sendMenu(ctx: RBotCtx, chatId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  await sendMessage(
    ctx.token,
    chatId,
    fmt(t.rbMenu, { shop: esc(ctx.shopName) }),
    {
      inline_keyboard: [
        [{ text: t.btnShop, callback_data: "shop" }],
        [{ text: t.btnSubs, callback_data: "subs" }, { text: t.btnWallet, callback_data: "wallet" }],
        [{ text: t.btnSupport, callback_data: "support" }],
      ],
    },
    { proxyUrl: ctx.proxyUrl }
  );
}

/* ---------- callback handling ---------- */

async function handleCallback(
  ctx: RBotCtx,
  cb: TgCallback,
  fromId: string,
  _isNew: boolean
): Promise<void> {
  const data = cb.data ?? "";
  const chatId = String(cb.message?.chat?.id ?? fromId);

  // receipt review — OWNER admins only (the buttons live in their chats;
  // the gate re-checks on every tap so a replayed callback_data is dead)
  if (data.startsWith("ok:") || data.startsWith("no:")) {
    const tgRowG = await db.tgUser.findUnique({ where: { tgId: fromId } });
    const settings = await getTelegramSettings();
    if (!settings.adminChatIds.includes(fromId)) {
      const ta = botTexts(((tgRowG?.lang as BotLang) ?? ctx.botLang) as BotLang);
      await answerCallbackQuery(ctx.token, cb.id, ta.notAuthorized, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      return;
    }
    await adminReviewOrder(ctx, chatId, cb.message?.message_id ?? 0, data.slice(3), data.startsWith("ok:"));
    return;
  }

  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const lang = ((tgRow?.lang as BotLang) ?? ctx.botLang) as BotLang;
  const t = botTexts(lang);

  if (data.startsWith("lang:")) {
    const code = data.slice(5);
    const next = (Object.keys(BOT_LANG_LABELS) as BotLang[]).includes(code as BotLang) ? (code as BotLang) : ctx.botLang;
    await db.tgUser.update({ where: { tgId: fromId }, data: { lang: next } });
    await sendMenu(ctx, chatId, next);
    return;
  }
  if (data === "menu") {
    await sendMenu(ctx, chatId, lang);
    return;
  }
  if (data === "shop") {
    await sendShop(ctx, chatId, lang);
    return;
  }
  if (data.startsWith("tpl:")) {
    await sendTemplateDetail(ctx, chatId, lang, fromId, data.slice(4));
    return;
  }
  if (data.startsWith("free:")) {
    await fulfillFreeOrder(ctx, chatId, fromId, lang, data.slice(5));
    return;
  }
  if (data.startsWith("pay:")) {
    // pay:<templateId>:z|c — reseller gateway only (no wallet/crypto/stars)
    const [, orderId, method] = data.split(":");
    const m = method === "z" ? "zarinpal" : "card";
    await startPayment(ctx, chatId, fromId, lang, orderId, m);
    return;
  }
  if (data === "wallet") {
    // minimal wallet — the reseller-scoped balance view (no top-up flows here)
    const tgRowW = await db.tgUser.findUnique({ where: { tgId: fromId } });
    const balance = Math.max(0, Math.floor(Number(tgRowW?.balanceToman ?? 0)));
    await sendMessage(
      ctx.token,
      chatId,
      fmt(t.walletView, { balance: fmtToman(balance) }),
      menuBackKeyboard(t.backMenu),
      { proxyUrl: ctx.proxyUrl }
    );
    return;
  }
  if (data.startsWith("ren:")) {
    await sendRenewPicker(ctx, cb, chatId, fromId, lang, data.slice(4));
    return;
  }
  if (data.startsWith("rt:")) {
    const [, subId, idxStr] = data.split(":");
    await sendRenewPaymentPicker(ctx, cb, chatId, fromId, lang, subId, Number(idxStr));
    return;
  }
  if (data.startsWith("rtp:")) {
    const [, subId, idxStr, m] = data.split(":");
    const method = m === "z" ? "zarinpal" : "card";
    await startRenewPayment(ctx, chatId, fromId, lang, subId, Number(idxStr), method);
    return;
  }
  if (data === "subs") {
    await sendMySubscriptions(ctx, chatId, fromId, lang);
    return;
  }
  if (data === "support") {
    const contact =
      (await db.serverSetting.findUnique({ where: { key: "set_tg_chat_id" } }))?.value || ctx.supportUrl || "@sephiroth";
    await sendMessage(ctx.token, chatId, fmt(t.support, { contact }), menuBackKeyboard(t.backMenu), {
      proxyUrl: ctx.proxyUrl,
    });
    return;
  }
  if (data === "checkpay") {
    await sendMessage(ctx.token, chatId, t.checkHint, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }
  // unknown / legacy callbacks (noop: etc.) → silence
}

/* ---------- shop ---------- */

async function sendShop(ctx: RBotCtx, chatId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  const templates = await shopTemplates(ctx);
  if (templates.length === 0) {
    await sendMessage(ctx.token, chatId, t.shopEmpty, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const rows = templates.slice(0, 12).map((tpl) => ({
    text:
      tpl.priceToman > 0
        ? `${tpl.name} · ${fmtToman(tpl.priceToman)} T`
        : `${tpl.name} · ${t.tplFree}`,
    callback_data: `tpl:${tpl.id}`,
  }));
  await sendMessage(
    ctx.token,
    chatId,
    fmt(t.rbShopTitle, { shop: esc(ctx.shopName) }),
    {
      inline_keyboard: [
        ...chunk(rows, 2),
        [{ text: t.backMenu, callback_data: "menu" }],
      ],
    },
    { proxyUrl: ctx.proxyUrl }
  );
}

async function sendTemplateDetail(
  ctx: RBotCtx,
  chatId: string,
  lang: BotLang,
  fromId: string,
  templateId: string
): Promise<void> {
  const t = botTexts(lang);
  const tpl = await db.saleTemplate.findUnique({ where: { id: templateId } });
  // SCOPING: a template is only purchasable from the shop it belongs to
  if (!tpl || !tpl.enabled || !tpl.botVisible || tpl.resellerId !== ctx.resellerId) {
    await sendMessage(ctx.token, chatId, t.shopEmpty, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const price = tpl.priceToman > 0 ? `${fmtToman(tpl.priceToman)} Toman` : t.tplFree;
  const text = fmt(t.tplLine, {
    name: tpl.name,
    gb: fmtGb(tpl.trafficLimitGb),
    days: fmtDays(tpl.expiryDays),
    ip: tpl.ipLimit === 0 ? "∞" : String(tpl.ipLimit),
    price,
  });

  if (tpl.priceToman === 0) {
    await sendMessage(
      ctx.token,
      chatId,
      `${fmt(t.payPicker, { name: tpl.name, price })}\n\n${text}`,
      {
        inline_keyboard: [
          [{ text: t.btnTrial, callback_data: `free:${tpl.id}` }],
          [{ text: t.backMenu, callback_data: "menu" }],
        ],
      },
      { proxyUrl: ctx.proxyUrl }
    );
    return;
  }

  // paid template — the reseller's OWN gateway leads the flow. Nothing
  // configured → the buy button is DISABLED with an honest message (never a
  // silent fall back to the owner's credentials).
  if (!gatewayReady(ctx)) {
    await sendMessage(
      ctx.token,
      chatId,
      `${fmt(t.payPicker, { name: tpl.name, price })}\n\n${text}\n\n${t.payUnavailable}`,
      menuBackKeyboard(t.backMenu),
      { proxyUrl: ctx.proxyUrl }
    );
    return;
  }

  const rows: { text: string; callback_data: string }[][] = [];
  const zarinReady = Boolean(ctx.zarinpalMerchant);
  if (zarinReady && ctx.cardNumber && ctx.cardHolder) {
    rows.push([
      { text: t.payZarin, callback_data: `pay:${tpl.id}:z` },
      { text: t.payCard, callback_data: `pay:${tpl.id}:c` },
    ]);
  } else if (zarinReady) {
    rows.push([{ text: t.payZarin, callback_data: `pay:${tpl.id}:z` }]);
  } else {
    rows.push([{ text: t.payCard, callback_data: `pay:${tpl.id}:c` }]);
  }
  rows.push([{ text: t.backMenu, callback_data: "menu" }]);
  await sendMessage(ctx.token, chatId, `${fmt(t.payPicker, { name: tpl.name, price })}\n\n${text}`, { inline_keyboard: rows }, { proxyUrl: ctx.proxyUrl });
}

/* ---------- payments (reseller gateway ONLY) ---------- */

async function startPayment(
  ctx: RBotCtx,
  chatId: string,
  fromId: string,
  lang: BotLang,
  templateId: string,
  method: "zarinpal" | "card"
): Promise<void> {
  const t = botTexts(lang);
  const tpl = await db.saleTemplate.findUnique({ where: { id: templateId } });
  if (!tpl || !tpl.enabled || !tpl.botVisible || tpl.priceToman <= 0 || tpl.resellerId !== ctx.resellerId) {
    await sendMessage(ctx.token, chatId, t.shopEmpty, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  if (!gatewayReady(ctx)) {
    await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const base = {
    tgId: fromId,
    tgUsername: tgRow?.tgUsername ?? "",
    templateId: tpl.id,
    templateName: tpl.name,
    amountToman: tpl.priceToman,
    resellerId: ctx.resellerId, // task 3-1 — attribution: this order belongs to THIS shop
  };

  if (method === "zarinpal") {
    if (!ctx.zarinpalMerchant) {
      await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
      return;
    }
    const callbackUrl = ctx.publicHost || "https://t.me";
    const req = await zarinpalRequest(ctx.zarinpalMerchant, tpl.priceToman, `${ctx.shopName} · ${tpl.name}`, callbackUrl);
    if (!req.ok || !req.authority) {
      const reason = req.ok ? `response missing authority (code ${req.code})` : req.reason;
      logBot("reseller.bot.error", "warn", `ZarinPal request failed for ${fromId} (${tpl.name}) in shop ${ctx.shopName}: ${reason}`, {
        resellerId: ctx.resellerId,
        templateId: tpl.id,
        amountToman: tpl.priceToman,
        reason,
      });
      await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
      return;
    }
    const order = await db.tgOrder.create({
      data: { ...base, method, status: "awaiting_payment", authority: req.authority },
    });
    await logOrderEvent(order, "created", "reseller bot · zarinpal request ok");
    await sendMessage(
      ctx.token,
      chatId,
      fmt(t.payZarinSent, { price: fmtToman(tpl.priceToman) }),
      {
        inline_keyboard: [
          [{ text: t.payZarin, url: zarinpalStartPayUrl(req.authority) }],
          [{ text: "🔄", callback_data: "checkpay" }],
          [{ text: t.backMenu, callback_data: "menu" }],
        ],
      },
      { proxyUrl: ctx.proxyUrl }
    );
    return;
  }

  // card-to-card — the reseller's OWN card; receipt photo flows through the
  // scoped handleReceiptPhoto below (matches THIS shop's pending orders only)
  if (!ctx.cardNumber || !ctx.cardHolder) {
    await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const order = await db.tgOrder.create({
    data: { ...base, method, status: "pending_manual" },
  });
  await logOrderEvent(order, "created", "reseller bot · awaiting receipt photo");
  await sendMessage(
    ctx.token,
    chatId,
    `${fmt(t.payCardInfo, {
      card: ctx.cardNumber,
      holder: ctx.cardHolder,
      price: fmtToman(tpl.priceToman),
    })}\n\n${t.payCardSendReceipt}`,
    menuBackKeyboard(t.backMenu),
    { proxyUrl: ctx.proxyUrl }
  );
}

async function handleReceiptPhoto(
  ctx: RBotCtx,
  msg: TgMessage,
  fromId: string,
  chatId: string,
  lang: BotLang
): Promise<void> {
  const t = botTexts(lang);
  const order = await db.tgOrder.findFirst({
    // SCOPED: only THIS shop's pending card orders match a receipt sent here
    where: { tgId: fromId, method: "card", status: "pending_manual", resellerId: ctx.resellerId },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    await sendMessage(ctx.token, chatId, t.noPendingReceipt, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }
  const photo = msg.photo ?? [];
  const fileId = photo.length > 0 ? photo[photo.length - 1]?.file_id ?? "" : "";
  const updated = await db.tgOrder.update({ where: { id: order.id }, data: { receiptFileId: fileId } });
  await logOrderEvent(updated, "receipt", "reseller bot · photo received");
  await sendMessage(ctx.token, chatId, t.receiptReceived, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });

  // review request → the OWNER's admin chats (the only approvers that exist);
  // buttons are re-gated on admin membership at tap time
  const kb: InlineKeyboard = {
    inline_keyboard: [
      [
        { text: "✅", callback_data: `ok:${order.id}` },
        { text: "❌", callback_data: `no:${order.id}` },
      ],
    ],
  };
  const caption = [
    `🧾 Receipt · shop <b>${esc(ctx.shopName)}</b> · order <code>${order.id.slice(-6)}</code>`,
    `user: ${order.tgUsername || order.tgId}`,
    `${order.templateName} · ${fmtToman(order.amountToman)} Toman`,
  ].join("\n");
  for (const adminId of ctx.adminChatIds) {
    await sendPhoto(ctx.token, adminId, fileId, caption, kb, { proxyUrl: ctx.proxyUrl }).catch(() => {});
  }
}

/* ---------- completion / delivery (SAME engine as the main bot) ---------- */

async function completeAndDeliver(ctx: RBotCtx, orderId: string, via: string): Promise<void> {
  const res = await transitionOrder(orderId, "completed");
  if (!res.ok) {
    if (res.reason === "terminal" && res.order && isProvisioningClaim(res.order)) {
      // claimed but provisioning crashed earlier — heal it
      await provisionAndDeliverClaimed(asDeliveryCtx(ctx), res.order);
    }
    return; // already completed/rejected → idempotent no-op
  }
  const order = res.order;
  await logOrderEvent(order, via === "zarinpal" ? "zarinpal_paid" : "completed", `via ${via} (reseller bot)`);
  // no cart/discounts in the reseller MVP — safe no-op kept for the SAME
  // completion semantics as the main engine
  await consumeDiscountForOrder(order);
  await provisionAndDeliverClaimed(asDeliveryCtx(ctx), order);
  logBot("reseller.sale.completed", "success", `Reseller sale completed — order ${order.id.slice(-6)} (${order.templateName}, ${fmtToman(order.amountToman)} Toman, via ${order.method}) in shop ${ctx.shopName}`, {
    resellerId: ctx.resellerId,
    orderId: order.id,
    tgId: order.tgId,
    amountToman: order.amountToman,
    method: order.method,
  });
}

/* ---------- free / trial fulfillment (scoped) ---------- */

async function fulfillFreeOrder(
  ctx: RBotCtx,
  chatId: string,
  fromId: string,
  lang: BotLang,
  templateId: string | null
): Promise<void> {
  const t = botTexts(lang);
  const free = templateId
    ? await db.saleTemplate.findFirst({
        where: { id: templateId, priceToman: 0, enabled: true, botVisible: true, resellerId: ctx.resellerId },
      })
    : await db.saleTemplate.findFirst({
        where: { priceToman: 0, enabled: true, botVisible: true, resellerId: ctx.resellerId },
        orderBy: { createdAt: "asc" },
      });
  if (!free) {
    await sendMessage(ctx.token, chatId, t.noTrial, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  // one free order per tg user PER SHOP (scoped — the main bot's trial budget is untouched)
  const claimed = await db.tgOrder.count({
    where: { tgId: fromId, amountToman: 0, status: "completed", resellerId: ctx.resellerId },
  });
  if (claimed > 0) {
    await sendMessage(ctx.token, chatId, t.trialLimit, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const order = await db.tgOrder.create({
    data: {
      tgId: fromId,
      tgUsername: tgRow?.tgUsername ?? "",
      templateId: free.id,
      templateName: free.name,
      amountToman: 0,
      method: "card", // free fulfillment — method is irrelevant, keep the union satisfied
      status: "awaiting_payment",
      resellerId: ctx.resellerId,
    },
  });
  await completeAndDeliver(ctx, order.id, "free");
}

/* ---------- renew / top-up (reseller catalog) ---------- */

async function resolveRenewTarget(
  ctx: RBotCtx,
  fromId: string,
  subId: string,
  index: number
): Promise<{ tpl: SaleTemplate } | null> {
  if (!Number.isInteger(index) || index < 0 || index > 99) return null;
  const user = await db.clientUser.findFirst({ where: { subId } });
  // SECURITY: the subscription MUST belong to the tapper
  if (!user || user.tgId !== fromId) return null;
  const templates = (await shopTemplates(ctx)).filter((tpl) => tpl.priceToman > 0);
  const tpl = templates[index];
  if (!tpl) return null;
  return { tpl };
}

async function sendRenewPicker(
  ctx: RBotCtx,
  cb: TgCallback,
  chatId: string,
  fromId: string,
  lang: BotLang,
  subId: string
): Promise<void> {
  const t = botTexts(lang);
  const user = await db.clientUser.findFirst({ where: { subId } });
  if (!user || user.tgId !== fromId) {
    await answerCallbackQuery(ctx.token, cb.id, t.notAuthorized, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    return;
  }
  const templates = (await shopTemplates(ctx)).filter((tpl) => tpl.priceToman > 0);
  if (templates.length === 0) {
    await sendMessage(ctx.token, chatId, t.renEmpty, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  if (!gatewayReady(ctx)) {
    await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const rows = templates.slice(0, 12).map((tpl, i) => ({
    text: `${tpl.name} · ${fmtToman(tpl.priceToman)} T`,
    callback_data: `rt:${subId}:${i}`,
  }));
  await sendMessage(
    ctx.token,
    chatId,
    fmt(t.renTitle, { user: user.username }),
    { inline_keyboard: [...chunk(rows, 2), [{ text: t.backMenu, callback_data: "menu" }]] },
    { proxyUrl: ctx.proxyUrl }
  );
}

async function sendRenewPaymentPicker(
  ctx: RBotCtx,
  cb: TgCallback,
  chatId: string,
  fromId: string,
  lang: BotLang,
  subId: string,
  index: number
): Promise<void> {
  const t = botTexts(lang);
  const resolved = await resolveRenewTarget(ctx, fromId, subId, index);
  if (!resolved) {
    await answerCallbackQuery(ctx.token, cb.id, t.notAuthorized, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    return;
  }
  const tpl = resolved.tpl;
  const rows: { text: string; callback_data: string }[][] = [];
  const zarinReady = Boolean(ctx.zarinpalMerchant);
  if (zarinReady && ctx.cardNumber && ctx.cardHolder) {
    rows.push([
      { text: t.payZarin, callback_data: `rtp:${subId}:${index}:z` },
      { text: t.payCard, callback_data: `rtp:${subId}:${index}:c` },
    ]);
  } else if (zarinReady) {
    rows.push([{ text: t.payZarin, callback_data: `rtp:${subId}:${index}:z` }]);
  } else {
    rows.push([{ text: t.payCard, callback_data: `rtp:${subId}:${index}:c` }]);
  }
  rows.push([{ text: t.backMenu, callback_data: "menu" }]);
  await sendMessage(
    ctx.token,
    chatId,
    fmt(t.payPicker, { name: tpl.name, price: `${fmtToman(tpl.priceToman)} Toman` }),
    { inline_keyboard: rows },
    { proxyUrl: ctx.proxyUrl }
  );
}

async function startRenewPayment(
  ctx: RBotCtx,
  chatId: string,
  fromId: string,
  lang: BotLang,
  subId: string,
  index: number,
  method: "zarinpal" | "card"
): Promise<void> {
  const t = botTexts(lang);
  const resolved = await resolveRenewTarget(ctx, fromId, subId, index);
  if (!resolved) {
    await sendMessage(ctx.token, chatId, t.notAuthorized, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  if (!gatewayReady(ctx)) {
    await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const tpl = resolved.tpl;
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const orderData = {
    tgId: fromId,
    tgUsername: tgRow?.tgUsername ?? "",
    templateId: tpl.id,
    templateName: tpl.name,
    amountToman: tpl.priceToman,
    renewTargetSubId: subId,
    resellerId: ctx.resellerId,
  };

  if (method === "zarinpal") {
    if (!ctx.zarinpalMerchant) {
      await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
      return;
    }
    const req = await zarinpalRequest(
      ctx.zarinpalMerchant,
      tpl.priceToman,
      `${ctx.shopName} · ${tpl.name}`,
      ctx.publicHost || "https://t.me"
    );
    if (!req.ok || !req.authority) {
      const reason = req.ok ? `response missing authority (code ${req.code})` : req.reason;
      logBot("reseller.bot.error", "warn", `ZarinPal renew request failed for ${fromId} (${tpl.name}) in shop ${ctx.shopName}: ${reason}`, {
        resellerId: ctx.resellerId,
        templateId: tpl.id,
        renewTargetSubId: subId,
        amountToman: tpl.priceToman,
        reason,
      });
      await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
      return;
    }
    const order = await db.tgOrder.create({
      data: { ...orderData, method, status: "awaiting_payment", authority: req.authority },
    });
    await logOrderEvent(order, "created", "reseller bot · zarinpal request ok (renew)");
    await sendMessage(
      ctx.token,
      chatId,
      fmt(t.payZarinSent, { price: fmtToman(tpl.priceToman) }),
      {
        inline_keyboard: [
          [{ text: t.payZarin, url: zarinpalStartPayUrl(req.authority) }],
          [{ text: "🔄", callback_data: "checkpay" }],
          [{ text: t.backMenu, callback_data: "menu" }],
        ],
      },
      { proxyUrl: ctx.proxyUrl }
    );
    return;
  }

  // card-to-card renew — scoped receipt matching (below)
  if (!ctx.cardNumber || !ctx.cardHolder) {
    await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const order = await db.tgOrder.create({ data: { ...orderData, method, status: "pending_manual" } });
  await logOrderEvent(order, "created", "reseller bot · awaiting receipt photo (renew)");
  await sendMessage(
    ctx.token,
    chatId,
    `${fmt(t.payCardInfo, {
      card: ctx.cardNumber,
      holder: ctx.cardHolder,
      price: fmtToman(tpl.priceToman),
    })}\n\n${t.payCardSendReceipt}`,
    menuBackKeyboard(t.backMenu),
    { proxyUrl: ctx.proxyUrl }
  );
}

/* ---------- my subscriptions ---------- */

async function sendMySubscriptions(ctx: RBotCtx, chatId: string, fromId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  const users = await db.clientUser.findMany({ where: { tgId: fromId }, orderBy: { createdAt: "desc" } });
  if (users.length === 0) {
    await sendMessage(ctx.token, chatId, t.subsEmpty, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const now = Date.now();
  const lines = users.map((u) => {
    const daysLeft =
      u.expiryDays !== null
        ? Math.max(0, Math.ceil((new Date(u.createdAt).getTime() + u.expiryDays * 86_400_000 - now) / 86_400_000))
        : "∞";
    const state = u.enabled ? "" : " · ⛔";
    return fmt(t.subsLine, {
      user: u.username,
      used: (Number(u.usedTrafficGb) || 0).toFixed(1),
      limit: fmtGb(u.trafficLimitGb),
      days: String(daysLeft),
      state,
    });
  });
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...users.slice(0, 6).map((u) => [
        ctx.publicHost
          ? { text: `${t.btnSubLink} · ${u.username}`, url: `${ctx.publicHost}/sub/${u.subId}` }
          : { text: `${t.btnSubLink} · ${u.username}`, callback_data: "menu" },
        { text: t.btnRenew, callback_data: `ren:${u.subId}` },
      ]),
      [{ text: t.backMenu, callback_data: "menu" }],
    ],
  };
  await sendMessage(ctx.token, chatId, `${t.subsTitle}\n\n${lines.join("\n")}`, keyboard, { proxyUrl: ctx.proxyUrl });
}

/* ---------- receipt review (owner admins) ---------- */

async function adminReviewOrder(
  ctx: RBotCtx,
  chatId: string,
  messageId: number,
  orderId: string,
  approve: boolean
): Promise<void> {
  if (approve) {
    await completeAndDeliver(ctx, orderId, "card-approve");
    // flip the receipt buttons so a second tap can never double-approve
    await editMessageText(
      ctx.token,
      chatId,
      messageId,
      `✅ Order <code>${orderId.slice(-6)}</code> approved.`,
      undefined,
      { proxyUrl: ctx.proxyUrl }
    ).catch(() => {});
  } else {
    const res = await transitionOrder(orderId, "rejected");
    if (res.ok) {
      // guard: only THIS shop's orders can be rejected from this bot
      if (res.order.resellerId !== ctx.resellerId) return;
      await logOrderEvent(res.order, "rejected", "reseller bot · owner-admin reject");
      const langRow = await db.tgUser.findUnique({ where: { tgId: res.order.tgId } });
      const t = botTexts(((langRow?.lang as BotLang) ?? ctx.botLang) as BotLang);
      await sendMessage(ctx.token, res.order.tgId, t.rejected, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      await editMessageText(
        ctx.token,
        chatId,
        messageId,
        `❌ Order <code>${orderId.slice(-6)}</code> rejected.`,
        undefined,
        { proxyUrl: ctx.proxyUrl }
      ).catch(() => {});
    }
  }
}

/* ---------- payment sweep (per-instance, reseller merchant) ---------- */

/** One 60s sweep across all running instances: verify awaiting ZarinPal
 *  orders with EACH shop's OWN merchant (the owner's sweep filters
 *  resellerId:"" — the two never overlap) and self-heal provisioning claims. */
async function sweepAll(): Promise<void> {
  for (const [resellerId, inst] of Array.from(instances.entries())) {
    if (!inst.running || inst.stop) continue;
    try {
      const ctx = await loadRBotCtx(resellerId);
      if (!ctx) continue;
      const orders = await db.tgOrder.findMany({
        where: { resellerId, method: "zarinpal", status: "awaiting_payment", authority: { not: "" } },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      for (const order of orders) {
        // 10s grace after creation so a just-issued authority isn't verified too early
        if (Date.now() - new Date(order.updatedAt).getTime() < 10_000) continue;
        const res = await zarinpalVerify(ctx.zarinpalMerchant, order.amountToman, order.authority);
        if (res.ok) {
          await completeAndDeliver(ctx, order.id, "zarinpal");
        }
      }
      // self-heal: completed orders whose provisioning claim never finished
      const stuck = (await db.tgOrder.findMany({
        where: { resellerId, status: "completed" },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }))
        .filter(isProvisioningClaim)
        .filter((o) => Date.now() - new Date(o.updatedAt).getTime() > 60_000);
      for (const order of stuck) {
        await provisionAndDeliverClaimed(asDeliveryCtx(ctx), order);
      }
    } catch (err) {
      console.warn(`[reseller-bot] sweep error for ${resellerId}:`, err);
    }
  }
}

function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void sweepAll();
  }, SWEEP_MS);
  sweepTimer.unref?.();
}
