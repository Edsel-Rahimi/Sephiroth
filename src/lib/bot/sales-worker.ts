import { db, type TgOrder, type TgUser } from "@/lib/db";
import {
  getGeneralSettings,
  getPaymentSettings,
  getTelegramSettings,
  getTelegramToken,
} from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { buildBackupPayload } from "@/app/api/settings/backup/route";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  answerCallbackQuery,
  editMessageText,
  sendChatAction,
  sendDocument,
  sendMessage,
  sendPhoto,
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
  botTexts,
  fmt,
  fmtDays,
  fmtGb,
  fmtToman,
  type BotLang,
} from "@/lib/bot/texts";
import { zarinpalRequest, zarinpalStartPayUrl, zarinpalVerify } from "@/lib/bot/zarinpal";

/* ============================================================
   Sephiroth · Task 23-c — Sephiroth Sales Bot v1 (Phase-1 MVP)

   In-process long-poll worker (design doc §E). Zero external
   services: the worker calls the same lib functions the API
   routes use (db / syncUserProjection / genAccessFields /
   buildBackupPayload / logActivity) — no HTTP hop.

   Lifecycle: startSalesWorker()/stopSalesWorker() driven by
   settings (botMode === "sales" + token). single-instance guard,
   sequential getUpdates (1s idle, error backoff 1s→5s→30s),
   never crashes the panel.

   Env overrides (documented, test-only):
   • SEPH_TG_API_BASE   — Bot API base (mock E2E harness)
   • SEPH_ZARINPAL_BASE — ZarinPal base (mock E2E harness)
   • SEPH_TG_PAY_POLL_MS — zarinpal verify poll interval (default 60s)
   ============================================================ */

/* ---------- status ---------- */

export interface SalesWorkerStatus {
  mode: "console" | "sales";
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
  shopLang: BotLang;
  publicHost: string;
  supportUrl: string;
  cardNumber: string;
  cardHolder: string;
  zarinpalMerchant: string;
}

async function loadCtx(): Promise<WorkerCtx> {
  const [tg, general, payment] = await Promise.all([
    getTelegramSettings(),
    getGeneralSettings(),
    getPaymentSettings(),
  ]);
  const token = await getTelegramToken();
  return {
    token,
    proxyUrl: tg.botProxyUrl,
    adminChatIds: tg.adminChatIds,
    shopLang: tg.shopLang,
    publicHost: general.publicHost.replace(/\/+$/, ""),
    supportUrl: general.subSupportUrl,
    cardNumber: payment.cardNumber,
    cardHolder: payment.cardHolder,
    zarinpalMerchant: payment.zarinpalMerchant,
  };
}

/* ---------- lifecycle ---------- */

let payTimer: ReturnType<typeof setInterval> | null = null;
let booting = false;

