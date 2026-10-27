import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { coreStatusPayload, getSidecarManager } from "@/lib/core/registry";

/* ============================================================
   Sephiroth · v2.4/2.5 — Core backend status (admin)
   GET /api/system/core-status
   Reports which engine drives the telemetry (sim | xray), the
   real process state (pid/version/uptime/api door), the last
   error and whether the xray driver fell back to the simulator.
   v2.5: also reports the hysteria2 sidecar engines.
   ============================================================ */

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const status = coreStatusPayload();
  if (!status) {
    return NextResponse.json({ error: "core_not_ready" }, { status: 503 });
  }
  const sidecars = getSidecarManager()?.statusList() ?? [];
  return NextResponse.json({ status, sidecars });
}
