/* ============================================================
   Sephiroth · Task 3-a — NowPayments crypto gateway client
   (server-only, mirrors the shape of zarinpal.ts)

   Phase-1 flow (NO webhook requirement): the bot creates an
   invoice via POST /invoice, hands the buyer the invoice_url and
   a 60s sweep polls GET /invoice/{id} for every awaiting crypto
   order until it settles — exactly like the ZarinPal verify loop.
   The public IPN route (/api/nowpayments/ipn) is the FAST path:
   it re-uses verifyIpnSignature + the same completeAndDeliver
   choke point, so IPN-less setups still complete via the sweep.

   API base: https://api.nowpayments.io/v1
   Sandbox:  https://api.sandbox.nowpayments.io/v1
   SEPH_NOWPAYMENTS_BASE overrides the live base — used by the
   mock acceptance harness only (same pattern as SEPH_ZARINPAL_BASE).

   The API key / IPN secret NEVER appear in a log line — errors
   surface only endpoint + HTTP status / provider description.
   ============================================================ */

import { createHmac, timingSafeEqual } from "node:crypto";

const LIVE_BASE = (process.env.SEPH_NOWPAYMENTS_BASE || "https://api.nowpayments.io/v1").replace(/\/+$/, "");
const SANDBOX_BASE = "https://api.sandbox.nowpayments.io/v1";

export type NowResult =
  | { ok: true; invoiceId: string; invoiceUrl: string }
  | { ok: false; reason: string };

export type NowInvoiceStatus = {
  ok: boolean;
  paymentStatus: string; // waiting / confirming / confirmed / finished / failed / expired / refunded
  reason: string; // honest failure description when ok=false
};

function baseFor(sandbox: boolean): string {
  return sandbox ? SANDBOX_BASE : LIVE_BASE;
}

/** 8s timeout, JSON POST, x-api-key auth. Never logs the key. */
async function nowFetch(
  base: string,
  path: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/**
 * Create a NowPayments invoice for a Toman order. The Toman→USD
 * conversion happens at CONFIG time (nowpaymentsTomanPerUsd setting,
 * see tomanToUsdCents in orders.ts) — the gateway always sees USD.
 * `orderId` rides as order_id so the IPN callback can match the
 * order without any extra state.
 */
export async function nowpaymentsCreateInvoice(opts: {
  apiKey: string;
  sandbox: boolean;
  /** USD price as a decimal string with ≤2dp (cents/100 — integer-safe). */
  priceUsd: string;
  orderId: string;
  orderDescription: string;
  ipnCallbackUrl: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<NowResult> {
  try {
    const { status, json } = await nowFetch(baseFor(opts.sandbox), "/invoice", opts.apiKey, {
      price_amount: opts.priceUsd,
      price_currency: "usd",
      pay_currency: "any", // buyer picks the coin on the invoice page
      order_id: opts.orderId,
      order_description: opts.orderDescription.slice(0, 128),
      ipn_callback_url: opts.ipnCallbackUrl,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
    });
    if (status >= 200 && status < 300 && typeof json?.id === "string" && json.id) {
      const url = typeof json?.invoice_url === "string" ? json.invoice_url : "";
      if (url) return { ok: true, invoiceId: json.id, invoiceUrl: url };
      return { ok: false, reason: "invoice created but response missing invoice_url" };
    }
    const desc =
      json?.message ?? json?.description ?? json?.error ?? (Array.isArray(json?.messages) ? json.messages.join("; ") : "");
    return { ok: false, reason: `invoice request failed (HTTP ${status}${desc ? `: ${desc}` : ""})` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "network error" };
  }
}

/**
 * Poll an invoice's payment status (60s sweep). ok=true only for a
 * well-formed HTTP-200 answer — the caller decides which
 * payment_status values complete the order.
 */
export async function nowpaymentsInvoiceStatus(
  apiKey: string,
  sandbox: boolean,
  invoiceId: string
): Promise<NowInvoiceStatus> {
  try {
    const { status, json } = await nowFetch(baseFor(sandbox), `/invoice/${encodeURIComponent(invoiceId)}`, apiKey);
    if (status >= 200 && status < 300 && json && typeof json === "object") {
      return { ok: true, paymentStatus: String(json.payment_status ?? ""), reason: "" };
    }
    return { ok: false, paymentStatus: "", reason: `status check failed (HTTP ${status})` };
  } catch (err) {
    return { ok: false, paymentStatus: "", reason: err instanceof Error ? err.message : "network error" };
  }
}

/* ---------- IPN signature (HMAC-SHA512 over sorted-key JSON) ---------- */

/**
 * Canonical serialization NowPayments signs: keys sorted recursively
 * (alphabetically), compact JSON. The IPN callback body must be fed
 * RAW (string) — never a re-parsed-then-reformatted object — and the
 * x-nowpayments-sig member is dropped before signing.
 */
export function sortedJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(sortedJsonStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedJsonStringify(obj[k])}`).join(",")}}`;
}

/**
 * Verify an x-nowpayments-sig header against the RAW request body
 * using the panel's IPN secret. Constant-time compare; false on any
 * malformed input (missing secret / empty sig / unparseable JSON).
 */
export function verifyIpnSignature(
  rawBody: string,
  signatureHeader: string,
  ipnSecret: string
): boolean {
  if (!ipnSecret || !signatureHeader) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const { "x-nowpayments-sig": _drop, ...rest } = parsed as Record<string, unknown>;
  void _drop;
  const canonical = sortedJsonStringify(rest);
  const expected = createHmac("sha512", ipnSecret).update(canonical).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signatureHeader).trim().toLowerCase(), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Compute the signature for a payload (test affordance / self-check). */
export function computeIpnSignature(payload: unknown, ipnSecret: string): string {
  return createHmac("sha512", ipnSecret).update(sortedJsonStringify(payload)).digest("hex");
}
