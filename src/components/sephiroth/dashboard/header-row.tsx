"use client";

import { useMemo } from "react";
import { Clock3, Users, Radio, DatabaseZap } from "lucide-react";
import { D2Card, StatPill, TrendBadge } from "@/components/sephiroth/dashboard/parts";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { d2Dictionaries } from "@/lib/i18n/dashboard-strings";

export function HeaderRow() {
  const lang = useAppStore((s) => s.lang);
  const dict = useMemo(() => dictionaries[lang], [lang]);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);

  const kpis = [
    { icon: Users, val: "435", label: d2.kpiClients, up: true, delta: "+12%" },
    { icon: Radio, val: "312", label: d2.kpiActive, up: true, delta: "+8%" },
    { icon: DatabaseZap, val: "8.4 TB", label: d2.kpiTraffic, up: false, delta: "-4%" },
  ];

  return (
    <>
      {/* welcome header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-primary">
            <span className="h-1 w-1 rounded-full bg-primary glow-cyan" />
            {dict.dash.phaseBadge}
          </div>
          <h1 className="text-2xl font-bold md:text-[32px] md:leading-tight">
            <span className="text-muted-foreground">{d2.welcome}</span>{" "}
            <span className="text-silver">Commander</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{dict.dash.subtitle}</p>
        </div>
        <div className="glass hidden items-center gap-2 rounded-full px-4 py-2 text-xs text-muted-foreground sm:flex">
          <Clock3 className="h-3.5 w-3.5 text-primary" />
          {dict.dash.uptime}: <span className="font-mono text-foreground">42d 06:18:44</span>
        </div>
      </div>

      {/* performance pills + big KPIs */}
      <div className="mt-6 grid grid-cols-12 gap-4">
        <D2Card title={d2.perf} className="col-span-12 xl:col-span-7">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <StatPill label={d2.cpu} pct={34} color="linear-gradient(90deg,#0e7490,#22d8ee)" />
            <StatPill label={d2.ram} pct={61} color="linear-gradient(90deg,#64748b,#c9d6e2)" />
            <StatPill label={d2.disk} pct={28} color="linear-gradient(90deg,#059669,#34d399)" />
            <StatPill label={d2.net} pct={47} color="linear-gradient(90deg,#b45309,#fbbf24)" />
          </div>
        </D2Card>

        <D2Card className="col-span-12 xl:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            {kpis.map((k) => (
              <div key={k.label} className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                  <k.icon className="h-4.5 w-4.5 text-primary" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-2xl font-bold tabular-nums leading-none">
                      {k.val}
                    </span>
                    <TrendBadge up={k.up} val={k.delta} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{k.label}</p>
                </div>
              </div>
            ))}
            <span className="hidden text-[10px] text-muted-foreground/70 xl:block">
              {d2.vsWeek}
            </span>
          </div>
        </D2Card>
      </div>
    </>
  );
}
