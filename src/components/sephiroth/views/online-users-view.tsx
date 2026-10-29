"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Gauge,
  Globe,
  Info,
  Radio,
  RefreshCw,
  Timer,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { liveDictionaries, relTime } from "@/lib/i18n/live-strings";
import type { CoreUserStat } from "@/lib/realtime/core-types";
import { stringifyCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · v2.7 — Online Users view (task 2-b upgrade)

   Who is connected RIGHT NOW:
   • live roster from the socket core feed (topUsers[].up)
   • KPI strip: active users, sessions, distribution %
   • concurrent-IP usage table from /api/users/ip-usage
     (honest empty state on the simulator core)
   • 2-b — inline session drill-down in BOTH directions:
       roster row   → per-IP sessions (ip · state · last seen)
       IP table row → which user(s) share each IP (reverse map)
     fed by GET /api/system/online-sessions (IpTracker lastSeen),
     refreshed on the same 30s poll cycle as the ip-usage table
   • 2-b — CSV export (RFC-4180 + BOM via lib/csv, Blob download):
       sephiroth-online-<date>.csv · sephiroth-online-ips-<date>.csv

   Honesty notes: the IpTracker stores only the LAST observation
   per (email, ip) pair, so there is no firstSeen anywhere; Xray
   exposes no per-IP byte counters, so traffic stays user-level
   (labelled as such in the panels and the export columns).
   ============================================================ */

interface IpUsageRow {
  email: string;
  userId: string;
  username: string;
  ips: string[];
  count: number;
  limit: number;
  breach: boolean;
}

interface SessionIp {
  ip: string;
  lastSeenMs: number;
  stale: boolean;
}

interface SessionUser {
  email: string;
  username: string;
  userId: string | null;
  enabled: boolean;
  ipLimit: number;
  ips: SessionIp[];
}

interface SessionsPayload {
  live?: boolean;
  windowMinutes?: number;
  serverNow?: number;
  note?: string;
  users?: SessionUser[];
}

/** reverse-map view: one user observed on an IP inside the window */
interface IpOwner {
  email: string;
  username: string;
  stale: boolean;
  /** null = timestamped tracker data unavailable (fallback owner row) */
  lastSeenMs: number | null;
}

function Spark({ points, alive }: { points: number[]; alive: boolean }) {
  const max = Math.max(1, ...points);
  return (
    <div className="flex h-5 items-end gap-px" aria-hidden="true">
      {points.map((p, i) => (
        <span
          key={i}
          className={cn(
            "w-1 rounded-sm",
            alive ? "bg-emerald-400/80" : "bg-muted-foreground/30"
          )}
          style={{ height: `${Math.max(10, Math.round((p / max) * 100))}%` }}
        />
      ))}
    </div>
  );
}

function UsageBar({ pct }: { pct: number }) {
  return (
    <div className="flex w-28 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 90 ? "bg-rose-400" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400"
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  );
}

/** accessible expand/collapse toggle (Enter/Space native button semantics) */
function ChevronToggle({
  open,
  controls,
  label,
  onToggle,
}: {
  open: boolean;
  controls: string;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      className="inline-grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
  );
}

export function OnlineUsersView() {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].online;
  const L = liveDictionaries[lang];
  const status = useCoreStore((s) => s.status);
  const snapshot = useCoreStore((s) => s.snapshot);

  const [query, setQuery] = useState("");
  const [ipUsage, setIpUsage] = useState<IpUsageRow[]>([]);
  const [ipLive, setIpLive] = useState(false);
  const [ipWindow, setIpWindow] = useState(10);
  const [ipLoading, setIpLoading] = useState(false);

  /* 2-b — timestamped session data (IpTracker lastSeen per email+ip) */
  const [sessions, setSessions] = useState<SessionUser[]>([]);
  const [sessionsLive, setSessionsLive] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  /* 2-b — inline drill-down state */
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [expandedIp, setExpandedIp] = useState<string | null>(null);
  const [focusIp, setFocusIp] = useState<string | null>(null);

  /* ticking clock for relative "last seen" labels */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadIpUsage = async () => {
    setIpLoading(true);
    try {
      const res = await fetch("/api/users/ip-usage", { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as {
          live?: boolean;
          windowMinutes?: number;
          usage?: IpUsageRow[];
        };
        setIpUsage(Array.isArray(d.usage) ? d.usage : []);
        setIpLive(Boolean(d.live));
        setIpWindow(Number(d.windowMinutes) || 10);
      }
    } catch {
      /* keep previous data — honest staleness */
    } finally {
      setIpLoading(false);
    }
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/system/online-sessions", { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as SessionsPayload;
        setSessions(Array.isArray(d.users) ? d.users : []);
        setSessionsLive(Boolean(d.live));
      }
    } catch {
      /* keep previous data — honest staleness */
    } finally {
      setSessionsLoading(false);
    }
  };

  /* one poll cycle for both feeds (mirrors the previous 30s ip-usage loop) */
  useEffect(() => {
    void loadIpUsage();
    void loadSessions();
    const t = setInterval(() => {
      void loadIpUsage();
      void loadSessions();
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const refreshAll = () => {
    void loadIpUsage();
    void loadSessions();
  };

  const online = useMemo(() => snapshot.topUsers.filter((u) => u.up), [snapshot.topUsers]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return online;
    return online.filter((u) => u.user.toLowerCase().includes(q) || u.proto.toLowerCase().includes(q));
  }, [online, query]);

  const live = status === "live";
  const loading = ipLoading || sessionsLoading;

  /* ---------- 2-b joins: roster (username-keyed) ↔ sessions (email-keyed) ---------- */

  const sessionsByEmail = useMemo(
    () => new Map(sessions.map((s) => [s.email, s])),
    [sessions]
  );
  const emailByUsername = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sessions) m.set(s.username, s.email);
    return m;
  }, [sessions]);
  const rosterByName = useMemo(() => new Map(online.map((u) => [u.user, u])), [online]);

  /** reverse map: ip → every user observed on it inside the window */
  const ipOwners = useMemo(() => {
    const m = new Map<string, IpOwner[]>();
    for (const s of sessions) {
      for (const p of s.ips) {
        const arr = m.get(p.ip) ?? [];
        arr.push({ email: s.email, username: s.username, stale: p.stale, lastSeenMs: p.lastSeenMs });
        m.set(p.ip, arr);
      }
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.lastSeenMs ?? 0) - (b.lastSeenMs ?? 0));
    return m;
  }, [sessions]);

  /** email for a roster row: sessions join first, then the ip-usage username join */
  const emailForRoster = (user: string): string => {
    const viaSessions = emailByUsername.get(user);
    if (viaSessions) return viaSessions;
    const viaUsage = ipUsage.find((r) => r.username === user || r.email.split("@")[0] === user);
    return viaUsage?.email ?? "";
  };

  const limitRowFor = (user: string, email: string): IpUsageRow | undefined =>
    ipUsage.find((r) => r.email === email || (email === "" && r.username === user));

  /** owners of an ip — falls back to the clicked row's own user when the
      timestamped tracker is unavailable (still honest: no times shown) */
  const ownersFor = (ip: string, row: IpUsageRow): IpOwner[] => {
    const found = ipOwners.get(ip);
    if (found && found.length > 0) return found;
    return [{ email: row.email, username: row.username, stale: !ipLive, lastSeenMs: null }];
  };

  /* ---------- 2-b — CSV export (RFC-4180 + BOM via lib/csv) ---------- */

  const downloadCsv = (filename: string, rows: (string | number)[][]) => {
    const blob = new Blob([stringifyCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const exportRosterCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const rows: (string | number)[][] = [
      ["username", "email", "enabled", "proto", "ips", "sessions", "traffic_gb", "delta_gb", "quota_pct"],
    ];
    for (const u of online) {
      const email = emailForRoster(u.user);
      const session = email ? sessionsByEmail.get(email) : undefined;
      rows.push([
        u.user,
        email,
        session ? String(session.enabled) : "",
        u.proto,
        session ? session.ips.map((p) => p.ip).join(";") : "",
        session ? session.ips.length : 0,
        u.gb.toFixed(4),
        u.delta.toFixed(4),
        u.usagePct === null ? "" : String(Math.round(u.usagePct)),
      ]);
    }
    downloadCsv(`sephiroth-online-${stamp}.csv`, rows);
  };

  const exportIpsCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const rows: (string | number)[][] = [["ip", "users", "last_seen", "state"]];
    if (ipOwners.size > 0) {
      const entries = [...ipOwners.entries()].sort(
        (a, b) =>
          Math.max(...b[1].map((o) => o.lastSeenMs ?? 0)) -
          Math.max(...a[1].map((o) => o.lastSeenMs ?? 0))
      );
      for (const [ip, owners] of entries) {
        const newest = Math.max(...owners.map((o) => o.lastSeenMs ?? 0));
        rows.push([
          ip,
          owners.map((o) => o.email).join(";"),
          newest > 0 ? new Date(newest).toISOString() : "",
          owners.some((o) => !o.stale) ? "live" : "stale",
        ]);
      }
    } else {
      // honest fallback — the per-user table has IP lists but no timestamps
      for (const r of ipUsage) {
        for (const ip of r.ips) rows.push([ip, r.email, "", ipLive ? "live" : "stale"]);
      }
    }
    downloadCsv(`sephiroth-online-ips-${stamp}.csv`, rows);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30">
            <Wifi className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{fx.title}</h1>
            <p className="text-sm text-muted-foreground">{fx.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "gap-1.5",
              live ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300"
            )}
          >
            {live ? <Radio className="size-3.5 animate-pulse" /> : <WifiOff className="size-3.5" />}
            {live ? fx.liveBadge : fx.connecting}
          </Badge>
          {/* 2-b — CSV export: live roster + concurrent-IP table */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                aria-label={L.onlineExport}
                title={L.onlineExport}
              >
                <Download className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{L.onlineExport}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass-strong">
              <DropdownMenuItem onClick={exportRosterCsv}>
                <FileSpreadsheet className="size-4" aria-hidden="true" /> {L.onlineExportRoster}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportIpsCsv}>
                <FileSpreadsheet className="size-4" aria-hidden="true" /> {L.onlineExportIps}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            <span className="sr-only">refresh</span>
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="size-3.5" /> {fx.kpiActive}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-300">{snapshot.metrics.activeUsers}</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="size-3.5" /> {fx.kpiSessions}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{snapshot.metrics.sessions}</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="size-3.5" /> {fx.kpiConnected}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-300">{snapshot.distribution.connectedPct}%</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Timer className="size-3.5" /> {fx.kpiIdle}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-amber-300">{snapshot.distribution.idlePct}%</div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Gauge className="size-3.5" /> {fx.kpiLimited}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-rose-300">{snapshot.distribution.limitedPct}%</div>
        </div>
      </div>

      {/* live roster */}
      <div className="glass rounded-2xl p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-emerald-300" />
            {fx.title}
            <span className="text-muted-foreground">({shown.length})</span>
          </h2>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search…"
            className="h-9 max-w-56"
          />
        </div>

        {!live ? (
          <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200/90">
            <p className="font-semibold">{fx.offlineTitle}</p>
            <p className="mt-1 text-muted-foreground">{fx.offlineNote}</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-2 py-10 text-center">
            <WifiOff className="size-8 text-muted-foreground/40" />
            <p className="font-semibold">{fx.emptyTitle}</p>
            <p className="text-sm text-muted-foreground">{fx.emptyNote}</p>
          </div>
        ) : (
          <div className="mt-4 max-h-96 overflow-y-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/5 text-start text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{fx.colUser}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colProto}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colTraffic}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colDelta}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colUsage}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colExpires}</th>
                  <th className="px-3 py-2" aria-hidden="true" />
                  <th className="px-3 py-2 text-end font-medium">
                    <span className="sr-only">{L.onlineDetail}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => {
                  const isOpen = expandedUser === u.uid;
                  const email = emailForRoster(u.user);
                  const session = email ? sessionsByEmail.get(email) : undefined;
                  const limitRow = limitRowFor(u.user, email);
                  return (
                    <RosterRow
                      key={u.uid}
                      u={u}
                      isOpen={isOpen}
                      fx={fx}
                      L={L}
                      email={email}
                      session={session}
                      limitRow={limitRow}
                      now={now}
                      sessionsLive={sessionsLive}
                      onToggle={() => setExpandedUser(isOpen ? null : u.uid)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* concurrent IP usage */}
      <div className="glass rounded-2xl p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="size-4 text-sky-300" />
            {fx.ipTitle}
          </h2>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {fx.ipWindow.replace("{minutes}", String(ipWindow))}
            </Badge>
            <Badge
              variant="outline"
              className={cn("text-xs", ipLive ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300")}
            >
              {ipLive ? fx.ipLive : fx.ipStale}
            </Badge>
          </div>
        </div>

        {!ipLive && (
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {fx.simNote}
          </p>
        )}

        {ipUsage.length === 0 ? (
          <p className="mt-4 py-6 text-center text-sm text-muted-foreground">{fx.ipEmpty}</p>
        ) : (
          <div className="mt-4 max-h-96 overflow-y-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{fx.colEmail}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colIps}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colCount}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colLimit}</th>
                  <th className="px-3 py-2 text-end font-medium">
                    <span className="sr-only">{L.onlineDetail}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ipUsage.map((row, idx) => {
                  const isOpen = expandedIp === row.email;
                  const session = sessionsByEmail.get(row.email);
                  return (
                    <IpRow
                      key={row.email}
                      row={row}
                      idx={idx}
                      isOpen={isOpen}
                      session={session}
                      fx={fx}
                      L={L}
                      now={now}
                      ipLive={ipLive}
                      focusIp={focusIp}
                      ownersFor={ownersFor}
                      rosterByName={rosterByName}
                      onToggle={() => {
                        setExpandedIp(isOpen ? null : row.email);
                        if (!isOpen) setFocusIp(null);
                      }}
                      onFocusIp={(ip) => {
                        setExpandedIp(row.email);
                        setFocusIp(ip);
                      }}
                      onPickUser={(username) => setQuery(username)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   2-b — roster row + its inline session drill-down:
   one row per concurrent IP (ip · live/stale · last seen)
   ============================================================ */

function RosterRow({
  u,
  isOpen,
  fx,
  L,
  email,
  session,
  limitRow,
  now,
  sessionsLive,
  onToggle,
}: {
  u: CoreUserStat;
  isOpen: boolean;
  fx: (typeof FEATURE)["en"]["online"];
  L: (typeof liveDictionaries)["en"];
  email: string;
  session: SessionUser | undefined;
  limitRow: IpUsageRow | undefined;
  now: number;
  sessionsLive: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-white/5 transition-colors hover:bg-white/5",
          isOpen && "bg-white/5"
        )}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
            <span className="font-medium">{u.user}</span>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {u.proto}
          </Badge>
        </td>
        <td className="px-3 py-2.5 tabular-nums">{u.gb.toFixed(2)} GB</td>
        <td className={cn("px-3 py-2.5 tabular-nums", u.delta >= 0 ? "text-emerald-300" : "text-rose-300")}>
          {u.delta >= 0 ? "+" : ""}
          {u.delta.toFixed(2)}
        </td>
        <td className="px-3 py-2.5">
          {u.usagePct === null ? (
            <span className="text-xs text-muted-foreground">{fx.unlimited}</span>
          ) : (
            <UsageBar pct={u.usagePct} />
          )}
        </td>
        <td className="px-3 py-2.5 text-xs">
          {u.expiresInH === null ? (
            <span className="text-muted-foreground">{fx.unlimited}</span>
          ) : u.expiresInH <= 0 ? (
            <span className="text-rose-300">{fx.expired}</span>
          ) : u.expiresInH < 48 ? (
            <span className="text-amber-300">{fx.hoursLeft.replace("{n}", String(Math.round(u.expiresInH)))}</span>
          ) : (
            <span>{fx.daysLeft.replace("{n}", String(Math.round(u.expiresInH / 24)))}</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <Spark points={u.spark.slice(-8)} alive />
        </td>
        <td className="px-3 py-2.5 text-end">
          <ChevronToggle
            open={isOpen}
            controls={`ux-${u.uid}`}
            label={L.onlineAriaUser.replace("{user}", u.user)}
            onToggle={onToggle}
          />
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-white/5">
          <td colSpan={8} className="px-3 pb-4">
            <div
              id={`ux-${u.uid}`}
              role="region"
              aria-label={`${L.onlineSessionsTitle} · ${u.user}`}
              className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4"
            >
              {/* identity + user-level live stats (traffic is user-level by design) */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-mono text-xs" dir="ltr">
                  {email || u.user}
                </span>
                <Badge variant="outline" className="font-mono text-[10px] uppercase">
                  {u.proto}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {fx.colTraffic}:{" "}
                  <span className="tabular-nums text-foreground">{u.gb.toFixed(2)} GB</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {fx.colDelta}:{" "}
                  <span className={cn("tabular-nums", u.delta >= 0 ? "text-emerald-300" : "text-rose-300")}>
                    {u.delta >= 0 ? "+" : ""}
                    {u.delta.toFixed(2)}
                  </span>
                </span>
                {u.usagePct === null ? (
                  <span className="text-xs text-muted-foreground">
                    {fx.colUsage}: {fx.unlimited}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {fx.colUsage}: <UsageBar pct={u.usagePct} />
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {fx.kpiSessions}:{" "}
                  <span className="tabular-nums text-foreground">
                    {session ? session.ips.length : 0}
                    {limitRow ? ` / ${limitRow.limit === 0 ? fx.unlimited : limitRow.limit}` : ""}
                  </span>
                </span>
                {limitRow?.breach && (
                  <Badge className="bg-rose-500/15 text-[10px] text-rose-300">{fx.breachBadge}</Badge>
                )}
              </div>

              {/* one row per concurrent IP */}
              {session ? (
                <>
                  <div className="mt-3 max-h-60 overflow-y-auto pe-1">
                    <div className="flex flex-col gap-1.5">
                      {session.ips.map((p) => (
                        <div
                          key={p.ip}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/5 px-3 py-2"
                        >
                          <span className="min-w-28 font-mono text-xs" dir="ltr">
                            {p.ip}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              p.stale
                                ? "border-amber-400/40 text-amber-300"
                                : "border-emerald-400/40 text-emerald-300"
                            )}
                          >
                            {p.stale ? fx.ipStale : fx.ipLive}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {L.onlineLastSeen}:{" "}
                            <span dir="ltr" className="tabular-nums">
                              {relTime(p.lastSeenMs, now, L)}
                            </span>
                          </span>
                          <span
                            className="ms-auto text-xs text-muted-foreground/60"
                            title={L.onlinePerIpNote}
                          >
                            —
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Info className="size-3 shrink-0" aria-hidden="true" />
                    {L.onlinePerIpNote}
                  </p>
                </>
              ) : (
                <div className="mt-3 flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-white/10 py-6 text-center">
                  <WifiOff className="size-5 text-muted-foreground/40" aria-hidden="true" />
                  <p className="text-sm font-medium">{L.onlineNoSessions}</p>
                  {!sessionsLive && <p className="text-xs text-muted-foreground">{fx.simNote}</p>}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ============================================================
   2-b — concurrent-IP row + its reverse-map drill-down:
   which user(s) each IP belongs to (email links styled as text),
   their per-pair live status and user-level traffic
   ============================================================ */

function IpRow({
  row,
  idx,
  isOpen,
  session,
  fx,
  L,
  now,
  ipLive,
  focusIp,
  ownersFor,
  rosterByName,
  onToggle,
  onFocusIp,
  onPickUser,
}: {
  row: IpUsageRow;
  idx: number;
  isOpen: boolean;
  session: SessionUser | undefined;
  fx: (typeof FEATURE)["en"]["online"];
  L: (typeof liveDictionaries)["en"];
  now: number;
  ipLive: boolean;
  focusIp: string | null;
  ownersFor: (ip: string, row: IpUsageRow) => IpOwner[];
  rosterByName: Map<string, CoreUserStat>;
  onToggle: () => void;
  onFocusIp: (ip: string) => void;
  onPickUser: (username: string) => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-white/5 transition-colors hover:bg-white/5",
          row.breach && "bg-rose-500/5",
          isOpen && "bg-white/5"
        )}
      >
        <td className="px-3 py-2.5 font-mono text-xs">
          <span dir="ltr">{row.email}</span>
          {row.username && <span className="ms-2 text-muted-foreground">({row.username})</span>}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap gap-1">
            {row.ips.slice(0, 4).map((ip) => (
              <button
                key={ip}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusIp(ip);
                }}
                aria-expanded={isOpen}
                aria-controls={`ipx-${idx}`}
                aria-label={L.onlineAriaIp.replace("{ip}", ip)}
                className="inline-flex items-center rounded-md border border-white/15 bg-transparent px-2 py-0.5 font-mono text-[10px] transition-colors hover:border-sky-400/40 hover:bg-sky-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                dir="ltr"
              >
                {ip}
              </button>
            ))}
            {row.ips.length > 4 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                aria-expanded={isOpen}
                aria-controls={`ipx-${idx}`}
                aria-label={L.onlineDetail}
                className="inline-flex items-center rounded-md border border-white/15 bg-transparent px-2 py-0.5 text-[10px] transition-colors hover:border-sky-400/40 hover:bg-sky-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                +{row.ips.length - 4}
              </button>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 tabular-nums">{row.count}</td>
        <td className="px-3 py-2.5">
          <span className={cn("tabular-nums", row.breach && "font-semibold text-rose-300")}>
            {row.limit === 0 ? fx.unlimited : row.limit}
          </span>
          {row.breach && <Badge className="ms-2 bg-rose-500/15 text-[10px] text-rose-300">{fx.breachBadge}</Badge>}
        </td>
        <td className="px-3 py-2.5 text-end">
          <ChevronToggle
            open={isOpen}
            controls={`ipx-${idx}`}
            label={L.onlineAriaIp.replace("{ip}", row.email)}
            onToggle={onToggle}
          />
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-white/5">
          <td colSpan={5} className="px-3 pb-4">
            <div
              id={`ipx-${idx}`}
              role="region"
              aria-label={`${L.onlineDetail} · ${row.email}`}
              className="rounded-xl border border-sky-400/15 bg-sky-400/[0.04] p-4"
            >
              <div className="max-h-72 overflow-y-auto pe-1">
                <div className="flex flex-col gap-2">
                  {row.ips.map((ip) => {
                    const pair = session?.ips.find((p) => p.ip === ip) ?? null;
                    const owners = ownersFor(ip, row);
                    const focused = focusIp === ip;
                    return (
                      <div
                        key={ip}
                        className={cn(
                          "rounded-lg bg-white/5 p-3 transition-shadow",
                          focused && "ring-1 ring-sky-400/40"
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-28 font-mono text-xs" dir="ltr">
                            {ip}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              pair
                                ? pair.stale
                                  ? "border-amber-400/40 text-amber-300"
                                  : "border-emerald-400/40 text-emerald-300"
                                : ipLive
                                  ? "border-emerald-400/40 text-emerald-300"
                                  : "border-amber-400/40 text-amber-300"
                            )}
                          >
                            {pair ? (pair.stale ? fx.ipStale : fx.ipLive) : ipLive ? fx.ipLive : fx.ipStale}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {L.onlineLastSeen}:{" "}
                            {pair ? (
                              <span dir="ltr" className="tabular-nums">
                                {relTime(pair.lastSeenMs, now, L)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{L.onlineShared}:</span>
                          {owners.map((o) => {
                            const roster = rosterByName.get(o.username);
                            return (
                              <button
                                key={o.email}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPickUser(o.username);
                                }}
                                title={roster ? `${o.username} · ${roster.gb.toFixed(2)} GB` : o.username}
                                className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-emerald-300 underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <span
                                  className={cn(
                                    "size-1.5 shrink-0 rounded-full",
                                    o.stale ? "bg-amber-400" : "animate-pulse bg-emerald-400"
                                  )}
                                  aria-hidden="true"
                                />
                                <span dir="ltr" className="font-mono">
                                  {o.email}
                                </span>
                                {roster && (
                                  <span className="tabular-nums text-muted-foreground">
                                    ({roster.gb.toFixed(2)} GB)
                                  </span>
                                )}
                              </button>
                            );
                          })}
                          {owners.length === 1 && (
                            <span className="text-[11px] text-muted-foreground">({L.onlineOnlyUser})</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Info className="size-3 shrink-0" aria-hidden="true" />
                {L.onlinePerIpNote}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
