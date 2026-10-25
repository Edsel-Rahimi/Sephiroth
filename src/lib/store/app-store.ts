"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Lang, ViewId } from "@/lib/i18n/dictionaries";

export type Role = "admin" | "reseller";
export type GlowPref = "on" | "soft" | "off";

interface AppState {
  lang: Lang;
  view: ViewId;
  /* Phase 6 — session role; set from /api/auth/session, not persisted */
  role: Role;
  /* Phase 7 — appearance preferences (persisted per browser) */
  starfield: boolean;
  glow: GlowPref;
  reduceMotion: boolean;
  setLang: (lang: Lang) => void;
  setView: (view: ViewId) => void;
  setRole: (role: Role) => void;
  setStarfield: (v: boolean) => void;
  setGlow: (v: GlowPref) => void;
  setReduceMotion: (v: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: "en",
      view: "dashboard",
      role: "admin",
      starfield: true,
      glow: "on",
      reduceMotion: false,
      setLang: (lang) => set({ lang }),
      setView: (view) => set({ view }),
      setRole: (role) => set({ role }),
      setStarfield: (starfield) => set({ starfield }),
      setGlow: (glow) => set({ glow }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    }),
    {
      name: "sephiroth-ui",
      storage: createJSONStorage(() => localStorage),
      /* role is session-derived — UI prefs + language persist */
      partialize: (s) =>
        ({
          lang: s.lang,
          view: s.view,
          starfield: s.starfield,
          glow: s.glow,
          reduceMotion: s.reduceMotion,
        }) as unknown as AppState,
    }
  )
);
