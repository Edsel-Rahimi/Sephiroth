import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { retryDeadLetter } from "@/lib/webhooks";

/* ============================================================
   Sephiroth · Task 2-a — Retry one dead-letter webhook (admin)
   POST /api/webhooks/dead-letters/retry  { id }
   → 200 { ok: true, status, ms }            (row removed from the queue)
   → 502 { ok: false, status, error }        (row kept, diagnostics refreshed)
   → 404 { error: "not_found" }
   Re-POSTs the stored payload to the CURRENT resolved URL for the
   event with a fresh timestamp + HMAC signature.
   ============================================================ */

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    let id = "";
    try {
      const body = (await req.json()) as { id?: unknown } | null;
      if (body && typeof body.id === "string") id = body.id.trim();
    } catch {
      /* invalid body → id stays empty */
    }
    if (!id) {
      return NextResponse.json({ error: "id_required" }, { status: 400 });
    }
    const res = await retryDeadLetter(id);
    if (res.ok) {
      return NextResponse.json({ ok: true, status: res.status, ms: res.ms });
    }
    if (res.error === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, status: res.status, error: res.error },
      { status: 502 }
    );
  } catch (err) {
    console.error("[webhooks:dead-letters:retry]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
