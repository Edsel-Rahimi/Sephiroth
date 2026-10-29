import { db, type ClientUser, type SaleTemplate, type TgOrder, type TgUser } from "@/lib/db";
import {
  appVersion,
  getBotOffset,
  getCoreSettings,
  getGeneralSettings,
  getPaymentSettings,
  getTelegramSettings,
  getTelegramToken,
  saveBotOffset,
} from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { stripUserEverywhere, syncUserProjection } from "@/lib/user-sync";
import { buildBackupPayload } from "@/app/api/settings/backup/route";
import { coreStatusPayload } from "@/lib/core/registry";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  answerCallbackQuery,
  editMessageText,
  sendChatAction,
  sendDocument,
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
  provisionOrderUser,
  transitionOrder,
} from "@/lib/bot/orders";
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

/* ============================================================
   Sephiroth · Task 23-c/23-a — Sephiroth Bot worker (Phase-1 MVP)

   In-process long-poll worker (design doc §E). Zero external
   services: the worker calls the same lib functions the API
   routes use (db / syncUserProjection / genAccessFields /
   buildBackupPayload / logActivity) — no HTTP hop.

   Lifecycle: startSalesWorker()/stopSalesWorker() driven by
   settings (botMode notify|sales + token). single-instance guard,
   sequential getUpdates (1s idle, error backoff 1s→5s→30s),
   offset persisted to the store (survives restarts), never
   crashes the panel.

   Modes (23-a):
   • console — legacy test executor only (no worker, no alerts)
   • notify  — worker: event notifications + admin commands
   • sales   — worker: everything above + the shop/payment flow

   Env overrides (documented, test-only):
   • SEPH_TG_API_BASE   — Bot API base (mock E2E harness)
   • SEPH_ZARINPAL_BASE — ZarinPal base (mock E2E harness)
   • SEPH_TG_PAY_POLL_MS — zarinpal verify poll interval (default 60s)
   ============================================================ */

/* ---------- status ---------- */

export interface SalesWorkerStatus {
  mode: "console" | "notify" | "sales";
  running: boolean;
  startedAt: string | null;
  lastPollAt: string | null;
  handledUpdates: number;
  errors: number;
  lastError: string;
}

const status: SalesWorkerStatus & { generation: number; stopRequested: boolean } = {
  mode: "console",
  running: false,
  startedAt: null,
  lastPollAt: null,
  handledUpdates: 0,
  errors: 0,
  lastError: "",
  generation: 0,
  stopRequested: false,
};

export function getSalesWorkerStatus(): SalesWorkerStatus {
  return {
    mode: status.mode,
    running: status.running,
    startedAt: status.startedAt,
    lastPollAt: status.lastPollAt,
    handledUpdates: status.handledUpdates,
    errors: status.errors,
    lastError: status.lastError,
  };
}

const PAY_POLL_MS = (() => {
  const raw = Number(process.env.SEPH_TG_PAY_POLL_MS);
  if (Number.isFinite(raw) && raw >= 5000) return raw;
  return 60_000;
})();

/* ---------- shared config snapshot ---------- */

interface WorkerCtx {
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
}

async function loadCtx(): Promise<WorkerCtx> {
  const [tg, general, payment] = await Promise.all([
    getTelegramSettings(),
    getGeneralSettings(),
    getPaymentSettings(),
  ]);
  const token = await getTelegramToken();
  // the botApiBase SETTING (23-a) drives every Bot API call
  setTgApiBase(tg.botApiBase);
  return {
    token,
    proxyUrl: tg.botProxyUrl,
    adminChatIds: tg.adminChatIds,
    botLang: tg.botLang as BotLang,
    publicHost: general.publicHost.replace(/\/+$/, ""),
    supportUrl: general.subSupportUrl,
    cardNumber: payment.cardNumber,
    cardHolder: payment.cardHolder,
    zarinpalMerchant: payment.zarinpalMerchant,
    salesTemplateId: tg.salesTemplateId,
    salesPayMode: tg.salesPayMode,
  };
}

/* ---------- lifecycle ---------- */

let payTimer: ReturnType<typeof setInterval> | null = null;
let booting = false;

/** Start the worker if settings say notify|sales mode + token present. Safe to call repeatedly. */
export async function startSalesWorker(): Promise<void> {
  if (status.running || booting) return;
  booting = true;
  try {
    const tg = await getTelegramSettings();
    status.mode = tg.botMode;
    const token = await getTelegramToken();
    if (tg.botMode === "console" || !token) return; // console mode or no token → stay idle
    if (tg.adminChatIds.length === 0) {
      console.warn("[telegram-bot] mode=" + tg.botMode + " but adminChatIds is empty — worker idle");
      return;
    }

    // Bot API base comes from the botApiBase setting (23-a)
    setTgApiBase(tg.botApiBase);

    // restore the persisted long-poll offset — a restart must never
    // replay updates that were already handled (23-a)
    offset = Math.max(offset, await getBotOffset());

    status.running = true;
    status.stopRequested = false;
    status.startedAt = new Date().toISOString();
    status.generation += 1;
    const gen = status.generation;

    // officially drop any webhook backlog so a restart never replays old commands
    try {
      await apiCall(ctx0(token, tg.botProxyUrl), "deleteWebhook", { drop_pending_updates: true });
    } catch {
      /* fine — polling still works */
    }

    console.log("[telegram-bot] worker started (mode", tg.botMode, ", generation", gen, ")");
    void pollLoop(gen);

    if (!payTimer) {
      payTimer = setInterval(() => {
        void verifyAwaitingZarinpal().catch((err) =>
          console.warn("[telegram-bot] zarinpal poll error:", err)
        );
      }, PAY_POLL_MS);
      payTimer.unref?.();
    }
  } finally {
    booting = false;
  }
}

export function stopSalesWorker(): void {
  if (!status.running) return;
  status.running = false;
  status.stopRequested = true;
  status.generation += 1; // kills any in-flight loop at its next checkpoint
  if (payTimer) {
    clearInterval(payTimer);
    payTimer = null;
  }
  // flush the offset so the next start resumes cleanly
  void saveBotOffset(offset).catch(() => {});
  console.log("[telegram-bot] worker stopped");
}

/** Called after the telegram settings are saved — re-syncs the worker. */
export async function onTelegramSettingsSaved(): Promise<void> {
  stopSalesWorker();
  await startSalesWorker();
}

/** Boot hook for server.ts: start on boot when settings say sales+token. */
export async function salesWorkerBoot(): Promise<void> {
  await startSalesWorker();
}

/** Shutdown hook for server.ts. */
export function salesWorkerShutdown(): void {
  stopSalesWorker();
}

function ctx0(token: string, proxyUrl: string): WorkerCtx {
  return {
    token,
    proxyUrl,
    adminChatIds: [],
    botLang: "fa",
    publicHost: "",
    supportUrl: "",
    cardNumber: "",
    cardHolder: "",
    zarinpalMerchant: "",
    salesTemplateId: "",
    salesPayMode: "manual",
  };
}

/* ---------- long-poll loop ---------- */

async function pollLoop(gen: number): Promise<void> {
  let backoffMs = 0; // 0 = no error yet → 1s idle between polls
  let consecutiveErrors = 0;

  while (status.running && gen === status.generation && !status.stopRequested) {
    try {
      const updates = await getUpdatesBatch();
      status.lastPollAt = new Date().toISOString();
      if (consecutiveErrors > 0) {
        consecutiveErrors = 0;
        backoffMs = 0;
      }
      for (const update of updates) {
        if (!status.running || gen !== status.generation) return;
        try {
          await handleUpdate(update);
        } catch (err) {
          console.warn("[telegram-bot] update handling error:", err);
        } finally {
          status.handledUpdates += 1;
          if (typeof update.update_id === "number" && update.update_id >= 0) {
            offset = update.update_id + 1;
          }
        }
      }
      if (updates.length > 0) {
        // persist the offset so a crash/restart never replays handled updates
        await saveBotOffset(offset).catch(() => {});
      }
      await sleep(backoffMs || 1000);
    } catch (err) {
      consecutiveErrors += 1;
      status.errors += 1;
      status.lastError = err instanceof Error ? err.message : String(err);
      // 1s → 5s → 30s → 30s … — never crash the panel
      backoffMs = consecutiveErrors === 1 ? 1000 : consecutiveErrors === 2 ? 5000 : 30_000;
      if (status.running) {
        console.warn(`[telegram-bot] poll error (x${consecutiveErrors}) — retry in ${backoffMs}ms`);
      }
      await sleep(backoffMs);
    }
  }
}

let offset = 0;

