"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Lang, ViewId } from "@/lib/i18n/dictionaries";

export type Role = "admin" | "reseller";

interface AppState {
  lang: Lang;
  view: ViewId;
  /* Phase 6 — session role; set from /api/auth/session, not persisted */
  role: Role;
  setLang: (lang: Lang) => void;
  setView: (view: ViewId) => void;
  setRole: (role: Role) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: "en",
      view: "dashboard",
      role: "admin",
      setLang: (lang) => set({ lang }),
      setView: (view) => set({ view }),
      setRole: (role) => set({ role }),
    }),
    {
      name: "sephiroth-ui",
      storage: createJSONStorage(() => localStorage),
      /* role is session-derived — only UI prefs persist */
      partialize: (s) => ({ lang: s.lang, view: s.view }) as unknown as AppState,
    }
  )
);
