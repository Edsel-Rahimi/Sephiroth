import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { getActiveBackend } from "@/lib/core/registry";

/* ============================================================
   Sephiroth · v2.4 — Core log tail (admin)
   GET /api/system/core-log?n=200
   Last n merged stdout/stderr lines of the real core (with
   timestamps). Empty array in simulator mode.
   ============================================================ */

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const n = Math.max(1, Math.min(500, Number(url.searchParams.get("n")) || 200));
  const backend = getActiveBackend();
  const lines = backend ? backend.tailLog(n) : [];
  return NextResponse.json({ lines, kind: backend?.kind ?? null });
}
