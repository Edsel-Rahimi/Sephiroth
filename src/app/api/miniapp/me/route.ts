import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateMiniapp, ensureTgUser } from "../_shared";

/* ============================================================
   Sephiroth · Task 3-2 — Mini App "my account" (OWNER bot)

   GET /api/miniapp/me
   Auth: `x-telegram-init-data` header (validated initData).

   Returns everything the bot's wallet + subscriptions views show,
   scoped STRICTLY to the validated telegram chatId:
   • wallet balance (TgUser.balanceToman — optional column, ?? 0)
   • subscriptions (ClientUser rows with tgId = chatId, newest 10)
   • orders (TgOrder rows with tgId = chatId, newest 10)
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

    const [subs, orders] = await Promise.all([
      db.clientUser.findMany({
        where: { tgId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      db.tgOrder.findMany({
        where: { tgId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    const balance = Math.max(0, Math.floor(Number(tgRow.balanceToman ?? 0)));

    return NextResponse.json({
      lang: tgRow.lang,
      balanceToman: balance,
      subscriptions: subs.map((u) => ({
        username: u.username,
        subId: u.subId,
        subUrl: ctx.publicHost
          ? `${ctx.publicHost}/sub/${u.subId}`
          : `/sub/${u.subId}`,
        usedTrafficGb: Number(u.usedTrafficGb) || 0,
        trafficLimitGb: u.trafficLimitGb,
        expiryDays: u.expiryDays,
        enabled: Boolean(u.enabled),
        createdAt: new Date(u.createdAt).toISOString(),
      })),
      orders: orders.map((o) => ({
        id: o.id,
        templateName: o.templateName,
        amountToman: Math.max(0, Math.floor(Number(o.amountToman) || 0)),
        method: o.method,
        status: o.status,
        createdAt: new Date(o.createdAt).toISOString(),
      })),
    });
  } catch (err) {
    console.error("[miniapp:me]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
