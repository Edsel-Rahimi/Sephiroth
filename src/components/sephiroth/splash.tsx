"use client";

import { BrandMark } from "@/components/sephiroth/brand";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function Splash() {
  const lang = useAppStore((s) => s.lang);
  const t = dictionaries[lang];

  return (
    <div className="bg-cosmic flex min-h-screen flex-col items-center justify-center gap-8">
      <div className="relative flex flex-col items-center gap-6">
        <div className="float-y">
          <BrandMark size={88} pulse className="rounded-[22px]" />
        </div>
        <div className="text-center">
          <p className="text-silver text-xl font-bold tracking-[0.42em] pl-[0.42em]">
            SEPHIROTH
          </p>
          <p className="mt-2 text-xs text-muted-foreground tracking-widest">
            {t.splash.booting}
            <span className="animate-pulse">…</span>
          </p>
        </div>
        <div className="orbit-spin h-8 w-8 rounded-full border border-primary/15 border-t-primary/80" />
      </div>
    </div>
  );
}
