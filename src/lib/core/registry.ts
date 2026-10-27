/**
 * Sephiroth core adapter — active-backend registry (server-only).
 *
 * server.ts constructs the chosen backend at boot and registers it here;
 * the /api/system/core-* routes reach the SAME instance through this module
 * (single process, so a module singleton is the natural rendezvous).
 */

import type { CoreBackend, CoreStatusPayload } from "@/lib/core/types";

interface RegistryState {
  backend: CoreBackend | null;
  fallbackActive: boolean;
  fallbackReason: string;
}

const g = globalThis as unknown as { __sephCoreRegistry?: RegistryState };

function state(): RegistryState {
  if (!g.__sephCoreRegistry) {
    g.__sephCoreRegistry = { backend: null, fallbackActive: false, fallbackReason: "" };
  }
  return g.__sephCoreRegistry;
}

/** Register the active backend (called once at boot / driver swap). */
export function setActiveBackend(
  backend: CoreBackend,
  fallback?: { active: boolean; reason: string }
): void {
  const s = state();
  s.backend = backend;
  s.fallbackActive = fallback?.active ?? false;
  s.fallbackReason = fallback?.reason ?? "";
}

export function getActiveBackend(): CoreBackend | null {
  return state().backend;
}

export function isFallbackActive(): { active: boolean; reason: string } {
  const s = state();
  return { active: s.fallbackActive, reason: s.fallbackReason };
}

/** Status payload for GET /api/system/core-status (null backend → honest zero state). */
export function coreStatusPayload(): CoreStatusPayload | null {
  const backend = state().backend;
  if (!backend) return null;
  const fb = isFallbackActive();
  return { ...backend.status(), fallbackActive: fb.active, fallbackReason: fb.reason };
}

/**
 * Replace the running backend at runtime (driver switch via core-action).
 * Disposes the old one best-effort before handing over.
 */
export async function swapBackend(
  next: CoreBackend,
  fallback?: { active: boolean; reason: string }
): Promise<void> {
  const s = state();
  const prev = s.backend;
  s.backend = next;
  s.fallbackActive = fallback?.active ?? false;
  s.fallbackReason = fallback?.reason ?? "";
  if (prev && prev !== next) {
    try {
      await prev.dispose();
    } catch {
      /* old driver cleanup is best-effort */
    }
  }
}
