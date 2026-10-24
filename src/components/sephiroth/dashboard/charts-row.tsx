"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Info, Radio, Layers } from "lucide-react";
import { D2Card, smoothLine } from "@/components/sephiroth/dashboard/parts";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { d2Dictionaries } from "@/lib/i18n/dashboard-strings";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ---------- synthetic datasets per range ---------- */
const DATASETS: Record<string, { dl: number[]; ul: number[]; labels: string[]; peakIdx: number }> = {
  "24H": {
    dl: [95, 140, 110, 388, 205, 160, 130, 175],
    ul: [40, 70, 55, 120, 80, 60, 50, 65],
    labels: ["00", "04", "08", "12", "16", "20", "24"],
    peakIdx: 3,
  },
  "7D": {
    dl: [220, 150, 390, 240, 310, 200, 260],
    ul: [80, 55, 130, 85, 110, 70, 90],
    labels: ["1", "2", "3", "4", "5", "6", "7"],
    peakIdx: 2,
  },
  "30D": {
    dl: [150, 190, 240, 200, 310, 180, 390, 260, 300, 220],
    ul: [60, 80, 95, 75, 120, 70, 150, 95, 110, 85],
    labels: ["1", "5", "10", "15", "20", "25", "30"],
    peakIdx: 6,
  },
};

const W = 600;
const H = 190;
const Y_MAX = 420;

