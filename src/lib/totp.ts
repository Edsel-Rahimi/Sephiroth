import { createHmac, randomBytes } from "node:crypto";

/* ============================================================
   Sephiroth · v2.2 — TOTP (RFC 6238) server-side helper
   Zero-dependency implementation on node:crypto (same style
   as the rest of the panel). SHA-1 / 6 digits / 30s period —
   the exact profile Google Authenticator, Aegis, 1Password
   and Authy generate by default.
   ============================================================ */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 160-bit random secret → RFC 4648 base32 (no padding). */
export function genTotpSecret(): string {
  const buf = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Hotp digest → 6-digit code (RFC 4226 dynamic truncation). */
function hotp(secretBuf: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const digest = createHmac("sha1", secretBuf).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const bin =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Verify a 6-digit code against the current window (±1 step = ±30s). */
export function verifyTotp(secretB32: string, code: string, window = 1): boolean {
  const clean = (code || "").replace(/\D/g, "");
  if (clean.length !== 6) return false;
  let secretBuf: Buffer;
  try {
    secretBuf = base32Decode(secretB32);
  } catch {
    return false;
  }
  if (secretBuf.length === 0) return false;
  const counter = Math.floor(Date.now() / 30_000);
  for (let off = -window; off <= window; off++) {
    const expected = hotp(secretBuf, counter + off);
    if (clean === expected) return true;
  }
  return false;
}

/** otpauth:// URI for QR rendering (issuer = Sephiroth). */
export function otpauthUri(secretB32: string, account: string): string {
  const label = `Sephiroth:${encodeURIComponent(account || "admin")}`;
  const q = new URLSearchParams({
    secret: secretB32,
    issuer: "Sephiroth",
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
