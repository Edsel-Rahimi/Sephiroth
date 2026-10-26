import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { requireAdmin } from "@/lib/inbounds";
import { appVersion } from "@/lib/settings";

/* ============================================================
   Sephiroth · v2.2 — Panel self-update (status polling)
   GET /api/system/update-status
   The frontend polls this while an update job is running and
   matches runId so a stale result can never be mistaken for
   the current run (same contract as 3x-ui getUpdateStatus).
   ============================================================ */

const STATUS_FILE = resolve(process.cwd(), "db", "update-status.json");
const LOG_FILE = resolve(process.cwd(), "db", "update.log");

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let status: unknown = null;
  try {
    if (existsSync(STATUS_FILE)) {
      status = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
    }
  } catch {
    status = null;
  }

  return NextResponse.json({
    status,
    current: appVersion(),
    logFile: LOG_FILE,
    logBytes: existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0,
  });
}
