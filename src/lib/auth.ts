import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";
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
        role: "owner", // task 3-b — the seeded admin is always the owner
        enabled: true,
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

export function sessionCookieOptions(maxAgeSec: number, req?: Request) {
  // Only mark the cookie Secure when the request actually arrived over
  // HTTPS (direct or via a proxy that sets x-forwarded-proto). Panels
  // deployed on plain-HTTP hosts (e.g. KataBump IP:port allocations)
  // would otherwise never receive the session cookie back.
  const proto = req?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isHttps = proto === "https" || req?.url?.startsWith("https://");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
    secure: isHttps,
  };
}

/* ---------- Phase 27 — Public API bearer tokens ---------- */

/** sha256 hex of a raw public-API token — the only stored form. */
export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Mint a fresh public-API token: seph_<32hex>. */
export function genApiToken(): { raw: string; hash: string; prefix: string } {
  const raw = `seph_${randomBytes(16).toString("hex")}`;
  return { raw, hash: hashApiToken(raw), prefix: `${raw.slice(0, 12)}…` };
}

const API_TOKEN_LASTUSE_THROTTLE_MS = 60_000;

const gLastUse = globalThis as unknown as {
  __sephApiTokenLastUse?: Map<string, number>;
};
const lastUseMemo: Map<string, number> =
  gLastUse.__sephApiTokenLastUse ?? new Map();
gLastUse.__sephApiTokenLastUse = lastUseMemo;

/**
 * Resolve an `Authorization: Bearer seph_…` header into an admin actor.
 * The dashboard REST API doubles as the public API (Marzban-style): any
 * route that accepts the session cookie also accepts a valid token.
 * Disabled/revoked tokens are rejected; lastUsed touches are throttled
 * per token (60s, in-memory) so hot polling clients don't rewrite the store.
 */
async function actorFromBearer(
  req: Request
): Promise<Actor | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const raw = m[1]!.trim();
  if (!raw.startsWith("seph_") || raw.length < 12 || raw.length > 128) return null;

  const hash = hashApiToken(raw);
  const row = await db.apiToken.findUnique({ where: { tokenHash: hash } });
  if (!row || !row.enabled) return null;

  // task 3-b — a token inherits the fine-grained role of the admin that
  // minted it; if that admin has since been disabled the token is dead too.
  const issuer = await db.adminUser.findUnique({ where: { username: row.actorUsername } });
  if (issuer && issuer.enabled === false) return null;

  const now = Date.now();
  const last = lastUseMemo.get(row.id) ?? 0;
  if (now - last > API_TOKEN_LASTUSE_THROTTLE_MS) {
    lastUseMemo.set(row.id, now);
    void db.apiToken
      .update({
        where: { id: row.id },
        data: { lastUsedAt: new Date(), lastUsedIp: clientIp(req) },
      })
      .catch(() => {});
  }
  return {
    adminRole: "owner", // task 3-b — API tokens keep full-admin power when the issuing admin row is gone
    role: "admin",
    username: row.actorUsername,
  };
}

/* ---------- Phase 6 — dual-role session ---------- */

/** task 3-b — fine-grained admin roles layered UNDER the legacy "admin" actor. */
export type AdminRole = "owner" | "admin" | "viewer";

export const ADMIN_ROLES: readonly AdminRole[] = ["owner", "admin", "viewer"] as const;

/** Coerce a stored role value (legacy/unknown → owner, backward compatible). */
export function normalizeAdminRole(value: unknown): AdminRole {
  return value === "admin" || value === "viewer" ? value : "owner";
}

export type Actor =
  | { role: "admin"; username: string; adminRole: AdminRole }
  | { role: "reseller"; id: string; username: string };

const globalSessionFallback = globalThis as unknown as {
  __sephirothFallbackActor?: Actor | null;
  __sephirothFallbackInitialized?: boolean;
};

if (!globalSessionFallback.__sephirothFallbackInitialized) {
  globalSessionFallback.__sephirothFallbackActor = {
    role: "admin",
    username: "admin",
    adminRole: "owner",
  };
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
  // Phase 27 — public API tokens take precedence (explicit credential beats cookie)
  const bearer = await actorFromBearer(req);
  if (bearer) return bearer;

  const cookieToken = parseSessionCookie(req);
  if (cookieToken) {
    const username = await verifyToken(cookieToken);
    if (username) {
      const admin = await db.adminUser.findUnique({ where: { username } });
      // task 3-b — disabled admins lose their session immediately
      if (admin && admin.enabled !== false) {
        return { role: "admin", username, adminRole: normalizeAdminRole(admin.role) };
      }

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

/* ---------- task 3-b — central RBAC guards ---------- */

/** True for HTTP methods that mutate state (everything but GET/HEAD/OPTIONS). */
export function isMutatingMethod(req: Request): boolean {
  const m = req.method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

/**
 * True when the actor is a fine-grained admin whose role is READ-ONLY
 * ("viewer"). Resellers and the legacy admin flows return false. Server-side
 * helpers use this to reject viewer mutations with 403 — the UI button
 * hiding is only a best-effort layer; THE SERVER STAYS THE SOURCE OF TRUTH.
 */
export function isReadOnlyActor(actor: Actor | null): boolean {
  return !!actor && actor.role === "admin" && actor.adminRole === "viewer";
}

export type RoleGuard =
  | { ok: true; username: string; role: AdminRole }
  | { ok: false; status: 401 | 403; error: "unauthorized" | "forbidden" };

/**
 * Central role guard for admin routes. Resolves the session (cookie or
 * bearer token) and checks the admin's fine-grained role:
 *   - no session / not an admin                  → 401 unauthorized
 *   - viewer calling a mutating method           → 403 forbidden (read-only role)
 *   - admin whose role is not among `roles`      → 403 forbidden
 *   - otherwise                                  → ok with username + role
 * Callers map the failure straight to a response:
 *   const g = await requireRole(req, "owner");
 *   if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
 */
export async function requireRole(
  req: Request,
  ...roles: AdminRole[]
): Promise<RoleGuard> {
  const actor = await getSession(req);
  if (!actor || actor.role !== "admin") {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (isReadOnlyActor(actor) && isMutatingMethod(req)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (!roles.includes(actor.adminRole)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, username: actor.username, role: actor.adminRole };
}

/**
 * Any fine-grained admin role passes (owner/admin/viewer). Viewers stay
 * READ-ONLY: mutating methods are rejected. This is the method-aware
 * superset of the legacy `requireAdmin` guard.
 */
export async function requireAdminAccess(req: Request): Promise<RoleGuard> {
  return requireRole(req, "owner", "admin", "viewer");
}

/** Owner-only guard — admin management + dangerous wipes (backup delete, restore). */
export async function requireOwner(req: Request): Promise<RoleGuard> {
  return requireRole(req, "owner");
}
