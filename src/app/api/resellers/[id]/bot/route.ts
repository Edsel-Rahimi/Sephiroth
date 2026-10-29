import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prismaErrorCode, requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import {
  maskResellerSecret,
  resellerBotStats,
  validateResellerBotPatch,
  type ResellerBotDTO,
} from "@/lib/resellers";
import {
  getResellerBotStatus,
  startResellerBot,
  stopResellerBot,
} from "@/lib/bot/reseller-worker";
import { tgCall } from "@/lib/bot/api";
import { getTelegramSettings } from "@/lib/settings";

/* ============================================================
   Sephiroth · task 3-1 — Per-reseller Telegram bot API (admin)

   GET   /api/resellers/[id]/bot
         → ResellerBotDTO — the token NEVER echoes (masked hint
           only); status is the worker's honest per-instance state.
   PUT    { botToken? ("" = keep, masked echo = keep),
            botEnabled?, payCardNumber?, payCardHolder?,
            payZarinpalMerchant? ("" = clear, masked echo = keep) }
         → validates the token shape, restarts that reseller's
           worker instance and probes getMe (bad token → honest
           status error, never a crash).
   POST   → test delivery: sends a short message to the OWNER's
           adminChatIds through the reseller bot token; honest ok/
           reason. Guard convention: requireAdmin (owner/admin RBAC
           like every other resellers route).
   ============================================================ */

type Ctx = { params: Promise<{ id: string }> };

async function buildBotDTO(resellerId: string): Promise<ResellerBotDTO | null> {
  const row = await db.reseller.findUnique({ where: { id: resellerId } });
  if (!row) return null;
  const [status, stats] = await Promise.all([
    Promise.resolve(getResellerBotStatus(resellerId)),
    resellerBotStats(resellerId),
  ]);
  return {
    resellerId,
    botUsername: row.botUsername ?? "",
    botEnabled: Boolean(row.botEnabled),
    tokenConfigured: Boolean((row.botToken ?? "").trim()),
    tokenMasked: maskResellerSecret(row.botToken),
    status,
    customers: stats.customers,
    ordersTotal: stats.ordersTotal,
    ordersCompleted: stats.ordersCompleted,
    salesToday: stats.salesToday,
    salesWeek: stats.salesWeek,
    catalogCount: stats.catalogCount,
    payCardConfigured: Boolean((row.payCardNumber ?? "").trim() && (row.payCardHolder ?? "").trim()),
    payZarinConfigured: Boolean((row.payZarinpalMerchant ?? "").trim()),
    payCardMasked: maskResellerSecret(row.payCardNumber),
    payCardHolder: row.payCardHolder ?? "",
    payZarinMasked: maskResellerSecret(row.payZarinpalMerchant),
  };
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const dto = await buildBotDTO(id);
    if (!dto) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(dto);
  } catch (err) {
    console.error("[resellers:bot:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const existing = await db.reseller.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateResellerBotPatch(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "validation", fields: parsed.fields }, { status: 400 });
    }
    const data = parsed.data;

    const updated = await db.reseller.update({
      where: { id },
      data: {
        ...(data.botToken !== undefined ? { botToken: data.botToken } : {}),
        ...(data.botEnabled !== undefined ? { botEnabled: data.botEnabled } : {}),
        ...(data.payCardNumber !== undefined ? { payCardNumber: data.payCardNumber } : {}),
        ...(data.payCardHolder !== undefined ? { payCardHolder: data.payCardHolder } : {}),
        ...(data.payZarinpalMerchant !== undefined ? { payZarinpalMerchant: data.payZarinpalMerchant } : {}),
      },
    });

    // mirror onTelegramSettingsSaved: a saved settings change restarts the
    // worker instance; getMe runs INSIDE the start probe so a bad token
    // surfaces as an honest status error (the PUT itself still succeeds —
    // the secret was stored, the bot just cannot run).
    if (data.botEnabled === false) {
      stopResellerBot(id, "disabled");
    }
    await startResellerBot(id, { force: true }).catch((err) =>
      console.warn(`[resellers:bot:PUT] restart failed for ${updated.username}:`, err)
    );

    await logActivity({
      kind: "reseller.updated",
      level: "info",
      actor: admin,
      message: `Reseller "${updated.username}" bot settings saved (enabled=${Boolean(updated.botEnabled)}${data.botToken !== undefined ? ", token updated" : ""})`,
      meta: { resellerId: id, botEnabled: Boolean(updated.botEnabled) },
    });

    const dto = await buildBotDTO(id);
    return NextResponse.json(dto);
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[resellers:bot:PUT]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const row = await db.reseller.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const token = (row.botToken ?? "").trim();
    if (!token) {
      return NextResponse.json({ ok: false, reason: "no_token" });
    }
    if (!row.botEnabled) {
      return NextResponse.json({ ok: false, reason: "disabled" });
    }
    const tg = await getTelegramSettings();
    if (tg.adminChatIds.length === 0) {
      return NextResponse.json({ ok: false, reason: "no_admin_chats" });
    }

    const shopName = row.brandName || row.username;
    const text = `🤖 Reseller bot test · shop <b>${shopName.replace(/</g, "&lt;")}</b>${row.botUsername ? ` (@${row.botUsername})` : ""}\nDelivery, receipts and payment links for this shop will come from this bot.`;
    try {
      for (const adminId of tg.adminChatIds) {
        await tgCall(
          token,
          "sendMessage",
          {
            chat_id: adminId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          },
          { proxyUrl: tg.botProxyUrl, timeoutMs: 12_000 }
        );
      }
      await logActivity({
        kind: "reseller.updated",
        level: "info",
        actor: admin,
        message: `Reseller bot test message sent for "${row.username}" to ${tg.adminChatIds.length} admin chat(s)`,
        meta: { resellerId: id, test: true },
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, reason });
    }
  } catch (err) {
    console.error("[resellers:bot:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
