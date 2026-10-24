"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Lang, ViewId } from "@/lib/i18n/dictionaries";

interface AppState {
  lang: Lang;
  view: ViewId;
  setLang: (lang: Lang) => void;
  setView: (view: ViewId) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: "en",
      view: "dashboard",
      setLang: (lang) => set({ lang }),
      setView: (view) => set({ view }),
    }),
    {
      name: "sephiroth-ui",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
