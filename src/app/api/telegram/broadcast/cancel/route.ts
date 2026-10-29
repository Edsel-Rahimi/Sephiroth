import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { db } from "@/lib/db";
import { jobView } from "@/lib/bot/broadcast";

/* ============================================================
   Sephiroth · Task 2-e — Broadcast cancel (admin only)

   POST /api/telegram/broadcast/cancel
     → flips the running job to "cancelled". The sender loop
       re-reads the row between sends and stops within one
       message, finalizing finishedAt + the activity entry.
     → 404 no_running when nothing is running.
   ============================================================ */

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const running = await db.broadcastJob.findFirst({ where: { status: "running" } });
    if (!running) {
      return NextResponse.json({ error: "no_running" }, { status: 404 });
    }
    const updated = await db.broadcastJob.update({
      where: { id: running.id },
      data: { status: "cancelled" },
    });
    return NextResponse.json({ job: jobView(updated) });
  } catch (err) {
    console.error("[telegram:broadcast:cancel]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
