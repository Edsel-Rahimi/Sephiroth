import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/lib/db";
import { buildBackupPayload } from "@/app/api/settings/backup/route";
import { getSecuritySettings, markAutoBackupRun } from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { notifyBackupDone } from "@/lib/bot/notify"; // Task 23-a — bot alert

/* ============================================================
   Sephiroth · v2.2 — Scheduled server-side backups
   Mirrors the manual export (buildBackupPayload) into
   db/backups/sephiroth-auto-<stamp>.json every 24h, keeping
   the last N files. Same atomic write pattern as the store.
   ============================================================ */

export const BACKUPS_DIR = resolve(process.cwd(), "db", "backups");

const AUTO_NAME_RE = /^sephiroth-auto-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;

function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, data, { encoding: "utf8" });
  renameSync(tmp, file);
}

/** Run the daily auto-backup if it is due. Safe to call every minute. */
export async function runAutoBackup(force = false): Promise<{ ran: boolean; file?: string; reason?: string }> {
  try {
    const sec = await getSecuritySettings();
    if (!sec.autoBackupEnabled && !force) {
      return { ran: false, reason: "disabled" };
    }

    if (!force) {
      const lastIso = (await db.serverSetting.findUnique({ where: { key: "set_auto_backup_last" } }))?.value ?? "";
      const last = lastIso ? Date.parse(lastIso) : 0;
      // at most one auto backup per 24h (with a 23h guard so clock jumps don't spam)
      if (last && Date.now() - last < 23 * 3_600_000) {
        return { ran: false, reason: "not_due" };
      }
    }

    mkdirSync(BACKUPS_DIR, { recursive: true });

    const payload = await buildBackupPayload();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = resolve(BACKUPS_DIR, `sephiroth-auto-${stamp}.json`);
    const body = JSON.stringify(payload, null, 2);
    atomicWrite(file, body);

    // prune — keep only the newest N auto files
    const keep = Math.max(1, Math.min(30, sec.autoBackupKeep));
    const autos = readdirSync(BACKUPS_DIR)
      .filter((f) => AUTO_NAME_RE.test(f))
      .map((f) => ({ f, m: statSync(resolve(BACKUPS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const old of autos.slice(keep)) {
      try {
        unlinkSync(resolve(BACKUPS_DIR, old.f));
      } catch {
        /* best effort */
      }
    }

    await markAutoBackupRun(statSync(file).size);
    await logActivity({
      kind: "backup.exported",
      level: "info",
      actor: "system",
      message: `Scheduled backup created (${(body.length / 1024).toFixed(1)} KB, keeping ${keep})`,
      meta: { file: `sephiroth-auto-${stamp}.json`, sizeBytes: body.length, auto: true },
    });
    void notifyBackupDone(`sephiroth-auto-${stamp}.json`, body.length); // Task 23-a — bot alert
    return { ran: true, file };
  } catch (err) {
    console.error("[backup-job] auto backup failed:", err);
    return { ran: false, reason: "error" };
  }
}

/** Validate a requested backup filename to prevent path traversal. */
export function isSafeBackupName(name: string): boolean {
  return AUTO_NAME_RE.test(name) || /^sephiroth-backup-[\w.-]+\.json$/.test(name);
}
