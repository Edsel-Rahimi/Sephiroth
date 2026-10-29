import { db } from "@/lib/db";

/* ============================================================
   Sephiroth · Activity log (server-only)
   Persisted audit trail behind the Activity view. The dashboard
   feed streams ephemeral socket events; this table keeps the
   searchable history. Rows are pruned to the newest MAX_ROWS.
   ============================================================ */

export const MAX_ROWS = 500;

export type ActivityLevel = "info" | "success" | "warn" | "error";

export type ActivityKind =
  | "auth.login"
  | "auth.failed"
  | "auth.password"
  | "auth.recovery"
  | "auth.sessions"
  | "inbound.created"
  | "inbound.updated"
  | "inbound.deleted"
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "user.ipLimitExceeded" // Task 23-b — core auto-enforcement, distinct-IP breach
  | "sub.created"
  | "sub.updated"
  | "sub.deleted"
  | "sub.hwidBlocked" // Task 23-b — subscription delivery gate rejected an unknown device
  | "reseller.created"
  | "reseller.updated"
  | "reseller.deleted"
  | "settings.updated"
  | "backup.exported"
  | "backup.restored"
  | "system.cleared"
  | "system.update"
  | "webhook.delivered" // v2.7 — outbound webhook succeeded (meta: event, status, ms)
  | "webhook.failed" // v2.7 — outbound webhook exhausted retries
  | "admin.created" // task 3-b — RBAC admin management (owner-only)
  | "admin.updated" // task 3-b — role/enabled/password changes
  | "admin.deleted"; // task 3-b — admin removal

export interface ActivityEntry {
  kind: ActivityKind;
  level?: ActivityLevel;
  actor?: string;
  message: string;
  meta?: Record<string, unknown>;
}

/** Fire-and-forget safe: callers may `await` but failures never break the route. */
export async function logActivity(e: ActivityEntry): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        kind: e.kind,
        level: e.level ?? "info",
        actor: e.actor ?? "",
        message: e.message,
        metaJson: JSON.stringify(e.meta ?? {}),
      },
    });
    /* prune — keep the newest MAX_ROWS */
    const keep = await db.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { id: true, createdAt: true },
    });
    if (keep.length === MAX_ROWS) {
      const cutoff = keep[keep.length - 1]!.createdAt;
      await db.activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    }
  } catch (err) {
    console.error("[activity:log]", err);
  }
}
