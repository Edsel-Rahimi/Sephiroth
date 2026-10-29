import { NextResponse } from "next/server";
import { db, type DiscountCode, type SaleTemplate, type TgOrder, type TgUser } from "@/lib/db";
import {
  getGeneralSettings,
  getPaymentSettings,
  getTelegramSettings,
  getTelegramToken,
} from "@/lib/settings";
import {
  logOrderEvent,
  transitionOrder,
  consumeDiscountForOrder,
  provisionOrderUser,
  parseOrderItems,
  discountProblem,
  CART_MAX_QTY,
} from "@/lib/bot/orders";
import { botTexts, fmt, fmtGb, fmtDays, fmtToman, type BotLang } from "@/lib/bot/texts";
import { sendMessage, tgCall } from "@/lib/bot/api";
import { validateInitData, miniappUnauthorized, type MiniappTgUser } from "@/lib/bot/miniapp-auth";

/* ============================================================
   Sephiroth · Task 3-2 — shared server logic for the OWNER-bot
   Mini App API (/api/miniapp/*). Server-only.

   IMPORTANT — replicas of private sales-worker internals live
   here on purpose. sales-worker.ts keeps its helpers file-private
   and is co-owned by the reseller-bot task (3-1), so the mini-app
   replicates the minimum it needs (each replica carries a comment
   pointing at the original) instead of widening that file's
   export surface:

     • loadCtx()             → miniappCtx()          (same settings reads)
     • shopTemplates()       → miniappCatalog()      (same eligibility)
     • resolveCart()         → resolveMiniappLines() (same live re-validation)
     • upsertTgUser()        → ensureTgUser()        (same shape)
     • getBotUsername()      → botUsernameFor()      (same getMe cache)
     • notifyAdminsNewOrder  → notifyAdminsMiniappOrder()
     • payWithWalletCart + completeAndDeliver + provisionAndDeliverClaimed
                             → walletCheckoutComplete()
       (same no-yield balance discipline + transitionOrder claim;
        the only difference: the sub links ALSO return to the
        mini-app so the buyer sees them without leaving the web view)

   Scope: this module is wired to the OWNER bot token exclusively
   (getTelegramToken). Reseller mini-apps (per-reseller bot token,
   reseller-scoped catalog) are future work — documented in
   miniapp-auth.ts.
   ============================================================ */

/* ---------- ctx (mirror of sales-worker loadCtx) ---------- */

export interface MiniappCtx {
  token: string;
  proxyUrl: string;
  adminChatIds: string[];
  botLang: BotLang;
  publicHost: string;
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
}

/** Mirror of sales-worker.ts loadCtx() — identical settings reads. */
export async function miniappCtx(): Promise<MiniappCtx | null> {
  const [tg, general, payment] = await Promise.all([
    getTelegramSettings(),
    getGeneralSettings(),
    getPaymentSettings(),
  ]);
  const token = await getTelegramToken();
  if (!token) return null; // honest: no OWNER bot token configured
  return {
    token,
    proxyUrl: tg.botProxyUrl,
    adminChatIds: tg.adminChatIds,
    botLang: tg.botLang as BotLang,
    publicHost: general.publicHost.replace(/\/+$/, ""),
    cardNumber: payment.cardNumber,
    cardHolder: payment.cardHolder,
    zarinpalMerchant: payment.zarinpalMerchant,
    salesTemplateId: tg.salesTemplateId,
    salesPayMode: tg.salesPayMode,
    nowpaymentsEnabled: payment.nowpaymentsEnabled,
    nowpaymentsApiKey: payment.nowpaymentsApiKey,
    nowpaymentsSandbox: payment.nowpaymentsSandbox,
    nowpaymentsTomanPerUsd: payment.nowpaymentsTomanPerUsd,
    starsEnabled: payment.starsEnabled,
    starsTomanPerStar: payment.starsTomanPerStar,
  };
}

/* ---------- auth gate (every route) ---------- */

/** Extract initData from the request header the mini-app sets. */
function initDataFromRequest(req: Request): string {
  return String(req.headers.get("x-telegram-init-data") ?? "").trim();
}

