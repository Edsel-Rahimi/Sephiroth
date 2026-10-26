"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/sephiroth/brand";
import { useAppStore } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { liveDictionaries } from "@/lib/i18n/live-strings";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

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
  const L = liveDictionaries[lang];
  const status = useCoreStore((s) => s.status);

  const statusMap = {
    live: { label: L.liveChip, cls: "text-chart-3", dot: "bg-chart-3" },
    connecting: { label: L.connecting, cls: "text-chart-4", dot: "bg-chart-4" },
    offline: { label: L.offline, cls: "text-chart-5", dot: "bg-chart-5" },
  }[status];

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
            <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", statusMap.dot)} />
            <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", statusMap.dot)} />
          </span>
          <span>
            {t.status.core}: {t.status.simulator} ·{" "}
            <span className={statusMap.cls}>{statusMap.label}</span>
          </span>
        </div>

        {/* right : rights + crafted-by + clock */}
        <div className="flex items-center gap-3">
          <span>{t.footer.rights}</span>
          <span className="text-border">|</span>
          <span>
            {t.footer.crafted}{" "}
            <a
              href="https://github.com/Edsel-Rahimi"
              target="_blank"
              rel="noreferrer"
              className="font-mono font-semibold text-primary hover:glow-cyan transition-colors"
            >
              EPODONIOS
            </a>
          </span>
          <span className="text-border">|</span>
          <ClientClock />
        </div>
      </div>
    </footer>
  );
}
