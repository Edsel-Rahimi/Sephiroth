"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Ban,
  Cable,
  Check,
  ChevronDown,
  Globe,
  Globe2,
  HelpCircle,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  ShieldCheck,
  Shuffle,
  SquarePen,
  Sword,
  Trash2,
  TriangleAlert,
  Wifi,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries, type Dict } from "@/lib/i18n/dictionaries";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 8 — Outbounds (egress gates, admin)
   Glass cards for every xray outbound: direct/blocked defaults
   (protected) plus custom chains. Create/edit dialog builds the
   settings JSON per protocol; per-card simulated latency test;
   traffic counters with reset. Strings ×6 languages.
   ============================================================ */

type OutboundProtocol =
  | "freedom"
  | "blackhole"
  | "dns"
  | "socks"
  | "http"
  | "vmess"
  | "vless"
  | "trojan"
  | "shadowsocks"
  | "wireguard";

type DomainStrategy = "AsIs" | "UseIP" | "UseIPv4" | "UseIPv6";

interface OutboundDTO {
  id: string;
  tag: string;
  protocol: OutboundProtocol;
  sendThrough: string;
  domainStrategy: string;
  settings: Record<string, unknown>;
  stream: Record<string, unknown>;
  muxEnabled: boolean;
  muxConcurrency: number;
  sortOrder: number;
  upBytes: number;
  downBytes: number;
  createdAt: string;
  updatedAt: string;
}

interface OutboundForm {
  tag: string;
  protocol: OutboundProtocol;
  strategy: DomainStrategy;
  sendThrough: string;
  muxEnabled: boolean;
  muxConcurrency: string;
  address: string;
  port: string;
  id: string;
  password: string;
  method: string;
  publicKey: string;
  endpoint: string;
}

interface CredNeeds {
  address: boolean;
  port: boolean;
  id: boolean;
  password: boolean;
  method: boolean;
  publicKey: boolean;
  endpoint: boolean;
}

const PROTOCOLS: readonly OutboundProtocol[] = [
  "freedom",
  "blackhole",
  "dns",
  "socks",
  "http",
  "vmess",
  "vless",
  "trojan",
  "shadowsocks",
  "wireguard",
];

const PROTOCOL_ICONS: Record<OutboundProtocol, React.ComponentType<{ className?: string }>> = {
  freedom: Zap,
  blackhole: Ban,
  dns: Globe,
  socks: Shuffle,
  http: Globe2,
  vmess: Layers,
  vless: ShieldCheck,
  trojan: Sword,
  shadowsocks: Lock,
  wireguard: Cable,
};

const PROTO_LABEL: Record<OutboundProtocol, keyof Dict["outbounds"]> = {
  freedom: "protoFreedom",
  blackhole: "protoBlackhole",
  dns: "protoDns",
  socks: "protoSocks",
  http: "protoHttp",
  vmess: "protoVmess",
  vless: "protoVless",
  trojan: "protoTrojan",
  shadowsocks: "protoShadowsocks",
  wireguard: "protoWireguard",
};

const PROTO_DESC: Record<OutboundProtocol, keyof Dict["outbounds"]> = {
  freedom: "protoDescFreedom",
  blackhole: "protoDescBlackhole",
  dns: "protoDescDns",
  socks: "protoDescSocks",
  http: "protoDescHttp",
  vmess: "protoDescVmess",
  vless: "protoDescVless",
  trojan: "protoDescTrojan",
  shadowsocks: "protoDescShadowsocks",
  wireguard: "protoDescWireguard",
};

const STRATEGIES: readonly DomainStrategy[] = ["AsIs", "UseIP", "UseIPv4", "UseIPv6"];

const STRATEGY_LABEL: Record<DomainStrategy, keyof Dict["outbounds"]> = {
  AsIs: "strategyAsIs",
  UseIP: "strategyUseIp",
  UseIPv4: "strategyV4",
  UseIPv6: "strategyV6",
};