export type MiniappAuthGate =
  | { ok: true; ctx: MiniappCtx; user: MiniappTgUser }
  | { ok: false; res: NextResponse };

/**
 * Full auth chain for one miniapp API call:
 *   bot token configured? → initData present? → signature + freshness valid?
 * Returns an honest typed 401/503 response on every failure path. The
 * server NEVER trusts client claims beyond the validated initData —
 * prices/totals/eligibility are computed here, server-side only.
 */
export async function authenticateMiniapp(req: Request): Promise<MiniappAuthGate> {
  const ctx = await miniappCtx();
  if (!ctx) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "bot_not_configured", reason: "owner_bot_token_missing" },
        { status: 503 }
      ),
    };
  }
  const initData = initDataFromRequest(req);
  if (!initData) {
    return {
      ok: false,
      res: NextResponse.json(miniappUnauthorized("missing_init_data"), { status: 401 }),
    };
  }
  const auth = validateInitData(initData, ctx.token);
  if (!auth.ok) {
    // never log initData or the token — nothing about the failure logs the payload
    return {
      ok: false,
      res: NextResponse.json(miniappUnauthorized(auth.reason), { status: 401 }),
    };
  }
  return { ok: true, ctx, user: auth.user };
}

/* ---------- tgUser upsert (mirror of sales-worker upsertTgUser) ---------- */

/**
 * Mirror of sales-worker.ts upsertTgUser — a mini-app visitor may never
 * have typed /start, so the row is created on the first authenticated
 * call (same shape: "@username" with first_name fallback, settings
 * default lang, banned=false). A race against the bot's own upsert
 * degrades to a re-read of the winning row.
 */
export async function ensureTgUser(user: MiniappTgUser, defaultLang: BotLang): Promise<TgUser> {
  const existing = await db.tgUser.findUnique({ where: { tgId: user.id } });
  if (existing) {
    if (user.username && user.username !== existing.tgUsername) {
      return db.tgUser.update({ where: { tgId: user.id }, data: { tgUsername: user.username } });
    }
    return existing;
  }
  try {
    return await db.tgUser.create({
      data: { tgId: user.id, tgUsername: user.username, lang: defaultLang, banned: false },
    });
  } catch {
    // lost the create race against the bot's upsertTgUser — read the winner
    const row = await db.tgUser.findUnique({ where: { tgId: user.id } });
    if (!row) throw new Error("tgUser upsert race lost without a row");
    return row;
  }
}

/* ---------- catalog eligibility (mirror of sales-worker shopTemplates) ---------- */

/**
 * Mirror of sales-worker.ts shopTemplates(): enabled + botVisible, with
 * the admin-pinned salesTemplateId narrowing the list when set (a stale
 * pin falls back to the whole catalog), createdAt ascending.
 */
export async function miniappCatalog(ctx: MiniappCtx): Promise<SaleTemplate[]> {
  const where = { enabled: true, botVisible: true };
  if (ctx.salesTemplateId) {
    const pinned = await db.saleTemplate.findFirst({ where: { ...where, id: ctx.salesTemplateId } });
    if (pinned) return [pinned];
  }
  return db.saleTemplate.findMany({ where, orderBy: { createdAt: "asc" } });
}

/**
 * Mirror of sales-worker.ts resolveCart() — every line is re-validated
 * against the LIVE template row: dead / hidden / FREE templates are
 * dropped so a stale cart can never check out. The mini-app cart lives
 * client-side between requests, so THIS is the cart authority.
 */
export async function resolveMiniappLines(
  items: { templateId: string; qty: number }[]
): Promise<{ tpl: SaleTemplate; qty: number }[]> {
  const out: { tpl: SaleTemplate; qty: number }[] = [];
  for (const line of items.slice(0, 10)) {
    const tpl = await db.saleTemplate.findUnique({ where: { id: line.templateId } });
    if (!tpl || !tpl.enabled || !tpl.botVisible || tpl.priceToman <= 0) continue;
    out.push({ tpl, qty: Math.min(CART_MAX_QTY, Math.max(1, Math.floor(line.qty) || 1)) });
  }
  return out;
}

/* ---------- discount re-validation (2-d pure helpers from orders.ts) ---------- */

export interface MiniappDiscount {
  row: DiscountCode;
  percentOff: number | null;
  maxOff: number | null;
}

