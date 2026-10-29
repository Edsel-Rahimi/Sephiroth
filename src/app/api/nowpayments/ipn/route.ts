import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPaymentSettings } from "@/lib/settings";
import { logActivity, type ActivityKind } from "@/lib/activity";
import { verifyIpnSignature } from "@/lib/bot/nowpayments";
import { ipnCompleteCryptoOrder } from "@/lib/bot/sales-worker";

/* ============================================================
   Sephiroth · Task 3-a — NowPayments IPN callback (PUBLIC route)

   Deliberately NOT admin-guarded: NowPayments servers POST here.
   Trust comes from the x-nowpayments-sig HMAC-SHA512 signature
   over the RAW body (keys sorted, compact JSON — NowPayments
   canonicalization), verified in constant time against the
   panel's nowpaymentsIpnSecret setting. See nowpayments.ts.

   Contract (documented in the settings card):
   • missing/invalid signature → 400, everything else → 200
     (a 2xx tells NowPayments to stop retrying; internal errors
     are logged, never thrown to the caller);
   • payment_status "finished" + matching awaiting "crypto"
     order → completeAndDeliver (the SAME choke point zarinpal
     and the 60s sweep use) → idempotent by the order state
     machine (already-completed → 200 ok);
   • unknown order → honest 200 "order not found" (no echo of
     the payload, no secret leakage in responses or logs).
   ============================================================ */

export async function POST(req: Request) {
  try {
    // read the RAW body first — the signature covers the exact bytes sent
    const raw = await req.text().catch(() => "");
    const sig = req.headers.get("x-nowpayments-sig") ?? "";

    const pay = await getPaymentSettings();
    if (!pay.nowpaymentsIpnSecret || !verifyIpnSignature(raw, sig, pay.nowpaymentsIpnSecret)) {
      // never leak WHY beyond "invalid signature"; body is not echoed
      await logActivity({
        kind: "payment.crypto.rejected" as unknown as ActivityKind,
        level: "warn",
        actor: "nowpayments-ipn",
        message: "NowPayments IPN rejected — missing or invalid x-nowpayments-sig signature",
        meta: { configured: pay.nowpaymentsIpnSecret.length > 0 },
      });
      return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const orderIdRaw = payload.order_id;
    const orderId = typeof orderIdRaw === "string" ? orderIdRaw : orderIdRaw == null ? "" : String(orderIdRaw);
    const paymentStatus = String(payload.payment_status ?? "");

    if (paymentStatus !== "finished") {
      // waiting / confirming / failed / expired … — acknowledge, do nothing
      return NextResponse.json({ ok: true, handled: false, reason: `status "${paymentStatus}" ignored` });
    }

    const order = orderId ? await db.tgOrder.findUnique({ where: { id: orderId } }) : null;
    if (!order || order.method !== "crypto") {
      return NextResponse.json({ ok: true, handled: false, reason: "order not found" });
    }
    if (order.status !== "awaiting_payment") {
      // idempotent replay (IPN + 60s sweep may both fire) — plain 200
      return NextResponse.json({ ok: true, handled: false, reason: "order already settled" });
    }

    await logActivity({
      kind: "payment.crypto.started" as unknown as ActivityKind,
      level: "info",
      actor: "nowpayments-ipn",
      message: `NowPayments IPN finished for order ${order.id.slice(-6)} (${order.amountToman} Toman) — completing via crypto`,
      meta: { orderId: order.id, tgId: order.tgId, paymentStatus },
    });

    // the SAME completeAndDeliver pipeline zarinpal's verify sweep uses
    await ipnCompleteCryptoOrder(order.id);

    await logActivity({
      kind: "payment.crypto.completed" as unknown as ActivityKind,
      level: "success",
      actor: "nowpayments-ipn",
      message: `Crypto payment completed for order ${order.id.slice(-6)} (${order.amountToman} Toman) via NowPayments IPN`,
      meta: { orderId: order.id, tgId: order.tgId, method: "crypto" },
    });
    return NextResponse.json({ ok: true, handled: true });
  } catch (err) {
    // never throw to the gateway — a 2xx with handled:false keeps us honest
    console.warn("[nowpayments:ipn] handler error:", err);
    return NextResponse.json({ ok: true, handled: false, reason: "internal error" });
  }
}

export async function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
