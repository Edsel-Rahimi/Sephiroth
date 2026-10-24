"use client";

import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------- smooth path helper (catmull-rom → bezier) ---------- */
export function smoothLine(
  values: number[],
  w: number,
  h: number,
  opts: { min?: number; max?: number; pad?: number } = {}
): { line: string; area: string } {
  const pad = opts.pad ?? 3;
  const min = opts.min ?? Math.min(...values);
  const max = opts.max ?? Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1),
    h - pad - ((v - min) / range) * (h - pad * 2),
  ] as const);

  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = ((x0 + x1) / 2).toFixed(2);
    d += ` C${cx},${y0.toFixed(2)} ${cx},${y1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  const area = `${d} L${pts[pts.length - 1][0].toFixed(2)},${h} L${pts[0][0].toFixed(2)},${h} Z`;
  return { line: d, area };
}

/* ---------- sparkline (Stakent-style asset cards) ---------- */
export function Sparkline({
  values,
  id,
  tone = "up",
  className,
}: {
  values: number[];
  id: string;
  tone?: "up" | "down";
  className?: string;
}) {
  const W = 160;
  const H = 52;
  const { line, area } = useMemo(() => smoothLine(values, W, H, { pad: 4 }), [values]);
  const stroke = tone === "up" ? "#22d8ee" : "#f43f5e";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-12 w-full", className)} aria-hidden="true">
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${id})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        className="line-draw"
        style={{ filter: `drop-shadow(0 0 5px ${stroke}66)` }}
      />
    </svg>
  );
}

/* ---------- trend badge (Resq-style circle + %) ---------- */
export function TrendBadge({ up, val }: { up: boolean; val: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-0.5 rounded-full px-1.5 font-mono text-[11px] font-bold tabular-nums",
        up ? "bg-chart-3/15 text-chart-3" : "bg-chart-5/15 text-chart-5"
      )}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {val}
    </span>
  );
}

/* ---------- performance pill (Resq-style header pills) ---------- */
export function StatPill({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 truncate text-[11px] text-muted-foreground">{label}</p>
      <div className="flex h-6 w-full max-w-32 items-center overflow-hidden rounded-full bg-muted/80 p-1">
        <div
          className="flex h-full items-center justify-end rounded-full px-2.5 transition-[width] duration-700"
          style={{ width: `${Math.max(18, pct)}%`, background: color }}
        >
          <span className="font-mono text-[10px] font-bold tabular-nums text-[#041014]">
            {pct}%
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- card wrapper ---------- */
export function D2Card({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("glass hover-glow rounded-2xl p-5", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
