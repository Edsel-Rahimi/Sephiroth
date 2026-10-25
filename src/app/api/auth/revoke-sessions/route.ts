import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { rotateSessionSecret } from "@/lib/auth";

/* ============================================================
   Sephiroth · Phase 7 — revoke every session (admin).
   Rotates the HMAC session secret so ALL issued cookies
   (including the caller's) become invalid instantly. The
   client signs out right after this call.
   ============================================================ */

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    await rotateSessionSecret();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth:revoke-sessions]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