const CREDS: Record<OutboundProtocol, CredNeeds> = {
  freedom: { address: false, port: false, id: false, password: false, method: false, publicKey: false, endpoint: false },
  blackhole: { address: false, port: false, id: false, password: false, method: false, publicKey: false, endpoint: false },
  dns: { address: false, port: false, id: false, password: false, method: false, publicKey: false, endpoint: false },
  socks: { address: true, port: true, id: true, password: true, method: false, publicKey: false, endpoint: false },
  http: { address: true, port: true, id: true, password: true, method: false, publicKey: false, endpoint: false },
  vmess: { address: true, port: true, id: true, password: false, method: false, publicKey: false, endpoint: false },
  vless: { address: true, port: true, id: true, password: false, method: false, publicKey: false, endpoint: false },
  trojan: { address: true, port: true, id: false, password: true, method: false, publicKey: false, endpoint: false },
  shadowsocks: { address: true, port: true, id: false, password: true, method: true, publicKey: false, endpoint: false },
  wireguard: { address: false, port: false, id: false, password: false, method: false, publicKey: true, endpoint: true },
};

const TAG_RE = /^[a-zA-Z0-9_-]{1,42}$/;

const EMPTY_FORM: OutboundForm = {
  tag: "",
  protocol: "vless",
  strategy: "AsIs",
  sendThrough: "",
  muxEnabled: false,
  muxConcurrency: "8",
  address: "",
  port: "443",
  id: "",
  password: "",
  method: "",
  publicKey: "",
  endpoint: "",
};

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : Number(v.toFixed(1))} ${units[i]}`;
}

function settingsEndpoint(settings: Record<string, unknown>, protocol: OutboundProtocol): string {
  if (protocol === "wireguard") {
    return typeof settings.endpoint === "string" ? settings.endpoint : "";
  }
  const addr = typeof settings.address === "string" ? settings.address : "";
  if (!addr) return "";
  const raw = settings.port;
  const port = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(port) && port > 0 ? `${addr}:${port}` : addr;
}

function isProtectedTag(tag: string): boolean {
  return tag === "direct" || tag === "blocked";
}

export function OutboundsView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.outbounds;
  const { toast } = useToast();

  const [outbounds, setOutbounds] = useState<OutboundDTO[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  /* toolbar */
  const [q, setQ] = useState("");
  const [tipOpen, setTipOpen] = useState(true);

  /* per-card test */
  const [testBusy, setTestBusy] = useState<string | null>(null);

  /* dialog */
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<OutboundDTO | null>(null);
  const [form, setForm] = useState<OutboundForm>(EMPTY_FORM);
  const [tagErr, setTagErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* delete */
  const [deleting, setDeleting] = useState<OutboundDTO | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  /* reset traffic */
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const res = await fetch("/api/outbounds", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const d = (await res.json()) as { outbounds: OutboundDTO[] };
      setOutbounds(d.outbounds);
    } catch {
      setOutbounds([]);
      setLoadErr(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- derived ---------- */

  const kpis = useMemo(() => {
    const list = outbounds ?? [];
    const traffic = list.reduce((acc, o) => acc + o.upBytes + o.downBytes, 0);
    return {
      total: list.length,
      protocols: new Set(list.map((o) => o.protocol)).size,
      traffic,
    };
  }, [outbounds]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = outbounds ?? [];
    if (!needle) return list;
    return list.filter(
      (o) => o.tag.toLowerCase().includes(needle) || o.protocol.includes(needle)
    );
  }, [outbounds, q]);

  const hasCustom = useMemo(
    () => (outbounds ?? []).some((o) => !isProtectedTag(o.tag)),
    [outbounds]
  );

  /* form validation */
  const needs = CREDS[form.protocol];
  const tagValue = form.tag.trim();
  const tagOk = TAG_RE.test(tagValue);
  const portNum = Number(form.port);
  const portOk = !needs.port || (Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535);
  const addrOk = !needs.address || form.address.trim().length > 0;
  const pkOk = !needs.publicKey || form.publicKey.trim().length > 0;
  const canSave = tagOk && portOk && addrOk && pkOk && !saving;

  /* ---------- dialog ---------- */

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setTagErr(null);
    setDlgOpen(true);
  };

  const openEdit = (o: OutboundDTO) => {
    setEditing(o);
    const s = o.settings ?? {};
    const rawPort = s.port;
    const p = typeof rawPort === "number" ? rawPort : Number(rawPort);
    setForm({
      tag: o.tag,
      protocol: o.protocol,
      strategy: (STRATEGIES as readonly string[]).includes(o.domainStrategy)
        ? (o.domainStrategy as DomainStrategy)
        : "AsIs",
      sendThrough: o.sendThrough ?? "",
      muxEnabled: o.muxEnabled,
      muxConcurrency: String(o.muxConcurrency ?? 8),
      address: typeof s.address === "string" ? s.address : "",
      port: Number.isFinite(p) && p > 0 ? String(p) : "443",
      id: typeof s.id === "string" ? s.id : "",
      password: typeof s.password === "string" ? s.password : "",
      method: typeof s.method === "string" ? s.method : "",
      publicKey: typeof s.publicKey === "string" ? s.publicKey : "",
      endpoint: typeof s.endpoint === "string" ? s.endpoint : "",
    });
    setTagErr(null);
    setDlgOpen(true);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setTagErr(null);
    const settings: Record<string, unknown> = {};
    if (needs.address) settings.address = form.address.trim();
    if (needs.port) settings.port = portNum;
    if (needs.id && form.id.trim()) settings.id = form.id.trim();
    if (needs.password && form.password) settings.password = form.password;
    if (needs.method && form.method.trim()) settings.method = form.method.trim();
    if (needs.publicKey && form.publicKey.trim()) settings.publicKey = form.publicKey.trim();
    if (needs.endpoint && form.endpoint.trim()) settings.endpoint = form.endpoint.trim();

    const muxN = Math.min(128, Math.max(1, Number(form.muxConcurrency) || 8));
    const body = {
      tag: tagValue,
      protocol: form.protocol,
      sendThrough: form.sendThrough.trim(),
      domainStrategy: form.strategy,
      settings,
      stream: {},
      muxEnabled: form.muxEnabled,
      muxConcurrency: muxN,
    };
    try {
      const res = await fetch(editing ? `/api/outbounds/${editing.id}` : "/api/outbounds", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        setTagErr(t.resellers.errTaken);
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error("save");
      setDlgOpen(false);
      await load();
      toast({ description: editing ? u.updated : u.created });
    } catch {
      toast({ variant: "destructive", description: t.inbounds.errGeneric });
    }
    setSaving(false);
  };

  /* ---------- actions ---------- */

  const testOutbound = async (o: OutboundDTO) => {
    setTestBusy(o.id);
    try {
      const res = await fetch(`/api/outbounds/${o.id}/test`, { method: "POST" });
      if (!res.ok) throw new Error("test");
      const d = (await res.json()) as { ok?: boolean; latencyMs?: number };
      if (d.ok) {
        toast({ description: `${u.testOk} · ${d.latencyMs ?? 0} ms` });
      } else {
        toast({ variant: "destructive", description: u.testFail });
      }
    } catch {
      toast({ variant: "destructive", description: u.testFail });
    }
    setTestBusy(null);
  };

  const destroy = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/outbounds/${deleting.id}`, { method: "DELETE" });
      if (res.status === 409) {
        toast({ variant: "destructive", description: u.protected });
        setDeleting(null);
        setDeleteBusy(false);
        return;
      }
      if (!res.ok) throw new Error("delete");
      await load();
      setDeleting(null);
      toast({ description: u.deleted });
    } catch {
      toast({ variant: "destructive", description: t.inbounds.errGeneric });
      setDeleting(null);
    }
    setDeleteBusy(false);
  };

  const resetTraffic = async () => {
    setResetBusy(true);
    try {
      const res = await fetch("/api/outbounds/traffic-reset", { method: "POST" });
      if (!res.ok) throw new Error("reset");
      const d = (await res.json()) as { outbounds: OutboundDTO[] };
      setOutbounds(d.outbounds);
      setResetOpen(false);
      toast({ description: u.resetDone });
    } catch {
      toast({ variant: "destructive", description: t.inbounds.errGeneric });
    }
    setResetBusy(false);
  };

  const loading = outbounds === null;

  /* ---------- render ---------- */

  if (loading) {
    return (
      <div className="fade-up space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-20 w-full max-w-2xl rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="fade-up space-y-6">
        <div
          className="glass flex items-center gap-3 rounded-2xl border border-chart-5/30 px-5 py-4 text-sm text-chart-5"
          role="alert"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t.inbounds.errGeneric}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="ms-auto gap-2 rounded-full border-white/10 bg-white/[0.03]"
            aria-label="retry"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up space-y-6">
      {/* header */}
      <section className="space-y-2">
        <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-primary/90 ring-1 ring-primary/20">
          <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />
          {u.badge}
        </span>
        <h2 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">
          {t.nav.outbounds}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{u.subtitle}</p>
      </section>

      {/* collapsible tip */}
      <div className="glass max-w-2xl rounded-2xl">
        <button
          type="button"
          onClick={() => setTipOpen((o) => !o)}
          aria-expanded={tipOpen}
          className="flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-start text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {u.tipTitle}
          <ChevronDown
            className={cn(
              "ms-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              tipOpen && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>
        {tipOpen && (
          <p className="border-t border-white/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            {u.tipBody}
          </p>
        )}
      </div>

      {/* KPI row */}
      <section className="grid grid-cols-3 gap-3" aria-label={u.kpiTotal}>
        {[
          { label: u.kpiTotal, value: String(kpis.total), icon: ArrowRightLeft, cls: "text-primary" },
          { label: u.kpiProtocols, value: String(kpis.protocols), icon: Layers, cls: "text-chart-4" },
          { label: u.kpiTraffic, value: fmtBytes(kpis.traffic), icon: Activity, cls: "text-chart-3" },
        ].map(({ label, value, icon: Icon, cls }) => (
          <div key={label} className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
              <span className={cn("glass flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-white/10", cls)}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-1.5 font-mono text-2xl font-bold text-foreground md:text-3xl" dir="ltr">
              {value}
            </p>
          </div>
        ))}
      </section>

      {/* toolbar */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md min-w-0 flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={u.searchPh}
            className="h-10 ps-9"
            aria-label={u.searchPh}
          />
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setResetOpen(true)}
            disabled={resetBusy}
            className="gap-2 rounded-full border-chart-5/30 bg-chart-5/10 text-chart-5 hover:bg-chart-5/20 hover:text-chart-5"
          >
            {resetBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            )}
            {u.resetTraffic}
          </Button>
          <Button onClick={openCreate} className="glow-cyan gap-2" aria-label={u.new}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {u.new}
          </Button>
        </div>
      </section>

      {/* cards grid */}
      {filtered.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center ring-1 ring-white/10">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-4 text-sm font-semibold text-foreground">{u.empty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{u.emptyDesc}</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((o) => {
            const Icon = PROTOCOL_ICONS[o.protocol];
            const isDefault = isProtectedTag(o.tag);
            const accent =
              o.protocol === "freedom"
                ? "bg-chart-3/15 ring-chart-3/30"
                : o.protocol === "blackhole"
                  ? "bg-chart-5/15 ring-chart-5/30"
                  : "bg-primary/15 ring-primary/30";
            const iconCls =
              o.protocol === "freedom"
                ? "text-chart-3"
                : o.protocol === "blackhole"
                  ? "text-chart-5"
                  : "text-primary";
            const endpoint = settingsEndpoint(o.settings, o.protocol);
            const traffic = o.upBytes + o.downBytes;
            return (
              <li
                key={o.id}
                className="glass hover-glow relative overflow-hidden rounded-2xl p-5 ring-1 ring-white/10"
              >
                <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                {/* header */}
                <div className="flex items-start gap-3">
                  <span className={cn("glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1", accent)}>
                    <Icon className={cn("h-[18px] w-[18px]", iconCls)} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-mono text-sm font-bold text-foreground" dir="ltr">
                        {o.tag}
                      </p>
                      {isDefault && (
                        <Badge
                          variant="outline"
                          className="gap-1 rounded-full border-white/10 bg-white/5 px-2 py-0 text-[10px] font-medium text-muted-foreground"
                        >
                          <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                          {u.badgeDefault}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] font-medium text-primary/80">
                      {u[PROTO_LABEL[o.protocol]]}
                    </p>
                  </div>
                </div>

                {/* description */}
                <p className="mt-3 text-start text-xs leading-relaxed text-muted-foreground">
                  {u[PROTO_DESC[o.protocol]]}
                </p>

                {/* endpoint */}
                {endpoint && (
                  <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" dir="ltr" title={endpoint}>
                    {endpoint}
                  </p>
                )}

                {/* traffic */}
                {traffic > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1" dir="ltr">
                      <ArrowUp className="h-3 w-3 text-chart-3" aria-hidden="true" />
                      {fmtBytes(o.upBytes)}
                    </span>
                    <span className="flex items-center gap-1" dir="ltr">
                      <ArrowDown className="h-3 w-3 text-primary" aria-hidden="true" />
                      {fmtBytes(o.downBytes)}
                    </span>
                  </div>
                )}

                {/* actions */}
                <div className="mt-4 flex items-center gap-1.5 border-t border-white/5 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void testOutbound(o)}
                    disabled={testBusy === o.id}
                    className="h-8 gap-1.5 rounded-full border-white/10 bg-white/[0.03] px-3 text-xs text-muted-foreground hover:text-foreground"
                    aria-label={u.test}
                  >
                    {testBusy === o.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {testBusy === o.id ? u.testing : u.test}
                  </Button>
                  <span className="ms-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(o)}
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                      aria-label={u.edit}
                    >
                      <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    {!isDefault && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(o)}
                        className="h-8 w-8 rounded-full text-muted-foreground hover:bg-chart-5/15 hover:text-chart-5"
                        aria-label={u.del}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* defaults-only hint */}
      {!hasCustom && filtered.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {u.empty} · {u.emptyDesc}
        </p>
      )}

      {/* ── create / edit dialog ── */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="glass-strong max-h-[90vh] overflow-y-auto rounded-2xl border-white/10 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? u.edit : u.new}</DialogTitle>
            <DialogDescription>{u[PROTO_DESC[form.protocol]]}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* tag */}
            <div className="space-y-1.5">
              <Label htmlFor="ob-tag">{u.fieldTag}</Label>
              <Input
                id="ob-tag"
                dir="ltr"
                className="font-mono"
                value={form.tag}
                onChange={(e) => setForm((p) => ({ ...p, tag: e.target.value }))}
                placeholder={u.phTag}
                aria-invalid={tagErr !== null || (tagValue.length > 0 && !tagOk) || undefined}
              />
              {tagErr && <p className="text-xs text-chart-5">{tagErr}</p>}
            </div>

            {/* protocol */}
            <div className="space-y-1.5">
              <Label htmlFor="ob-proto">{u.fieldProtocol}</Label>
              <Select
                value={form.protocol}
                onValueChange={(v) => setForm((p) => ({ ...p, protocol: v as OutboundProtocol }))}
              >
                <SelectTrigger id="ob-proto" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {PROTOCOLS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {u[PROTO_LABEL[p]]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{u[PROTO_DESC[form.protocol]]}</p>
            </div>

            {/* strategy + sendThrough */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ob-strategy">{u.fieldStrategy}</Label>
                <Select
                  value={form.strategy}
                  onValueChange={(v) => setForm((p) => ({ ...p, strategy: v as DomainStrategy }))}
                >
                  <SelectTrigger id="ob-strategy" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    {STRATEGIES.map((s) => (
                      <SelectItem key={s} value={s} dir="ltr">
                        {u[STRATEGY_LABEL[s]]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ob-sendthrough">{u.fieldSendThrough}</Label>
                <Input
                  id="ob-sendthrough"
                  dir="ltr"
                  className="font-mono"
                  value={form.sendThrough}
                  onChange={(e) => setForm((p) => ({ ...p, sendThrough: e.target.value }))}
                  placeholder="0.0.0.0"
                />
              </div>
            </div>

            {/* mux */}
            <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-white/10">
              <p className="text-sm font-medium text-foreground">{u.fieldMux}</p>
              <div className="flex items-center gap-3">
                {form.muxEnabled && (
                  <Input
                    id="ob-muxn"
                    dir="ltr"
                    inputMode="numeric"
                    className="h-8 w-20 font-mono"
                    value={form.muxConcurrency}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, muxConcurrency: e.target.value.replace(/[^0-9]/g, "") }))
                    }
                    aria-label={u.fieldMuxN}
                  />
                )}
                <Switch
                  checked={form.muxEnabled}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, muxEnabled: v }))}
                  aria-label={u.fieldMux}
                />
              </div>
            </div>

            {/* credentials */}
            {(needs.address || needs.publicKey) && (
              <>
                <Separator className="bg-white/10" />
                <div className="flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  <p className="text-sm font-semibold text-foreground">{u.credTitle}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {needs.address && (
                    <>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="ob-addr">{u.credAddress}</Label>
                        <Input
                          id="ob-addr"
                          dir="ltr"
                          className="font-mono"
                          value={form.address}
                          onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                          placeholder={u.phAddress}
                          aria-invalid={!addrOk || undefined}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ob-port">{u.credPort}</Label>
                        <Input
                          id="ob-port"
                          dir="ltr"
                          inputMode="numeric"
                          className="font-mono"
                          value={form.port}
                          onChange={(e) =>
                            setForm((p) => ({ ...p, port: e.target.value.replace(/[^0-9]/g, "") }))
                          }
                          placeholder="443"
                          aria-invalid={!portOk || undefined}
                        />
                      </div>
                    </>
                  )}
                  {needs.id && (
                    <div className="space-y-1.5">
                      <Label htmlFor="ob-id">{u.credId}</Label>
                      <Input
                        id="ob-id"
                        dir="ltr"
                        className="font-mono"
                        value={form.id}
                        onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
                        placeholder={u.phId}
                      />
                    </div>
                  )}
                  {needs.password && (
                    <div className="space-y-1.5">
                      <Label htmlFor="ob-password">{u.credPassword}</Label>
                      <Input
                        id="ob-password"
                        type="password"
                        dir="ltr"
                        className="font-mono"
                        value={form.password}
                        onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                        placeholder={u.phPassword}
                      />
                    </div>
                  )}
                  {needs.method && (
                    <div className="space-y-1.5">
                      <Label htmlFor="ob-method">{u.credMethod}</Label>
                      <Input
                        id="ob-method"
                        dir="ltr"
                        className="font-mono"
                        value={form.method}
                        onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
                        placeholder={u.phMethod}
                      />
                    </div>
                  )}
                  {needs.publicKey && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="ob-pk">{u.credPublicKey}</Label>
                      <Input
                        id="ob-pk"
                        dir="ltr"
                        className="font-mono"
                        value={form.publicKey}
                        onChange={(e) => setForm((p) => ({ ...p, publicKey: e.target.value }))}
                        aria-invalid={!pkOk || undefined}
                      />
                    </div>
                  )}
                  {needs.endpoint && (
                    <div className="space-y-1.5">
                      <Label htmlFor="ob-endpoint">{u.credEndpoint}</Label>
                      <Input
                        id="ob-endpoint"
                        dir="ltr"
                        className="font-mono"
                        value={form.endpoint}
                        onChange={(e) => setForm((p) => ({ ...p, endpoint: e.target.value }))}
                        placeholder="engage.core.net:51820"
                      />
                    </div>
                  )}
                </div>
              </>
            )}
            {!needs.address && !needs.publicKey && (
              <p className="rounded-xl bg-white/[0.03] px-3.5 py-3 text-xs text-muted-foreground ring-1 ring-white/10">
                {u[PROTO_DESC[form.protocol]]}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDlgOpen(false)}
              className="rounded-full border-white/10 bg-white/[0.03]"
            >
              {t.users.cancel}
            </Button>
            <Button onClick={() => void save()} disabled={!canSave} className="glow-cyan gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4" aria-hidden="true" />
              )}
              {t.subgroups.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── delete confirm ── */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent className="glass-strong rounded-2xl border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>{u.del}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono" dir="ltr">
                {deleting?.tag}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-white/[0.03]">
              {t.users.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void destroy();
              }}
              className="bg-chart-5 text-white hover:bg-chart-5/90"
            >
              {deleteBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              {u.del}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── reset traffic confirm ── */}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent className="glass-strong rounded-2xl border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>{u.resetTraffic}</AlertDialogTitle>
            <AlertDialogDescription>{u.resetDone}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-white/[0.03]">
              {t.users.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void resetTraffic();
              }}
              className="bg-chart-5 text-white hover:bg-chart-5/90"
            >
              {resetBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              )}
              {u.resetTraffic}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
