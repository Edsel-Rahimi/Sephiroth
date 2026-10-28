/* ============================================================
   Sephiroth · Task 25-a — MTProto secret helpers (isomorphic)

   The client `key` field of an mtproto inbound IS the MTProto
   secret. Canonical mtg v2 form:

     ee + 32 lowercase hex chars [+ fake-TLS domain]

   `ee` = faketls-requiring mode, the hex is the 16-byte key,
   the domain suffix activates the fake-TLS camouflage
   (e.g. ee0af9…deadbeefwww.cloudflare.com). `dd` + hex is the
   legacy NON-faketls mode (also accepted by mtg v2).
   ============================================================ */

export const MTP_SECRET_PATTERN = /^(dd|ee)?[0-9a-f]{32}/i;
/** total cap incl. the optional domain suffix (2 + 32 + ~30 chars) */
export const MTP_SECRET_MAX_LEN = 64;
/** fake-TLS default camouflage domain used by quick-create */
export const MTP_DEFAULT_DOMAIN = "www.cloudflare.com";

/**
 * Generate a canonical mtg v2 secret: `ee` + 16 random bytes hex,
 * optionally suffixed with the fake-TLS domain. Uses the global
 * WebCrypto (browser + bun/node ≥18 both expose getRandomValues),
 * mirroring how the Forge's genClientKey stays client-safe.
 */
export function genMtpSecret(domain?: string): string {
  const arr = new Uint8Array(16);
  if (typeof globalThis.crypto !== "undefined" && "getRandomValues" in globalThis.crypto) {
    globalThis.crypto.getRandomValues(arr);
  } else {
    // extremely defensive fallback (old runtimes) — LCG noise, better than crashing
    for (let i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  const d = (domain ?? "").trim();
  return `ee${hex}${d}`;
}

/** True when a key is a usable MTProto secret (hex core, sane length). */
export function isValidMtpSecret(key: string): boolean {
  const k = key.trim();
  if (!k || k.length > MTP_SECRET_MAX_LEN) return false;
  return MTP_SECRET_PATTERN.test(k);
}
