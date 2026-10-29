import { useEffect, useMemo, useState } from "react";
import { Activity, Gauge, Globe, Info, Radio, RefreshCw, Timer, Users, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · v2.7 — Online Users view

   Who is connected RIGHT NOW:
   • live roster from the socket core feed (topUsers[].up)
   • KPI strip: active users, sessions, distribution %
   • concurrent-IP usage table from /api/users/ip-usage
     (honest empty state on the simulator core)
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

export function OnlineUsersView() {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].online;
  const status = useCoreStore((s) => s.status);
  const snapshot = useCoreStore((s) => s.snapshot);

  const [query, setQuery] = useState("");
  const [ipUsage, setIpUsage] = useState<IpUsageRow[]>([]);
  const [ipLive, setIpLive] = useState(false);
  const [ipWindow, setIpWindow] = useState(10);
  const [ipLoading, setIpLoading] = useState(false);

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

  useEffect(() => {
    void loadIpUsage();
    const t = setInterval(() => void loadIpUsage(), 30_000);
    return () => clearInterval(t);
  }, []);

  const online = useMemo(() => snapshot.topUsers.filter((u) => u.up), [snapshot.topUsers]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return online;
    return online.filter((u) => u.user.toLowerCase().includes(q) || u.proto.toLowerCase().includes(q));
  }, [online, query]);

  const live = status === "live";

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
          <Button variant="outline" size="sm" onClick={() => void loadIpUsage()} disabled={ipLoading}>
            <RefreshCw className={cn("size-4", ipLoading && "animate-spin")} />
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
          <div className="mt-4 overflow-x-auto">
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
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.uid} className="border-b border-white/5 transition-colors hover:bg-white/5">
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
                        <div className="flex w-28 items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                u.usagePct >= 90 ? "bg-rose-400" : u.usagePct >= 70 ? "bg-amber-400" : "bg-emerald-400"
                              )}
                              style={{ width: `${Math.min(100, u.usagePct)}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(u.usagePct)}%</span>
                        </div>
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
                  </tr>
                ))}
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
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{fx.colEmail}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colIps}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colCount}</th>
                  <th className="px-3 py-2 text-start font-medium">{fx.colLimit}</th>
                </tr>
              </thead>
              <tbody>
                {ipUsage.map((row) => (
                  <tr
                    key={row.email}
                    className={cn("border-b border-white/5", row.breach && "bg-rose-500/5")}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs">
                      <span dir="ltr">{row.email}</span>
                      {row.username && (
                        <span className="ms-2 text-muted-foreground">({row.username})</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {row.ips.slice(0, 4).map((ip) => (
                          <Badge key={ip} variant="outline" className="font-mono text-[10px]" dir="ltr">
                            {ip}
                          </Badge>
                        ))}
                        {row.ips.length > 4 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{row.ips.length - 4}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{row.count}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn("tabular-nums", row.breach && "font-semibold text-rose-300")}>
                        {row.limit === 0 ? fx.unlimited : row.limit}
                      </span>
                      {row.breach && (
                        <Badge className="ms-2 bg-rose-500/15 text-[10px] text-rose-300">{fx.breachBadge}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
