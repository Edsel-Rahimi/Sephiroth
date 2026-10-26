import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SHORT,
  rotateSessionSecret,
  sessionCookieOptions,
  signToken,
} from "@/lib/auth";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Phase 7/8 — revoke every OTHER session (admin).
   Rotates the HMAC session secret so all previously issued
   cookies become invalid instantly, then re-signs a fresh
   cookie for the caller — "sign out everywhere else" while
   the current device stays signed in.
   ============================================================ */

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    await rotateSessionSecret();
    const token = await signToken(admin, SESSION_TTL_SHORT);
    await logActivity({
      kind: "auth.sessions",
      level: "warn",
      actor: admin,
      message: "Revoked all other sessions (fresh cookie issued for this device)",
      meta: {},
    });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(Math.floor(SESSION_TTL_SHORT / 1000))
    );
    return res;
  } catch (err) {
    console.error("[auth:revoke-sessions]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