export type MiniappDiscountResult =
  | { ok: true; discount: MiniappDiscount | null } // null = no code supplied
  | { ok: false; problem: "invalid" | "expired" | "limit" | "used" }; // honest per-code failure

/** Same normalization + validation as the bot's code step (handleCheckoutCode):
 *  invalid / disabled / expired / usage-limit / already-used-by-this-user. */
export async function validateMiniappDiscount(
  rawCode: string,
  tgId: string
): Promise<MiniappDiscountResult> {
  const code = String(rawCode ?? "").trim().toUpperCase().slice(0, 64);
  if (!code) return { ok: true, discount: null };
  const row = await db.discountCode.findUnique({ where: { code } });
  if (!row) return { ok: false, problem: "invalid" };
  const problem = discountProblem(row, Date.now(), tgId); // 2-d pure helper
  if (problem) {
    // "disabled" collapses to invalid from the buyer's point of view
    return { ok: false, problem: problem === "expired" ? "expired" : problem === "limit" ? "limit" : problem === "used" ? "used" : "invalid" };
  }
  return { ok: true, discount: { row, percentOff: row.percentOff, maxOff: row.maxOff } };
}

/* ---------- bot username (mirror of sales-worker getBotUsername) ---------- */

let botUsernameCache = "";

/** Mirror of sales-worker.ts getBotUsername() — getMe, best-effort cached. */
export async function botUsernameFor(ctx: MiniappCtx): Promise<string> {
  if (botUsernameCache) return botUsernameCache;
  try {
    const me = await tgCall(ctx.token, "getMe", {}, { proxyUrl: ctx.proxyUrl, timeoutMs: 8000 });
    const username = typeof me?.username === "string" ? me.username : "";
    if (username) botUsernameCache = username;
    return username;
  } catch {
    return ""; // deep links degrade; never blocks checkout
  }
}

/* ---------- admin notice (mirror of sales-worker notifyAdminsNewOrder) ---------- */

/** Mirror of sales-worker.ts notifyAdminsNewOrder() — best-effort fan-out. */
export async function notifyAdminsMiniappOrder(ctx: MiniappCtx, order: TgOrder): Promise<void> {
  const text =
    `🛍 <b>Mini-app order</b> <code>${order.id.slice(-6)}</code>\n` +
    `• ${order.templateName} — ${fmtToman(order.amountToman)} Toman\n` +
    `• buyer: ${order.tgUsername || order.tgId} · method: ${order.method}`;
  for (const adminId of ctx.adminChatIds) {
    await sendMessage(ctx.token, adminId, text, undefined, { proxyUrl: ctx.proxyUrl }).catch(() => {});
  }
}

/* ---------- wallet completion (mirror of payWithWalletCart + completeAndDeliver) ---------- */

export interface MiniappSubLink {
  username: string;
  subId: string;
  subUrl: string;
}

export type WalletCompletion =
  | { ok: true; subs: MiniappSubLink[] }
  | { ok: false; reason: "insufficient" };

/**
 * Wallet checkout for the mini-app — REPLICATE of the private
 * sales-worker.ts path (payWithWalletCart → completeAndDeliver →
 * provisionAndDeliverClaimed), pointed at by comment instead of an
 * import because those helpers are file-private:
 *
 *   1. the balance read is the LAST await before the deduct write
 *      (no-yield discipline — a double-tap can never double-spend);
 *   2. the order is created awaiting_payment, then transitionOrder
 *      ("completed") takes the provisioning claim exactly once;
 *   3. the discount counter is consumed at completion (2-d semantics);
 *   4. every cart unit becomes its own ClientUser (provisionOrderUser);
 *   5. ONE delivery message goes to the buyer's bot chat (best-effort,
 *      same botTexts strings the bot uses — identical chat experience)
 *      and the sub links ALSO return to the mini-app.
 */
