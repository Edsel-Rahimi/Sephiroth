import { db, type AdminUser } from "@/lib/db";
import { normalizeAdminRole } from "@/lib/auth";

/* ============================================================
   Sephiroth · task 3-b — admin management shared helpers
   Used by /api/admins and /api/admins/[id] (both owner-only).
   ============================================================ */

export function toAdminDTO(row: AdminUser, selfUsername?: string) {
  return {
    id: row.id,
    username: row.username,
    role: normalizeAdminRole(row.role),
    enabled: row.enabled !== false,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    isSelf: selfUsername !== undefined ? row.username === selfUsername : undefined,
  };
}

/** Count ACTIVE owners (enabled) — the last-owner protection baseline. */
export async function countActiveOwners(): Promise<number> {
  const rows = await db.adminUser.findMany({ where: { role: "owner" } });
  return rows.filter((r) => r.enabled !== false).length;
}
