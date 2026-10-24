"use client";

import { useMemo } from "react";
import { ArrowDown, ArrowUp, Clock3, Cpu, MemoryStick } from "lucide-react";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";

/* ---------- static sample data (phase 0 showcase) ---------- */
const SAMPLE_CONSUMERS = [
  { name: "Aria", gb: 412.6, pct: 92 },
  { name: "Neo", gb: 356.1, pct: 79 },
  { name: "Kaya", gb: 287.4, pct: 64 },
  { name: "Orion", gb: 198.2, pct: 44 },
  { name: "Vega", gb: 121.9, pct: 27 },
];

const SAMPLE_EVENTS = [
  { user: "Aria", kind: "connect", time: "2m" },
  { user: "Neo", kind: "connect", time: "5m" },
  { kind: "created", time: "11m" },
  { user: "Kaya", kind: "limit", time: "18m" },
  { kind: "login", time: "26m" },
  { user: "Orion", kind: "connect", time: "33m" },
] as const;

function Card({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className={`glass hover-glow rounded-2xl p-5 ${className ?? ""}`}>
      <h3 className="mb-4 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function DashboardView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang].dash, [lang]);

  /* health ring geometry */
  const R = 46;
  const C = 2 * Math.PI * R;
  const pct = 0.62;

  /* donut segments */
  const segs = [
    { v: 312, color: "var(--chart-3)" }, // active
    { v: 38, color: "var(--chart-5)" }, // expired
    { v: 21, color: "var(--chart-4)" }, // limited
    { v: 64, color: "var(--chart-2)" }, // near limit
  ];
  const total = segs.reduce((a, s) => a + s.v, 0);
  const rDonut = 40;
  const cDonut = 2 * Math.PI * rDonut;
  let offsetAcc = 0;

  return (
    <div className="pt-6">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-primary">
            <span className="h-1 w-1 rounded-full bg-primary glow-cyan" />
            {t.phaseBadge}
          </div>
          <h1 className="text-silver text-2xl font-bold md:text-3xl">{t.title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="glass hidden items-center gap-2 rounded-full px-4 py-2 text-xs text-muted-foreground sm:flex">
          <Clock3 className="h-3.5 w-3.5 text-primary" />
          {t.uptime}: <span className="font-mono text-foreground">42d 06:18:44</span>
        </div>
      </div>

      {/* bento grid */}
      <div className="mt-7 grid grid-cols-12 gap-4">
        {/* health ring */}
        <Card title={t.health} className="col-span-12 md:col-span-6 xl:col-span-4">
          <div className="flex items-center gap-6">
            <div className="relative h-32 w-32 shrink-0">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <defs>
                  <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#22d8ee" />
                    <stop offset="100%" stopColor="#c9d6e2" />
                  </linearGradient>
                </defs>
                <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(148,184,205,0.12)" strokeWidth="9" />
                <circle
                  cx="60"
                  cy="60"
                  r={R}
                  fill="none"
                  stroke="url(#ringGrad)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={`${C * pct} ${C}`}
                  className="drop-shadow-[0_0_10px_rgba(34,216,238,0.55)]"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-2xl font-bold tabular-nums">62%</span>
                <span className="text-[10px] text-muted-foreground">{t.healthNote}</span>
              </div>
            </div>
            <div className="grid flex-1 gap-3">
              <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5 text-primary" /> {t.cpu}
                </span>
                <span className="font-mono text-sm tabular-nums">34%</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MemoryStick className="h-3.5 w-3.5 text-primary" /> {t.ram}
                </span>
                <span className="font-mono text-sm tabular-nums">61%</span>
              </div>
            </div>
          </div>
        </Card>

        {/* live traffic */}
        <Card title={t.liveTraffic} className="col-span-12 md:col-span-6 xl:col-span-8">
          <div className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowDown className="h-3.5 w-3.5 text-primary" /> {t.down}
              </p>
              <p className="font-mono text-2xl font-bold tabular-nums">
                128.4 <span className="text-sm text-muted-foreground">MB/s</span>
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowUp className="h-3.5 w-3.5 text-chart-2" /> {t.up}
              </p>
              <p className="font-mono text-2xl font-bold tabular-nums">
                42.1 <span className="text-sm text-muted-foreground">MB/s</span>
              </p>
            </div>
          </div>
          <div className="relative h-24 w-full overflow-hidden rounded-xl bg-muted/40">
            <svg viewBox="0 0 600 96" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(34,216,238,0.4)" />
                  <stop offset="100%" stopColor="rgba(34,216,238,0)" />
                </linearGradient>
              </defs>
              <path
                d="M0,78 C40,72 70,60 105,58 C140,56 165,66 200,62 C235,58 260,38 300,36 C340,34 365,52 400,48 C435,44 465,26 505,24 C540,22 570,30 600,26 L600,96 L0,96 Z"
                fill="url(#areaGrad)"
              />
              <path
                d="M0,78 C40,72 70,60 105,58 C140,56 165,66 200,62 C235,58 260,38 300,36 C340,34 365,52 400,48 C435,44 465,26 505,24 C540,22 570,30 600,26"
                fill="none"
                stroke="#22d8ee"
                strokeWidth="2"
                className="drop-shadow-[0_0_6px_rgba(34,216,238,0.8)]"
              />
            </svg>
            <div className="shine-sweep pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/6 to-transparent" />
          </div>
        </Card>

        {/* clients donut */}
        <Card title={t.clients} className="col-span-12 md:col-span-6 xl:col-span-4">
          <div className="flex items-center gap-6">
            <div className="relative h-28 w-28 shrink-0">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                {segs.map((s, i) => {
                  const frac = s.v / total;
                  const dash = `${cDonut * frac - 3} ${cDonut * (1 - frac) + 3}`;
                  const off = -offsetAcc;
                  offsetAcc += cDonut * frac;
                  return (
                    <circle
                      key={i}
                      cx="50"
                      cy="50"
                      r={rDonut}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="11"
                      strokeDasharray={dash}
                      strokeDashoffset={off}
                      strokeLinecap="round"
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-xl font-bold tabular-nums">435</span>
                <span className="text-[9px] text-muted-foreground">{t.clientsTotal}</span>
              </div>
            </div>
            <ul className="grid flex-1 gap-2 text-xs">
              {[
                { c: "var(--chart-3)", l: t.active, v: "312" },
                { c: "var(--chart-5)", l: t.expired, v: "38" },
                { c: "var(--chart-4)", l: t.limited, v: "21" },
                { c: "var(--chart-2)", l: t.nearLimit, v: "64" },
              ].map((row) => (
                <li key={row.l} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: row.c }} />
                    {row.l}
                  </span>
                  <span className="font-mono tabular-nums">{row.v}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {/* top consumers */}
        <Card title={t.topConsumers} className="col-span-12 md:col-span-6 xl:col-span-4">
          <ul className="grid gap-3.5">
            {SAMPLE_CONSUMERS.map((u) => (
              <li key={u.name} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-chart-2/10 font-mono text-xs font-bold text-primary ring-1 ring-primary/25">
                  {u.name[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">{u.name}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {u.gb} GB
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-chart-2/50 to-primary"
                      style={{ width: `${u.pct}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* activity pulse */}
        <Card title={t.activity} className="col-span-12 md:col-span-6 xl:col-span-4">
          <ul className="grid gap-3">
            {SAMPLE_EVENTS.map((e, i) => (
              <li key={i} className="flex items-center gap-3 text-xs">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    e.kind === "connect"
                      ? "bg-chart-3"
                      : e.kind === "limit"
                        ? "bg-chart-4"
                        : e.kind === "created"
                          ? "bg-primary"
                          : "bg-chart-2"
                  } ${i === 0 ? "glow-cyan" : ""}`}
                />
                <span className="flex-1 text-muted-foreground">
                  {e.user && <span className="font-medium text-foreground">{e.user} </span>}
                  {e.kind === "connect"
                    ? t.evConnected
                    : e.kind === "created"
                      ? t.evCreated
                      : e.kind === "limit"
                        ? t.evLimit
                        : t.evLogin}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground/70">
                  {e.time}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
