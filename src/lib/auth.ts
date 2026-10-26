import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

/* ============================================================
   Sephiroth · Phase 1 — Auth & Security (server-only)
   - scrypt password hashing (no external deps)
   - HMAC-SHA256 signed session token (payload.signature)
   - in-memory brute-force lockout: 5 failures → 5 min lock
   - lazy seed: admin / sephiroth + preview recovery key
   ============================================================ */

export const SESSION_COOKIE = "sephiroth_session";

export const SESSION_TTL_SHORT = 24 * 60 * 60 * 1000; // 24h
export const SESSION_TTL_LONG = 30 * 24 * 60 * 60 * 1000; // 30d

export const LOCK_LIMIT = 5;
const LOCK_MS = 5 * 60 * 1000;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

/** Preview-only seed credentials — real credentials become editable in Phase 7 */
export const PREVIEW = {
  username: "admin",
  password: "sephiroth",
  recoveryKey: "SEPH-ORBIT-2077-NOVA",
} as const;

/* ---------- password hashing ---------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const original = Buffer.from(hash, "hex");
  return (
    original.length === candidate.length && timingSafeEqual(original, candidate)
  );
}

/* ---------- session secret (rotatable) ---------- */

async function getSecret(): Promise<string> {
  const row = await db.serverSetting.findUnique({
    where: { key: "session_secret" },
  });
  if (row?.value) return row.value;
  const value = randomBytes(32).toString("hex");
  await db.serverSetting.upsert({
    where: { key: "session_secret" },
    update: { value },
    create: { key: "session_secret", value },
  });
  return value;
}

/** Rotating the secret instantly invalidates every issued session. */
export async function rotateSessionSecret(): Promise<void> {
  const value = randomBytes(32).toString("hex");
  await db.serverSetting.upsert({
    where: { key: "session_secret" },
    update: { value },
    create: { key: "session_secret", value },
  });
}

/* ---------- token ---------- */

export async function signToken(
  username: string,
  ttlMs: number
): Promise<string> {
  const secret = await getSecret();
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + ttlMs })
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export async function verifyToken(
  token: string | undefined
): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const secret = await getSecret();
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      u?: string;
      exp?: number;
    };
    if (!data.u || typeof data.exp !== "number" || data.exp < Date.now())
      return null;
    return data.u;
  } catch {
    return null;
  }
}

/* ---------- lazy seed ---------- */

export async function ensureSeed(): Promise<void> {
  await getSecret();
  const existing = await db.adminUser.findFirst();
  if (!existing) {
    // Deployment-configurable admin credentials (docker-compose env);
    // falls back to the preview defaults when unset.
    const username = (process.env.SEPHIROTH_ADMIN_USER ?? "").trim() || PREVIEW.username;
    const password = process.env.SEPHIROTH_ADMIN_PASS ?? PREVIEW.password;
    await db.adminUser.create({
      data: {
        username,
        passwordHash: hashPassword(password),
        recoveryKey: PREVIEW.recoveryKey,
        displayName: "Sephiroth Commander",
      },
    });
  }
}

/* ---------- brute-force lockout (per client IP, in-memory) ---------- */

interface LockEntry {
  count: number;
  until: number; // locked-until timestamp (0 = not locked)
  last: number; // last failure timestamp
}

const globalLocks = globalThis as unknown as {
  __sephirothLocks?: Map<string, LockEntry>;
};
const locks: Map<string, LockEntry> =
  globalLocks.__sephirothLocks ?? new Map();
globalLocks.__sephirothLocks = locks;

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "local";
}

export function lockState(
  ip: string
): { locked: true; retryAfter: number } | { locked: false } {
  const entry = locks.get(ip);
  if (entry && entry.until > Date.now()) {
    return {
      locked: true,
      retryAfter: Math.ceil((entry.until - Date.now()) / 1000),
    };
  }
  return { locked: false };
}

/** Register a failed attempt. Returns remaining attempts / lock status. */
export function registerFailure(ip: string): {
  locked: boolean;
  attemptsLeft: number;
  retryAfter?: number;
} {
  const now = Date.now();
  const entry = locks.get(ip);
  const fresh =
    entry && now - entry.last < FAIL_WINDOW_MS
      ? entry
      : { count: 0, until: 0, last: now };
  fresh.count += 1;
  fresh.last = now;

  if (fresh.count >= LOCK_LIMIT) {
    fresh.until = now + LOCK_MS;
    locks.set(ip, fresh);
    return {
      locked: true,
      attemptsLeft: 0,
      retryAfter: Math.ceil(LOCK_MS / 1000),
    };
  }
  locks.set(ip, fresh);
  return { locked: false, attemptsLeft: LOCK_LIMIT - fresh.count };
}

export function clearFailures(ip: string): void {
  locks.delete(ip);
}

/* ---------- cookie helpers ---------- */

export function parseSessionCookie(req: Request): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const raw = rest.join("=");
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}

export function sessionCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
    secure: process.env.NODE_ENV === "production",
  };
}

/* ---------- Phase 6 — dual-role session ---------- */

export type Actor =
  | { role: "admin"; username: string }
  | { role: "reseller"; id: string; username: string };

const globalSessionFallback = globalThis as unknown as {
  __sephirothFallbackActor?: Actor | null;
  __sephirothFallbackInitialized?: boolean;
};

if (!globalSessionFallback.__sephirothFallbackInitialized) {
  globalSessionFallback.__sephirothFallbackActor = { role: "admin", username: "admin" };
  globalSessionFallback.__sephirothFallbackInitialized = true;
}

export function setServerFallbackActor(actor: Actor | null): void {
  globalSessionFallback.__sephirothFallbackActor = actor;
}

/**
 * Resolve the session cookie into an admin OR reseller actor.
 * Admin table is authoritative first (a username existing in both
 * tables always resolves to the admin). Disabled resellers are
 * rejected. Server-side fallback actor is ONLY honored when the
 * deployment explicitly opts in via SEPH_PREVIEW_AUTH=1 (sandbox /
 * iframe previews where third-party cookies are blocked). Real
 * deployments stay cookie-authenticated — no anonymous admin access.
 */
export async function getSession(req: Request): Promise<Actor | null> {
  const cookieToken = parseSessionCookie(req);
  if (cookieToken) {
    const username = await verifyToken(cookieToken);
    if (username) {
      const admin = await db.adminUser.findUnique({ where: { username } });
      if (admin) return { role: "admin", username };

      const reseller = await db.reseller.findUnique({ where: { username } });
      if (reseller && reseller.enabled) {
        return { role: "reseller", id: reseller.id, username };
      }
    }
  }

  if (process.env.SEPH_PREVIEW_AUTH === "1") {
    return globalSessionFallback.__sephirothFallbackActor ?? null;
  }
  return null;
}
