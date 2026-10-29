import { NextResponse } from "next/server";
import {
  authenticateMiniapp,
  ensureTgUser,
  miniappCatalog,
  botUsernameFor,
  type MiniappCtx,
} from "../_shared";
import { tomanToUsdCents, tomanToStars } from "@/lib/bot/orders";

/* ============================================================
   Sephiroth · Task 3-2 — Mini App catalog (OWNER bot)

   GET /api/miniapp/catalog
   Auth: `x-telegram-init-data` header (validated initData) — 401 on
   any failure; 503 when no OWNER bot token is configured.

   Returns the SAME catalog the bot shop shows (mirror of
   shopTemplates() eligibility: enabled + botVisible + optional
   admin pin), the payment methods that are actually configured
   (never a dead button — same gating the bot uses), the wallet
   balance and the bot deep-link for "manage subscription".
   ============================================================ */

export async function GET(req: Request) {
  try {
    const gate = await authenticateMiniapp(req);
    if (!gate.ok) return gate.res;
    const { ctx, user } = gate;

    const tgRow = await ensureTgUser(user, ctx.botLang);
    if (tgRow.banned) {
      return NextResponse.json({ error: "banned" }, { status: 403 });
    }

    const [templates, botUsername] = await Promise.all([
      miniappCatalog(ctx),
      botUsernameFor(ctx),
    ]);

    // balanceToman is OPTIONAL on TgUser (pre-v2.8 rows) — always ?? 0
    const balance = Math.max(0, Math.floor(Number(tgRow.balanceToman ?? 0)));

    // method gating — mirror of the bot's picker (sendTemplateDetail /
    // showCartPaymentPicker): a method ships only when configured.
    const methods = {
      zarinpal:
        ctx.salesPayMode === "zarinpal" && Boolean(ctx.zarinpalMerchant),
      card: Boolean(ctx.cardNumber && ctx.cardHolder),
      wallet: true, // balance-checked at checkout time
      crypto:
        ctx.nowpaymentsEnabled &&
        Boolean(ctx.nowpaymentsApiKey) &&
        ctx.nowpaymentsTomanPerUsd > 0,
      stars: ctx.starsEnabled && ctx.starsTomanPerStar > 0,
    };

    return NextResponse.json({
      lang: tgRow.lang, // the user's explicit bot-language pick wins in the UI
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        languageCode: user.languageCode,
      },
      balanceToman: balance,
      catalog: templates.map((tpl) => ({
        id: tpl.id,
        name: tpl.name,
        trafficLimitGb: tpl.trafficLimitGb,
        expiryDays: tpl.expiryDays,
        ipLimit: tpl.ipLimit,
        priceToman: tpl.priceToman,
      })),
      methods,
      rates: {
        // conversion metadata so the UI can preview Stars/USD amounts —
        // the SERVER recomputes everything at checkout; these are display hints
        tomanPerUsd: ctx.nowpaymentsTomanPerUsd,
        tomanPerStar: ctx.starsTomanPerStar,
        usdReady: tomanToUsdCents(1000, ctx.nowpaymentsTomanPerUsd) > 0,
        starsReady: tomanToStars(1000, ctx.starsTomanPerStar) > 0,
      },
      bot: {
        username: botUsername,
        deepLink: botUsername ? `https://t.me/${botUsername}` : "",
      },
    });
  } catch (err) {
    console.error("[miniapp:catalog]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/* ctx re-export guard — keeps the type import tree-shakeable for other routes */
export type { MiniappCtx };
