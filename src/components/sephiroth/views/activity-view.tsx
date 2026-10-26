"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  ChevronDown,
  Database,
  DatabaseBackup,
  Download,
  Gauge,
  HelpCircle,
  History,
  Loader2,
  LogIn,
  LogOut,
  Pause,
  PenLine,
  Play,
  Plus,
  PowerOff,
  Radio,
  RefreshCw,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TimerOff,
  Trash2,
  TrendingUp,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppStore } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { dictionaries, type Lang } from "@/lib/i18n/dictionaries";
import { lfmt, liveDictionaries, relTime, type L } from "@/lib/i18n/live-strings";
import type { ActivityEvent, ActivityKind, ActivityLevel } from "@/lib/realtime/core-types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 8 — Activity view (admin)
   LEFT  : live terminal streaming useCoreStore events (same
           rendering approach as dashboard/activity-feed.tsx)
           with pause / resume (frozen snapshot while paused).
   RIGHT : server-persisted history — GET /api/activity with
           level/kind/search filters, paged (append), export as
           JSON and admin clear via DELETE /api/activity.
   ============================================================ */

interface ActivityItem {
  id: string;
  kind: string;
  level: ActivityLevel;
  actor: string;
  message: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface ActivityPage {
  items: ActivityItem[];
  total: number;
  page: number;
  pageSize: number;
}

type LevelFilter = "" | ActivityLevel;
type KindFilter = "" | "auth" | "inbound" | "user" | "sub" | "reseller" | "system";

const PAGE_SIZE = 25;

const LEVEL_FILTERS: ReadonlyArray<{
  value: LevelFilter;
  key: "fAll" | "fInfo" | "fSuccess" | "fWarn" | "fError";
}> = [
  { value: "", key: "fAll" },
  { value: "info", key: "fInfo" },
  { value: "success", key: "fSuccess" },
  { value: "warn", key: "fWarn" },
  { value: "error", key: "fError" },
];

const LEVEL_LABEL: Record<ActivityLevel, "fInfo" | "fSuccess" | "fWarn" | "fError"> = {
  info: "fInfo",
  success: "fSuccess",
  warn: "fWarn",
  error: "fError",
};

const KIND_GROUPS: ReadonlyArray<{
  value: KindFilter;
  key: "gAll" | "gAuth" | "gInbound" | "gUser" | "gSub" | "gReseller" | "gSystem";
}> = [
  { value: "", key: "gAll" },
  { value: "auth", key: "gAuth" },
  { value: "inbound", key: "gInbound" },
  { value: "user", key: "gUser" },
  { value: "sub", key: "gSub" },
  { value: "reseller", key: "gReseller" },
  { value: "system", key: "gSystem" },
];

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

/* terminal palette — info = muted cyan, success = emerald, warn = amber, error = rose */
const LEVEL_TEXT: Record<ActivityLevel, string> = {
  info: "text-primary/80",
  success: "text-chart-3",
  warn: "text-chart-4",
  error: "text-chart-5",
};

const LEVEL_DOT: Record<ActivityLevel, string> = {
  info: "bg-primary",
  success: "bg-chart-3",
  warn: "bg-chart-4",
  error: "bg-chart-5",
};

function buildUrl(level: LevelFilter, kind: KindFilter, q: string, page: number): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (level) params.set("level", level);
  if (kind) params.set("kind", kind);
  if (q) params.set("q", q);
  return `/api/activity?${params.toString()}`;
}

