import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cartTotals, tomanToStars, transitionOrder, logOrderEvent } from "@/lib/bot/orders";
import { zarinpalRequest, zarinpalStartPayUrl } from "@/lib/bot/zarinpal";
import { nowpaymentsCreateInvoice } from "@/lib/bot/nowpayments";
import {
  authenticateMiniapp,
  ensureTgUser,
  resolveMiniappLines,
  validateMiniappDiscount,
  walletCheckoutComplete,
  notifyAdminsMiniappOrder,
  miniappRateLimited,
  botUsernameFor,
} from "../_shared";

/* ============================================================
   Sephiroth · Task 3-2 — Mini App checkout (OWNER bot)

   POST /api/miniapp/checkout
   Auth: `x-telegram-init-data` header (validated initData).
   Body: { items: [{ templateId, qty }], code?: string,
           method: "zarinpal" | "card" | "wallet" | "crypto" | "stars" }

   EVERYTHING money-related is computed SERVER-side: cart lines are
   re-validated against live templates (resolveCart semantics), the
   discount code is re-validated (discountProblem), totals come from
   the 2-d pure helpers (cartTotals) — the mini-app's numbers are
   never trusted. Order creation mirrors the bot's startCartPayment
   base EXACTLY (itemsJson / discountJson / amountToman = post-
   discount payable / templateName joined "name×qty"). The TgOrder
   table has no source column (checked db.ts) — the mini-app origin
   is marked in the activity log detail ("miniapp checkout · …") and
   the admin notice, per the "mark source if a field exists, else
   meta" rule.

   Payment handoff per method (honest paths):
   • wallet    → full server-side flow (deduct + provision), subs returned
   • zarinpal  → order awaiting_payment + StartPay redirect URL
   • crypto    → order awaiting_payment + NowPayments invoice_url
   • card      → order pending_manual + card details; the receipt photo
                 sent in the bot chat completes it (handleReceiptPhoto
                 matches any pending_manual card order of this tgId)
   • stars     → Telegram Stars invoices CANNOT be sent from a web app
                 (sendInvoice is a Bot-API chat call) — the order is
                 created awaiting_payment and the response carries a
                 "handoff_bot" status + bot deep link; the buyer confirms
                 the XTR invoice inside the bot chat. Documented
                 trade-off: the order stays awaiting_payment until that
                 chat payment settles (no money can move until then).
   ============================================================ */

interface CheckoutBody {
  items?: unknown;
  code?: unknown;
  method?: unknown;
}

function parseItems(raw: unknown): { templateId: string; qty: number }[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) return null;
  const out: { templateId: string; qty: number }[] = [];
  for (const item of raw) {
    const templateId = typeof (item as { templateId?: unknown })?.templateId === "string"
      ? (item as { templateId: string }).templateId.trim()
      : "";
    const qty = Math.floor(Number((item as { qty?: unknown })?.qty));
    if (!templateId || !Number.isFinite(qty) || qty < 1 || qty > 10) return null;
    out.push({ templateId, qty });
  }
  return out;
}

const METHODS = new Set(["zarinpal", "card", "wallet", "crypto", "stars"]);

