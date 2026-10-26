import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions, setServerFallbackActor } from "@/lib/auth";

export async function POST() {
  setServerFallbackActor(null);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
}
