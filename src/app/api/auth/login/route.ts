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
  signToken,
  verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db";

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

  let body: { username?: unknown; password?: unknown; remember?: unknown };
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
  if (!admin || !verifyPassword(password, admin.passwordHash)) {
    const fail = registerFailure(ip);
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

  clearFailures(ip);

  const ttl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT;
  const token = await signToken(admin.username, ttl);

  const res = NextResponse.json({ ok: true, username: admin.username });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(Math.floor(ttl / 1000)));
  return res;
}
