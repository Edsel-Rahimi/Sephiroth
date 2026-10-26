"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Globe2,
  HelpCircle,
  Loader2,
  Network,
  Pencil,
  Plus,
  Power,
  RadioTower,
  RotateCw,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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

/* ============================================================
   Sephiroth · Phase 8 — Hosts (per-inbound link overrides)
   Grouped by inbound: enable switches, security chips, copyable
   link previews and a full create/edit dialog. All strings ×6
   languages, RTL-safe logical props, Sephiroth Glass styling.
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

type HostSecurity = "same" | "tls" | "none" | "reality";

interface HostDTO {
  id: string;
  inboundId: string;
  inboundTag: string;
  remark: string;
  address: string;
  port: number; // 0 = inherit inbound port
  security: HostSecurity;
  sni: string;
  hostHeader: string;
  path: string;
  alpn: string;
  fingerprint: string;
  enable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

type HostBody = Omit<HostDTO, "id" | "inboundTag" | "sortOrder" | "createdAt" | "updatedAt">;

interface HostForm {
  inboundId: string;
  remark: string;
  address: string;
  inherit: boolean;
  port: string;
  security: HostSecurity;
  sni: string;
  hostHeader: string;
  path: string;
  alpn: string;
  fingerprint: string;
  enable: boolean;
}

type HostErrors = Partial<Record<"remark" | "address" | "inboundId" | "port" | "sni" | "path", boolean>>;

type Filter = "all" | "on" | "off";

const EMPTY_FORM: HostForm = {
  inboundId: "",
  remark: "",
  address: "",
  inherit: true,
  port: "",
  security: "same",
  sni: "",
  hostHeader: "",
  path: "",
  alpn: "",
  fingerprint: "",
  enable: true,
};

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/* security chip styling — tls=emerald, reality=cyan, none=muted */
const SEC_CHIP: Record<Exclude<HostSecurity, "same">, string> = {
  tls: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
  reality: "bg-primary/10 text-primary ring-primary/30",
  none: "bg-white/5 text-muted-foreground ring-border",
};

function secText(security: HostSecurity, inboundSec: string | undefined): string {
  if (security === "tls") return "TLS";
  if (security === "reality") return "REALITY";
  if (security === "none") return "none";
  /* "same" → mirror the inbound's own security as a technical value */
  if (inboundSec === "tls") return "TLS";
  if (inboundSec === "reality") return "REALITY";
  return "none";
}

/* ---------- small local atoms (settings-view patterns) ---------- */

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
      {active && <Check className="h-3 w-3 text-primary" aria-hidden="true" />}
      {children}
    </button>
  );
}

