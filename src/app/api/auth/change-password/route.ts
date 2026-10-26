import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, hashPassword, verifyPassword } from "@/lib/auth";

/* ============================================================
   Sephiroth · Phase 7 — in-app password change (any signed-in
   actor: admin or reseller). Verifies the current password,
   then re-hashes with a fresh scrypt salt. Other sessions of
   the same user stay valid (token carries the username only).
   ============================================================ */

const MIN_LEN = 6;

export async function POST(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: { current?: string; next?: string };
    try {
      body = (await req.json()) as { current?: string; next?: string };
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const current = String(body.current ?? "");
    const next = String(body.next ?? "");

    if (!current || !next) {
      return NextResponse.json({ error: "fields_required" }, { status: 400 });
    }
    if (next.length < MIN_LEN) {
      return NextResponse.json({ error: "weak_password" }, { status: 400 });
    }

    if (actor.role === "admin") {
      const row = await db.adminUser.findUnique({ where: { username: actor.username } });
      if (!row || !verifyPassword(current, row.passwordHash)) {
        return NextResponse.json({ error: "wrong_current" }, { status: 403 });
      }
      await db.adminUser.update({
        where: { username: actor.username },
        data: { passwordHash: hashPassword(next) },
      });
    } else {
      const row = await db.reseller.findUnique({ where: { id: actor.id } });
      if (!row || !row.enabled) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      if (!verifyPassword(current, row.passwordHash)) {
        return NextResponse.json({ error: "wrong_current" }, { status: 403 });
      }
      await db.reseller.update({
        where: { id: actor.id },
        data: { passwordHash: hashPassword(next) },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth:change-password]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
