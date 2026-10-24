"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/sephiroth/brand";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";

function ClientClock() {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return <span className="font-mono tabular-nums">{time || "--:--:--"}</span>;
}

export function Footer() {
  const lang = useAppStore((s) => s.lang);
  const t = dictionaries[lang];

  return (
    <footer className="mt-auto border-t border-border/60 bg-background-deep/60 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5 text-[11px] text-muted-foreground md:px-6">
        {/* left : brand + phase */}
        <div className="flex items-center gap-2.5">
          <BrandMark size={20} />
          <span className="font-semibold tracking-wide text-foreground/80">SEPHIROTH</span>
          <span className="hidden sm:inline text-border">|</span>
          <span className="hidden sm:inline">{t.footer.phase}</span>
        </div>

        {/* center : core status */}
        <div className="flex items-center gap-2 order-last w-full sm:order-none sm:w-auto">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          <span>
            {t.status.core}: {t.status.simulator} ·{" "}
            <span className="text-emerald-400">{t.status.online}</span>
          </span>
        </div>

        {/* right : rights + clock */}
        <div className="flex items-center gap-3">
          <span>{t.footer.rights}</span>
          <span className="text-border">|</span>
          <ClientClock />
        </div>
      </div>
    </footer>
  );
}