export async function POST(req: Request) {
  try {
    const gate = await authenticateMiniapp(req);
    if (!gate.ok) return gate.res;
    const { ctx, user } = gate;

    // in-memory rate limit — 30 req/min per tgId
    if (miniappRateLimited(user.id)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const tgRow = await ensureTgUser(user, ctx.botLang);
    if (tgRow.banned) {
      return NextResponse.json({ error: "banned" }, { status: 403 });
    }

    let body: CheckoutBody;
    try {
      body = (await req.json()) as CheckoutBody;
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const method = typeof body.method === "string" ? body.method : "";
    if (!METHODS.has(method)) {
      return NextResponse.json({ error: "bad_method" }, { status: 400 });
    }

    const parsed = parseItems(body.items);
    if (!parsed) {
      return NextResponse.json({ error: "bad_items" }, { status: 400 });
    }

    // live re-validation — the cart authority (mirror of resolveCart)
    const lines = await resolveMiniappLines(parsed);
    if (lines.length === 0) {
      return NextResponse.json({ error: "empty_cart" }, { status: 400 });
    }

    // discount re-validation (same rules as the bot's code step)
    const rawCode = typeof body.code === "string" ? body.code : "";
    const discountRes = await validateMiniappDiscount(rawCode, user.id);
    if (!discountRes.ok) {
      return NextResponse.json({ error: "bad_code", problem: discountRes.problem }, { status: 400 });
    }
    const discount = discountRes.discount;

    // server-side totals (task 2-d pure math)
    const totals = cartTotals(
      lines.map((l) => ({ unitPrice: l.tpl.priceToman, qty: l.qty })),
      discount?.percentOff ?? null,
      discount?.maxOff ?? null
    );
    if (totals.payable <= 0) {
      return NextResponse.json({ error: "empty_cart" }, { status: 400 });
    }

    // order base — mirror of startCartPayment's CartOrderBase
    const itemsJson = JSON.stringify(lines.map((l) => ({ templateId: l.tpl.id, qty: l.qty })));
    const base = {
      tgId: user.id,
      tgUsername: tgRow.tgUsername ?? "",
      templateId: lines[0]!.tpl.id, // legacy column — first line
      templateName: lines
        .map((l) => `${l.tpl.name}×${l.qty}`)
        .join(" + ")
        .slice(0, 96),
      amountToman: totals.payable,
      ...(discount
        ? {
            discountJson: JSON.stringify({
              code: discount.row.code,
              percentOff: discount.row.percentOff,
              maxOff: discount.row.maxOff,
              discountToman: totals.discount,
            }),
          }
        : {}),
    };

    const receipt = {
      totalToman: totals.total,
      discountToman: totals.discount,
      payableToman: totals.payable,
      code: discount?.row.code ?? "",
    };

    /* ---------- wallet — full server-side flow ---------- */
    if (method === "wallet") {
      const order = await db.tgOrder.create({
        data: { ...base, itemsJson, method: "wallet", status: "awaiting_payment" },
      });
      const completion = await walletCheckoutComplete({
        ctx,
        tgId: user.id,
        payable: totals.payable,
        order,
      });
      if (!completion.ok) {
        // balance moved between the pre-read and the critical section —
        // cancel honestly (awaiting → canceled is a legal transition)
        await transitionOrder(order.id, "canceled").catch(() => {});
        await logOrderEvent(order, "canceled", "miniapp wallet · insufficient at debit time");
        return NextResponse.json(
          { error: "insufficient_funds", payableToman: totals.payable },
          { status: 400 }
        );
      }
      return NextResponse.json({
        status: "paid",
        orderId: order.id,
        ...receipt,
        subs: completion.subs,
      });
    }

    /* ---------- zarinpal — redirect URL (same as the bot) ---------- */
    if (method === "zarinpal") {
      if (!(ctx.salesPayMode === "zarinpal" && ctx.zarinpalMerchant)) {
        return NextResponse.json({ error: "method_unavailable", method }, { status: 400 });
      }
      const host = ctx.publicHost || "https://t.me";
      const reqZ = await zarinpalRequest(
        ctx.zarinpalMerchant,
        totals.payable,
        `Sephiroth · ${base.templateName}`,
        host
      );
      if (!reqZ.ok || !reqZ.authority) {
        console.error(
          `[miniapp:checkout] zarinpal failed for ${user.id}: ${
            reqZ.ok ? `missing authority (code ${reqZ.code})` : reqZ.reason
          }`
        );
        return NextResponse.json({ error: "gateway_error" }, { status: 502 });
      }
      const order = await db.tgOrder.create({
        data: { ...base, itemsJson, method, status: "awaiting_payment", authority: reqZ.authority },
      });
      await logOrderEvent(order, "created", "miniapp checkout · zarinpal request ok");
      await notifyAdminsMiniappOrder(ctx, order);
      return NextResponse.json({
        status: "redirect",
        orderId: order.id,
        ...receipt,
        redirectUrl: zarinpalStartPayUrl(reqZ.authority),
      });
    }

    /* ---------- crypto (NowPayments) — invoice_url ---------- */
    if (method === "crypto") {
      const ready =
        ctx.nowpaymentsEnabled && Boolean(ctx.nowpaymentsApiKey) && ctx.nowpaymentsTomanPerUsd > 0;
      if (!ready) {
        return NextResponse.json({ error: "method_unavailable", method }, { status: 400 });
      }
      const cents = Math.round((totals.payable * 100) / ctx.nowpaymentsTomanPerUsd);
      if (cents <= 0) {
        return NextResponse.json({ error: "method_unavailable", method }, { status: 400 });
      }
      const order = await db.tgOrder.create({
        data: { ...base, itemsJson, method: "crypto", status: "awaiting_payment" },
      });
      const host = ctx.publicHost || "https://t.me";
      const priceUsd = (cents / 100).toFixed(2);
      const inv = await nowpaymentsCreateInvoice({
        apiKey: ctx.nowpaymentsApiKey,
        sandbox: ctx.nowpaymentsSandbox,
        priceUsd,
        orderId: order.id,
        orderDescription: `Sephiroth · ${base.templateName}`,
        ipnCallbackUrl: `${host}/api/nowpayments/ipn`,
        successUrl: host,
        cancelUrl: host,
      });
      if (!inv.ok) {
        // mirror launchCryptoOrder: invoice failure CANCELS the order —
        // never a fake invoice, never a stranded order
        await transitionOrder(order.id, "canceled").catch(() => {});
        await logOrderEvent(order, "canceled", `miniapp crypto invoice failed: ${inv.reason}`);
        return NextResponse.json({ error: "gateway_error" }, { status: 502 });
      }
      await db.tgOrder.update({ where: { id: order.id }, data: { authority: inv.invoiceId } });
      await logOrderEvent(order, "created", `miniapp checkout · crypto invoice (${priceUsd} USD)`);
      await notifyAdminsMiniappOrder(ctx, { ...order, authority: inv.invoiceId });
      return NextResponse.json({
        status: "redirect",
        orderId: order.id,
        ...receipt,
        redirectUrl: inv.invoiceUrl,
        priceUsd,
      });
    }

    /* ---------- Telegram Stars — honest handoff to the bot ---------- */
    if (method === "stars") {
      const stars = tomanToStars(totals.payable, ctx.starsTomanPerStar);
      if (!(ctx.starsEnabled && ctx.starsTomanPerStar > 0) || stars <= 0) {
        return NextResponse.json({ error: "method_unavailable", method }, { status: 400 });
      }
      // Stars invoices can only be sent by the bot INSIDE the chat
      // (sendInvoice is not available to web apps) — the order is created
      // awaiting_payment and the buyer confirms it in the bot chat. No
      // money can move from the mini-app for Stars; this order completes
      // only via the bot's successful_payment handler.
      const order = await db.tgOrder.create({
        data: { ...base, itemsJson, method: "stars", status: "awaiting_payment" },
      });
      await logOrderEvent(order, "created", `miniapp checkout · stars handoff (${stars} XTR)`);
      await notifyAdminsMiniappOrder(ctx, order);
      const username = await botUsernameFor(ctx);
      return NextResponse.json({
        status: "handoff_bot",
        orderId: order.id,
        ...receipt,
        stars,
        deepLink: username ? `https://t.me/${username}` : "",
      });
    }

    /* ---------- card-to-card — receipt photo completes it in the bot ---------- */
    if (method === "card") {
      if (!(ctx.cardNumber && ctx.cardHolder)) {
        return NextResponse.json({ error: "method_unavailable", method }, { status: 400 });
      }
      const order = await db.tgOrder.create({
        data: { ...base, itemsJson, method: "card", status: "pending_manual" },
      });
      await logOrderEvent(order, "created", "miniapp checkout · awaiting receipt photo");
      await notifyAdminsMiniappOrder(ctx, order);
      const username = await botUsernameFor(ctx);
      return NextResponse.json({
        status: "await_receipt",
        orderId: order.id,
        ...receipt,
        card: { number: ctx.cardNumber, holder: ctx.cardHolder },
        deepLink: username ? `https://t.me/${username}` : "",
      });
    }

    return NextResponse.json({ error: "bad_method" }, { status: 400 });
  } catch (err) {
    console.error("[miniapp:checkout]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
