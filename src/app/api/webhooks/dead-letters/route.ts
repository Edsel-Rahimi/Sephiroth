import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { listDeadLetters, deleteDeadLetters } from "@/lib/webhooks";

/* ============================================================
   Sephiroth · Task 2-a — Webhook dead-letter queue (admin)
   GET    /api/webhooks/dead-letters           → { deadLetters: [...] } (newest first, cap 100)
   DELETE /api/webhooks/dead-letters?all=true  → clear everything
   DELETE /api/webhooks/dead-letters  {id}     → remove one row
   Backs the "dead letters" section of the Webhooks settings card.
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const deadLetters = await listDeadLetters(100);
    return NextResponse.json({ deadLetters });
  } catch (err) {
    console.error("[webhooks:dead-letters]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = new URL(req.url);
    if (url.searchParams.get("all") === "true") {
      const removed = await deleteDeadLetters({ all: true });
      return NextResponse.json({ removed });
    }
    let id = "";
    try {
      const body = (await req.json()) as { id?: unknown } | null;
      if (body && typeof body.id === "string") id = body.id.trim();
    } catch {
      /* no / invalid body → fall through to the id check */
    }
    if (!id) {
      return NextResponse.json({ error: "id_required" }, { status: 400 });
    }
    const removed = await deleteDeadLetters({ id });
    if (removed === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ removed });
  } catch (err) {
    console.error("[webhooks:dead-letters:delete]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