export async function walletCheckoutComplete(opts: {
  ctx: MiniappCtx;
  tgId: string;
  payable: number;
  order: TgOrder;
}): Promise<WalletCompletion> {
  const { ctx, tgId, payable, order } = opts;
  const tgRow = await db.tgUser.findUnique({ where: { tgId } }); // READ — last await before the write
  const balance = Math.max(0, Math.floor(Number(tgRow?.balanceToman ?? 0)));
  if (balance < payable) return { ok: false, reason: "insufficient" };

  // ---- critical section: NO await between the read above and this write ----
  await db.tgUser.update({ where: { tgId }, data: { balanceToman: balance - payable } });

  const completed = await transitionOrder(order.id, "completed");
  const finalOrder = completed.ok ? completed.order : order;
  await logOrderEvent(finalOrder, "created", "miniapp checkout · wallet debit ok");
  if (completed.ok) {
    await consumeDiscountForOrder(finalOrder).catch(() => {});
  }

  // ---- provisioning loop (mirror of provisionAndDeliverClaimed) ----
  const items = parseOrderItems(finalOrder);
  const langRow = await db.tgUser.findUnique({ where: { tgId: finalOrder.tgId } });
  const lang = ((langRow?.lang as BotLang) ?? ctx.botLang) as BotLang;
  const t = botTexts(lang);
  const subs: MiniappSubLink[] = [];
  const deliveredLines: string[] = [];

  for (const line of items) {
    const qty = Math.min(CART_MAX_QTY, Math.max(1, line.qty));
    const tpl = await db.saleTemplate.findUnique({ where: { id: line.templateId } });
    const name = tpl?.name ?? line.templateId;
    const usernames: string[] = [];
    const links: string[] = [];
    for (let i = 0; i < qty; i++) {
      const user = await provisionOrderUser(finalOrder, tpl);
      const subUrl = ctx.publicHost ? `${ctx.publicHost}/sub/${user.subId}` : `/sub/${user.subId}`;
      subs.push({ username: user.username, subId: user.subId, subUrl });
      usernames.push(user.username);
      links.push(subUrl);
    }
    deliveredLines.push(
      [
        fmt(t.cartDeliveredLine, { name, qty, user: usernames.join(" · "), sub: links[0] ?? "" }),
        ...links.slice(1).map((s) => `  ${s}`),
      ].join("\n")
    );
  }

  // best-effort chat delivery — identical strings to the bot's wallet flow
  if (subs.length === 1) {
    const tplRow = await db.saleTemplate.findUnique({ where: { id: finalOrder.templateId } });
    const sub = subs[0]!;
    await sendMessage(
      ctx.token,
      finalOrder.tgId,
      fmt(t.delivered, {
        user: sub.username,
        gb: fmtGb(tplRow?.trafficLimitGb ?? null),
        days: fmtDays(tplRow?.expiryDays ?? null),
        sub: sub.subUrl,
        clash: ctx.publicHost ? `${ctx.publicHost}/api/sub/${sub.subId}?format=clash` : "",
        singbox: ctx.publicHost ? `${ctx.publicHost}/api/sub/${sub.subId}?format=singbox` : "",
      }),
      ctx.publicHost
        ? { inline_keyboard: [[{ text: t.btnSubLink, url: sub.subUrl }]] }
        : undefined,
      { proxyUrl: ctx.proxyUrl }
    ).catch(() => {});
  } else if (deliveredLines.length > 0 && subs[0]) {
    await sendMessage(
      ctx.token,
      finalOrder.tgId,
      fmt(t.cartDelivered, { lines: deliveredLines.join("\n") }),
      ctx.publicHost
        ? { inline_keyboard: [[{ text: t.btnSubLink, url: subs[0].subUrl }]] }
        : undefined,
      { proxyUrl: ctx.proxyUrl }
    ).catch(() => {});
  }

  return { ok: true, subs };
}

/* ---------- rate limiting (in-memory, per tgId) ---------- */

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30; // 30 requests / minute / tgId on the checkout POST

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window counter; the map is swept on every call so it stays bounded. */
export function miniappRateLimited(tgId: string, nowMs = Date.now()): boolean {
  for (const [k, v] of rateBuckets) {
    if (v.resetAt <= nowMs) rateBuckets.delete(k);
  }
  const bucket = rateBuckets.get(tgId);
  if (!bucket || bucket.resetAt <= nowMs) {
    rateBuckets.set(tgId, { count: 1, resetAt: nowMs + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX;
}
