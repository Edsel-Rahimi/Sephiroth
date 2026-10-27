/* ============================================================
   Sephiroth · Task 23-c — ZarinPal v4 REST client (server-only)

   Phase-1 flow (NO webhook): server-side request → give the user
   the StartPay URL → a poll loop calls verify.json for every
   awaiting_payment zarinpal order until it succeeds.

   SEPH_ZARINPAL_BASE overrides https://payment.zarinpal.com —
   used by the mock-E2E acceptance harness only.
   ============================================================ */

const BASE = (process.env.SEPH_ZARINPAL_BASE || "https://payment.zarinpal.com").replace(/\/+$/, "");

export type ZarinResult =
  | { ok: true; authority?: string; refId?: string; code: number }
  | { ok: false; code?: number; reason: string };

function zarinFetch(path: string, body: Record<string, unknown>): Promise<any> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  }).then((r) => r.json().catch(() => ({})));
}

/**
 * Create a payment request. ZarinPal v4 expects the amount in RIAL,
 * so Toman is multiplied by 10.
 */
export async function zarinpalRequest(
  merchantId: string,
  amountToman: number,
  description: string,
  callbackUrl: string
): Promise<ZarinResult> {
  try {
    const json = await zarinFetch("/pg/v4/payment/request.json", {
      merchant_id: merchantId,
      amount: Math.round(amountToman * 10),
      description,
      callback_url: callbackUrl,
    });
    const code = json?.data?.code;
    if (code === 100 && typeof json?.data?.authority === "string") {
      return { ok: true, authority: json.data.authority, code };
    }
    const errCode = json?.errors?.code ?? json?.errors?.[0]?.code;
    return { ok: false, code: errCode, reason: `request failed (code ${errCode ?? "unknown"})` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "network error" };
  }
}

/** Verify a payment. 100 = paid, 101 = already verified (both complete the order). */
export async function zarinpalVerify(
  merchantId: string,
  amountToman: number,
  authority: string
): Promise<ZarinResult> {
  try {
    const json = await zarinFetch("/pg/v4/payment/verify.json", {
      merchant_id: merchantId,
      amount: Math.round(amountToman * 10),
      authority,
    });
    const code = json?.data?.code;
    if ((code === 100 || code === 101) && json?.data) {
      return { ok: true, refId: json.data.ref_id ? String(json.data.ref_id) : undefined, code };
    }
    const errCode = json?.errors?.code ?? json?.errors?.[0]?.code;
    // -51 = not paid yet, -50 = amount mismatch — both keep the order awaiting
    return { ok: false, code: errCode, reason: `verify not complete (code ${errCode ?? "unknown"})` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "network error" };
  }
}

/** StartPay URL the user opens in a browser to pay. */
export function zarinpalStartPayUrl(authority: string): string {
  return `${BASE}/pg/StartPay/${authority}`;
}