function TipBanner({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="glass rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-2xl"
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

export function HostsView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.hosts;
  const { toast } = useToast();

  const [hosts, setHosts] = useState<HostDTO[] | null>(null);
  const [inbounds, setInbounds] = useState<InboundLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HostDTO | null>(null);
  const [form, setForm] = useState<HostForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<HostErrors>({});
  const [saving, setSaving] = useState(false);

  const [delTarget, setDelTarget] = useState<HostDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    let ok = true;
    try {
      const res = await fetch("/api/hosts", { cache: "no-store" });
      if (!res.ok) throw new Error("hosts");
      const d = (await res.json()) as { hosts: HostDTO[] };
      setHosts(d.hosts);
    } catch {
      ok = false;
    }
    /* inbounds power the picker + group headers; failure degrades gracefully */
    try {
      const res = await fetch("/api/inbounds", { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as { inbounds: InboundLite[] };
        setInbounds(d.inbounds);
      }
    } catch {
      /* group headers fall back to host.inboundTag */
    }
    if (!ok && !silent) setLoadErr(true);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inboundById = useMemo(() => new Map(inbounds.map((i) => [i.id, i])), [inbounds]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (hosts ?? [])
      .filter((h) => {
        if (filter === "on" && !h.enable) return false;
        if (filter === "off" && h.enable) return false;
        if (!needle) return true;
        return `${h.remark} ${h.address} ${h.inboundTag}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.remark.localeCompare(b.remark));
  }, [hosts, q, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, HostDTO[]>();
    for (const h of filtered) {
      const arr = map.get(h.inboundId);
      if (arr) arr.push(h);
      else map.set(h.inboundId, [h]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ta = inboundById.get(a)?.tag ?? "";
      const tb = inboundById.get(b)?.tag ?? "";
      return ta.localeCompare(tb);
    });
  }, [filtered, inboundById]);

  const all = hosts ?? [];
  const kpiTotal = all.length;
  const kpiActive = all.filter((h) => h.enable).length;
  const kpiInbounds = new Set(all.map((h) => h.inboundId)).size;
  const kpiTls = all.filter((h) => h.security === "tls").length;

  const effectivePort = useCallback(
    (h: HostDTO) => (h.port > 0 ? h.port : (inboundById.get(h.inboundId)?.port ?? 0)),
    [inboundById]
  );

  const previewOf = useCallback(
    (h: HostDTO) => {
      let s = `vless://${h.address}:${effectivePort(h)}${h.path}`;
      if (h.sni) s += ` · sni:${h.sni}`;
      return s;
    },
    [effectivePort]
  );

  const extrasOf = (h: HostDTO): string =>
    [
      h.sni ? `sni:${h.sni}` : "",
      h.hostHeader ? `host:${h.hostHeader}` : "",
      h.alpn ? `alpn:${h.alpn}` : "",
      h.fingerprint ? `fp:${h.fingerprint}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

  /* ---------- actions ---------- */

  const hostBody = (h: HostDTO, enable: boolean): HostBody => ({
    inboundId: h.inboundId,
    remark: h.remark,
    address: h.address,
    port: h.port,
    security: h.security,
    sni: h.sni,
    hostHeader: h.hostHeader,
    path: h.path,
    alpn: h.alpn,
    fingerprint: h.fingerprint,
    enable,
  });

  const toggleHost = async (h: HostDTO, enable: boolean) => {
    setHosts((prev) => (prev ? prev.map((x) => (x.id === h.id ? { ...x, enable } : x)) : prev));
    try {
      const res = await fetch(`/api/hosts/${h.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(hostBody(h, enable)),
      });
      if (!res.ok) throw new Error("toggle");
      const d = (await res.json()) as { host: HostDTO };
      setHosts((prev) => (prev ? prev.map((x) => (x.id === d.host.id ? d.host : x)) : prev));
      toast({ description: u.saved });
    } catch {
      setHosts((prev) => (prev ? prev.map((x) => (x.id === h.id ? h : x)) : prev));
      toast({ description: t.inbounds.errGeneric });
    }
  };

  const copyPreview = async (h: HostDTO) => {
    try {
      await navigator.clipboard.writeText(previewOf(h));
      toast({ description: u.copied });
    } catch {
      /* clipboard unavailable */
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (h: HostDTO) => {
    setEditing(h);
    setForm({
      inboundId: h.inboundId,
      remark: h.remark,
      address: h.address,
      inherit: h.port === 0,
      port: h.port > 0 ? String(h.port) : "",
      security: h.security,
      sni: h.sni,
      hostHeader: h.hostHeader,
      path: h.path,
      alpn: h.alpn,
      fingerprint: h.fingerprint,
      enable: h.enable,
    });
    setErrors({});
    setDialogOpen(true);
  };

  const saveHost = async () => {
    const errs: HostErrors = {};
    if (!form.remark.trim()) errs.remark = true;
    if (!form.address.trim()) errs.address = true;
    if (!form.inboundId) errs.inboundId = true;
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    const body = {
      inboundId: form.inboundId,
      remark: form.remark.trim(),
      address: form.address.trim(),
      port: form.inherit ? 0 : Number(form.port) || 0,
      security: form.security,
      sni: form.sni.trim(),
      hostHeader: form.hostHeader.trim(),
      path: form.path.trim(),
      alpn: form.alpn.trim(),
      fingerprint: form.fingerprint.trim(),
      enable: form.enable,
    };
    try {
      const res = await fetch(editing ? `/api/hosts/${editing.id}` : "/api/hosts", {
        method: editing ? "PATCH" : "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        toast({ description: u.errDup });
        setSaving(false);
        return;
      }
      if (res.status === 400) {
        const d = (await res.json().catch(() => null)) as {
          fields?: { field: string; code: string }[];
        } | null;
        const fields = d?.fields ?? [];
        if (fields.some((f) => f.code.includes("dup") || f.code.includes("taken"))) {
          toast({ description: u.errDup });
          setSaving(false);
          return;
        }
        const next: HostErrors = {};
        for (const f of fields) {
          if (f.field === "remark" || f.field === "address" || f.field === "inboundId" || f.field === "port" || f.field === "sni" || f.field === "path") {
            next[f.field] = true;
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

  const deleteHost = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/hosts/${delTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      setDelTarget(null);
      toast({ description: u.deleted });
      await load(true);
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setDeleting(false);
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
        <Skeleton className="h-10 w-full max-w-xl rounded-full" />
        <Skeleton className="h-64 rounded-2xl" />
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
        <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/90 ring-1 ring-primary/20">
          <Network className="h-3 w-3" aria-hidden="true" />
          {u.badge}
        </span>
        <h2 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">{t.nav.hosts}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{u.subtitle}</p>
      </section>

      {/* collapsible tip banner */}
      <TipBanner title={u.tipTitle} body={u.tipBody} />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <KpiCard icon={Globe2} value={String(kpiTotal)} label={u.kpiTotal} />
        <KpiCard icon={Power} value={String(kpiActive)} label={u.kpiActive} tone="text-emerald-400" />
        <KpiCard icon={RadioTower} value={String(kpiInbounds)} label={u.kpiInbounds} />
        <KpiCard icon={ShieldCheck} value={String(kpiTls)} label={u.kpiTls} tone="text-primary" />
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="glass relative h-10 min-w-40 flex-1 rounded-xl sm:max-w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={u.searchPh}
            aria-label={u.searchPh}
            className="h-full w-full bg-transparent ps-9 pe-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-2" role="group" aria-label={t.nav.hosts}>
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            {u.fAll}
          </Chip>
          <Chip active={filter === "on"} onClick={() => setFilter("on")}>
            {u.fOn}
          </Chip>
          <Chip active={filter === "off"} onClick={() => setFilter("off")}>
            {u.fOff}
          </Chip>
        </div>
        <Button onClick={openCreate} className="ms-auto gap-2 rounded-full">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {u.new}
        </Button>
      </div>

      {/* list */}
      {kpiTotal === 0 ? (
        <section className="glass flex flex-col items-center gap-4 rounded-3xl px-6 py-14 text-center">
          <span className="glass glow-cyan flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-primary/30">
            <Network className="h-7 w-7 text-primary" aria-hidden="true" />
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
      ) : groups.length === 0 ? (
        <section className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-10 text-center">
          <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{u.empty}</p>
        </section>
      ) : (
        <div className="space-y-4">
          {groups.map(([inboundId, items]) => {
            const inbound = inboundById.get(inboundId);
            return (
              <section key={inboundId} className="glass overflow-hidden rounded-2xl">
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-white/5 px-4 py-3 md:px-5">
                  <span className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                    <RadioTower className="h-4 w-4 text-primary" aria-hidden="true" />
                  </span>
                  <span
                    className="font-mono text-sm font-semibold text-primary"
                    dir="ltr"
                  >
                    {inbound?.tag ?? items[0]?.inboundTag ?? "—"}
                  </span>
                  {inbound && (
                    <span
                      className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-primary ring-1 ring-primary/25"
                      dir="ltr"
                    >
                      {inbound.protocol}
                    </span>
                  )}
                  {inbound && (
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                      :{inbound.port}
                    </span>
                  )}
                  <span className="ms-auto flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-1 ring-1 ring-border">
                    <Globe2 className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                    <span className="font-mono text-[11px] font-semibold text-foreground">{items.length}</span>
                    <span className="sr-only">{u.kpiTotal}</span>
                  </span>
                </header>
                <ul className="divide-y divide-border/50">
                  {items.map((h) => {
                    const sec = secText(h.security, inbound?.security);
                    const cls =
                      h.security === "same"
                        ? "bg-transparent text-muted-foreground ring-border"
                        : SEC_CHIP[h.security];
                    const extras = extrasOf(h);
                    return (
                      <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:px-5">
                        <Switch
                          checked={h.enable}
                          onCheckedChange={(v) => void toggleHost(h, v)}
                          aria-label={`${u.fieldEnabled} · ${h.remark}`}
                        />
                        <div className="min-w-0 flex-1 basis-48">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="truncate text-sm font-semibold text-foreground" dir="auto">
                              {h.remark}
                            </p>
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ring-1",
                                cls
                              )}
                              dir="ltr"
                            >
                              {sec}
                            </span>
                          </div>
                          <p
                            className="mt-0.5 truncate font-mono text-xs text-muted-foreground"
                            dir="ltr"
                            title={previewOf(h)}
                          >
                            {previewOf(h)}
                          </p>
                          {extras && (
                            <p
                              className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70"
                              dir="ltr"
                              title={extras}
                            >
                              {extras}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover-glow hover:text-primary"
                            onClick={() => void copyPreview(h)}
                            aria-label={u.copyLink}
                          >
                            <Copy className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover-glow hover:text-primary"
                            onClick={() => openEdit(h)}
                            aria-label={u.edit}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover-glow hover:text-destructive"
                            onClick={() => setDelTarget(h)}
                            aria-label={u.del}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
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
                <Network className="h-4 w-4 text-primary" aria-hidden="true" />
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
              <Label htmlFor="host-remark">{u.fieldRemark}</Label>
              <Input
                id="host-remark"
                value={form.remark}
                onChange={(e) => setForm((p) => ({ ...p, remark: e.target.value }))}
                placeholder={u.phRemark}
                aria-required="true"
                aria-invalid={errors.remark ? "true" : undefined}
                className={cn(errors.remark && "border-destructive ring-destructive/40")}
              />
              {errors.remark && <FieldError label={u.fieldRemark} />}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="host-inbound">{u.fieldInbound}</Label>
              <Select
                value={form.inboundId}
                onValueChange={(v) => setForm((p) => ({ ...p, inboundId: v }))}
              >
                <SelectTrigger
                  id="host-inbound"
                  className={cn("w-full", errors.inboundId && "border-destructive ring-destructive/40")}
                >
                  <SelectValue placeholder={u.fieldInbound} />
                </SelectTrigger>
                <SelectContent className="glass-strong max-h-64">
                  {inbounds.map((i) => (
                    <SelectItem key={i.id} value={i.id} dir="ltr" className="font-mono text-xs">
                      {i.tag} · {i.protocol} :{i.port}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.inboundId && <FieldError label={u.fieldInbound} />}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="host-address">{u.fieldAddress}</Label>
              <Input
                id="host-address"
                dir="ltr"
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                placeholder={u.phAddress}
                aria-required="true"
                aria-invalid={errors.address ? "true" : undefined}
                className={cn("font-mono", errors.address && "border-destructive ring-destructive/40")}
              />
              {errors.address && <FieldError label={u.fieldAddress} />}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="host-port">{u.fieldPort}</Label>
              <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-border/70">
                <Checkbox
                  id="host-inherit"
                  checked={form.inherit}
                  onCheckedChange={(v) =>
                    setForm((p) => ({ ...p, inherit: v === true, port: v === true ? "" : p.port }))
                  }
                />
                <Label
                  htmlFor="host-inherit"
                  className="cursor-pointer text-xs font-normal text-muted-foreground"
                >
                  {u.fieldPortInherit}
                </Label>
                <Input
                  id="host-port"
                  dir="ltr"
                  inputMode="numeric"
                  disabled={form.inherit}
                  className="ms-auto h-8 w-24 font-mono disabled:opacity-40"
                  value={form.inherit ? "" : form.port}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, port: e.target.value.replace(/[^0-9]/g, "") }))
                  }
                  placeholder={t.inbounds.phPort}
                />
              </div>
              {errors.port && <FieldError label={u.fieldPort} />}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="host-security">{u.fieldSecurity}</Label>
              <Select
                value={form.security}
                onValueChange={(v) => setForm((p) => ({ ...p, security: v as HostSecurity }))}
              >
                <SelectTrigger id="host-security" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  <SelectItem value="same">{u.secSame}</SelectItem>
                  <SelectItem value="tls">{u.secTls}</SelectItem>
                  <SelectItem value="none">{u.secNone}</SelectItem>
                  <SelectItem value="reality">{u.secReality}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="host-sni">{u.fieldSni}</Label>
                <Input
                  id="host-sni"
                  dir="ltr"
                  value={form.sni}
                  onChange={(e) => setForm((p) => ({ ...p, sni: e.target.value }))}
                  placeholder={u.phSni}
                  aria-invalid={errors.sni ? "true" : undefined}
                  className={cn("font-mono", errors.sni && "border-destructive ring-destructive/40")}
                />
                {errors.sni && <FieldError label={u.fieldSni} />}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="host-header">{u.fieldHost}</Label>
                <Input
                  id="host-header"
                  dir="ltr"
                  className="font-mono"
                  value={form.hostHeader}
                  onChange={(e) => setForm((p) => ({ ...p, hostHeader: e.target.value }))}
                  placeholder={u.phHost}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="host-path">{u.fieldPath}</Label>
                <Input
                  id="host-path"
                  dir="ltr"
                  value={form.path}
                  onChange={(e) => setForm((p) => ({ ...p, path: e.target.value }))}
                  placeholder={u.phPath}
                  aria-invalid={errors.path ? "true" : undefined}
                  className={cn("font-mono", errors.path && "border-destructive ring-destructive/40")}
                />
                {errors.path && <FieldError label={u.fieldPath} />}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="host-alpn">{u.fieldAlpn}</Label>
                <Input
                  id="host-alpn"
                  dir="ltr"
                  className="font-mono"
                  value={form.alpn}
                  onChange={(e) => setForm((p) => ({ ...p, alpn: e.target.value }))}
                  placeholder={u.phAlpn}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="host-fp">{u.fieldFingerprint}</Label>
              <Input
                id="host-fp"
                dir="ltr"
                className="font-mono"
                value={form.fingerprint}
                onChange={(e) => setForm((p) => ({ ...p, fingerprint: e.target.value }))}
                placeholder={u.phFp}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-border/70">
              <p className="text-sm font-medium text-foreground">{u.fieldEnabled}</p>
              <Switch
                checked={form.enable}
                onCheckedChange={(v) => setForm((p) => ({ ...p, enable: v }))}
                aria-label={u.fieldEnabled}
              />
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
            <Button onClick={() => void saveHost()} disabled={saving} className="gap-2 rounded-full">
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

      {/* delete confirm */}
      <AlertDialog open={delTarget !== null} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-silver">{u.del}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-1.5">
              <span className="block font-mono text-foreground" dir="ltr">
                {delTarget?.remark}
              </span>
              <span className="block font-mono text-xs" dir="ltr">
                {delTarget ? previewOf(delTarget) : ""}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-white/[0.03]">
              {t.inbounds.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void deleteHost()}
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
    </div>
  );
}
