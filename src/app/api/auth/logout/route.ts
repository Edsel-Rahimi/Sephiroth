import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions, setServerFallbackActor } from "@/lib/auth";

export async function POST(req: Request) {
  setServerFallbackActor(null);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0, req));
  return res;
}
