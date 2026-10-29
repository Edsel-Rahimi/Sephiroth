"use client";

import { useAppStore, type Role } from "@/lib/store/app-store";

/* ============================================================
   Sephiroth · task 3-b — tiny RBAC helpers for the UI layer

   `useRole()` reads the session role out of the app store.
   `useCanMutate()` gates the HIGHEST-traffic mutation buttons for
   fine-grained "viewer" admins (read-only). This is a best-effort
   UX layer only — THE SERVER STAYS THE SOURCE OF TRUTH: every
   mutation route rejects viewers server-side (403 / central
   requireAdmin guard), so hiding buttons must never be trusted
   for security.
   ============================================================ */

/** Current session role: "owner" | "admin" | "viewer" | "reseller". */
export function useRole(): Role {
  return useAppStore((s) => s.role);
}

/** False only for read-only "viewer" admins — resellers and other
 * admin roles mutate their own scope exactly as before. */
export function useCanMutate(): boolean {
  const role = useRole();
  return role !== "viewer";
}
