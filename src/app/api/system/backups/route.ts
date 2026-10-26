import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { requireAdmin } from "@/lib/inbounds";
import { BACKUPS_DIR, isSafeBackupName, runAutoBackup } from "@/lib/backup-job";
import { getAutoBackupLastRun } from "@/lib/settings";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · v2.2 — Server-side auto backups
   GET    /api/system/backups                 → { backups[], lastRun }
   GET    /api/system/backups?name=X&dl=1     → download one backup file
   POST   /api/system/backups {action:"run"}  → force a backup now
   DELETE /api/system/backups?name=X          → delete one backup file
   ============================================================ */

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "";
  const dl = url.searchParams.get("dl") === "1";

  if (name) {
    if (!isSafeBackupName(name)) {
      return NextResponse.json({ error: "bad_name" }, { status: 400 });
    }
    const file = resolve(BACKUPS_DIR, name);
    if (!existsSync(file)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = readFileSync(file, "utf8");
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...(dl ? { "content-disposition": `attachment; filename="${name}"` } : {}),
      },
    });
  }

  const backups: { name: string; sizeBytes: number; createdAt: string }[] = [];
  try {
    if (existsSync(BACKUPS_DIR)) {
      for (const f of readdirSync(BACKUPS_DIR)) {
        if (!isSafeBackupName(f)) continue;
        const st = statSync(resolve(BACKUPS_DIR, f));
        backups.push({ name: f, sizeBytes: st.size, createdAt: st.mtime.toISOString() });
      }
    }
  } catch {
    /* empty */
  }
  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ backups, lastRun: await getAutoBackupLastRun() });
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { action?: unknown } = {};
  try {
    body = (await req.json()) as { action?: unknown };
  } catch {
    /* ignore */
  }
  if (body.action !== "run") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const res = await runAutoBackup(true);
  if (!res.ran) {
    return NextResponse.json({ ok: false, reason: res.reason ?? "error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, file: res.file ? res.file.split("/").pop() : "" });
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "";
  if (!isSafeBackupName(name)) {
    return NextResponse.json({ error: "bad_name" }, { status: 400 });
  }
  const file = resolve(BACKUPS_DIR, name);
  if (!existsSync(file)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    unlinkSync(file);
  } catch {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  await logActivity({
    kind: "backup.exported",
    level: "info",
    actor: admin,
    message: `Backup file deleted: ${name}`,
    meta: { name },
  });
  return NextResponse.json({ ok: true });
}
