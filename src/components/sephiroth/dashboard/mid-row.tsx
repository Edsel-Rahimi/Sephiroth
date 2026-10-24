"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Pause,
  Square,
  Sparkles,
  UserPlus,
  RadioTower,
  DatabaseBackup,
  Send,
  Bot,
} from "lucide-react";
import { D2Card, Sparkline, TrendBadge } from "@/components/sephiroth/dashboard/parts";
import { useAppStore } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { splitUptime } from "@/lib/i18n/live-strings";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { d2Dictionaries } from "@/lib/i18n/dashboard-strings";
import { useToast } from "@/hooks/use-toast";

/* ---------- top consumers (Stakent-style asset cards, live) ---------- */
function ConsumerCards() {
  const lang = useAppStore((s) => s.lang);
  const dict = useMemo(() => dictionaries[lang], [lang]);
  const topUsers = useCoreStore((s) => s.snapshot.topUsers);
  const top = useMemo(() => topUsers.slice(0, 3), [topUsers]);

  return (
    <>
      {top.map((c) => (
        <section
          key={c.uid}
          className="glass hover-glow relative col-span-12 overflow-hidden rounded-2xl p-5 md:col-span-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-chart-2/10 font-mono text-sm font-bold text-primary ring-1 ring-primary/25">
                {c.user[0]}
              </span>
              <div>
                <p className="text-sm font-semibold leading-none">{c.user}</p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {c.proto}
                </p>
              </div>
            </div>
            <span className="glass rounded-full px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
              24H
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="font-mono text-[26px] font-bold tabular-nums leading-none">
              {c.gb.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">GB</span>
            <TrendBadge up={c.up} val={`${c.up ? "+" : ""}${c.delta.toFixed(1)}`} />
          </div>

          <div className="mt-3">
            <Sparkline
              id={c.uid}
              values={c.spark}
              tone={c.up ? "up" : "down"}
            />
          </div>
          <p className="sr-only">{dict.dash.topConsumers}</p>
        </section>
      ))}
    </>
  );
}

/* ---------- hero throughput (Stakent-style featured card, live) ---------- */
function ThroughputHero() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);
  const dict = useMemo(() => dictionaries[lang], [lang]);
  const metrics = useCoreStore((s) => s.snapshot.metrics);
  const total = metrics.netIn + metrics.netOut;
  const loadPct = Math.min(100, Math.round(total / 4.2));

  const strip = [
    { label: d2.peakToday, val: metrics.peakToday.toFixed(1) },
    { label: d2.avgToday, val: metrics.avgToday.toFixed(1) },
    { label: d2.errors, val: String(metrics.errorsToday) },
    { label: d2.saturated, val: `${metrics.saturatedPct}%` },
  ];

  return (
    <D2Card
      title={d2.hero}
      action={
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chart-3 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-chart-3" />
        </span>
      }
      className="col-span-12 md:col-span-6 xl:col-span-5"
    >
      {/* big live number */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <p className="font-mono text-[44px] font-bold leading-none tabular-nums text-glow">
            {total.toFixed(1)}
            <span className="ml-1.5 align-middle text-sm font-medium text-muted-foreground">
              MB/s
            </span>
          </p>
        </div>
        <div className="flex gap-2.5">
          <span className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground">
            <ArrowDown className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono tabular-nums text-foreground">
              {metrics.netIn.toFixed(1)}
            </span>
          </span>
          <span className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground">
            <ArrowUp className="h-3.5 w-3.5 text-chart-2" />
            <span className="font-mono tabular-nums text-foreground">
              {metrics.netOut.toFixed(1)}
            </span>
          </span>
        </div>
      </div>

      {/* decorative load track */}
      <div className="relative mt-6 h-1.5 rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-chart-2/40 to-primary transition-[width] duration-700"
          style={{ width: `${Math.max(6, loadPct)}%` }}
        />
        <span
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-[#0a1218] glow-cyan transition-[left] duration-700"
          style={{ left: `${Math.max(6, loadPct)}%` }}
        />
        <span
          className="absolute top-1/2 ml-3 -translate-y-1/2 font-mono text-[10px] tabular-nums text-primary transition-[left] duration-700"
          style={{ left: `${Math.max(6, loadPct)}%` }}
        >
          {loadPct}%
        </span>
      </div>

      {/* bottom strip */}
      <div className="mt-5 grid grid-cols-4 divide-x divide-border/60 rounded-xl bg-muted/40 py-3">
        {strip.map((s) => (
          <div key={s.label} className="px-3 text-center first:pl-0 last:pr-0">
            <p className="truncate text-[9px] text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 font-mono text-sm font-bold tabular-nums">{s.val}</p>
          </div>
        ))}
      </div>
      <p className="sr-only">{dict.dash.liveTraffic}</p>
    </D2Card>
  );
}

/* ---------- quick actions (Resq-style assistant card) ---------- */
function QuickActions() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);
  const dict = useMemo(() => dictionaries[lang], [lang]);
  const { toast } = useToast();

  const soon = () => toast({ title: dict.common.soon, description: dict.common.soonDesc });

  const actions = [
    { icon: UserPlus, label: d2.newClient },
    { icon: RadioTower, label: d2.newInbound },
    { icon: DatabaseBackup, label: d2.backupNow },
    { icon: Bot, label: d2.tgBot },
  ];

  return (
    <D2Card className="col-span-12 md:col-span-6 xl:col-span-4">
      <h3 className="text-[15px] font-bold">{d2.quickHi}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{d2.quickHelp}</p>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={soon}
            className="glass hover-glow flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <a.icon className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{a.label}</span>
          </button>
        ))}
      </div>

      <div className="glass mt-3 flex items-center gap-2 rounded-full py-1 pl-4 pr-1">
        <input
          placeholder={d2.askPh}
          className="h-8 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          aria-label={d2.askPh}
        />
        <button
          onClick={soon}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary/25"
          aria-label="send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
      <Sparkles className="pointer-events-none absolute -right-3 -top-3 h-8 w-8 text-primary/15" />
    </D2Card>
  );
}