function FrequencyChart() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);
  const [range, setRange] = useState<"24H" | "7D" | "30D">("30D");
  const data = DATASETS[range];

  const dl = useMemo(() => smoothLine(data.dl, W, H, { min: 0, max: Y_MAX }), [data]);
  const ul = useMemo(() => smoothLine(data.ul, W, H, { min: 0, max: Y_MAX }), [data]);

  const peakX = 10 + (data.peakIdx * (W - 20)) / (data.dl.length - 1);
  const peakY = H - 6 - (data.dl[data.peakIdx] / Y_MAX) * (H - 12);

  const yLabels = [400, 300, 200, 100];

  return (
    <D2Card
      title={d2.freq}
      action={
        <div className="glass flex items-center rounded-full p-1">
          {(["30D", "7D", "24H"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "h-7 rounded-full px-3 font-mono text-[11px] transition-colors",
                range === r
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      }
      className="col-span-12 md:col-span-6 xl:col-span-6"
    >
      {/* plot */}
      <div className="flex gap-2.5" dir="ltr">
        {/* y axis */}
        <div className="flex h-[190px] flex-col-reverse justify-between py-0.5 text-right font-mono text-[9px] tabular-nums text-muted-foreground/60">
          {[400, 300, 200, 100, 0].map((v) => (
            <span key={v}>{v}</span>
          ))}
        </div>
        <div className="relative flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[190px] w-full">
            <defs>
              <linearGradient id="freqArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(34,216,238,0.28)" />
                <stop offset="100%" stopColor="rgba(34,216,238,0)" />
              </linearGradient>
            </defs>

            {/* grid */}
            {[0, 1, 2, 3].map((i) => {
              const y = 6 + (i * (H - 12)) / 4;
              return (
                <line
                  key={i}
                  x1="0"
                  x2={W}
                  y1={y}
                  y2={y}
                  stroke="rgba(148,184,205,0.09)"
                  strokeDasharray="3 6"
                />
              );
            })}

            {/* upload (silver) */}
            <path key={`u-${range}`} d={ul.line} fill="none" stroke="#8fa3b3" strokeWidth="1.8" className="line-draw" opacity="0.85" />
            {/* download (cyan + glow area) */}
            <path key={`a-${range}`} d={dl.area} fill="url(#freqArea)" className="fade-in-soft" />
            <path
              key={`d-${range}`}
              d={dl.line}
              fill="none"
              stroke="#22d8ee"
              strokeWidth="2.4"
              strokeLinecap="round"
              className="line-draw"
              style={{ filter: "drop-shadow(0 0 6px rgba(34,216,238,0.5))" }}
            />

            {/* peak marker */}
            <circle cx={peakX} cy={peakY} r="4.5" fill="#22d8ee" stroke="#041014" strokeWidth="2" className="drop-shadow-[0_0_8px_rgba(34,216,238,0.9)]" />
          </svg>

          {/* peak bubble (Resq-style annotation) */}
          <div
            className="glass-strong absolute z-10 -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-center"
            style={{ left: `${(peakX / W) * 100}%`, top: `${Math.max(4, (peakY / H) * 100 - 26)}%` }}
          >
            <p className="whitespace-nowrap font-mono text-[10px] font-bold text-primary tabular-nums">
              {data.dl[data.peakIdx]} MB/s
            </p>
            <p className="whitespace-nowrap text-[9px] text-muted-foreground">{d2.peak}</p>
            <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-l border-border bg-[#0a1218]" />
          </div>
        </div>
      </div>

      {/* x labels */}
      <div className="mt-2 flex justify-between pl-8 font-mono text-[9px] tabular-nums text-muted-foreground/60" dir="ltr">
        {data.labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </D2Card>
  );
}

function SummaryCard() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);

  const rows = [
    { dot: "bg-chart-3", label: d2.nodesOnline, val: "5" },
    { dot: "bg-chart-2", label: d2.maintenance, val: "1" },
    { dot: "bg-chart-4", label: d2.alertsOpen, val: "2" },
  ];

  return (
    <D2Card title={d2.summary} className="col-span-12 md:col-span-6 xl:col-span-3">
      <ul className="grid gap-2.5">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between rounded-xl bg-muted/50 px-3.5 py-3"
          >
            <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", r.dot)} />
              {r.label}
            </span>
            <span className="rounded-md bg-white/6 px-2 py-0.5 font-mono text-xs font-bold tabular-nums">
              {r.val}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex gap-2 border-l-2 border-primary/40 pl-3 text-[11px] leading-relaxed text-muted-foreground/80">
        <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
        {d2.summaryNote}
      </p>
    </D2Card>
  );
}

function PassCard() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);
  const { toast } = useToast();
  const dict = useMemo(() => dictionaries[lang], [lang]);

  return (
    <section className="relative col-span-12 overflow-hidden rounded-2xl p-5 md:col-span-6 xl:col-span-3 bg-[linear-gradient(150deg,#35e2f6_0%,#17b6cf_45%,#0a7f95_100%)]">
      {/* watermark ring */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full border-[10px] border-white/15" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-4 -top-2 h-24 w-24 rounded-full border-[6px] border-white/10" />
      <div aria-hidden="true" className="shine-sweep pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent" />

      <div className="relative">
        <div className="flex items-start justify-between">
          <h3 className="text-[15px] font-bold text-[#04161b]">{d2.passTitle}</h3>
          <button
            onClick={() =>
              toast({ title: dict.common.soon, description: dict.common.soonDesc })
            }
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#04161b] text-primary transition-transform hover:scale-105"
            aria-label={d2.passTitle}
          >
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 min-h-10 text-[11px] leading-relaxed text-[#04161b]/75">
          {d2.passDesc}
        </p>

        {/* stacked mini cards */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-white/90 px-3.5 py-2.5 shadow-lg shadow-black/20">
            <span className="flex items-center gap-2 text-[11px] font-semibold text-[#04161b]">
              <Radio className="h-3.5 w-3.5 text-[#0a7f95]" /> {d2.subs}
            </span>
            <span className="font-mono text-sm font-bold tabular-nums text-[#04161b]">312</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/60 px-3.5 py-2.5 shadow-md shadow-black/15 backdrop-blur-sm">
            <span className="flex items-center gap-2 text-[11px] font-semibold text-[#04161b]">
              <Layers className="h-3.5 w-3.5 text-[#0a7f95]" /> {d2.groups}
            </span>
            <span className="font-mono text-sm font-bold tabular-nums text-[#04161b]">12</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ChartsRow() {
  return (
    <div className="grid grid-cols-12 gap-4">
      <SummaryCard />
      <FrequencyChart />
      <PassCard />
    </div>
  );
}
