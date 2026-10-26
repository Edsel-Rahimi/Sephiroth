"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, Users, Radio, DatabaseZap } from "lucide-react";
import { D2Card, StatPill, useIdentity } from "@/components/sephiroth/dashboard/parts";
import { useAppStore } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { splitUptime } from "@/lib/i18n/live-strings";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { d2Dictionaries } from "@/lib/i18n/dashboard-strings";

export function HeaderRow() {
  const lang = useAppStore((s) => s.lang);
  const dict = useMemo(() => dictionaries[lang], [lang]);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);
  const snapshot = useCoreStore((s) => s.snapshot);
  const { metrics, totals, core } = snapshot;

  /* keep the uptime pill ticking even when the stream is offline */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const up = splitUptime(core.startedAt, now);
  const upLabel = `${up.dd}d ${up.hh}:${up.mm}:${up.ss}`;

  const kpis = [
    { icon: Users, val: String(totals.users), label: d2.kpiClients },
    { icon: Radio, val: String(Math.round(metrics.activeUsers)), label: d2.kpiActive },
    {
      icon: DatabaseZap,
      val: `${metrics.monthTxTb.toFixed(2)} TB`,
      label: d2.kpiTraffic,
    },
  ];

  /* real signed-in identity (GET /api/profile) — falls back to the
     translated "Commander" badge while loading / on failure */
  const identity = useIdentity();
  const who = identity
    ? identity.displayName.trim() || identity.username
    : dict.profile.badge;
  const roleLabel =
    identity?.role === "reseller" ? dict.profile.roleReseller : dict.profile.roleAdmin;

  return (
    <>
      {/* welcome header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-primary">
              <span className="h-1 w-1 rounded-full bg-primary glow-cyan" />
              {dict.dash.phaseBadge}
            </span>
            {identity && (
              <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/60 px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-muted-foreground">
                {roleLabel}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold md:text-[32px] md:leading-tight">
            <span className="text-muted-foreground">{d2.welcome}</span>{" "}
            <span className="text-silver">{who}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{dict.dash.subtitle}</p>
        </div>
        <div className="glass hidden items-center gap-2 rounded-full px-4 py-2 text-xs text-muted-foreground sm:flex">
          <Clock3 className="h-3.5 w-3.5 text-primary" />
          {dict.dash.uptime}: <span className="font-mono text-foreground tabular-nums">{upLabel}</span>
        </div>
      </div>

      {/* performance pills + big KPIs */}
      <div className="mt-6 grid grid-cols-12 gap-4">
        <D2Card title={d2.perf} className="col-span-12 xl:col-span-7">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <StatPill label={d2.cpu} pct={Math.round(metrics.cpu)} color="linear-gradient(90deg,#0e7490,#22d8ee)" />
            <StatPill label={d2.ram} pct={Math.round(metrics.ram)} color="linear-gradient(90deg,#64748b,#c9d6e2)" />
            <StatPill label={d2.disk} pct={Math.round(metrics.disk)} color="linear-gradient(90deg,#059669,#34d399)" />
            <StatPill
              label={d2.net}
              pct={Math.min(100, Math.round((metrics.netIn + metrics.netOut) / 4.2))}
              color="linear-gradient(90deg,#b45309,#fbbf24)"
            />
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
                  <span className="font-mono text-2xl font-bold tabular-nums leading-none">
                    {k.val}
                  </span>
                  <p className="mt-1 text-[11px] text-muted-foreground">{k.label}</p>
                </div>
              </div>
            ))}
          </div>
        </D2Card>
      </div>
    </>
  );
}