function timeShort(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleTimeString(lang, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ---------- local building blocks ---------- */

function TipBanner({
  title,
  body,
  open,
  onToggle,
}: {
  title: string;
  body: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="glass rounded-2xl ring-1 ring-primary/15" role="note">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-start outline-none transition-colors hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-4 w-4 shrink-0 text-primary/80" aria-hidden="true" />
        <span className="text-xs font-semibold text-foreground">{title}</span>
        <ChevronDown
          className={cn(
            "ms-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <p className="px-4 pb-3.5 ps-11 text-xs leading-relaxed text-muted-foreground">{body}</p>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-gradient-to-br from-primary/25 to-primary/5 text-foreground ring-1 ring-primary/40"
          : "text-muted-foreground ring-1 ring-border hover:bg-white/5 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            "glass flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-white/10",
            tone
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-foreground md:text-3xl">
        {value}
      </p>
    </div>
  );
}

/* ---------- live terminal (col-span-2) ---------- */

function LiveCard() {
  const lang = useAppStore((s) => s.lang);
  const u = useMemo(() => dictionaries[lang].activity, [lang]);
  const L = liveDictionaries[lang];
  const events = useCoreStore((s) => s.events);
  const status = useCoreStore((s) => s.status);

  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<ActivityEvent[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /* 1s heartbeat so relative labels stay fresh (live panel only — history has no timers) */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const visible = frozen ?? events;
  const isLive = !paused && status === "live";

  const togglePaused = () => {
    if (paused) {
      setFrozen(null);
      setPaused(false);
    } else {
      setFrozen(events);
      setPaused(true);
    }
  };

  const badgeCls = isLive
    ? "text-chart-3 ring-chart-3/30 bg-chart-3/10"
    : paused
      ? "text-chart-4 ring-chart-4/30 bg-chart-4/10"
      : "text-muted-foreground ring-border bg-white/5";
  const badgeDot = isLive ? "bg-chart-3" : paused ? "bg-chart-4" : "bg-muted-foreground";
  const badgeLabel = paused ? u.livePaused : isLive ? u.liveLive : status === "offline" ? L.offline : L.connecting;

  return (
    <section className="glass hover-glow flex flex-col rounded-2xl p-5 lg:col-span-2 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
          {u.liveTitle}
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider ring-1",
              badgeCls
            )}
          >
            <span className="relative flex h-1.5 w-1.5">
              {isLive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chart-3 opacity-60" />
              )}
              <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", badgeDot)} />
            </span>
            {badgeLabel}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={togglePaused}
            aria-label={paused ? u.resume : u.pause}
            className="h-8 gap-1.5 rounded-full border-border bg-white/4 px-3 hover:bg-white/8"
          >
            {paused ? (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">{paused ? u.resume : u.pause}</span>
          </Button>
        </div>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{u.liveDesc}</p>

      {/* terminal */}
      <div className="mt-3 max-h-96 flex-1 space-y-1 overflow-y-auto rounded-xl bg-black/40 p-3 font-mono ring-1 ring-white/10">
        {visible.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-2 text-muted-foreground/60">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary/70" />
            </span>
            <p className="font-sans text-xs">{L.feedEmpty}</p>
          </div>
        ) : (
          visible.map((e) => {
            const Icon = KIND_ICON[e.kind] ?? Activity;
            const message = lfmt(L[KIND_KEY[e.kind] ?? "evtUserConnected"], e.params);
            return (
              <div
                key={e.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
              >
                <span
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_DOT[e.level])}
                  aria-hidden="true"
                />
                <Icon
                  className={cn("h-3 w-3 shrink-0", LEVEL_TEXT[e.level])}
                  aria-hidden="true"
                />
                <span
                  className={cn("min-w-0 flex-1 truncate text-[11px]", LEVEL_TEXT[e.level])}
                  title={message}
                >
                  {message}
                </span>
                <time
                  dateTime={new Date(e.ts).toISOString()}
                  className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70"
                >
                  {relTime(e.ts, now, L)}
                </time>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/* ---------- main view ---------- */

export function ActivityView() {
  const lang = useAppStore((s) => s.lang);
  const { toast } = useToast();
  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.activity;

  /* live events (for the today KPI) */
  const events = useCoreStore((s) => s.events);

  /* filters */
  const [level, setLevel] = useState<LevelFilter>("");
  const [kind, setKind] = useState<KindFilter>("");
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");

  /* history state */
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  /* clear dialog */
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [tipOpen, setTipOpen] = useState(true);

  /* debounce search input → query (300ms) */
  useEffect(() => {
    const id = setTimeout(() => setQd(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  /* load page 1 whenever filters change (reset) — no polling, no timers */
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setLoadErr(false);
    void (async () => {
      try {
        const res = await fetch(buildUrl(level, kind, qd, 1), {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("history");
        const d = (await res.json()) as ActivityPage;
        setItems(d.items);
        setTotal(d.total);
        setPage(1);
      } catch {
        if (!ctrl.signal.aborted) setLoadErr(true);
      }
      if (!ctrl.signal.aborted) setLoading(false);
    })();
    return () => ctrl.abort();
  }, [level, kind, qd, reloadTick]);

  const hasMore = page * PAGE_SIZE < total;
  const firstLoad = loading && items.length === 0;

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(level, kind, qd, page + 1), { cache: "no-store" });
      if (!res.ok) throw new Error("history");
      const d = (await res.json()) as ActivityPage;
      setItems((prev) => [...prev, ...d.items]);
      setTotal(d.total);
      setPage(d.page);
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setLoadingMore(false);
  };

  const exportJson = () => {
    if (items.length === 0) return;
    const payload = {
      app: "sephiroth",
      kind: "activity-export",
      exportedAt: new Date().toISOString(),
      count: items.length,
      items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sephiroth-activity-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ description: u.exported });
  };

  const clearHistory = async () => {
    setClearing(true);
    try {
      const res = await fetch("/api/activity", { method: "DELETE" });
      if (!res.ok) throw new Error("clear");
      toast({ description: u.cleared });
      setReloadTick((n) => n + 1);
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setClearing(false);
  };

  /* KPIs — today counts loaded history + live events of today */
  const kpis = useMemo(() => {
    const today = new Date().toDateString();
    return {
      today:
        items.filter((i) => new Date(i.createdAt).toDateString() === today).length +
        events.filter((e) => new Date(e.ts).toDateString() === today).length,
      total,
      errors: items.filter((i) => i.level === "error").length,
      logins: items.filter((i) => i.kind === "auth.login").length,
    };
  }, [items, total, events]);

  return (
    <div className="fade-up space-y-6">
      {/* header */}
      <section className="space-y-2">
        <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-primary/90 ring-1 ring-primary/20">
          <History className="h-3 w-3" aria-hidden="true" />
          {u.badge}
        </span>
        <h2 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">
          {t.nav.activity}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{u.subtitle}</p>
      </section>

      <TipBanner title={u.tipTitle} body={u.tipBody} open={tipOpen} onToggle={() => setTipOpen((v) => !v)} />

      {/* KPI row */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={u.kpiTotal}>
        <Kpi label={u.kpiToday} value={kpis.today} icon={CalendarClock} tone="text-primary" />
        <Kpi label={u.kpiTotal} value={kpis.total} icon={Database} tone="text-chart-2" />
        <Kpi label={u.kpiErrors} value={kpis.errors} icon={AlertTriangle} tone="text-chart-5" />
        <Kpi label={u.kpiLogins} value={kpis.logins} icon={LogIn} tone="text-chart-3" />
      </section>

      {/* two-column: live (2) + history (3) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <LiveCard />

        <section className="glass hover-glow rounded-2xl p-5 md:p-6 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <History className="h-4 w-4 text-primary" aria-hidden="true" />
                {u.historyTitle}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{u.historyDesc}</p>
            </div>
            <Badge
              variant="outline"
              className="gap-1 rounded-full border-border bg-white/5 font-mono tabular-nums text-muted-foreground"
            >
              <Database className="h-3 w-3" aria-hidden="true" />
              {total}
            </Badge>
          </div>

          {/* filter bar */}
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={u.colLevel}>
              {LEVEL_FILTERS.map(({ value, key }) => (
                <Chip key={key} active={level === value} onClick={() => setLevel(value)}>
                  {u[key]}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={kind === "" ? "all" : kind}
                onValueChange={(v) => setKind((v === "all" ? "" : v) as KindFilter)}
              >
                <SelectTrigger
                  className="h-9 w-full sm:w-44"
                  aria-label={u.colKind}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {KIND_GROUPS.map(({ value, key }) => (
                    <SelectItem key={key} value={value === "" ? "all" : value}>
                      {u[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative min-w-0 flex-1">
                <Search
                  className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={u.searchPh}
                  aria-label={u.searchPh}
                  className="h-9 ps-9"
                />
              </div>
              <div className="ms-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportJson}
                  disabled={items.length === 0}
                  aria-label={u.export}
                  className="h-9 gap-1.5 rounded-full border-border bg-white/4 px-3 hover:bg-white/8"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {u.export}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setClearOpen(true)}
                  disabled={clearing || (items.length === 0 && total === 0)}
                  aria-label={u.clear}
                  className="h-9 gap-1.5 rounded-full border-chart-5/40 px-3 text-chart-5 hover:bg-chart-5/10 hover:text-chart-5"
                >
                  {clearing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {u.clear}
                </Button>
              </div>
            </div>
          </div>

          {/* body */}
          {loadErr ? (
            <div
              className="mt-4 flex items-center gap-3 rounded-xl border border-chart-5/30 bg-chart-5/[0.06] px-4 py-3.5 text-sm text-chart-5"
              role="alert"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t.inbounds.errGeneric}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadTick((n) => n + 1)}
                aria-label="retry"
                className="ms-auto gap-2 rounded-full border-white/10 bg-white/[0.03]"
              >
                <RotateCw className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : firstLoad ? (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="mt-4 rounded-xl bg-white/[0.02] p-10 text-center ring-1 ring-white/10">
              <History className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
              <p className="mt-4 text-sm font-semibold text-foreground">{u.empty}</p>
              <p className="mt-1 text-xs text-muted-foreground">{u.emptyDesc}</p>
            </div>
          ) : (
            <>
              <div className="mt-4 max-h-[520px] overflow-auto rounded-xl ring-1 ring-white/10">
                <Table className="min-w-[680px]">
                  <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[110px]">{u.colTime}</TableHead>
                      <TableHead className="w-[150px]">{u.colKind}</TableHead>
                      <TableHead className="w-[110px]">{u.colLevel}</TableHead>
                      <TableHead className="w-[130px]">{u.colActor}</TableHead>
                      <TableHead className="text-start">{u.colMessage}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id} className="hover:bg-white/[0.03]">
                        <TableCell
                          className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground"
                          dir="ltr"
                          title={new Date(item.createdAt).toLocaleString(lang)}
                        >
                          {timeShort(item.createdAt, lang)}
                        </TableCell>
                        <TableCell>
                          <span
                            className="inline-block rounded-md bg-primary/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-primary/90 ring-1 ring-primary/20"
                            dir="ltr"
                          >
                            {item.kind}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-xs text-foreground/90">
                            <span
                              className={cn("h-1.5 w-1.5 rounded-full", LEVEL_DOT[item.level])}
                              aria-hidden="true"
                            />
                            {u[LEVEL_LABEL[item.level]]}
                          </span>
                        </TableCell>
                        <TableCell
                          className="font-mono text-xs text-foreground/80"
                          dir="ltr"
                        >
                          {item.actor || "—"}
                        </TableCell>
                        <TableCell className="text-start">
                          <span
                            className="block max-w-[320px] truncate text-xs text-foreground/90"
                            dir="auto"
                            title={item.message}
                          >
                            {item.message}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {hasMore ? (
                <div className="mt-3 text-center">
                  <Button
                    variant="outline"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
                  >
                    {loadingMore ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    )}
                    {u.loadMore}
                  </Button>
                </div>
              ) : (
                <p className="mt-3 text-center text-[11px] text-muted-foreground">{u.noMore}</p>
              )}
            </>
          )}
        </section>
      </div>

      {/* clear-history confirm */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{u.clearTitle}</AlertDialogTitle>
            <AlertDialogDescription>{u.clearDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.inbounds.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void clearHistory()}
              disabled={clearing}
              className="bg-chart-5 text-white hover:bg-chart-5/90"
            >
              {clearing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              {u.clearBtn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