/* ---------- uptime tracker (Donezo-style timer card, core-driven) ---------- */
function UptimeTracker() {
  const lang = useAppStore((s) => s.lang);
  const d2 = useMemo(() => d2Dictionaries[lang], [lang]);
  const dict = useMemo(() => dictionaries[lang], [lang]);
  const { toast } = useToast();
  const startedAt = useCoreStore((s) => s.snapshot.core.startedAt);

  /* re-render each second so the timer keeps ticking even when offline */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { dd, hh, mm, ss } = splitUptime(startedAt, now);

  return (
    <section className="relative col-span-12 overflow-hidden rounded-2xl p-5 md:col-span-6 xl:col-span-3 bg-[linear-gradient(160deg,#0a2733_0%,#061218_70%)] ring-1 ring-primary/20">
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -bottom-14 h-40 w-40 rounded-full border-[8px] border-primary/10" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-2 -bottom-4 h-16 w-16 orbit-spin rounded-full border-t border-primary/40" />

      <h3 className="relative text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        {d2.uptimeCard}
      </h3>
      <p className="relative mt-4 font-mono text-[34px] font-bold leading-none tabular-nums text-silver">
        {dd}
        <span className="text-lg text-primary">d</span> {hh}:{mm}:{ss}
      </p>

      <div className="relative mt-5 flex items-center gap-2.5">
        <button
          onClick={() => toast({ title: dict.common.soon, description: dict.common.soonDesc })}
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:text-primary"
          aria-label="pause"
        >
          <Pause className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => toast({ title: dict.common.soon, description: dict.common.soonDesc })}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-chart-5/20 text-chart-5 ring-1 ring-chart-5/40 transition-colors hover:bg-chart-5/30"
          aria-label="stop"
        >
          <Square className="h-3 w-3" />
        </button>
      </div>
    </section>
  );
}

export function MidRow() {
  return (
    <>
      {/* consumers trio */}
      <div className="grid grid-cols-12 gap-4">
        <ConsumerCards />
      </div>

      {/* hero + quick + uptime */}
      <div className="mt-4 grid grid-cols-12 gap-4">
        <ThroughputHero />
        <QuickActions />
        <UptimeTracker />
      </div>
    </>
  );
}
