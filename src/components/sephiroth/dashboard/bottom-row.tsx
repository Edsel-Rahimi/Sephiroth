"use client";

import { useMemo } from "react";
import { PlayCircle, TriangleAlert, Hourglass } from "lucide-react";
import { D2Card } from "@/components/sephiroth/dashboard/parts";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { d2Dictionaries } from "@/lib/i18n/dashboard-strings";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ---------- statistics bubbles (Resq-style overlapping circles) ---------- */
function StatsBubbles() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);

  return (
    <D2Card title={d2.stats} className="col-span-12 md:col-span-6 xl:col-span-3">
      <div className="relative h-44 select-none" dir="ltr">
        {/* dotted backdrop circle */}
        <div
          aria-hidden="true"
          className="absolute right-2 top-2 h-20 w-20 rounded-full opacity-40"
          style={{
            backgroundImage: "radial-gradient(rgba(148,184,205,0.5) 1px, transparent 1.5px)",
            backgroundSize: "7px 7px",
          }}
        />
        {/* big cyan */}
        <div className="float-y absolute left-2 top-8 flex h-36 w-36 flex-col items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#4be3f7,#0ea5bf_60%,#087a90)] shadow-[0_0_50px_-10px_rgba(34,216,238,0.6)]">
          <span className="font-mono text-[26px] font-bold tabular-nums leading-none text-[#04161b]">
            64%
          </span>
          <span className="mt-1 text-[10px] font-semibold text-[#04161b]/80">{d2.connected}</span>
        </div>
        {/* medium idle */}
        <div className="absolute right-8 top-0 flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white/8 ring-1 ring-white/15 backdrop-blur-md">
          <span className="font-mono text-lg font-bold tabular-nums leading-none">26%</span>
          <span className="mt-1 text-[10px] text-muted-foreground">{d2.idle}</span>
        </div>
        {/* small limited */}
        <div className="absolute bottom-0 right-16 flex h-20 w-20 flex-col items-center justify-center rounded-full bg-chart-4/25 ring-1 ring-chart-4/40">
          <span className="font-mono text-sm font-bold tabular-nums leading-none text-chart-4">
            10%
          </span>
          <span className="mt-0.5 text-[9px] text-muted-foreground">{d2.limitedB}</span>
        </div>
      </div>
    </D2Card>
  );
}

/* ---------- active alerts (Resq-style incident cards) ---------- */
function ActiveAlerts() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);

  const alerts = [
    {
      chip: d2.nearLimit,
      chipCls: "bg-chart-4/15 text-chart-4 ring-chart-4/30",
      icon: TriangleAlert,
      title: d2.a1Title,
      desc: d2.a1Desc,
      user: "Kaya",
      id: "USR-0341",
    },
    {
      chip: d2.expiringSoon,
      chipCls: "bg-chart-5/15 text-chart-5 ring-chart-5/30",
      icon: Hourglass,
      title: d2.a2Title,
      desc: d2.a2Desc,
      user: "Vega",
      id: "USR-0287",
    },
  ];

  return (
    <D2Card title={d2.alertsCard} className="col-span-12 md:col-span-6 xl:col-span-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {alerts.map((a) => (
          <article key={a.title} className="glass hover-glow rounded-xl p-4">
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                  a.chipCls
                )}
              >
                <a.icon className="h-3 w-3" />
                {a.chip}
              </span>
              <span className="font-mono text-[9px] tabular-nums text-muted-foreground/60">
                {a.id}
              </span>
            </div>
            <p className="mt-2.5 text-xs font-semibold">{a.title}</p>
            <p className="mt-1 min-h-8 text-[11px] leading-relaxed text-muted-foreground">
              {a.desc}
            </p>
            <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-chart-2/10 font-mono text-[10px] font-bold text-primary ring-1 ring-primary/25">
                {a.user[0]}
              </span>
              <span className="text-[11px] font-medium">{a.user}</span>
            </div>
          </article>
        ))}
      </div>
    </D2Card>
  );
}