async function getUpdatesBatch(): Promise<TgUpdate[]> {
  const ctx = await loadCtx();
  if (!ctx.token) return [];
  const params = new URLSearchParams({
    timeout: "25",
    offset: String(offset),
    allowed_updates: '["message","callback_query"]',
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

/* --- proxy-aware fetch + Bot API base (same pattern as api.ts) --- */

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

async function apiCall(ctx: WorkerCtx, method: string, payload: Record<string, unknown>): Promise<any> {
  return tgCall(ctx.token, method, payload, { proxyUrl: ctx.proxyUrl });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------- Telegram update shapes (subset) ---------- */

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
  caption?: string;
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

/* ---------- tgUser helpers ---------- */

async function upsertTgUser(from: TgUserFrom, defaultLang: BotLang): Promise<[TgUser, boolean]> {
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
      lang: defaultLang,
      banned: false,
    },
  });
  return [row, true]; // created — first /start must show the language picker (§E)
}

/* ---------- main update router ---------- */

async function handleUpdate(update: TgUpdate): Promise<void> {
  const ctx = await loadCtx();
  if (!ctx.token) return;

  const cb = update.callback_query;
  const msg = update.message;
  const from = cb?.from ?? msg?.from;
  if (!from || from.is_bot) return;

  const fromId = String(from.id);
  const chatId = String(cb?.message?.chat?.id ?? msg?.chat?.id ?? from.id);
  const isAdmin = ctx.adminChatIds.includes(fromId);

  const [tgUser, isNewTgUser] = await upsertTgUser(from, ctx.botLang);
  if (tgUser.banned && !isAdmin) return; // banned users get nothing at all

  if (cb) {
    await answerCallbackQuery(ctx.token, cb.id, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    await handleCallback(ctx, cb, fromId, isAdmin);
    return;
  }
  if (msg) {
    await handleMessage(ctx, msg, fromId, chatId, isAdmin, isNewTgUser);
  }
}

/* ---------- admin command grammar (23-a) ---------- */

const ADMIN_COMMANDS = new Set([
  "/admin",
  "/help",
  "/status",
  "/users",
  "/inbounds",
  "/user",
  "/backup_now",
  "/adduser", // v2.8 — create a user from a template
  "/credit", // v2.8 — wallet balance adjustment
]);

function daysLeftFor(u: ClientUser): string {
  if (u.expiryDays === null || u.expiryDays === undefined) return "∞";
  const left = Math.ceil((new Date(u.createdAt).getTime() + u.expiryDays * 86_400_000 - Date.now()) / 86_400_000);
  return String(Math.max(0, left));
}

function stateMark(u: ClientUser): string {
  return u.enabled ? "" : " · ⛔";
}

/* ---------- message handling ---------- */

async function handleMessage(
  ctx: WorkerCtx,
  msg: TgMessage,
  fromId: string,
  chatId: string,
  isAdmin: boolean,
  isNewTgUser = false
): Promise<void> {
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const lang = ((tgRow?.lang as BotLang) ?? ctx.botLang) as BotLang;
  const t = botTexts(lang);

  // receipt photo for a pending card order?
  if (msg.photo && msg.photo.length > 0) {
    await handleReceiptPhoto(ctx, msg, fromId, chatId, lang);
    return;
  }

  const text = (msg.text ?? "").trim();
  const firstToken = text.split(/[\s@]+/, 1)[0] ?? "";
  const isCommand = firstToken.startsWith("/") && ADMIN_COMMANDS.has(firstToken.split("@")[0] ?? firstToken);

  if (isCommand && !isAdmin) {
    // polite refusal in the bot language — admin flows are adminChatIds-only
    await sendMessage(ctx.token, chatId, t.notAuthorized, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }

  if (isAdmin) {
    if (firstToken === "/admin") {
      await sendAdminDashboard(ctx, chatId, lang);
      return;
    }
    if (firstToken === "/help") {
      await sendMessage(ctx.token, chatId, t.help, undefined, { proxyUrl: ctx.proxyUrl });
      return;
    }
    if (firstToken === "/status") {
      await sendStatus(ctx, chatId, lang);
      return;
    }
    if (firstToken === "/users") {
      const n = Math.min(20, Math.max(1, Number(text.split(/\s+/)[1]) || 5));
      await sendUsersTop(ctx, chatId, lang, n);
      return;
    }
    if (firstToken === "/inbounds") {
      await sendInbounds(ctx, chatId, lang);
      return;
    }
    if (firstToken === "/user") {
      const query = text.slice(firstToken.length).trim();
      if (!query) {
        await sendMessage(ctx.token, chatId, t.userQueryHint, undefined, { proxyUrl: ctx.proxyUrl });
      } else {
        await sendUserCard(ctx, chatId, lang, query);
      }
      return;
    }
    if (firstToken === "/backup_now") {
      await sendBackupNow(ctx, chatId);
      return;
    }
    if (firstToken === "/adduser") {
      await adminAddUser(ctx, chatId, fromId, lang, text.slice(firstToken.length).trim());
      return;
    }
    if (firstToken === "/credit") {
      await adminCredit(ctx, chatId, lang, text.slice(firstToken.length).trim());
      return;
    }
  }

  if (text.startsWith("/start")) {
    if (!tgRow || isNewTgUser) { // brand-new user → language picker first (§E)
      await sendLangPicker(ctx, chatId);
      return;
    }
    await sendMenu(ctx, chatId, lang);
    return;
  }

  // any other text → the menu (gentle, no state machine needed)
  await sendMenu(ctx, chatId, lang);
}

async function sendLangPicker(ctx: WorkerCtx, chatId: string): Promise<void> {
  const t = botTexts(ctx.botLang);
  const entries = Object.entries(BOT_LANG_LABELS) as [BotLang, string][];
  await sendMessage(ctx.token, chatId, t.pickLang, {
    inline_keyboard: [
      entries.slice(0, 3).map(([code, label]) => ({ text: label, callback_data: `lang:${code}` })),
      entries.slice(3).map(([code, label]) => ({ text: label, callback_data: `lang:${code}` })),
    ],
  }, { proxyUrl: ctx.proxyUrl });
}

async function sendMenu(ctx: WorkerCtx, chatId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  await sendMessage(ctx.token, chatId, t.menu, {
    inline_keyboard: [
      [{ text: t.btnShop, callback_data: "shop" }],
      [{ text: t.btnSubs, callback_data: "subs" }, { text: t.btnTrial, callback_data: "trial" }],
      [{ text: t.btnWallet, callback_data: "wallet" }], // v2.8 — wallet view
      [{ text: t.btnSupport, callback_data: "support" }],
    ],
  }, { proxyUrl: ctx.proxyUrl });
}

/* ---------- callback handling ---------- */

async function handleCallback(
  ctx: WorkerCtx,
  cb: TgCallback,
  fromId: string,
  isAdmin: boolean
): Promise<void> {
  const data = cb.data ?? "";
  const chatId = String(cb.message?.chat?.id ?? fromId);

  // ---- admin-only callbacks (checked on EVERY callback — §D hardening) ----
  if (data.startsWith("ok:") || data.startsWith("no:")) {
    if (!isAdmin) return; // silently ignore (already answered)
    const orderId = data.slice(3);
    await adminReviewOrder(ctx, chatId, cb.message?.message_id ?? 0, orderId, data.startsWith("ok:"));
    return;
  }
  if (data.startsWith("useen:") || data.startsWith("usdis:") || data.startsWith("usreset:")) {
    if (!isAdmin) {
      const tgRowA = await db.tgUser.findUnique({ where: { tgId: fromId } });
      const ta = botTexts(((tgRowA?.lang as BotLang) ?? ctx.botLang) as BotLang);
      await answerCallbackQuery(ctx.token, cb.id, ta.notAuthorized, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      return;
    }
    const sep = data.indexOf(":");
    const action = data.slice(0, sep); // "useen" | "usdis" | "usreset"
    const userId = data.slice(sep + 1);
    await adminUserAction(ctx, cb, chatId, action, userId);
    return;
  }
  // v2.8 — admin user-card tools: delete (2-step) / apply-template / reset-devices
  if (
    data.startsWith("udel:") ||
    data.startsWith("udy:") ||
    data.startsWith("uap:") ||
    data.startsWith("uapt:") ||
    data.startsWith("ures:")
  ) {
    if (!isAdmin) {
      const tgRowA = await db.tgUser.findUnique({ where: { tgId: fromId } });
      const ta = botTexts(((tgRowA?.lang as BotLang) ?? ctx.botLang) as BotLang);
      await answerCallbackQuery(ctx.token, cb.id, ta.notAuthorized, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      return;
    }
    await handleAdminUserTools(ctx, cb, chatId, data);
    return;
  }
  if (data.startsWith("noop:")) {
    return; // label rows + cancel buttons carry no action
  }

  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const lang = ((tgRow?.lang as BotLang) ?? ctx.botLang) as BotLang;
  const t = botTexts(lang);

  if (data.startsWith("lang:")) {
    const code = data.slice(5);
    const next = (Object.keys(BOT_LANG_LABELS) as BotLang[]).includes(code as BotLang) ? (code as BotLang) : "fa";
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
    // pay:<templateId>:z|c|w
    const [, orderId, method] = data.split(":");
    const m = method === "z" ? "zarinpal" : method === "w" ? "wallet" : "card";
    await startPayment(ctx, chatId, fromId, lang, orderId, m);
    return;
  }
  if (data === "wallet") {
    await sendWalletView(ctx, chatId, fromId, lang);
    return;
  }
  if (data.startsWith("ren:")) {
    // ren:<subId> — renew picker (owner-only, checked inside)
    await sendRenewPicker(ctx, cb, chatId, fromId, lang, data.slice(4));
    return;
  }
  if (data.startsWith("rt:")) {
    // rt:<subId>:<index> — payment-method picker for a renewal
    const [, subId, idxStr] = data.split(":");
    await sendRenewPaymentPicker(ctx, cb, chatId, fromId, lang, subId, Number(idxStr));
    return;
  }
  if (data.startsWith("rtp:")) {
    // rtp:<subId>:<index>:z|c|w — launch the renewal payment
    const [, subId, idxStr, m] = data.split(":");
    const method = m === "z" ? "zarinpal" : m === "w" ? "wallet" : "card";
    await startRenewPayment(ctx, chatId, fromId, lang, subId, Number(idxStr), method);
    return;
  }
  if (data === "trial") {
    await fulfillFreeOrder(ctx, chatId, fromId, lang, null);
    return;
  }
  if (data === "subs") {
    await sendMySubscriptions(ctx, chatId, fromId, lang);
    return;
  }
  if (data === "support") {
    await sendSupport(ctx, chatId, lang);
    return;
  }
  if (data === "checkpay") {
    await sendMessage(ctx.token, chatId, t.checkHint, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }
}

/* ---------- shop ---------- */

async function shopTemplates(ctx: WorkerCtx) {
  // 23-a — an admin-pinned salesTemplateId shows ONLY that template;
  // empty = the whole active catalog. A stale pin falls back to the catalog.
  const where = { enabled: true, botVisible: true };
  if (ctx.salesTemplateId) {
    const pinned = await db.saleTemplate.findFirst({ where: { ...where, id: ctx.salesTemplateId } });
    if (pinned) return [pinned];
  }
  return db.saleTemplate.findMany({ where, orderBy: { createdAt: "asc" } });
}

async function sendShop(ctx: WorkerCtx, chatId: string, lang: BotLang): Promise<void> {
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
  await sendMessage(ctx.token, chatId, t.shopTitle, {
    inline_keyboard: [...chunk(rows, 2), [{ text: t.backMenu, callback_data: "menu" }]],
  }, { proxyUrl: ctx.proxyUrl });
}

function menuBackKeyboard(backLabel: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: backLabel, callback_data: "menu" }]] };
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function sendTemplateDetail(
  ctx: WorkerCtx,
  chatId: string,
  lang: BotLang,
  fromId: string,
  templateId: string
): Promise<void> {
  const t = botTexts(lang);
  const tpl = await db.saleTemplate.findUnique({ where: { id: templateId } });
  if (!tpl || !tpl.enabled || !tpl.botVisible) {
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

  let keyboard: InlineKeyboard;
  if (tpl.priceToman === 0) {
    keyboard = {
      inline_keyboard: [
        [{ text: t.btnTrial, callback_data: `free:${tpl.id}` }],
        [{ text: t.backMenu, callback_data: "menu" }],
      ],
    };
  } else {
    // 23-a — the salesPayMode setting leads the flow:
    //   manual    → card-to-card only
    //   zarinpal  → ZarinPal button (+ card stays available as the
    //               manual fallback the spec requires)
    const zarinReady = ctx.salesPayMode === "zarinpal" && Boolean(ctx.zarinpalMerchant);
    const rows: { text: string; callback_data: string }[][] = [];
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
    // v2.8 — wallet payment appears when the balance covers the price
    const tgRowW = await db.tgUser.findUnique({ where: { tgId: fromId } });
    const balance = Math.max(0, Math.floor(Number(tgRowW?.balanceToman ?? 0)));
    if (balance >= tpl.priceToman) {
      rows.push([{ text: t.btnWalletPay, callback_data: `pay:${tpl.id}:w` }]);
    }
    rows.push([{ text: t.backMenu, callback_data: "menu" }]);
    keyboard = { inline_keyboard: rows };
  }
  await sendMessage(ctx.token, chatId, `${fmt(t.payPicker, { name: tpl.name, price })}\n\n${text}`, keyboard, { proxyUrl: ctx.proxyUrl });
}

/* ---------- payments ---------- */

async function startPayment(
  ctx: WorkerCtx,
  chatId: string,
  fromId: string,
  lang: BotLang,
  templateId: string,
  method: "zarinpal" | "card" | "wallet"
): Promise<void> {
  const t = botTexts(lang);
  const tpl = await db.saleTemplate.findUnique({ where: { id: templateId } });
  if (!tpl || !tpl.enabled || !tpl.botVisible || tpl.priceToman <= 0) {
    await sendMessage(ctx.token, chatId, t.shopEmpty, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });

  // v2.8 — wallet: synchronous deduct (see payWithWallet) + instant delivery
  if (method === "wallet") {
    await payWithWallet(ctx, chatId, fromId, lang, tpl, null);
    return;
  }

  if (method === "zarinpal") {
    if (!ctx.zarinpalMerchant) {
      await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
      return;
    }
    const callbackUrl = ctx.publicHost || "https://t.me";
    const req = await zarinpalRequest(
      ctx.zarinpalMerchant,
      tpl.priceToman,
      `Sephiroth · ${tpl.name}`,
      callbackUrl
    );
    if (!req.ok || !req.authority) {
      // ternary narrows: ok:false → the failure variant (has .reason)
      const reason = req.ok
        ? `response missing authority (code ${req.code})`
        : req.reason;
      await logActivity({
        kind: "user.created",
        level: "warn",
        actor: "telegram-bot",
        message: `ZarinPal request failed for ${fromId} (${tpl.name}): ${reason}`,
        meta: { templateId: tpl.id, amountToman: tpl.priceToman },
      });
      await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
      return;
    }
    const order = await db.tgOrder.create({
      data: {
        tgId: fromId,
        tgUsername: tgRow?.tgUsername ?? "",
        templateId: tpl.id,
        templateName: tpl.name,
        amountToman: tpl.priceToman,
        method,
        status: "awaiting_payment",
        authority: req.authority,
      },
    });
    await logOrderEvent(order, "created", "zarinpal request ok");
    await notifyAdminsNewOrder(ctx, order);
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

  // card-to-card
  if (!ctx.cardNumber || !ctx.cardHolder) {
    await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const order = await db.tgOrder.create({
    data: {
      tgId: fromId,
      tgUsername: tgRow?.tgUsername ?? "",
      templateId: tpl.id,
      templateName: tpl.name,
      amountToman: tpl.priceToman,
      method,
      status: "pending_manual",
    },
  });
  await logOrderEvent(order, "created", "awaiting receipt photo");
  await notifyAdminsNewOrder(ctx, order);
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
  ctx: WorkerCtx,
  msg: TgMessage,
  fromId: string,
  chatId: string,
  lang: BotLang
): Promise<void> {
  const t = botTexts(lang);
  const order = await db.tgOrder.findFirst({
    where: { tgId: fromId, method: "card", status: "pending_manual" },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    await sendMessage(ctx.token, chatId, t.noPendingReceipt, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }
  // handleMessage only routes here with a photo attached — re-narrow locally
  const photo = msg.photo ?? [];
  const fileId = photo.length > 0 ? photo[photo.length - 1]?.file_id ?? "" : "";
  const updated = await db.tgOrder.update({ where: { id: order.id }, data: { receiptFileId: fileId } });
  await logOrderEvent(updated, "receipt", "photo received");
  await sendMessage(ctx.token, chatId, t.receiptReceived, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });

  // admin review: photo + approve/reject buttons
  const kb: InlineKeyboard = {
    inline_keyboard: [
      [
        { text: "✅", callback_data: `ok:${order.id}` },
        { text: "❌", callback_data: `no:${order.id}` },
      ],
    ],
  };
  const caption = [
    `🧾 Receipt · order <code>${order.id.slice(-6)}</code>`,
    `user: ${order.tgUsername || order.tgId}`,
    `${order.templateName} · ${fmtToman(order.amountToman)} Toman`,
  ].join("\n");
  for (const adminId of ctx.adminChatIds) {
    await sendPhoto(ctx.token, adminId, fileId, caption, kb, { proxyUrl: ctx.proxyUrl }).catch(() => {});
  }
}

/* ---------- wallet (v2.8) ---------- */

/** 💰 wallet view — current balance + honest MVP top-up hint. */
async function sendWalletView(ctx: WorkerCtx, chatId: string, fromId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  // balanceToman is OPTIONAL on TgUser (pre-v2.8 rows lack it) — always ?? 0
  const balance = Math.max(0, Math.floor(Number(tgRow?.balanceToman ?? 0)));
  await sendMessage(
    ctx.token,
    chatId,
    fmt(t.walletView, { balance: fmtToman(balance) }),
    menuBackKeyboard(t.backMenu),
    { proxyUrl: ctx.proxyUrl }
  );
}

/**
 * v2.8 — wallet payment for BOTH shop purchases (renewTargetSubId = null)
 * and subscription renewals.
 *
 * CRITICAL SECTION: the balance read below is the LAST await before the
 * balance write. The JSON-store delegates (db.ts) mutate their in-memory
 * state SYNCHRONOUSLY inside the async wrapper — no internal await before
 * the write — so read → check → deduct → order-create runs inside ONE
 * event-loop task with zero yield points. A double-tap re-enters only
 * AFTER the new balance has landed and sees the deducted value: exactly
 * the same no-yield discipline transitionOrder uses for its provisioning
 * claim in orders.ts. A crash between deduct and order-create loses the
 * order row (MVP: balance wins) but can never double-spend.
 */
async function payWithWallet(
  ctx: WorkerCtx,
  chatId: string,
  fromId: string,
  lang: BotLang,
  tpl: SaleTemplate,
  renewTargetSubId: string | null
): Promise<void> {
  const t = botTexts(lang);
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } }); // READ — last await before the write
  const balance = Math.max(0, Math.floor(Number(tgRow?.balanceToman ?? 0)));
  if (balance < tpl.priceToman) {
    await sendMessage(
      ctx.token,
      chatId,
      fmt(t.walletInsufficient, { balance: fmtToman(balance), price: fmtToman(tpl.priceToman) }),
      menuBackKeyboard(t.backMenu),
      { proxyUrl: ctx.proxyUrl }
    );
    return;
  }
  // ---- critical section: NO await between the read above and this write ----
  await db.tgUser.update({ where: { tgId: fromId }, data: { balanceToman: balance - tpl.priceToman } });
  const order = await db.tgOrder.create({
    data: {
      tgId: fromId,
      tgUsername: tgRow?.tgUsername ?? "",
      templateId: tpl.id,
      templateName: tpl.name,
      amountToman: tpl.priceToman,
      method: "wallet",
      status: "awaiting_payment",
      ...(renewTargetSubId ? { renewTargetSubId } : {}),
    },
  });
  await logOrderEvent(order, "created", "wallet debit ok");
  await sendMessage(
    ctx.token,
    chatId,
    fmt(t.walletPaid, { price: fmtToman(tpl.priceToman), balance: fmtToman(balance - tpl.priceToman) }),
    undefined,
    { proxyUrl: ctx.proxyUrl }
  ).catch(() => {});
  await completeAndDeliver(ctx, order.id, "wallet");
}

/* ---------- renew / top-up an existing subscription (v2.8) ---------- */

/**
 * The renewal catalog: paid + botVisible + enabled templates, in the SAME
 * deterministic order for BOTH the picker render and the tap handler, so
 * the array index embedded in callback_data stays meaningful.
 */
async function paidRenewTemplates(ctx: WorkerCtx): Promise<SaleTemplate[]> {
  const all = await shopTemplates(ctx);
  return all.filter((tpl) => tpl.priceToman > 0);
}

/** Shared guard for every renew tap: ownership re-check + index bounds. */
async function resolveRenewTarget(
  ctx: WorkerCtx,
  fromId: string,
  subId: string,
  index: number
): Promise<{ user: ClientUser; tpl: SaleTemplate } | null> {
  if (!Number.isInteger(index) || index < 0 || index > 99) return null;
  const user = await db.clientUser.findFirst({ where: { subId } });
  // SECURITY: the subscription MUST belong to the tapper
  if (!user || user.tgId !== fromId) return null;
  const templates = await paidRenewTemplates(ctx);
  const tpl = templates[index];
  if (!tpl) return null;
  return { user, tpl };
}

async function sendRenewPicker(
  ctx: WorkerCtx,
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
  const templates = await paidRenewTemplates(ctx);
  if (templates.length === 0) {
    await sendMessage(ctx.token, chatId, t.renEmpty, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  // index = position in paidRenewTemplates() — ≤ 2 digits, callback ≤ 23 bytes
  const rows = templates.slice(0, 12).map((tpl, i) => ({
    text: `${tpl.name} · ${fmtToman(tpl.priceToman)} T`,
    callback_data: `rt:${subId}:${i}`,
  }));
  await sendMessage(ctx.token, chatId, fmt(t.renTitle, { user: user.username }), {
    inline_keyboard: [...chunk(rows, 2), [{ text: t.backMenu, callback_data: "menu" }]],
  }, { proxyUrl: ctx.proxyUrl });
}

async function sendRenewPaymentPicker(
  ctx: WorkerCtx,
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
  const zarinReady = ctx.salesPayMode === "zarinpal" && Boolean(ctx.zarinpalMerchant);
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
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const balance = Math.max(0, Math.floor(Number(tgRow?.balanceToman ?? 0)));
  if (balance >= tpl.priceToman) {
    rows.push([{ text: t.btnWalletPay, callback_data: `rtp:${subId}:${index}:w` }]);
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
  ctx: WorkerCtx,
  chatId: string,
  fromId: string,
  lang: BotLang,
  subId: string,
  index: number,
  method: "zarinpal" | "card" | "wallet"
): Promise<void> {
  const t = botTexts(lang);
  const resolved = await resolveRenewTarget(ctx, fromId, subId, index);
  if (!resolved) {
    await sendMessage(ctx.token, chatId, t.notAuthorized, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const tpl = resolved.tpl;

  if (method === "wallet") {
    await payWithWallet(ctx, chatId, fromId, lang, tpl, subId);
    return;
  }

  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const orderData = {
    tgId: fromId,
    tgUsername: tgRow?.tgUsername ?? "",
    templateId: tpl.id,
    templateName: tpl.name,
    amountToman: tpl.priceToman,
    renewTargetSubId: subId,
  };

  if (method === "zarinpal") {
    if (!ctx.zarinpalMerchant) {
      await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
      return;
    }
    const req = await zarinpalRequest(
      ctx.zarinpalMerchant,
      tpl.priceToman,
      `Sephiroth · ${tpl.name}`,
      ctx.publicHost || "https://t.me"
    );
    if (!req.ok || !req.authority) {
      const reason = req.ok ? `response missing authority (code ${req.code})` : req.reason;
      await logActivity({
        kind: "user.created",
        level: "warn",
        actor: "telegram-bot",
        message: `ZarinPal renew request failed for ${fromId} (${tpl.name}): ${reason}`,
        meta: { templateId: tpl.id, renewTargetSubId: subId, amountToman: tpl.priceToman },
      });
      await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
      return;
    }
    const order = await db.tgOrder.create({
      data: { ...orderData, method, status: "awaiting_payment", authority: req.authority },
    });
    await logOrderEvent(order, "created", "zarinpal request ok (renew)");
    await notifyAdminsNewOrder(ctx, order);
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

  // card-to-card (renew) — receipt photo flows through handleReceiptPhoto,
  // which matches ANY pending_manual card order of this tgId
  if (!ctx.cardNumber || !ctx.cardHolder) {
    await sendMessage(ctx.token, chatId, t.payUnavailable, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const order = await db.tgOrder.create({ data: { ...orderData, method, status: "pending_manual" } });
  await logOrderEvent(order, "created", "awaiting receipt photo (renew)");
  await notifyAdminsNewOrder(ctx, order);
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

/* ---------- completion / provisioning / delivery ---------- */

/**
 * Finish a completed order: provision exactly once (the claim is
 * taken inside transitionOrder) and deliver the sub links.
 */
async function completeAndDeliver(ctx: WorkerCtx, orderId: string, via: string): Promise<void> {
  const res = await transitionOrder(orderId, "completed");
  if (!res.ok) {
    if (res.reason === "terminal" && res.order && isProvisioningClaim(res.order)) {
      // claimed but provisioning crashed earlier — heal it
      await provisionAndDeliverClaimed(ctx, res.order);
    }
    return; // already completed/rejected → idempotent no-op
  }
  const order = res.order;
  await logOrderEvent(order, via === "zarinpal" ? "zarinpal_paid" : "completed", `via ${via}`);
  await provisionAndDeliverClaimed(ctx, order);
}

async function provisionAndDeliverClaimed(ctx: WorkerCtx, order: TgOrder): Promise<void> {
  const template = await db.saleTemplate.findUnique({ where: { id: order.templateId } });
  // v2.8 — a renewal order EXTENDS the existing subscription instead of
  // provisioning a new ClientUser
  if (order.renewTargetSubId) {
    await renewAndDeliverClaimed(ctx, order, template);
    return;
  }
  const user = await provisionOrderUser(order, template);
  const langRow = await db.tgUser.findUnique({ where: { tgId: order.tgId } });
  const lang = ((langRow?.lang as BotLang) ?? ctx.botLang) as BotLang;
  const t = botTexts(lang);

  const subPath = `/sub/${user.subId}`;
  const sub = ctx.publicHost ? `${ctx.publicHost}${subPath}` : subPath;
  const clash = ctx.publicHost ? `${ctx.publicHost}/api/sub/${user.subId}?format=clash` : `${subPath}?format=clash`;
  const singbox = ctx.publicHost ? `${ctx.publicHost}/api/sub/${user.subId}?format=singbox` : `${subPath}?format=singbox`;

  await sendMessage(
    ctx.token,
    order.tgId,
    fmt(t.delivered, {
      user: user.username,
      gb: fmtGb(template?.trafficLimitGb ?? null),
      days: fmtDays(template?.expiryDays ?? null),
      sub,
      clash,
      singbox,
    }),
    ctx.publicHost
      ? { inline_keyboard: [[{ text: t.btnSubLink, url: sub }]] }
      : undefined,
    { proxyUrl: ctx.proxyUrl }
  );

  // v2.8 — QR photo of the sub link (best-effort, AFTER the text delivery
  // so a QR failure can never break the delivery)
  await deliverQrCode(ctx, order.tgId, sub);

  for (const adminId of ctx.adminChatIds) {
    await sendMessage(
      ctx.token,
      adminId,
      `✅ Order <code>${order.id.slice(-6)}</code> completed → user <code>${user.username}</code> (${order.templateName}, ${fmtToman(order.amountToman)} Toman, via ${order.method})`,
      undefined,
      { proxyUrl: ctx.proxyUrl }
    ).catch(() => {});
  }
}

/**
 * v2.8 — QR PNG of the sub link via the qrcode package. Only fires when a
 * publicHost is configured (a relative link is useless inside a QR) and is
 * strictly best-effort: any failure is swallowed because the text message
 * with the raw links was already delivered.
 */
async function deliverQrCode(ctx: WorkerCtx, chatId: string, sub: string): Promise<void> {
  if (!ctx.publicHost) return;
  try {
    const mod = await import("qrcode");
    const QRCode = ((mod as { default?: unknown }).default ?? mod) as {
      toBuffer: (text: string, options?: Record<string, unknown>) => Promise<Buffer>;
    };
    const png = await QRCode.toBuffer(sub, { type: "png", width: 512, margin: 1 });
    await sendPhoto(ctx.token, chatId, { buffer: png, filename: "sub-qr.png" }, sub, undefined, {
      proxyUrl: ctx.proxyUrl,
    });
  } catch {
    /* QR is decoration — never break the delivery */
  }
}

/**
 * v2.8 — completion path for renewal orders (order.renewTargetSubId set).
 * Instead of creating a new ClientUser, the TARGET subscription is
 * extended in place and the SAME sub link is re-delivered (subId never
 * changes, so every client keeps pulling the same URL).
 */
async function renewAndDeliverClaimed(ctx: WorkerCtx, order: TgOrder, template: SaleTemplate | null): Promise<void> {
  const targetSubId = order.renewTargetSubId ?? "";
  const langRow = await db.tgUser.findUnique({ where: { tgId: order.tgId } });
  const lang = ((langRow?.lang as BotLang) ?? ctx.botLang) as BotLang;
  const t = botTexts(lang);

  // re-verify ownership at completion time (the buyer must STILL own the target)
  const user = await db.clientUser.findFirst({ where: { subId: targetSubId } });
  if (!user || user.tgId !== order.tgId) {
    // target deleted (or ownership mismatch) mid-payment — park the claim
    // off "provisioning" so the self-heal loop stops retrying forever
    await db.tgOrder.update({ where: { id: order.id }, data: { provisionedUserId: "orphaned" } });
    await logActivity({
      kind: "user.updated",
      level: "warn",
      actor: "telegram-bot",
      message: `Renew order ${order.id.slice(-6)} could not be applied — target sub ${targetSubId} missing or ownership mismatch`,
      meta: { orderId: order.id, tgId: order.tgId, renewTargetSubId: targetSubId },
    });
    await notifyAdmins(ctx, `⚠️ Renew order <code>${order.id.slice(-6)}</code> could not be applied — the target subscription is gone.`);
    return;
  }

  const DAY = 86_400_000;
  const now = Date.now();
  const createdMs = new Date(user.createdAt).getTime();

  // traffic: a template WITHOUT a traffic cap keeps the existing limit; a
  // capped template ADDS onto whatever the user has (null counts as 0)
  let nextTrafficGb = user.trafficLimitGb;
  if (template?.trafficLimitGb != null) {
    nextTrafficGb = (user.trafficLimitGb ?? 0) + template.trafficLimitGb;
  }

  // Renew extension math — expiryDays is stored as DAYS-FROM-CREATEDAT:
  //   absolute expiry = createdAt + expiryDays × DAY
  //   days-left shown = ceil((createdAt + expiryDays×DAY − now) / DAY)
  // To extend from `now` while KEEPING the days-from-createdAt convention:
  //   elapsedDays   = ceil((now − createdAt) / DAY)                    consumed time
  //   remainingDays = ceil(max(0, oldAbsExpiry − now) / DAY)           unexpired stock
  //   newExpiryDays = elapsedDays + remainingDays + template.expiryDays
  // because the new absolute expiry becomes
  //   createdAt + newExpiryDays×DAY
  //     = now + remainingDays×DAY + template.expiryDays×DAY
  //       + (elapsedDays×DAY − (now − createdAt))     ← bracket ≥ 0
  // i.e. the user keeps their FULL remaining window plus the template
  // window, with ≤ 1 day of ceil-rounding slack (never negative). An
  // already-expired sub (remaining = 0) gets a fresh full window from now.
  // A sub with expiryDays = null is ALREADY unlimited-time — ∞ + N days is
  // still ∞, so expiryDays stays null and only traffic is topped up.
  let nextExpiryDays: number | null;
  if (user.expiryDays === null || user.expiryDays === undefined) {
    nextExpiryDays = null; // stays unlimited
  } else {
    const elapsedDays = Math.max(0, Math.ceil((now - createdMs) / DAY));
    const remainingMs = Math.max(0, createdMs + user.expiryDays * DAY - now);
    const remainingDays = Math.ceil(remainingMs / DAY);
    nextExpiryDays = elapsedDays + remainingDays + (template?.expiryDays ?? 0);
  }

  await db.clientUser.update({
    where: { id: user.id },
    data: {
      trafficLimitGb: nextTrafficGb,
      expiryDays: nextExpiryDays,
      enabled: true,
      expiryWarnedAt: null, // re-arm the near-expiry warner
    },
  });
  await syncUserProjection(user.id, {
    ipLimit: user.ipLimit,
    trafficLimitGb: nextTrafficGb,
    expiryDays: nextExpiryDays,
    enabled: true,
  });
  // the claim resolves to the EXTENDED user — keeps isProvisioned() honest
  await db.tgOrder.update({ where: { id: order.id }, data: { provisionedUserId: user.id } });
  await logActivity({
    kind: "user.updated",
    level: "success",
    actor: "telegram-bot",
    message: `Telegram bot renewed subscription "${user.username}" (${order.templateName}, ${order.amountToman} Toman, ${order.method})`,
    meta: { orderId: order.id, tgId: order.tgId, userId: user.id },
  });

  const subPath = `/sub/${user.subId}`;
  const sub = ctx.publicHost ? `${ctx.publicHost}${subPath}` : subPath;
  await sendMessage(
    ctx.token,
    order.tgId,
    fmt(t.renewed, {
      user: user.username,
      tpl: order.templateName,
      gb: fmtGb(template?.trafficLimitGb ?? null),
      days: fmtDays(template?.expiryDays ?? null),
      sub,
    }),
    ctx.publicHost ? { inline_keyboard: [[{ text: t.btnSubLink, url: sub }]] } : undefined,
    { proxyUrl: ctx.proxyUrl }
  );
  await deliverQrCode(ctx, order.tgId, sub);

  for (const adminId of ctx.adminChatIds) {
    await sendMessage(
      ctx.token,
      adminId,
      `🔄 Order <code>${order.id.slice(-6)}</code> renewed → <code>${user.username}</code> (${order.templateName}, ${fmtToman(order.amountToman)} Toman, via ${order.method})`,
      undefined,
      { proxyUrl: ctx.proxyUrl }
    ).catch(() => {});
  }
}

/** Free (priceToman=0) template fulfillment — shop button or trial button. */
async function fulfillFreeOrder(
  ctx: WorkerCtx,
  chatId: string,
  fromId: string,
  lang: BotLang,
  templateId: string | null
): Promise<void> {
  const t = botTexts(lang);
  const free =
    templateId
      ? await db.saleTemplate.findFirst({ where: { id: templateId, priceToman: 0, enabled: true, botVisible: true } })
      : await db.saleTemplate.findFirst({ where: { priceToman: 0, enabled: true, botVisible: true }, orderBy: { createdAt: "asc" } });
  if (!free) {
    await sendMessage(ctx.token, chatId, t.noTrial, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  // rate-limit: one free order per tg user, ever
  const claimed = await db.tgOrder.count({ where: { tgId: fromId, amountToman: 0, status: "completed" } });
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
    },
  });
  await completeAndDeliver(ctx, order.id, "free");
}

/* ---------- zarinpal verify poller ---------- */

async function verifyAwaitingZarinpal(): Promise<void> {
  if (!status.running) return;
  const ctx = await loadCtx();
  if (!ctx.token || !ctx.zarinpalMerchant) return;

  const orders = await db.tgOrder.findMany({
    where: { method: "zarinpal", status: "awaiting_payment", authority: { not: "" } },
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

  // self-heal: orders completed but whose provisioning claim never finished
  const stuck = (await db.tgOrder.findMany({ where: { status: "completed" }, orderBy: { updatedAt: "desc" }, take: 50 }))
    .filter(isProvisioningClaim)
    .filter((o) => Date.now() - new Date(o.updatedAt).getTime() > 60_000);
  for (const order of stuck) {
    await provisionAndDeliverClaimed(ctx, order);
  }
}

/* ---------- admin flows ---------- */

async function notifyAdminsNewOrder(ctx: WorkerCtx, order: TgOrder): Promise<void> {
  const text = [
    `🛒 <b>New order</b> <code>${order.id.slice(-6)}</code>`,
    `user: ${order.tgUsername || order.tgId}`,
    `${order.templateName} · ${fmtToman(order.amountToman)} Toman · ${order.method}`,
    order.method === "card" ? "waiting for receipt photo…" : "awaiting ZarinPal payment…",
  ].join("\n");
  await notifyAdmins(ctx, text);
}

async function adminReviewOrder(
  ctx: WorkerCtx,
  chatId: string,
  messageId: number,
  orderId: string,
  approve: boolean
): Promise<void> {
  if (approve) {
    const pending = await db.tgOrder.findUnique({ where: { id: orderId } });
    if (pending?.receiptFileId) {
      await sendChatAction(ctx.token, pending.tgId, "typing", { proxyUrl: ctx.proxyUrl }).catch(() => {});
    }
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
      await logOrderEvent(res.order, "rejected", "admin reject");
      const langRow = await db.tgUser.findUnique({ where: { tgId: res.order.tgId } });
      const t = botTexts(((langRow?.lang as BotLang) ?? ctx.botLang) as BotLang);
      await sendMessage(ctx.token, res.order.tgId, t.rejected, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      await notifyAdmins(ctx, `❌ Order <code>${orderId.slice(-6)}</code> rejected.`);
      await editMessageText(
        ctx.token,
        chatId,
        messageId,
        `❌ Order <code>${orderId.slice(-6)}</code> rejected.`,
        undefined,
        { proxyUrl: ctx.proxyUrl }
      ).catch(() => {});
    } else if (res.reason === "terminal") {
      await notifyAdmins(ctx, `ℹ️ Order <code>${orderId.slice(-6)}</code> was already decided — no action taken.`);
    }
  }
}

async function sendAdminDashboard(ctx: WorkerCtx, chatId: string, _lang: BotLang): Promise<void> {
  const [users, orders] = await Promise.all([db.clientUser.findMany(), db.tgOrder.findMany()]);
  const now = Date.now();
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const weekAgo = now - 7 * 86_400_000;

  const completed = orders.filter((o) => o.status === "completed");
  const revenueToday = completed
    .filter((o) => new Date(o.updatedAt).getTime() >= startOfDay)
    .reduce((s, o) => s + o.amountToman, 0);
  const revenueWeek = completed
    .filter((o) => new Date(o.updatedAt).getTime() >= weekAgo)
    .reduce((s, o) => s + o.amountToman, 0);
  const pending = orders.filter((o) => o.status === "pending_manual" && o.receiptFileId);

  const lines = [
    "📊 <b>Sephiroth Sales Bot — Admin</b>",
    `• Users: ${users.filter((u) => u.enabled).length} enabled / ${users.length} total`,
    `• Revenue today: ${fmtToman(revenueToday)} Toman`,
    `• Revenue (7d): ${fmtToman(revenueWeek)} Toman`,
    `• Completed orders: ${completed.length}`,
    `• Pending card approvals: ${pending.length}`,
  ];
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...pending.slice(0, 8).map((o) => [
        { text: `🧾 ${o.tgUsername || o.tgId} · ${fmtToman(o.amountToman)} T`, callback_data: `noop:${o.id}` },
      ] as { text: string; callback_data: string }[]),
    ],
  };
  await sendMessage(ctx.token, chatId, lines.join("\n"), keyboard, { proxyUrl: ctx.proxyUrl });

  for (const order of pending.slice(0, 8)) {
    const kb: InlineKeyboard = {
      inline_keyboard: [
        [
          { text: "✅", callback_data: `ok:${order.id}` },
          { text: "❌", callback_data: `no:${order.id}` },
        ],
      ],
    };
    const caption = [
      `🧾 Receipt · order <code>${order.id.slice(-6)}</code>`,
      `user: ${order.tgUsername || order.tgId}`,
      `${order.templateName} · ${fmtToman(order.amountToman)} Toman`,
    ].join("\n");
    await sendPhoto(ctx.token, chatId, order.receiptFileId, caption, kb, { proxyUrl: ctx.proxyUrl }).catch(() => {});
  }
}

/* ---------- admin commands (23-a — same libs, no HTTP) ---------- */

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function sendStatus(ctx: WorkerCtx, chatId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  const [inbounds, users, core] = await Promise.all([
    db.inbound.findMany(),
    db.clientUser.findMany(),
    getCoreSettings(),
  ]);
  const coreStatus = coreStatusPayload();
  const coreName = core.driver === "simulator" ? "simulator" : `Xray API ${core.apiHost}:${core.apiPort}`;
  const coreRunning = coreStatus ? (coreStatus.running ? "running" : "stopped") : "stopped";
  const totalTraffic = users.reduce((acc, u) => acc + (Number(u.usedTrafficGb) || 0), 0);
  const lines = [
    t.stTitle,
    fmt(t.stVersion, { ver: appVersion() }),
    fmt(t.stCore, { core: coreName, status: coreRunning }),
    fmt(t.stInbounds, { online: inbounds.filter((i) => i.status === "online").length, total: inbounds.length }),
    fmt(t.stUsers, { enabled: users.filter((u) => u.enabled).length, total: users.length }),
    fmt(t.stTraffic, { gb: totalTraffic.toFixed(2) }),
    fmt(t.stUptime, { up: fmtUptime(process.uptime()) }),
  ];
  await sendMessage(ctx.token, chatId, lines.join("\n"), undefined, { proxyUrl: ctx.proxyUrl });
}

async function sendUsersTop(ctx: WorkerCtx, chatId: string, lang: BotLang, n: number): Promise<void> {
  const t = botTexts(lang);
  const users = await db.clientUser.findMany();
  const top = [...users]
    .sort((a, b) => (Number(b.usedTrafficGb) || 0) - (Number(a.usedTrafficGb) || 0))
    .slice(0, Math.max(1, Math.min(20, n)));
  if (top.length === 0) {
    await sendMessage(ctx.token, chatId, t.usersEmpty, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }
  const lines = [
    t.usersTitle,
    ...top.map((u, i) =>
      fmt(t.usersLine, {
        n: i + 1,
        user: u.username,
        used: (Number(u.usedTrafficGb) || 0).toFixed(1),
        limit: fmtGb(u.trafficLimitGb),
        days: daysLeftFor(u),
        state: stateMark(u),
      })
    ),
  ];
  await sendMessage(ctx.token, chatId, lines.join("\n"), undefined, { proxyUrl: ctx.proxyUrl });
}

async function sendInbounds(ctx: WorkerCtx, chatId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  const inbounds = await db.inbound.findMany({ orderBy: { createdAt: "asc" } });
  if (inbounds.length === 0) {
    await sendMessage(ctx.token, chatId, t.inbEmpty, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }
  const lines = [
    t.inbTitle,
    ...inbounds.slice(0, 15).map((i) => {
      let clients = 0;
      try {
        clients = (JSON.parse(i.clientsJson) as unknown[]).length;
      } catch {
        clients = 0;
      }
      return fmt(t.inbLine, {
        tag: i.tag,
        proto: i.protocol,
        port: i.port,
        status: i.status,
        clients,
      });
    }),
  ];
  await sendMessage(ctx.token, chatId, lines.join("\n"), undefined, { proxyUrl: ctx.proxyUrl });
}

async function sendUserCard(ctx: WorkerCtx, chatId: string, lang: BotLang, query: string): Promise<void> {
  const t = botTexts(lang);
  const q = query.toLowerCase();
  const user = await db.clientUser.findFirst({
    where: {
      OR: [{ username: query }, { username: { contains: q } }],
    },
  });
  if (!user) {
    await sendMessage(ctx.token, chatId, t.userNotFound, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }
  const status = user.enabled ? (daysLeftFor(user) === "0" ? "expired" : "active") : "disabled";
  const text = fmt(t.userCard, {
    user: user.username,
    status,
    used: (Number(user.usedTrafficGb) || 0).toFixed(1),
    limit: fmtGb(user.trafficLimitGb),
    days: daysLeftFor(user),
    ip: user.ipLimit === 0 ? "∞" : String(user.ipLimit),
  });
  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [
        user.enabled
          ? { text: t.btnDisable, callback_data: `usdis:${user.id}` }
          : { text: t.btnEnable, callback_data: `useen:${user.id}` },
        { text: t.btnReset, callback_data: `usreset:${user.id}` },
      ],
      [
        { text: t.btnApplyTpl, callback_data: `uap:${user.id}` }, // v2.8
        { text: t.btnResetDevices, callback_data: `ures:${user.id}` }, // v2.8
      ],
      [{ text: t.btnDelete, callback_data: `udel:${user.id}` }], // v2.8 — 2-step confirm
    ],
  };
  await sendMessage(ctx.token, chatId, text, keyboard, { proxyUrl: ctx.proxyUrl });
}

/**
 * Inline enable/disable/reset-traffic with an answerCallbackQuery
 * confirmation toast + refreshed card (23-a). The action re-checks
 * admin membership via the caller — callback_data can never be
 * replayed by a non-admin (§D hardening).
 */
async function adminUserAction(
  ctx: WorkerCtx,
  cb: TgCallback,
  chatId: string,
  action: string,
  userId: string
): Promise<void> {
  const tgRow = await db.tgUser.findUnique({ where: { tgId: cb.from.id ? String(cb.from.id) : "" } });
  const lang = ((tgRow?.lang as BotLang) ?? ctx.botLang) as BotLang;
  const t = botTexts(lang);
  const user = await db.clientUser.findUnique({ where: { id: userId } });
  if (!user) {
    await answerCallbackQuery(ctx.token, cb.id, t.userNotFound, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    return;
  }

  if (action === "useen" || action === "usdis") {
    const enabled = action === "useen";
    await db.clientUser.update({ where: { id: user.id }, data: { enabled } });
    await syncUserProjection(user.id, {
      ipLimit: user.ipLimit,
      trafficLimitGb: user.trafficLimitGb,
      expiryDays: user.expiryDays,
      enabled,
    });
    await logActivity({
      kind: "user.updated",
      level: enabled ? "success" : "warn",
      actor: "telegram-bot",
      message: `Telegram bot ${enabled ? "enabled" : "disabled"} user "${user.username}"`,
      meta: { userId: user.id, username: user.username },
    });
    const toast = fmt(enabled ? t.doneEnable : t.doneDisable, { user: user.username });
    await answerCallbackQuery(ctx.token, cb.id, toast, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    await sendMessage(ctx.token, chatId, `✅ ${toast}`, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    return;
  }

  if (action === "usreset") {
    await db.clientUser.update({ where: { id: user.id }, data: { usedTrafficGb: 0 } });
    await logActivity({
      kind: "user.updated",
      level: "info",
      actor: "telegram-bot",
      message: `Telegram bot reset traffic for "${user.username}"`,
      meta: { userId: user.id, username: user.username },
    });
    const toast = fmt(t.doneReset, { user: user.username });
    await answerCallbackQuery(ctx.token, cb.id, toast, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    await sendMessage(ctx.token, chatId, `♻️ ${toast}`, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    return;
  }
}

/* ---------- admin v2.8: /adduser + /credit + user-card tools ---------- */

/**
 * v2.8 — /adduser <templateName>: create a ClientUser straight from a
 * template. An order with method "admin" is created and pushed through
 * the normal transitionOrder → completed path as the audit trail, so the
 * /admin revenue counters keep counting honestly (spec decision). The
 * delivered card (sub link + clash + singbox) lands in the admin chat
 * because order.tgId is the invoking admin.
 */
async function adminAddUser(ctx: WorkerCtx, chatId: string, fromId: string, lang: BotLang, arg: string): Promise<void> {
  const t = botTexts(lang);
  const templates = await db.saleTemplate.findMany({ orderBy: { createdAt: "asc" } });
  if (!arg) {
    const list = templates
      .map((x) => `• ${x.name} · ${x.priceToman > 0 ? `${fmtToman(x.priceToman)} T` : t.tplFree}`)
      .join("\n");
    await sendMessage(ctx.token, chatId, fmt(t.addUserHint, { list }), undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }
  // case-insensitive EXACT name match
  const tpl = templates.find((x) => x.name.toLowerCase() === arg.toLowerCase());
  if (!tpl) {
    const q = arg.toLowerCase();
    const near = templates.filter(
      (x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase())
    ).slice(0, 3);
    const suggestions = (near.length > 0 ? near : templates.slice(0, 3))
      .map((x) => `• ${x.name}`)
      .join("\n");
    await sendMessage(ctx.token, chatId, fmt(t.addUserNotFound, { name: arg, suggestions }), undefined, {
      proxyUrl: ctx.proxyUrl,
    });
    return;
  }
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const order = await db.tgOrder.create({
    data: {
      tgId: fromId,
      tgUsername: tgRow?.tgUsername ?? "",
      templateId: tpl.id,
      templateName: tpl.name,
      amountToman: tpl.priceToman,
      method: "admin",
      status: "awaiting_payment",
    },
  });
  await logOrderEvent(order, "created", "admin /adduser");
  await completeAndDeliver(ctx, order.id, "admin");
}

/**
 * v2.8 — /credit <query> <amountToman>: adjust a tgUser's wallet balance.
 * query = tg username (without @) | ClientUser username | tgId. Negative
 * amounts deduct; the resulting total is clamped at ≥ 0. The target user
 * is notified in DM (best-effort).
 */
async function adminCredit(ctx: WorkerCtx, chatId: string, lang: BotLang, arg: string): Promise<void> {
  const t = botTexts(lang);
  const m = arg.match(/^(\S+)\s+(-?\d+)$/);
  if (!m) {
    await sendMessage(ctx.token, chatId, t.creditHint, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }
  const query = m[1].replace(/^@/, "");
  const amount = parseInt(m[2], 10);

  let tgRow: TgUser | null = null;
  if (/^\d+$/.test(query)) {
    tgRow = await db.tgUser.findUnique({ where: { tgId: query } });
  }
  if (!tgRow) {
    const all = await db.tgUser.findMany();
    const ql = query.toLowerCase();
    tgRow = all.find((u) => {
      const un = (u.tgUsername || "").toLowerCase();
      return un === ql || un === `@${ql}`;
    }) ?? null;
  }
  if (!tgRow) {
    const cu = await db.clientUser.findFirst({ where: { username: query } });
    if (cu?.tgId) tgRow = await db.tgUser.findUnique({ where: { tgId: cu.tgId } });
  }
  if (!tgRow) {
    await sendMessage(ctx.token, chatId, t.userNotFound, undefined, { proxyUrl: ctx.proxyUrl });
    return;
  }

  const oldBal = Math.max(0, Math.floor(Number(tgRow.balanceToman ?? 0)));
  const newBal = Math.max(0, oldBal + amount); // clamp ≥ 0
  await db.tgUser.update({ where: { tgId: tgRow.tgId }, data: { balanceToman: newBal } });
  await logActivity({
    kind: "user.updated",
    level: "info",
    actor: "telegram-bot",
    message: `Telegram bot wallet credit for ${tgRow.tgUsername || tgRow.tgId}: ${oldBal} → ${newBal} Toman (${amount >= 0 ? "+" : ""}${amount})`,
    meta: { tgId: tgRow.tgId, amountToman: amount },
  });
  // notify the target user (best-effort DM)
  await sendMessage(
    ctx.token,
    tgRow.tgId,
    fmt(t.walletCredited, { amount: `${amount >= 0 ? "+" : ""}${fmtToman(amount)}`, balance: fmtToman(newBal) }),
    undefined,
    { proxyUrl: ctx.proxyUrl }
  ).catch(() => {});
  await sendMessage(
    ctx.token,
    chatId,
    fmt(t.creditDone, { user: tgRow.tgUsername || tgRow.tgId, old: fmtToman(oldBal), new: fmtToman(newBal) }),
    undefined,
    { proxyUrl: ctx.proxyUrl }
  );
}

/**
 * v2.8 — admin user-card tools behind the udel:/udy:/uap:/uapt:/ures:
 * callbacks. handleCallback has ALREADY gated this on isAdmin.
 */
async function handleAdminUserTools(ctx: WorkerCtx, cb: TgCallback, chatId: string, data: string): Promise<void> {
  const tgRow = await db.tgUser.findUnique({ where: { tgId: String(cb.from.id) } });
  const lang = ((tgRow?.lang as BotLang) ?? ctx.botLang) as BotLang;
  const t = botTexts(lang);
  const messageId = cb.message?.message_id ?? 0;
  const [cmd, arg1, arg2] = data.split(":");

  if (cmd === "udel") {
    const user = await db.clientUser.findUnique({ where: { id: arg1 } });
    if (!user) {
      await answerCallbackQuery(ctx.token, cb.id, t.userNotFound, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      return;
    }
    // 2-step confirm — the destructive action lives behind udy:<id>
    await sendMessage(
      ctx.token,
      chatId,
      fmt(t.deleteConfirm, { user: user.username }),
      {
        inline_keyboard: [
          [{ text: "✅", callback_data: `udy:${user.id}` }],
          [{ text: "❌", callback_data: "noop:" }],
        ],
      },
      { proxyUrl: ctx.proxyUrl }
    );
    return;
  }

  if (cmd === "udy") {
    const user = await db.clientUser.findUnique({ where: { id: arg1 } });
    if (!user) {
      await answerCallbackQuery(ctx.token, cb.id, t.userNotFound, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      return;
    }
    // mirror DELETE /api/users/:id exactly: strip every clientsJson
    // projection → delete the row (the facade cascades userInboundAccess
    // + subGroupMember) → audit (kind user.deleted) → admin alert
    await stripUserEverywhere(user.id);
    await db.clientUser.delete({ where: { id: user.id } });
    await logActivity({
      kind: "user.deleted",
      level: "warn",
      actor: "telegram-bot",
      message: `User deleted (id ${user.id})`,
      meta: { userId: user.id, username: user.username },
    });
    await notifyAdmins(ctx, fmt(t.nUserDeleted, { user: user.username }));
    if (messageId) {
      await editMessageText(
        ctx.token,
        chatId,
        messageId,
        fmt(t.doneDelete, { user: user.username }),
        undefined,
        { proxyUrl: ctx.proxyUrl }
      ).catch(() => {});
    }
    return;
  }

  if (cmd === "uap") {
    const user = await db.clientUser.findUnique({ where: { id: arg1 } });
    if (!user) {
      await answerCallbackQuery(ctx.token, cb.id, t.userNotFound, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      return;
    }
    const templates = await db.saleTemplate.findMany({ orderBy: { createdAt: "asc" } });
    // index = position in this same ordering — ≤ 2 digits for MVP catalogs
    const rows = templates.slice(0, 20).map((tpl, i) => [
      {
        text: `${tpl.name} · ${tpl.priceToman > 0 ? `${fmtToman(tpl.priceToman)} T` : t.tplFree}`,
        callback_data: `uapt:${user.id}:${i}`,
      },
    ]);
    await sendMessage(ctx.token, chatId, fmt(t.uapTitle, { user: user.username }), {
      inline_keyboard: [...rows, [{ text: t.backMenu, callback_data: "menu" }]],
    }, { proxyUrl: ctx.proxyUrl });
    return;
  }

  if (cmd === "uapt") {
    const user = await db.clientUser.findUnique({ where: { id: arg1 } });
    const templates = await db.saleTemplate.findMany({ orderBy: { createdAt: "asc" } });
    const tpl = templates[Number(arg2)];
    if (!user || !tpl || !Number.isInteger(Number(arg2))) {
      await answerCallbackQuery(ctx.token, cb.id, t.userNotFound, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      return;
    }
    // apply-template: OVERWRITE traffic/expiry/ip from the chosen template
    await db.clientUser.update({
      where: { id: user.id },
      data: { trafficLimitGb: tpl.trafficLimitGb, expiryDays: tpl.expiryDays, ipLimit: tpl.ipLimit },
    });
    await syncUserProjection(user.id, {
      ipLimit: tpl.ipLimit,
      trafficLimitGb: tpl.trafficLimitGb,
      expiryDays: tpl.expiryDays,
      enabled: user.enabled,
    });
    await logActivity({
      kind: "user.updated",
      level: "info",
      actor: "telegram-bot",
      message: `Telegram bot applied template "${tpl.name}" to "${user.username}"`,
      meta: { userId: user.id, username: user.username, templateId: tpl.id },
    });
    const toast = fmt(t.doneApplyTpl, {
      user: user.username,
      tpl: tpl.name,
      gb: fmtGb(tpl.trafficLimitGb),
      days: fmtDays(tpl.expiryDays),
      ip: tpl.ipLimit === 0 ? "∞" : String(tpl.ipLimit),
    });
    await answerCallbackQuery(ctx.token, cb.id, toast, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    await sendMessage(ctx.token, chatId, toast, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    return;
  }

  if (cmd === "ures") {
    const user = await db.clientUser.findUnique({ where: { id: arg1 } });
    if (!user) {
      await answerCallbackQuery(ctx.token, cb.id, t.userNotFound, { proxyUrl: ctx.proxyUrl }).catch(() => {});
      return;
    }
    // mirror POST /api/users/:id/reset-devices: devices="[]", hwidLimit kept
    await db.clientUser.update({ where: { id: user.id }, data: { devices: "[]" } });
    await logActivity({
      kind: "user.updated",
      level: "info",
      actor: "telegram-bot",
      message: `Device registrations reset for "${user.username}"`,
      meta: { userId: user.id, username: user.username, reason: "devices_reset" },
    });
    const toast = fmt(t.doneResetDevices, { user: user.username });
    await answerCallbackQuery(ctx.token, cb.id, toast, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    await sendMessage(ctx.token, chatId, toast, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
    return;
  }
}

/* ---------- backup delivery ---------- */

async function sendBackupNow(ctx: WorkerCtx, chatId: string): Promise<void> {
  // buildBackupPayload EXCLUDES the bot token (Task 23-c) — safe to send
  const payload = await buildBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(json).digest("hex");
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `sephiroth-backup-${stamp}.json`;
  await sendDocument(ctx.token, chatId, filename, json, `Sephiroth backup ${stamp} · sha256:${sha.slice(0, 16)}…`, {
    proxyUrl: ctx.proxyUrl,
  });
  await logActivity({
    kind: "backup.exported",
    level: "success",
    actor: "telegram-bot",
    message: `Sales bot delivered backup snapshot ${filename} to admin chat`,
    meta: { sha256: sha },
  });
}

/* ---------- misc ---------- */

async function notifyAdmins(ctx: WorkerCtx, text: string): Promise<void> {
  for (const adminId of ctx.adminChatIds) {
    await sendMessage(ctx.token, adminId, text, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
  }
}

async function sendSupport(ctx: WorkerCtx, chatId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  const contact =
    (await db.serverSetting.findUnique({ where: { key: "set_tg_chat_id" } }))?.value || ctx.supportUrl || "@sephiroth";
  await sendMessage(ctx.token, chatId, fmt(t.support, { contact }), menuBackKeyboard(t.backMenu), {
    proxyUrl: ctx.proxyUrl,
  });
}

async function sendMySubscriptions(ctx: WorkerCtx, chatId: string, fromId: string, lang: BotLang): Promise<void> {
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
          : { text: `${t.btnSubLink} · ${u.username}`, callback_data: `menu` },
        { text: t.btnRenew, callback_data: `ren:${u.subId}` }, // v2.8 — renew / top-up
      ]),
      [{ text: t.backMenu, callback_data: "menu" }],
    ],
  };
  await sendMessage(ctx.token, chatId, `${t.subsTitle}\n\n${lines.join("\n")}`, keyboard, { proxyUrl: ctx.proxyUrl });
}