/** Start the worker if settings say sales mode + token present. Safe to call repeatedly. */
export async function startSalesWorker(): Promise<void> {
  if (status.running || booting) return;
  booting = true;
  try {
    const tg = await getTelegramSettings();
    status.mode = tg.botMode;
    const token = await getTelegramToken();
    if (tg.botMode !== "sales" || !token) return; // console mode or no token → stay idle
    if (tg.adminChatIds.length === 0) {
      console.warn("[sales-bot] mode=sales but adminChatIds is empty — worker idle");
      return;
    }

    status.running = true;
    status.stopRequested = false;
    status.startedAt = new Date().toISOString();
    status.generation += 1;
    const gen = status.generation;

    // officially drop any backlog so a restart never replays old commands
    try {
      await apiCall(ctx0(token, tg.botProxyUrl), "deleteWebhook", { drop_pending_updates: true });
    } catch {
      /* fine — polling still works */
    }

    console.log("[sales-bot] worker started (generation", gen, ")");
    void pollLoop(gen);

    if (!payTimer) {
      payTimer = setInterval(() => {
        void verifyAwaitingZarinpal().catch((err) =>
          console.warn("[sales-bot] zarinpal poll error:", err)
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
  console.log("[sales-bot] worker stopped");
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
    shopLang: "en",
    publicHost: "",
    supportUrl: "",
    cardNumber: "",
    cardHolder: "",
    zarinpalMerchant: "",
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
          console.warn("[sales-bot] update handling error:", err);
        } finally {
          status.handledUpdates += 1;
          if (typeof update.update_id === "number" && update.update_id >= 0) {
            offset = update.update_id + 1;
          }
        }
      }
      await sleep(backoffMs || 1000);
    } catch (err) {
      consecutiveErrors += 1;
      status.errors += 1;
      status.lastError = err instanceof Error ? err.message : String(err);
      // 1s → 5s → 30s → 30s … — never crash the panel
      backoffMs = consecutiveErrors === 1 ? 1000 : consecutiveErrors === 2 ? 5000 : 30_000;
      if (status.running) {
        console.warn(`[sales-bot] poll error (x${consecutiveErrors}) — retry in ${backoffMs}ms`);
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

  const [tgUser, isNewTgUser] = await upsertTgUser(from, ctx.shopLang);
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
  const lang = (tgRow?.lang as BotLang) ?? ctx.shopLang;
  const t = botTexts(lang);

  // receipt photo for a pending card order?
  if (msg.photo && msg.photo.length > 0) {
    await handleReceiptPhoto(ctx, msg, fromId, chatId, lang);
    return;
  }

  const text = (msg.text ?? "").trim();

  if (isAdmin) {
    if (text === "/admin") {
      await sendAdminDashboard(ctx, chatId, lang);
      return;
    }
    if (text === "/status") {
      await sendConsoleParityStatus(ctx, chatId);
      return;
    }
    if (text === "/users") {
      await sendConsoleParityUsers(ctx, chatId);
      return;
    }
    if (text === "/backup_now") {
      await sendBackupNow(ctx, chatId);
      return;
    }
  }

  if (text.startsWith("/start")) {
    if (!tgRow || isNewTgUser) { // brand-new user → language picker first (§E)
      await sendMessage(ctx.token, chatId, t.pickLang, {
        inline_keyboard: [
          [
            { text: "🇮🇷 فارسی", callback_data: "lang:fa" },
            { text: "🇬🇧 English", callback_data: "lang:en" },
          ],
        ],
      }, { proxyUrl: ctx.proxyUrl });
      return;
    }
    await sendMenu(ctx, chatId, lang);
    return;
  }

  // any other text → the menu (gentle, no state machine needed)
  await sendMenu(ctx, chatId, lang);
}

async function sendMenu(ctx: WorkerCtx, chatId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  await sendMessage(ctx.token, chatId, t.menu, {
    inline_keyboard: [
      [{ text: t.btnShop, callback_data: "shop" }],
      [{ text: t.btnSubs, callback_data: "subs" }, { text: t.btnTrial, callback_data: "trial" }],
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

  // ---- admin-only callbacks ----
  if (data.startsWith("ok:") || data.startsWith("no:")) {
    if (!isAdmin) return; // silently ignore (already answered)
    const orderId = data.slice(3);
    await adminReviewOrder(ctx, chatId, cb.message?.message_id ?? 0, orderId, data.startsWith("ok:"));
    return;
  }
  if (data.startsWith("noop:")) {
    return; // label rows carry no action
  }

  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });
  const lang = (tgRow?.lang as BotLang) ?? ctx.shopLang;
  const t = botTexts(lang);

  if (data.startsWith("lang:")) {
    const next = data.slice(5) === "fa" ? "fa" : "en";
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
    await sendTemplateDetail(ctx, chatId, lang, data.slice(4));
    return;
  }
  if (data.startsWith("free:")) {
    await fulfillFreeOrder(ctx, chatId, fromId, lang, data.slice(5));
    return;
  }
  if (data.startsWith("pay:")) {
    // pay:<orderId>:z|c
    const [, orderId, method] = data.split(":");
    await startPayment(ctx, chatId, fromId, lang, orderId, method === "z" ? "zarinpal" : "card");
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

async function shopTemplates() {
  return db.saleTemplate.findMany({
    where: { enabled: true, botVisible: true },
    orderBy: { createdAt: "asc" },
  });
}

async function sendShop(ctx: WorkerCtx, chatId: string, lang: BotLang): Promise<void> {
  const t = botTexts(lang);
  const templates = await shopTemplates();
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
    keyboard = {
      inline_keyboard: [
        [
          { text: t.payZarin, callback_data: `pay:${tpl.id}:z` },
          { text: t.payCard, callback_data: `pay:${tpl.id}:c` },
        ],
        [{ text: t.backMenu, callback_data: "menu" }],
      ],
    };
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
  method: "zarinpal" | "card"
): Promise<void> {
  const t = botTexts(lang);
  const tpl = await db.saleTemplate.findUnique({ where: { id: templateId } });
  if (!tpl || !tpl.enabled || !tpl.botVisible || tpl.priceToman <= 0) {
    await sendMessage(ctx.token, chatId, t.shopEmpty, menuBackKeyboard(t.backMenu), { proxyUrl: ctx.proxyUrl });
    return;
  }
  const tgRow = await db.tgUser.findUnique({ where: { tgId: fromId } });

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
  const user = await provisionOrderUser(order, template);
  const langRow = await db.tgUser.findUnique({ where: { tgId: order.tgId } });
  const lang = (langRow?.lang as BotLang) ?? ctx.shopLang;
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
      const t = botTexts((langRow?.lang as BotLang) ?? ctx.shopLang);
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

/* ---------- console-command parity (same libs, no HTTP) ---------- */

async function sendConsoleParityStatus(ctx: WorkerCtx, chatId: string): Promise<void> {
  const [inbounds, users] = await Promise.all([db.inbound.findMany(), db.clientUser.findMany()]);
  const enabled = users.filter((u) => u.enabled).length;
  const totalTraffic = users.reduce((acc, u) => acc + (Number(u.usedTrafficGb) || 0), 0);
  await sendMessage(
    ctx.token,
    chatId,
    [
      "🛰 <b>Sephiroth · System Telemetry</b>",
      `• Active Inbounds: ${inbounds.filter((i) => i.status === "online").length} / ${inbounds.length}`,
      `• Users: ${enabled} enabled / ${users.length} total`,
      `• Total Consumed Traffic: ${totalTraffic.toFixed(2)} GB`,
      `• Panel Uptime: ${Math.floor(process.uptime() / 60)}m`,
    ].join("\n"),
    undefined,
    { proxyUrl: ctx.proxyUrl }
  );
}

async function sendConsoleParityUsers(ctx: WorkerCtx, chatId: string): Promise<void> {
  const users = await db.clientUser.findMany();
  const top = [...users]
    .sort((a, b) => (Number(b.usedTrafficGb) || 0) - (Number(a.usedTrafficGb) || 0))
    .slice(0, 5);
  await sendMessage(
    ctx.token,
    chatId,
    [
      "👥 <b>Top Users &amp; Quota Report</b>",
      ...(top.length
        ? top.map(
            (u, i) =>
              `${i + 1}. <code>${u.username}</code> — ${(Number(u.usedTrafficGb) || 0).toFixed(1)} / ${u.trafficLimitGb ?? "∞"} GB (${u.enabled ? "Active" : "Disabled"})`
          )
        : ["No users created yet."]),
    ].join("\n"),
    undefined,
    { proxyUrl: ctx.proxyUrl }
  );
}

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
      ...users.slice(0, 6).map((u) =>
        ctx.publicHost
          ? [{ text: `${t.btnSubLink} · ${u.username}`, url: `${ctx.publicHost}/sub/${u.subId}` }]
          : [{ text: `${t.btnSubLink} · ${u.username}`, callback_data: `menu` }]
      ),
      [{ text: t.backMenu, callback_data: "menu" }],
    ],
  };
  await sendMessage(ctx.token, chatId, `${t.subsTitle}\n\n${lines.join("\n")}`, keyboard, { proxyUrl: ctx.proxyUrl });
}
