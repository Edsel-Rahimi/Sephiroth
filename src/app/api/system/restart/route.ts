import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · v2.2 — Graceful panel restart
   POST /api/system/restart
   Exits the process so the host supervisor (systemd, pm2,
   Docker, Ketabamp-style node hosts) brings the panel back up
   running the freshly updated code. Guarded by a typed
   confirmation because it briefly takes the panel offline.
   ============================================================ */

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { confirm?: unknown } = {};
  try {
    body = (await req.json()) as { confirm?: unknown };
  } catch {
    /* empty body tolerated */
  }
  if (body.confirm !== "RESTART") {
    return NextResponse.json({ ok: false, reason: "confirm_required" }, { status: 400 });
  }

  await logActivity({
    kind: "system.update",
    level: "warn",
    actor: admin,
    message: "Panel restart requested from Settings",
    meta: { restart: true },
  });

  // let the response flush, then exit — the supervisor restarts us
  setTimeout(() => {
    process.exit(0);
  }, 400);

  return NextResponse.json({ ok: true, message: "restarting" });
}