/* ---------- renewal radar (Donezo-style reminders) ---------- */
function RenewalRadar() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);
  const dict = useMemo(() => dictionaries[lang], [lang]);
  const { toast } = useToast();

  const items = [
    { name: "Vega", initial: "V", inCls: "text-chart-5 bg-chart-5/10", time: "12h" },
    { name: "Orion", initial: "O", inCls: "text-chart-4 bg-chart-4/10", time: "2d" },
    { name: "Aria", initial: "A", inCls: "text-chart-3 bg-chart-3/10", time: "5d" },
  ];

  return (
    <D2Card title={d2.radar} className="col-span-12 md:col-span-6 xl:col-span-4">
      <ul className="grid gap-2.5">
        {items.map((u) => (
          <li key={u.name} className="flex items-center gap-3 rounded-xl bg-muted/50 px-3.5 py-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-chart-2/10 font-mono text-[10px] font-bold text-primary ring-1 ring-primary/25">
              {u.initial}
            </span>
            <span className="flex-1 text-xs font-medium">{u.name}</span>
            <span className={cn("rounded-full px-2 py-0.5 font-mono text-[10px] tabular-nums", u.inCls)}>
              {u.time}
            </span>
          </li>
        ))}
      </ul>
      <button
        onClick={() => toast({ title: dict.common.soon, description: dict.common.soonDesc })}
        className="glow-cyan mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[#0ea5bf] text-sm font-bold text-[#041014] transition-transform hover:scale-[1.01]"
      >
        <PlayCircle className="h-4 w-4" />
        {d2.reviewNow}
      </button>
    </D2Card>
  );
}

/* ---------- monthly goal gauge (Donezo-style semicircle, full-width slim) ---------- */
function GoalGauge() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);

  const pct = 41;
  const R = 62;
  const C = Math.PI * R; /* semicircle */
  const done = (C * pct) / 100;

  const stats = [
    { dot: "bg-chart-3", label: d2.delivered, val: "120" },
    { dot: "bg-primary", label: d2.inProg, val: "64" },
    { dot: "bg-muted-foreground/50", label: d2.pendingG, val: "38" },
  ];

  return (
    <D2Card title={d2.goal} className="col-span-12">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
        {/* arc */}
        <div className="relative h-24 w-44 shrink-0" dir="ltr">
          <svg viewBox="0 0 160 84" className="h-full w-full">
            <defs>
              <pattern id="gaugeHatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="rgba(148,184,205,0.06)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(148,184,205,0.28)" strokeWidth="2.5" />
              </pattern>
              <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#0ea5bf" />
                <stop offset="100%" stopColor="#4be3f7" />
              </linearGradient>
            </defs>
            <path d="M18,78 A62,62 0 0 1 142,78" fill="none" stroke="url(#gaugeHatch)" strokeWidth="15" strokeLinecap="round" />
            <path
              d="M18,78 A62,62 0 0 1 142,78"
              fill="none"
              stroke="url(#gaugeGrad)"
              strokeWidth="15"
              strokeLinecap="round"
              strokeDasharray={`${done} ${C}`}
              className="line-draw"
              style={{ filter: "drop-shadow(0 0 8px rgba(34,216,238,0.45))" }}
            />
          </svg>
          <div className="absolute inset-x-0 bottom-0 text-center">
            <span className="font-mono text-[26px] font-bold tabular-nums leading-none">{pct}%</span>
          </div>
        </div>

        {/* stats inline */}
        <div className="flex flex-1 flex-wrap items-center justify-between gap-4">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-3">
              <span className={cn("h-2.5 w-2.5 rounded-full", s.dot)} />
              <div>
                <p className="font-mono text-xl font-bold tabular-nums leading-none">{s.val}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}

          {/* mini progress of the goal */}
          <div className="min-w-40 flex-1 sm:max-w-64">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="line-draw h-full rounded-full bg-gradient-to-r from-[#0ea5bf] to-[#4be3f7]"
                style={{ width: `${pct}%`, strokeDasharray: "none", animation: "none", filter: "drop-shadow(0 0 6px rgba(34,216,238,0.4))" }}
              />
            </div>
            <p className="mt-1.5 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              222 / 540 GB
            </p>
          </div>
        </div>
      </div>
    </D2Card>
  );
}

export function BottomRow() {
  return (
    <>
      <div className="mt-4 grid grid-cols-12 gap-4">
        <StatsBubbles />
        <ActiveAlerts />
        <RenewalRadar />
      </div>
      <div className="mt-4 grid grid-cols-12 gap-4">
        <GoalGauge />
      </div>
    </>
  );
}
