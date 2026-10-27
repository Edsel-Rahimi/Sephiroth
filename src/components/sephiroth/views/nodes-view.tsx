"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  Check,
  ChevronDown,
  CircleAlert,
  Cpu,
  Gauge,
  HelpCircle,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldOff,
  Trash2,
  TriangleAlert,
  Upload,
  Wifi,
  WifiOff,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { dictionaries } from "@/lib/i18n/dictionaries";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { RelayTunnelsPanel } from "@/components/sephiroth/views/relay-tunnels-panel";

/* ============================================================
   Sephiroth · Phase 8 — Nodes (remote fleet mirrors)
   Node cards with live status dots, latency/xray chips, probe
   action and a full create/edit dialog (sync scope, API token,
   TLS verification). All strings ×6 languages, RTL-safe
   logical props, Sephiroth Glass styling.
   ============================================================ */

/* ---------- API contracts ---------- */

interface InboundLite {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  transport: string;
  security: string;
  status: string;
}

interface NodeDTO {
  id: string;
  name: string;
  scheme: "http" | "https";
  address: string;
  port: number;
  basePath: string;
  baseUrl: string;
  tokenConfigured: boolean;
  tokenMasked: string;
  enable: boolean;
  syncAll: boolean;
  inboundTags: string[];
  outboundTag: string;
  tlsVerify: "verify" | "skip";
  status: "online" | "offline" | "unknown";
  latencyMs: number;
  xrayVersion: string;
  coreKind: string;
  lastSeen: string | null;
  lastSyncAt: string | null;
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

interface NodeForm {
  name: string;
  baseUrl: string;
  token: string;
  enable: boolean;
  syncAll: boolean;
  inboundTags: string[];
  outboundTag: string;
  tlsVerify: "verify" | "skip";
}

type NodeErrors = Partial<Record<"name" | "baseUrl", boolean>>;

const EMPTY_FORM: NodeForm = {
  name: "",
  baseUrl: "",
  token: "",
  enable: true,
  syncAll: true,
  inboundTags: [],
  outboundTag: "",
  tlsVerify: "verify",
};

/* ---------- master-side agent call payloads (see /api/nodes/[id]/*) ---------- */

interface AgentInfoPayload {
  version: string;
  hostname: string;
  platform: string;
  arch: string;
  uptimeMs: number;
  coreKind: "sim" | "xray";
  coreRunning: boolean;
  coreVersion: string;
}

interface NodeTrafficInbound {
  tag: string;
  protocol: string;
  port: number;
  status: string;
  users: number;
  txGb: number;
}

interface NodeTrafficUser {
  username: string;
  enabled: boolean;
  usedTrafficGb: number;
  trafficLimitGb: number | null;
}

interface NodeTrafficSnapshot {
  ts: number;
  coreKind: "sim" | "xray";
  coreRunning: boolean;
  inbounds: NodeTrafficInbound[];
  users: NodeTrafficUser[];
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/* status dot + label tone — online emerald (ping), offline rose, unknown muted */
const STATUS_META: Record<NodeDTO["status"], { dot: string; text: string }> = {
  online: { dot: "bg-emerald-400", text: "text-emerald-400" },
  offline: { dot: "bg-rose-500", text: "text-rose-400" },
  unknown: { dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
};

/** Compact relative time ("3m", "2h", "5d"); locale date for very old stamps. */
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "0m";
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d`;
  return new Date(then).toLocaleDateString();
}

/** "90061" → "1d 1h"; "90000" → "25h" style coarse uptime. */
function fmtUptime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Traffic label — honest zeros render as "0 GB". */
function fmtGb(gb: number): string {
  const v = Number(gb) || 0;
  if (v >= 100) return `${Math.round(v)} GB`;
  return `${Math.round(v * 100) / 100} GB`;
}

const BASEURL_RE = /^(https?):\/\/([^\/:?#]+)(?::(\d{1,5}))?(?:\/(.*))?$/;

/** "http://host:3104/panel" → parts (scheme defaults to http, port to 80/443). */
function parseBaseUrl(
  raw: string
): { scheme: "http" | "https"; address: string; port: number; basePath: string } | null {
  const m = raw.trim().match(BASEURL_RE);
  if (!m) return null;
  const scheme = (m[1] ?? "http") as "http" | "https";
  return {
    scheme,
    address: m[2] ?? "",
    port: m[3] ? Number(m[3]) : scheme === "https" ? 443 : 80,
    basePath: m[4] ? `/${m[4]}` : "/",
  };
}

/* ---------- small local atoms (settings-view patterns) ---------- */

function TipBanner({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="glass rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <HelpCircle className="h-4 w-4 text-primary" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <p className="px-4 pb-4 ps-[3.75rem] text-xs leading-relaxed text-muted-foreground" dir="auto">
          {body}
        </p>
      )}
    </section>
  );
}

function KpiCard({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <div className="glass hover-glow rounded-2xl px-4 py-4">
      <span className="glass flex h-9 w-9 items-center justify-center rounded-xl">
        <Icon className={cn("h-4 w-4", tone ?? "text-primary")} aria-hidden="true" />
      </span>
      <p className="mt-3 font-mono text-2xl font-bold leading-none text-silver tabular-nums md:text-3xl">
        {value}
      </p>
      <p className="mt-1.5 truncate text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function FieldError({ label }: { label: string }) {
  return (
    <p role="alert" className="flex items-center gap-1 text-[11px] font-medium text-destructive">
      <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </p>
  );
}

/* ---------- view ---------- */

export function NodesView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.nodes;
  const { toast } = useToast();

  const [nodes, setNodes] = useState<NodeDTO[] | null>(null);
  const [inbounds, setInbounds] = useState<InboundLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<NodeDTO | null>(null);
  const [form, setForm] = useState<NodeForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<NodeErrors>({});
  const [saving, setSaving] = useState(false);

  const [delTarget, setDelTarget] = useState<NodeDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);

  /* multi-node v1 — apply / refresh(info) / traffic */
  const [applyTarget, setApplyTarget] = useState<NodeDTO | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [infoTarget, setInfoTarget] = useState<NodeDTO | null>(null);
  const [infoData, setInfoData] = useState<AgentInfoPayload | null>(null);
  const [infoLatency, setInfoLatency] = useState(0);
  const [trafficTarget, setTrafficTarget] = useState<NodeDTO | null>(null);
  const [traffic, setTraffic] = useState<NodeTrafficSnapshot | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    let ok = true;
    try {
      const res = await fetch("/api/nodes", { cache: "no-store" });
      if (!res.ok) throw new Error("nodes");
      const d = (await res.json()) as { nodes: NodeDTO[] };
      setNodes(d.nodes);
    } catch {
      ok = false;
    }
    /* inbounds power the tag picker; failure degrades gracefully */
    try {
      const res = await fetch("/api/inbounds", { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as { inbounds: InboundLite[] };
        setInbounds(d.inbounds);
      }
    } catch {
      /* tag picker falls back to empty */
    }
    if (!ok && !silent) setLoadErr(true);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all = nodes ?? [];
  const kpiTotal = all.length;
  const online = all.filter((n) => n.status === "online");
  const kpiOnline = online.length;
  const kpiOffline = all.filter((n) => n.status === "offline").length;
  const avgLatency = online.length
    ? Math.round(online.reduce((sum, n) => sum + n.latencyMs, 0) / online.length)
    : null;

  const addressOf = (n: NodeDTO): string =>
    n.basePath && n.basePath !== "/" ? `${n.baseUrl}${n.basePath}` : n.baseUrl;

  /** How many of this panel's inbounds the node would receive on Apply. */
  const scopedCount = (n: NodeDTO): number =>
    n.syncAll ? inbounds.length : inbounds.filter((i) => n.inboundTags.includes(i.tag)).length;

  /* ---------- actions ---------- */

  const nodeBody = (n: NodeDTO, enable: boolean) => ({
    name: n.name,
    baseUrl: n.baseUrl,
    scheme: n.scheme,
    address: n.address,
    port: n.port,
    basePath: n.basePath,
    token: undefined, // keep configured token
    enable,
    syncAll: n.syncAll,
    inboundTags: n.inboundTags,
    outboundTag: n.outboundTag,
    tlsVerify: n.tlsVerify,
  });

  const toggleNode = async (n: NodeDTO, enable: boolean) => {
    setNodes((prev) => (prev ? prev.map((x) => (x.id === n.id ? { ...x, enable } : x)) : prev));
    try {
      const res = await fetch(`/api/nodes/${n.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(nodeBody(n, enable)),
      });
      if (!res.ok) throw new Error("toggle");
      const d = (await res.json()) as { node: NodeDTO };
      setNodes((prev) => (prev ? prev.map((x) => (x.id === d.node.id ? d.node : x)) : prev));
    } catch {
      setNodes((prev) => (prev ? prev.map((x) => (x.id === n.id ? n : x)) : prev));
      toast({ description: t.inbounds.errGeneric });
    }
  };

  const probeNode = async (n: NodeDTO) => {
    setProbingId(n.id);
    try {
      const res = await fetch(`/api/nodes/${n.id}/probe`, { method: "POST" });
      if (!res.ok) throw new Error("probe");
      const d = (await res.json()) as { ok: boolean; latencyMs: number; node: NodeDTO | null };
      const updated = d.node;
      if (updated) {
        setNodes((prev) => (prev ? prev.map((x) => (x.id === updated.id ? updated : x)) : prev));
      }
      if (d.ok) {
        toast({ title: u.probeOk, description: `${d.latencyMs} ms` });
      } else {
        toast({ title: u.probeFail, variant: "destructive" });
      }
    } catch {
      toast({ title: u.probeFail, variant: "destructive" });
    }
    setProbingId(null);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (n: NodeDTO) => {
    setEditing(n);
    setForm({
      name: n.name,
      baseUrl: addressOf(n),
      token: "",
      enable: n.enable,
      syncAll: n.syncAll,
      inboundTags: [...n.inboundTags],
      outboundTag: n.outboundTag,
      tlsVerify: n.tlsVerify,
    });
    setErrors({});
    setDialogOpen(true);
  };

  const toggleTag = (tag: string) => {
    setForm((p) => ({
      ...p,
      inboundTags: p.inboundTags.includes(tag)
        ? p.inboundTags.filter((x) => x !== tag)
        : [...p.inboundTags, tag],
    }));
  };

  const saveNode = async () => {
    const errs: NodeErrors = {};
    if (!form.name.trim()) errs.name = true;
    if (!parseBaseUrl(form.baseUrl)) errs.baseUrl = true;
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    const token = form.token.trim();
    const body = {
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      token: token ? token : editing ? undefined : "",
      enable: form.enable,
      syncAll: form.syncAll,
      inboundTags: form.syncAll ? [] : form.inboundTags,
      outboundTag: form.outboundTag.trim(),
      tlsVerify: form.tlsVerify,
    };
    try {
      const res = await fetch(editing ? `/api/nodes/${editing.id}` : "/api/nodes", {
        method: editing ? "PATCH" : "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      if (res.status === 400) {
        const d = (await res.json().catch(() => null)) as {
          fields?: { field: string }[];
        } | null;
        const next: NodeErrors = {};
        for (const f of d?.fields ?? []) {
          if (f.field === "name") next.name = true;
          if (f.field === "baseUrl" || f.field === "address" || f.field === "port" || f.field === "basePath") {
            next.baseUrl = true;
          }
        }
        if (Object.keys(next).length > 0) setErrors(next);
        else toast({ description: t.inbounds.errGeneric });
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error("save");
      setDialogOpen(false);
      toast({ description: editing ? u.updated : u.created });
      await load(true);
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setSaving(false);
  };

  const deleteNode = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/nodes/${delTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      setDelTarget(null);
      toast({ description: u.deleted });
      await load(true);
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setDeleting(false);
  };

  /* ---------- multi-node v1 actions (apply / refresh / traffic) ---------- */

  const applyNode = async (n: NodeDTO) => {
    setApplyingId(n.id);
    try {
      const res = await fetch(`/api/nodes/${n.id}/apply`, { method: "POST" });
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean;
        applied?: number;
        coreReloaded?: boolean;
        error?: string | null;
        node?: NodeDTO | null;
      } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? "apply");
      if (d.node) {
        setNodes((prev) => (prev ? prev.map((x) => (x.id === d.node!.id ? d.node! : x)) : prev));
      }
      setApplyTarget(null);
      toast({
        title: u.appliedOk,
        description: `${d.applied ?? 0} · ${u.coreKind}: ${d.coreReloaded ? u.coreRunning : "—"}`,
      });
    } catch {
      toast({ title: u.appliedFail, variant: "destructive" });
    }
    setApplyingId(null);
  };

  const refreshNode = async (n: NodeDTO) => {
    setRefreshingId(n.id);
    try {
      const res = await fetch(`/api/nodes/${n.id}/info`, { cache: "no-store" });
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean;
        info?: AgentInfoPayload | null;
        latencyMs?: number;
        error?: string | null;
        node?: NodeDTO | null;
      } | null;
      if (!res.ok || !d?.ok || !d.info) throw new Error(d?.error ?? "info");
      if (d.node) {
        setNodes((prev) => (prev ? prev.map((x) => (x.id === d.node!.id ? d.node! : x)) : prev));
      }
      setInfoData(d.info);
      setInfoLatency(d.latencyMs ?? 0);
      setInfoTarget(n);
    } catch {
      toast({ title: u.pullFail, variant: "destructive" });
    }
    setRefreshingId(null);
  };

  const loadTraffic = async (n: NodeDTO) => {
    setTrafficTarget(n);
    setTrafficLoading(true);
    setTraffic(null);
    try {
      const res = await fetch(`/api/nodes/${n.id}/stats`, { cache: "no-store" });
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean;
        traffic?: NodeTrafficSnapshot | null;
        error?: string | null;
      } | null;
      if (!res.ok || !d?.ok || !d.traffic) throw new Error(d?.error ?? "stats");
      setTraffic(d.traffic);
    } catch {
      toast({ title: u.pullFail, variant: "destructive" });
      setTrafficTarget(null);
    }
    setTrafficLoading(false);
  };

  /* ---------- render ---------- */

  if (loading) {
    return (
      <div className="fade-up space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/90 ring-1 ring-primary/20">
            <Server className="h-3 w-3" aria-hidden="true" />
            {u.badge}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/[0.08] px-3 py-1 text-[10px] font-medium text-amber-400/90 ring-1 ring-amber-500/25">
            <Info className="h-3 w-3" aria-hidden="true" />
            {u.simNote}
          </span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">{t.nav.nodes}</h2>
          <Button onClick={openCreate} className="gap-2 rounded-full">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {u.new}
          </Button>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">{u.subtitle}</p>
      </section>

      {/* collapsible tip banner */}
      <TipBanner title={u.tipTitle} body={u.tipBody} />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <KpiCard icon={Server} value={String(kpiTotal)} label={u.kpiTotal} />
        <KpiCard icon={Wifi} value={String(kpiOnline)} label={u.kpiOnline} tone="text-emerald-400" />
        <KpiCard icon={WifiOff} value={String(kpiOffline)} label={u.kpiOffline} tone="text-rose-400" />
        <KpiCard
          icon={Gauge}
          value={avgLatency === null ? "—" : `${avgLatency} ms`}
          label={u.kpiLatency}
          tone="text-primary"
        />
      </div>

      {/* grid */}
      {kpiTotal === 0 ? (
        <section className="glass flex flex-col items-center gap-4 rounded-3xl px-6 py-14 text-center">
          <span className="glass glow-cyan flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-primary/30">
            <Server className="h-7 w-7 text-primary" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h3 className="text-silver text-lg font-bold">{u.empty}</h3>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">{u.emptyDesc}</p>
          </div>
          <Button onClick={openCreate} className="gap-2 rounded-full">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {u.new}
          </Button>
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {all.map((n) => {
            const meta = STATUS_META[n.status];
            const statusLabel =
              n.status === "online" ? u.statusOnline : n.status === "offline" ? u.statusOffline : u.statusUnknown;
            return (
              <article key={n.id} className="glass hover-glow flex flex-col gap-3 rounded-2xl p-5">
                {/* status + name + enable */}
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    {n.status === "online" && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    )}
                    <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", meta.dot)} />
                  </span>
                  <span className={cn("shrink-0 text-[11px] font-semibold uppercase tracking-wider", meta.text)}>
                    {statusLabel}
                  </span>
                  <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-foreground" title={n.name} dir="auto">
                    {n.name}
                  </h3>
                  <Switch
                    checked={n.enable}
                    onCheckedChange={(v) => void toggleNode(n, v)}
                    aria-label={`${u.fieldEnable} · ${n.name}`}
                  />
                </div>

                {/* address */}
                <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr" title={addressOf(n)}>
                  {addressOf(n)}
                </p>

                {/* meta chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {n.status === "online" && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/25"
                      dir="ltr"
                      title={u.latency}
                    >
                      <Gauge className="h-3 w-3" aria-hidden="true" />
                      {n.latencyMs} ms
                    </span>
                  )}
                  {n.xrayVersion && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border"
                      dir="ltr"
                      title={u.xrayVer}
                    >
                      {n.xrayVersion}
                    </span>
                  )}
                  {n.coreKind && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                        n.coreKind === "xray"
                          ? "bg-primary/10 text-primary ring-primary/30"
                          : "bg-amber-500/10 text-amber-400 ring-amber-500/25"
                      )}
                      title={u.coreKind}
                    >
                      <Cpu className="h-3 w-3" aria-hidden="true" />
                      {n.coreKind === "xray" ? u.coreXray : u.coreSim}
                    </span>
                  )}
                  {n.tlsVerify === "verify" ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/25"
                      title={u.tlsVerify}
                    >
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      {u.tlsVerify}
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 ring-1 ring-amber-500/25"
                      title={u.tlsSkip}
                    >
                      <ShieldOff className="h-3 w-3" aria-hidden="true" />
                      {u.tlsSkip}
                    </span>
                  )}
                </div>

                {/* last seen + sync state */}
                <div className="mt-auto space-y-0.5 text-[11px] text-muted-foreground">
                  <p>
                    {u.lastSeen}
                    {": "}
                    {n.lastSeen ? (
                      <span className="font-mono" dir="ltr">
                        {relTime(n.lastSeen)}
                      </span>
                    ) : (
                      <span className="italic">{u.never}</span>
                    )}
                  </p>
                  <p>
                    {u.lastSync}
                    {": "}
                    {n.lastSyncAt ? (
                      <span className="font-mono" dir="ltr">
                        {relTime(n.lastSyncAt)}
                      </span>
                    ) : (
                      <span className="italic">{u.never}</span>
                    )}
                  </p>
                  {n.lastError && (
                    <p className="flex items-center gap-1 text-rose-400" title={n.lastError}>
                      <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-mono" dir="ltr">
                        {n.lastError}
                      </span>
                    </p>
                  )}
                </div>

                {/* actions */}
                <div className="flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-full border-white/10 bg-white/[0.03]"
                    onClick={() => void probeNode(n)}
                    disabled={probingId === n.id}
                  >
                    {probingId === n.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {probingId === n.id ? u.probing : u.probe}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-full border-primary/30 bg-primary/[0.06] text-primary hover:bg-primary/15 hover:text-primary"
                    onClick={() => setApplyTarget(n)}
                    disabled={applyingId === n.id}
                  >
                    {applyingId === n.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {applyingId === n.id ? u.applying : u.apply}
                  </Button>
                  <span className="ms-auto flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover-glow hover:text-primary"
                      onClick={() => void loadTraffic(n)}
                      disabled={trafficLoading && trafficTarget?.id === n.id}
                      aria-label={u.traffic}
                      title={u.traffic}
                    >
                      {trafficLoading && trafficTarget?.id === n.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover-glow hover:text-primary"
                      onClick={() => void refreshNode(n)}
                      disabled={refreshingId === n.id}
                      aria-label={u.refresh}
                      title={u.refresh}
                    >
                      {refreshingId === n.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover-glow hover:text-primary"
                      onClick={() => openEdit(n)}
                      aria-label={u.edit}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover-glow hover:text-destructive"
                      onClick={() => setDelTarget(n)}
                      aria-label={u.del}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-strong flex max-h-[90vh] flex-col gap-0 overflow-hidden border-white/10 p-0 sm:max-w-[600px]">
          <DialogHeader className="border-b border-white/5 px-5 py-4 text-start">
            <DialogTitle className="flex items-center gap-3 text-silver">
              <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                <Server className="h-4 w-4 text-primary" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base">{editing ? u.edit : u.new}</span>
                <DialogDescription className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
                  {u.subtitle}
                </DialogDescription>
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="node-name">{u.fieldName}</Label>
              <Input
                id="node-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder={u.phName}
                aria-required="true"
                aria-invalid={errors.name ? "true" : undefined}
                className={cn(errors.name && "border-destructive ring-destructive/40")}
              />
              {errors.name && <FieldError label={u.fieldName} />}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="node-baseurl">{u.fieldBaseUrl}</Label>
              <Input
                id="node-baseurl"
                dir="ltr"
                value={form.baseUrl}
                onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))}
                placeholder={u.phBaseUrl}
                aria-required="true"
                aria-invalid={errors.baseUrl ? "true" : undefined}
                className={cn("font-mono", errors.baseUrl && "border-destructive ring-destructive/40")}
              />
              {errors.baseUrl && <FieldError label={u.errBaseUrl} />}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="node-token">{u.fieldSecret}</Label>
              <Input
                id="node-token"
                type="password"
                dir="ltr"
                className="font-mono"
                autoComplete="new-password"
                value={form.token}
                onChange={(e) => setForm((p) => ({ ...p, token: e.target.value }))}
                placeholder={editing?.tokenConfigured ? `••••••${editing.tokenMasked}` : u.phSecret}
              />
              <p className="text-[11px] text-muted-foreground">
                {form.token.trim() ? u.fieldTokenSet : editing?.tokenConfigured ? u.fieldTokenKeep : u.fieldTokenSet}
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-border/70">
              <p className="text-sm font-medium text-foreground">{u.fieldEnable}</p>
              <Switch
                checked={form.enable}
                onCheckedChange={(v) => setForm((p) => ({ ...p, enable: v }))}
                aria-label={u.fieldEnable}
              />
            </div>

            <div className="space-y-2">
              <Label>{u.fieldSync}</Label>
              <RadioGroup
                value={form.syncAll ? "all" : "selected"}
                onValueChange={(v) => setForm((p) => ({ ...p, syncAll: v === "all" }))}
                className="gap-2"
              >
                <label
                  htmlFor="node-sync-all"
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-border/70 transition-colors hover:bg-white/[0.05]"
                >
                  <RadioGroupItem value="all" id="node-sync-all" />
                  <span className="text-sm">{u.fieldSyncAll}</span>
                </label>
                <label
                  htmlFor="node-sync-selected"
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-border/70 transition-colors hover:bg-white/[0.05]"
                >
                  <RadioGroupItem value="selected" id="node-sync-selected" />
                  <span className="text-sm">{u.fieldSyncSelected}</span>
                </label>
              </RadioGroup>

              {!form.syncAll && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-xs text-muted-foreground">{u.fieldTags}</Label>
                  {inbounds.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/70">—</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {inbounds.map((i) => {
                        const on = form.inboundTags.includes(i.tag);
                        return (
                          <label
                            key={i.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] transition-all",
                              on
                                ? "bg-gradient-to-br from-primary/25 to-primary/5 text-foreground ring-1 ring-primary/40"
                                : "text-muted-foreground ring-1 ring-border hover:bg-white/5 hover:text-foreground"
                            )}
                          >
                            <Checkbox
                              checked={on}
                              onCheckedChange={() => toggleTag(i.tag)}
                              className="h-3.5 w-3.5"
                              aria-label={i.tag}
                            />
                            <span dir="ltr">{i.tag}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="node-outbound">{u.fieldOutbound}</Label>
              <Input
                id="node-outbound"
                dir="ltr"
                className="font-mono"
                value={form.outboundTag}
                onChange={(e) => setForm((p) => ({ ...p, outboundTag: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="node-tls">{u.fieldTls}</Label>
              <Select
                value={form.tlsVerify}
                onValueChange={(v) => setForm((p) => ({ ...p, tlsVerify: v as NodeForm["tlsVerify"] }))}
              >
                <SelectTrigger id="node-tls" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  <SelectItem value="verify">{u.tlsVerify}</SelectItem>
                  <SelectItem value="skip">{u.tlsSkip}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-white/5 px-5 py-4">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="rounded-full border-white/10 bg-white/[0.03]"
            >
              {t.inbounds.cancel}
            </Button>
            <Button onClick={() => void saveNode()} disabled={saving} className="gap-2 rounded-full">
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

      {/* apply-config confirm — destructive replace on the node */}
      <AlertDialog open={applyTarget !== null} onOpenChange={(o) => !o && setApplyTarget(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-silver">
              <Upload className="h-4 w-4 text-primary" aria-hidden="true" />
              {u.applyTitle}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block font-mono text-foreground" dir="ltr">
                {applyTarget ? addressOf(applyTarget) : ""}
              </span>
              <span className="block">
                {applyTarget ? u.applyDesc.replace("{n}", String(scopedCount(applyTarget))) : ""}
              </span>
              <span className="block text-[11px] text-muted-foreground">{u.agentHint}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-white/[0.03]">
              {t.inbounds.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => applyTarget && void applyNode(applyTarget)}
              disabled={applyingId === applyTarget?.id}
              className="gap-2 rounded-full"
            >
              {applyingId === applyTarget?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              {applyingId === applyTarget?.id ? u.applying : u.apply}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* agent info (Refresh) */}
      <Dialog open={infoTarget !== null} onOpenChange={(o) => !o && setInfoTarget(null)}>
        <DialogContent className="glass-strong flex max-h-[90vh] flex-col gap-0 overflow-hidden border-white/10 p-0 sm:max-w-[440px]">
          <DialogHeader className="border-b border-white/5 px-5 py-4 text-start">
            <DialogTitle className="flex items-center gap-3 text-silver">
              <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                <RefreshCw className="h-4 w-4 text-primary" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base">{u.infoTitle}</span>
                <DialogDescription className="mt-0.5 block truncate font-mono text-[11px] font-normal text-muted-foreground" dir="ltr">
                  {infoTarget ? addressOf(infoTarget) : ""}
                </DialogDescription>
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 px-5 py-4 text-sm">
            {infoData ? (
              <>
                {[
                  [u.agentVersion, infoData.version],
                  [
                    u.coreKind,
                    `${
                      infoData.coreKind === "xray" ? u.coreXray : u.coreSim
                    } · ${infoData.coreRunning ? u.coreRunning : u.coreStopped}`,
                  ],
                  [u.uptime, fmtUptime(infoData.uptimeMs)],
                  [u.hostnameLabel, infoData.hostname],
                  [u.platformLabel, `${infoData.platform} · ${infoData.arch}`],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2"
                  >
                    <span className="shrink-0 text-xs text-muted-foreground">{k}</span>
                    <span className="min-w-0 truncate font-mono text-xs text-foreground" dir="ltr">
                      {v}
                    </span>
                  </div>
                ))}
                <p className="pt-1 text-end text-[11px] text-muted-foreground" dir="ltr">
                  {infoLatency} ms
                </p>
              </>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* node traffic (pull) */}
      <Dialog open={trafficTarget !== null} onOpenChange={(o) => !o && setTrafficTarget(null)}>
        <DialogContent className="glass-strong flex max-h-[90vh] flex-col gap-0 overflow-hidden border-white/10 p-0 sm:max-w-[520px]">
          <DialogHeader className="border-b border-white/5 px-5 py-4 text-start">
            <DialogTitle className="flex items-center gap-3 text-silver">
              <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                <ArrowDownUp className="h-4 w-4 text-primary" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base">{u.trafficTitle}</span>
                <DialogDescription className="mt-0.5 block truncate font-mono text-[11px] font-normal text-muted-foreground" dir="ltr">
                  {trafficTarget ? addressOf(trafficTarget) : ""}
                </DialogDescription>
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {traffic ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                      traffic.coreKind === "xray"
                        ? "bg-primary/10 text-primary ring-primary/30"
                        : "bg-amber-500/10 text-amber-400 ring-amber-500/25"
                    )}
                  >
                    <Cpu className="h-3 w-3" aria-hidden="true" />
                    {traffic.coreKind === "xray" ? u.coreXray : u.coreSim}
                    {traffic.coreRunning ? ` · ${u.coreRunning}` : ` · ${u.coreStopped}`}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{u.trafficInbounds}</Label>
                  {traffic.inbounds.length === 0 ? (
                    <p className="text-[11px] italic text-muted-foreground/70">{u.noTraffic}</p>
                  ) : (
                    <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                      {traffic.inbounds.map((i) => (
                        <div
                          key={`${i.tag}:${i.port}`}
                          className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" dir="ltr">
                            {i.tag}
                          </span>
                          <span className="shrink-0 rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border" dir="ltr">
                            {i.protocol}:{i.port}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground" dir="ltr">
                            {i.users}👤
                          </span>
                          <span className="shrink-0 font-mono text-xs font-semibold text-primary" dir="ltr">
                            {fmtGb(i.txGb)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{u.trafficUsers}</Label>
                  {traffic.users.length === 0 ? (
                    <p className="text-[11px] italic text-muted-foreground/70">{u.noTraffic}</p>
                  ) : (
                    <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                      {traffic.users.map((usr) => (
                        <div
                          key={usr.username}
                          className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" dir="ltr">
                            {usr.username}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground" dir="ltr">
                            {fmtGb(usr.usedTrafficGb)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-end text-[11px] text-muted-foreground" dir="ltr">
                  {new Date(traffic.ts).toLocaleTimeString()}
                </p>
              </>
            ) : (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={delTarget !== null} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-silver">{u.del}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-1.5">
              <span className="block font-mono text-foreground" dir="ltr">
                {delTarget?.name}
              </span>
              <span className="block font-mono text-xs" dir="ltr">
                {delTarget ? addressOf(delTarget) : ""}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-white/[0.03]">
              {t.inbounds.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void deleteNode()}
              disabled={deleting}
              className="gap-2 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              {u.del}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Multi-Node Relay Tunnels & Load Balancing */}
      <RelayTunnelsPanel />
    </div>
  );
}
