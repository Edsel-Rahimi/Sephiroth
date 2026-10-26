import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · v2.2 — Panel self-update (apply phase)
   POST /api/system/update
   Ports 3x-ui's updatePanel pattern 1:1 to Node:
     - single in-flight slot (20-min staleness guard)
     - writes a runner shell script with an EXIT trap that
       publishes a JSON status file (runId/state/exitCode)
     - detached spawn so the HTTP response returns immediately
     - git fetch <remote> + reset --hard <remote>/main + install
   The panel keeps running the OLD code until the operator hits
   "Restart" (POST /api/system/restart) or the host supervisor
   restarts the process.
   ============================================================ */

const STATUS_FILE = resolve(process.cwd(), "db", "update-status.json");
const RUNNER_FILE = resolve(process.cwd(), "db", "update-runner.sh");
const LOG_FILE = resolve(process.cwd(), "db", "update.log");
const STALE_MS = 20 * 60_000;

interface UpdateStatus {
  runId: string;
  state: "pending" | "success" | "failed";
  startedAt: string;
  exitCode?: number;
  finishedAt?: string;
}

function readStatus(): UpdateStatus | null {
  try {
    if (!existsSync(STATUS_FILE)) return null;
    return JSON.parse(readFileSync(STATUS_FILE, "utf8")) as UpdateStatus;
  } catch {
    return null;
  }
}

function pickRemote(): string {
  try {
    const cfg = readFileSync(resolve(process.cwd(), ".git", "config"), "utf8");
    const names = [...cfg.matchAll(/\[remote "([^"]+)"\]/g)].map((m) => m[1]!);
    return names.find((n) => n === "origin") ?? names.find((n) => n === "public") ?? names[0] ?? "";
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!existsSync(resolve(process.cwd(), ".git"))) {
    return NextResponse.json(
      { ok: false, reason: "not_git" },
      { status: 400 }
    );
  }

  const remote = pickRemote();
  if (!remote) {
    return NextResponse.json({ ok: false, reason: "no_remote" }, { status: 400 });
  }

  // single-slot guard — a pending run younger than 20min blocks a new one
  const prev = readStatus();
  if (prev && prev.state === "pending") {
    const age = Date.now() - Date.parse(prev.startedAt || "");
    if (Number.isFinite(age) && age < STALE_MS) {
      return NextResponse.json({ ok: false, reason: "busy", runId: prev.runId }, { status: 409 });
    }
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  const runner = `#!/usr/bin/env bash
# Sephiroth self-update runner (generated ${startedAt})
STATUS_FILE="${STATUS_FILE}"
RUN_ID="${runId}"
LOG_FILE="${LOG_FILE}"
STATE="success"
exec >>"$LOG_FILE" 2>&1
on_exit() {
  CODE=$?
  [ "$CODE" -ne 0 ] && STATE="failed"
  printf '{"runId":"%s","state":"%s","exitCode":%s,"startedAt":"%s","finishedAt":"%s"}\\n' \\
    "$RUN_ID" "$STATE" "$CODE" "${startedAt}" "$(date -u +%FT%TZ)" > "$STATUS_FILE"
}
trap on_exit EXIT
set -e
echo "[update] run ${runId} start $(date -u +%FT%TZ)"
cd "${process.cwd()}"
echo "[update] git fetch ${remote} main"
git fetch "${remote}" main --force
echo "[update] git reset --hard ${remote}/main"
git reset --hard "${remote}/main"
echo "[update] installing dependencies"
if command -v bun >/dev/null 2>&1; then
  bun install
else
  npm install --no-audit --no-fund
fi
echo "[update] done $(date -u +%FT%TZ)"
`;

  try {
    writeFileSync(RUNNER_FILE, runner, { encoding: "utf8" });
    const status: UpdateStatus = { runId, state: "pending", startedAt };
    writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), { encoding: "utf8" });

    const child = spawn("bash", [RUNNER_FILE], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();

    await logActivity({
      kind: "system.update",
      level: "info",
      actor: admin,
      message: `Panel update to remote "${remote}" started (runId ${runId.slice(0, 8)})`,
      meta: { runId, remote },
    });

    return NextResponse.json({ ok: true, runId });
  } catch (err) {
    console.error("[system:update]", err);
    return NextResponse.json({ ok: false, reason: "spawn_failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // convenience: same handler as update-status (kept separate for clarity)
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const st = readStatus();
  return NextResponse.json({ status: st, logFile: LOG_FILE, logBytes: existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0 });
}
