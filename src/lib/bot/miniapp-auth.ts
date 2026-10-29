import { createHmac, timingSafeEqual } from "node:crypto";

/* ============================================================
   Sephiroth · Task 3-2 — Telegram Mini App initData validation
   (server-only · OWNER bot)

   Telegram Mini Apps hand the web app a signed `initData` query
   string. The web app forwards it verbatim (here: through the
   `x-telegram-init-data` request header) and the server proves,
   with the OWNER bot token, that ONLY Telegram could have signed
   it. The exact chain (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):

     1. data_check_string = every received field sorted
        alphabetically, rendered as "key=value" lines joined by
        "\n" — with the "hash" field EXCLUDED (every other field,
        including "signature" when present, participates).
     2. secret_key       = HMAC_SHA256(key="WebAppData",
                                        data=bot_token)
     3. computed_hash    = hex(HMAC_SHA256(key=secret_key,
                                           data=data_check_string))
     4. computed_hash must equal the received "hash" — compared
        with timingSafeEqual (constant time, length guarded).

   In addition the `auth_date` unix-seconds must be within
   MAX_AUTH_AGE_MS (24h) of now — a replayed init from days ago
   is rejected even though its signature is still mathematically
   valid — and never more than FUTURE_SKEW_MS in the future.

   Scope note: this is the OWNER bot's mini-app. Reseller mini-apps
   (per-reseller bot token + their own storefront) are future work;
   the validator takes the token as a parameter so the reseller
   path can reuse it unchanged.
   ============================================================ */

/** Maximum accepted age of the initData auth_date (Telegram freshness window). */
export const MAX_AUTH_AGE_MS = 24 * 60 * 60 * 1000;
/** Tolerated clock skew for auth_date slightly ahead of the server clock. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/** The Telegram user carried inside validated initData. */
export interface MiniappTgUser {
  /** Telegram user id (chat id for DMs) — canonical string form. */
  id: string;
  /** "@username" or first_name fallback — mirrors upsertTgUser's shape. */
  username: string;
  firstName: string;
  /** Raw language_code from Telegram (e.g. "fa-IR"); "" when absent. */
  languageCode: string;
}

export type MiniappAuthResult =
  | { ok: true; user: MiniappTgUser; authDate: number }
  | {
      ok: false;
      reason:
        | "malformed" // not a query string / unparsable
        | "missing_hash"
        | "bad_signature" // HMAC chain failed — NOT signed by this bot
        | "expired" // auth_date older than MAX_AUTH_AGE_MS (or in the future)
        | "missing_user";
    }

/** Parse `key=value&...` pairs without the URLSearchParams edge cases
 *  (Telegram initData values can contain raw "+" in base64 — the
 *  official algorithm splits on & and the FIRST = only). */
function parseInitPairs(initData: string): Map<string, string> | null {
  if (typeof initData !== "string" || initData.length === 0 || initData.length > 4096) return null;
  const map = new Map<string, string>();
  for (const pair of initData.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) return null;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    try {
      map.set(key, decodeURIComponent(value));
    } catch {
      return null;
    }
  }
  return map;
}

/**
 * Validate Telegram Mini App `initData` against the bot token.
 * NEVER logs initData or the token — only tgId may appear in logs.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  opts?: { maxAgeMs?: number; nowMs?: number }
): MiniappAuthResult {
  const now = opts?.nowMs ?? Date.now();
  const maxAge = opts?.maxAgeMs ?? MAX_AUTH_AGE_MS;

  const pairs = parseInitPairs(initData);
  if (!pairs) return { ok: false, reason: "malformed" };

  const hash = pairs.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  // ---- 1. data_check_string: sorted "key=value" lines, hash excluded ----
  const dataCheckString = [...pairs.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // ---- 2. secret = HMAC_SHA256(key="WebAppData", data=botToken) ----
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();

  // ---- 3. computed = HMAC_SHA256(key=secret, data=dataCheckString) ----
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // ---- 4. constant-time compare (length-guarded) ----
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(hash.trim().toLowerCase(), "utf8");
  if (a.length !== b.length || a.length === 0 || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  // ---- freshness window on auth_date (unix seconds) ----
  const authDateRaw = Number(pairs.get("auth_date"));
  if (!Number.isFinite(authDateRaw) || authDateRaw <= 0) return { ok: false, reason: "expired" };
  const authDateMs = authDateRaw * 1000;
  if (authDateMs < now - maxAge || authDateMs > now + FUTURE_SKEW_MS) {
    return { ok: false, reason: "expired" };
  }

  // ---- user payload ----
  const rawUser = pairs.get("user") ?? "";
  let user: MiniappTgUser | null = null;
  try {
    const u = JSON.parse(rawUser) as Record<string, unknown>;
    const id = Number(u?.id);
    if (Number.isFinite(id) && id > 0) {
      const firstName = typeof u?.first_name === "string" ? u.first_name : "";
      const username = typeof u?.username === "string" && u.username ? `@${u.username}` : firstName;
      user = {
        id: String(Math.floor(id)),
        username,
        firstName,
        languageCode: typeof u?.language_code === "string" ? u.language_code : "",
      };
    }
  } catch {
    user = null;
  }
  if (!user) return { ok: false, reason: "missing_user" };

  return { ok: true, user, authDate: authDateMs };
}

/** Consistent 401 body for every miniapp API route. */
export function miniappUnauthorized(
  reason:
    | Exclude<Extract<MiniappAuthResult, { ok: false }>["reason"], undefined>
    | "missing_init_data"
) {
  return { error: "unauthorized", reason };
}
