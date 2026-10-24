"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  DatabaseBackup,
  Download,
  Gauge,
  LogIn,
  LogOut,
  PenLine,
  Plus,
  PowerOff,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TimerOff,
  Trash2,
  TrendingUp,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { D2Card } from "@/components/sephiroth/dashboard/parts";
import { useAppStore } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { lfmt, liveDictionaries, relTime, type L } from "@/lib/i18n/live-strings";
import type { ActivityKind, ActivityLevel } from "@/lib/realtime/core-types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  "user.connected": LogIn,
  "user.disconnected": LogOut,
  "user.created": UserPlus,
  "user.expired": TimerOff,
  "user.limit": Gauge,
  "auth.success": ShieldCheck,
  "auth.failed": ShieldAlert,
  "inbound.online": Radio,
  "inbound.offline": PowerOff,
  "inbound.created": Plus,
  "inbound.updated": PenLine,
  "inbound.deleted": Trash2,
  "core.reload": RefreshCw,
  "system.backup": DatabaseBackup,
  "traffic.spike": TrendingUp,
  "system.cert": BadgeCheck,
  "sub.fetch": Download,
};

const KIND_KEY: Record<ActivityKind, keyof L> = {
  "user.connected": "evtUserConnected",
  "user.disconnected": "evtUserDisconnected",
  "user.created": "evtUserCreated",
  "user.expired": "evtUserExpired",
  "user.limit": "evtUserLimit",
  "auth.success": "evtAuthSuccess",
  "auth.failed": "evtAuthFailed",
  "inbound.online": "evtInboundOnline",
  "inbound.offline": "evtInboundOffline",
  "inbound.created": "evtInboundCreated",
  "inbound.updated": "evtInboundUpdated",
  "inbound.deleted": "evtInboundDeleted",
  "core.reload": "evtCoreReload",
  "system.backup": "evtBackup",
  "traffic.spike": "evtSpike",
  "system.cert": "evtCert",
  "sub.fetch": "evtSubFetch",
};

const LEVEL_CLS: Record<ActivityLevel, string> = {
  info: "bg-primary/10 text-primary ring-primary/25",
  success: "bg-chart-3/10 text-chart-3 ring-chart-3/30",
  warn: "bg-chart-4/10 text-chart-4 ring-chart-4/30",
  error: "bg-chart-5/10 text-chart-5 ring-chart-5/30",
};

const LEVEL_DOT: Record<ActivityLevel, string> = {
  info: "bg-primary",
  success: "bg-chart-3",
  warn: "bg-chart-4",
  error: "bg-chart-5",
};

function StatusChip() {
  const lang = useAppStore((s) => s.lang);
  const L = liveDictionaries[lang];
  const status = useCoreStore((s) => s.status);

  const map = {
    live: { label: L.liveChip, cls: "text-chart-3 ring-chart-3/30 bg-chart-3/10", dot: "bg-chart-3" },
    connecting: { label: L.connecting, cls: "text-chart-4 ring-chart-4/30 bg-chart-4/10", dot: "bg-chart-4" },
    offline: { label: L.offline, cls: "text-chart-5 ring-chart-5/30 bg-chart-5/10", dot: "bg-chart-5" },
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider ring-1",
        map.cls
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", map.dot)} />
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", map.dot)} />
      </span>
      {map.label}
    </span>
  );
}

/**
 * Live activity terminal — the Phase-2 centerpiece.
 * Streams core events pushed by the simulator mini-service.
 */
export function ActivityFeed() {
  const lang = useAppStore((s) => s.lang);
  const L = liveDictionaries[lang];
  const events = useCoreStore((s) => s.events);
  const [filter, setFilter] = useState<"all" | "alerts">("all");
  const [now, setNow] = useState(() => Date.now());

  /* 1s heartbeat so relative labels stay fresh */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.level === "warn" || e.level === "error")),
    [events, filter]
  );
  const perMin = useMemo(() => events.filter((e) => now - e.ts < 60_000).length, [events, now]);

  return (
    <D2Card
      title={L.feedTitle}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="glass hidden items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] tabular-nums text-muted-foreground sm:inline-flex">
            <Activity className="h-3 w-3 text-primary" />
            {perMin} {L.eventsPerMin}
          </span>
          <StatusChip />
          <div className="glass flex items-center rounded-full p-1">
            {(
              [
                ["all", L.filterAll],
                ["alerts", L.filterAlerts],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "h-7 rounded-full px-3 text-[11px] font-medium transition-colors",
                  filter === key
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      }
      className="col-span-12"
    >
      <p className="-mt-2 mb-3 text-[11px] text-muted-foreground/70">{L.feedSub}</p>

      <div className="max-h-96 space-y-1.5 overflow-y-auto pe-1">
        {visible.length === 0 ? (
          <div className="flex h-28 flex-col items-center justify-center gap-2 text-muted-foreground/60">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary/70" />
            </span>
            <p className="text-xs">{L.feedEmpty}</p>
          </div>
        ) : (
          visible.map((e) => {
            const Icon = KIND_ICON[e.kind] ?? Activity;
            const template = L[KIND_KEY[e.kind] ?? "evtUserConnected"];
            const message = lfmt(template, e.params);
            return (
              <article
                key={e.id}
                className="fade-up group flex items-center gap-3 rounded-xl bg-muted/40 px-3.5 py-2.5 transition-colors hover:bg-muted/70"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1",
                    LEVEL_CLS[e.level]
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <p className="min-w-0 flex-1 truncate text-xs text-foreground/90">{message}</p>
                <span
                  className={cn(
                    "hidden h-1.5 w-1.5 shrink-0 rounded-full sm:block",
                    LEVEL_DOT[e.level]
                  )}
                  aria-hidden="true"
                />
                <time
                  dateTime={new Date(e.ts).toISOString()}
                  className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70"
                  title={new Date(e.ts).toLocaleTimeString("en-GB")}
                >
                  {relTime(e.ts, now, L)}
                </time>
              </article>
            );
          })
        )}
      </div>
    </D2Card>
  );
}
