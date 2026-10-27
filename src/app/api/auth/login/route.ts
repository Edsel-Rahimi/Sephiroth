import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_LONG,
  SESSION_TTL_SHORT,
  clearFailures,
  clientIp,
  ensureSeed,
  lockState,
  registerFailure,
  sessionCookieOptions,
  setServerFallbackActor,
  signToken,
  verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { getSecuritySettings, getTotpSecret } from "@/lib/settings";
import { verifyTotp } from "@/lib/totp";
import { logActivity } from "@/lib/activity";

export async function POST(req: Request) {
  await ensureSeed();

  const ip = clientIp(req);
  const lock = lockState(ip);
  if (lock.locked) {
    return NextResponse.json(
      { error: "locked", retryAfter: lock.retryAfter },
      { status: 423 }
    );
  }

  let body: { username?: unknown; password?: unknown; remember?: unknown; totp?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.remember === true;

  if (!username || !password) {
    return NextResponse.json({ error: "fields" }, { status: 400 });
  }

  const admin = await db.adminUser.findUnique({ where: { username } });
  let okUser: string | null = null;
  let role: "admin" | "reseller" | null = null;
  let resellerId: string | null = null;

  if (admin && verifyPassword(password, admin.passwordHash)) {
    okUser = admin.username;
    role = "admin";
  } else {
    const reseller = await db.reseller.findUnique({ where: { username } });
    if (reseller && reseller.enabled && verifyPassword(password, reseller.passwordHash)) {
      okUser = reseller.username;
      role = "reseller";
      resellerId = reseller.id;
    }
  }

  if (!okUser || !role) {
    const fail = registerFailure(ip);
    await logActivity({
      kind: "auth.failed",
      level: "error",
      actor: username || "?",
      message: `Failed sign-in for "${username}" from ${ip}`,
      meta: { ip },
    });
    if (fail.locked) {
      return NextResponse.json(
        { error: "locked", retryAfter: fail.retryAfter },
        { status: 423 }
      );
    }
    return NextResponse.json(
      { error: "invalid", attemptsLeft: fail.attemptsLeft },
      { status: 401 }
    );
  }

  // ---- TOTP second factor (v2.2) ----
  const sec = await getSecuritySettings();
  if (role === "admin" && sec.totpEnabled) {
    const totpCode = typeof body.totp === "string" ? body.totp.trim() : "";
    if (!totpCode) {
      // credentials are correct — ask for the second factor WITHOUT counting
      // a lockout failure and without revealing whether the password was right
      return NextResponse.json({ error: "totp_required" }, { status: 401 });
    }
    const secret = await getTotpSecret();
    if (!secret || !verifyTotp(secret, totpCode)) {
      await logActivity({
        kind: "auth.failed",
        level: "error",
        actor: okUser,
        message: `Invalid 2FA code for "${okUser}" from ${ip}`,
        meta: { ip, totp: true },
      });
      return NextResponse.json({ error: "totp_invalid" }, { status: 401 });
    }
  }

  clearFailures(ip);

  const ttl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT;
  const token = await signToken(okUser, ttl);

  setServerFallbackActor(
    role === "admin"
      ? { role: "admin", username: okUser }
      : { role: "reseller", id: resellerId!, username: okUser }
  );

  await logActivity({
    kind: "auth.login",
    level: "success",
    actor: okUser,
    message: `${role === "admin" ? "Administrator" : "Reseller"} "${okUser}" signed in`,
    meta: { ip, role },
  });

  const res = NextResponse.json({ ok: true, username: okUser, role });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(Math.floor(ttl / 1000), req));
  return res;
}
