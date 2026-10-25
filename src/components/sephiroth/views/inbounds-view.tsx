"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  CircleCheck,
  Copy,
  EllipsisVertical,
  Loader2,
  Pencil,
  Plus,
  RadioTower,
  Search,
  Trash2,
  Users,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { lfmt } from "@/lib/i18n/live-strings";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 3 — Inbounds management
   Config source of truth = Prisma (`/api/inbounds`), live stats
   = core-store (socket). Cards merge both; mutations apply
   optimistically and the next core:inbounds broadcast reconciles.
   ============================================================ */

interface InboundDTO {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  transport: string;
  security: string;
  status: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = "all" | "online" | "maintenance" | "disabled";
type FormState = {
  tag: string;
  protocol: string;
  port: string;
  transport: string;
  security: string;
  status: string;
  note: string;
};

const PROTOCOLS = ["vless", "vmess", "trojan", "shadowsocks", "hysteria2"] as const;
const TRANSPORTS = ["tcp", "ws", "grpc", "httpupgrade"] as const;
const STATUSES = ["online", "maintenance", "disabled"] as const;

const PROTO_LABEL: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria2: "Hysteria2",
};

const PROTO_CLS: Record<string, string> = {
  vless: "bg-primary/10 text-primary ring-primary/30",
  vmess: "bg-chart-2/10 text-chart-2 ring-chart-2/30",
  trojan: "bg-chart-4/10 text-chart-4 ring-chart-4/30",
  shadowsocks: "bg-white/5 text-silver ring-white/15",
  hysteria2: "bg-chart-5/10 text-chart-5 ring-chart-5/30",
};

const SCHEME: Record<string, string> = {
  vless: "vless",
  vmess: "vmess",
  trojan: "trojan",
  shadowsocks: "ss",
  hysteria2: "hy2",
};

const STATUS_DOT: Record<string, string> = {
  online: "bg-chart-3",
  maintenance: "bg-chart-4",
  disabled: "bg-chart-5",
};

const TRANSPORT_SHORT: Record<string, string> = {
  tcp: "",
  ws: "WS",
  grpc: "gRPC",
  httpupgrade: "HTTPUpgrade",
};

/** Same composition the core driver uses for its wire `proto` label. */
function composeProto(protocol: string, transport: string, security: string): string {
  const parts = [PROTO_LABEL[protocol] ?? protocol];
  const tr = TRANSPORT_SHORT[transport] ?? transport.toUpperCase();
  if (tr) parts.push(tr);
  if (security === "tls") parts.push("TLS");
  return parts.join(" · ");
}

function fmtTraffic(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`;
  return `${Math.round(gb)} GB`;
}

export function InboundsView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const { toast } = useToast();

  /* live stats from the core adapter (wire list is a stable ref) */
  const wireInbounds = useCoreStore((s) => s.snapshot.inbounds);
  const upsertInboundLocal = useCoreStore((s) => s.upsertInboundLocal);
  const removeInboundLocal = useCoreStore((s) => s.removeInboundLocal);

  /* config rows from the API — null = first load */
  const [rows, setRows] = useState<InboundDTO[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  /* toolbar */
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  /* create / edit dialog */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InboundDTO | null>(null);
  const [form, setForm] = useState<FormState>({
    tag: "",
    protocol: "vless",
    port: "",
    transport: "tcp",
    security: "none",
    status: "online",
    note: "",
  });
  const [fieldErr, setFieldErr] = useState<Partial<Record<keyof FormState, string>>>({});
  const [topErr, setTopErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* delete confirm */
  const [deleting, setDeleting] = useState<InboundDTO | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const FIELD_ERR: Record<string, string> = {
    required: t.inbounds.errGeneric,
    tagFormat: t.inbounds.errTagFormat,
    portType: t.inbounds.errPortType,
    portRange: t.inbounds.errPortRange,
    noteLong: t.inbounds.errNoteLong,
    badValue: t.inbounds.errBadValue,
  };

  /* ---------- data ---------- */

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbounds", { cache: "no-store" });
      if (!res.ok) {
        setLoadErr(true);
        return;
      }
      const data = (await res.json()) as { inbounds?: InboundDTO[] };
      setRows(data.inbounds ?? []);
      setLoadErr(false);
    } catch {
      setLoadErr(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statsByTag = useMemo(() => {
    const map = new Map<string, { users: number; txGb: number }>();
    for (const ib of wireInbounds) map.set(ib.tag, { users: ib.users, txGb: ib.txGb });
    return map;
  }, [wireInbounds]);

  const merged = useMemo(
    () =>
      (rows ?? []).map((r) => {
        const live = statsByTag.get(r.tag);
        return { ...r, users: live?.users ?? 0, txGb: live?.txGb ?? 0 };
      }),
    [rows, statsByTag]
  );

  const counts = useMemo(
    () => ({
      all: merged.length,
      online: merged.filter((r) => r.status === "online").length,
      maintenance: merged.filter((r) => r.status === "maintenance").length,
      disabled: merged.filter((r) => r.status === "disabled").length,
    }),
    [merged]
  );

  const totals = useMemo(
    () => ({
      users: merged.reduce((acc, r) => acc + r.users, 0),
      traffic: merged.reduce((acc, r) => acc + r.txGb, 0),
    }),
    [merged]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return merged.filter(
      (r) =>
        (statusFilter === "all" || r.status === statusFilter) &&
        (!needle || r.tag.toLowerCase().includes(needle))
    );
  }, [merged, q, statusFilter]);

  /* ---------- mutations ---------- */

  const openCreate = () => {
    const used = new Set((rows ?? []).map((r) => r.port));
    let port = 10000;
    while (used.has(port)) port++;
    setEditing(null);
    setForm({ tag: "", protocol: "vless", port: String(port), transport: "tcp", security: "none", status: "online", note: "" });
    setFieldErr({});
    setTopErr(null);
    setDialogOpen(true);
  };

  const openEdit = (row: InboundDTO) => {
    setEditing(row);
    setForm({
      tag: row.tag,
      protocol: row.protocol,
      port: String(row.port),
      transport: row.transport,
      security: row.security,
      status: row.status,
      note: row.note ?? "",
    });
    setFieldErr({});
    setTopErr(null);
    setDialogOpen(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setTopErr(null);
    setFieldErr({});
    const payload: Record<string, unknown> = {
      tag: form.tag.trim(),
      protocol: form.protocol,
      port: form.port.trim() === "" ? "" : Number(form.port),
      transport: form.transport,
      security: form.security,
      status: form.status,
      note: form.note.trim(), // "" normalizes to null server-side
    };
    try {
      const res = await fetch(editing ? `/api/inbounds/${editing.id}` : "/api/inbounds", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        inbound?: InboundDTO;
        error?: string;
        fields?: Record<string, string>;
      };

      if (res.status === 401) {
        setTopErr(t.inbounds.errGeneric);
        return;
      }
      if (res.status === 400 && data.fields) {
        const mapped: Partial<Record<keyof FormState, string>> = {};
        for (const [k, v] of Object.entries(data.fields)) {
          mapped[k as keyof FormState] = FIELD_ERR[v] ?? t.inbounds.errBadValue;
        }
        setFieldErr(mapped);
        return;
      }
      if (res.status === 409) {
        setTopErr(
          data.error === "duplicate_tag"
            ? t.inbounds.errTagUsed
            : data.error === "duplicate_port"
              ? t.inbounds.errPortUsed
              : t.inbounds.errGeneric
        );
        return;
      }
      if (!res.ok || !data.inbound) {
        toast({ title: t.inbounds.toastFail, variant: "destructive" });
        return;
      }

      const dto = data.inbound;
      const oldTag = editing?.tag;
      if (editing && oldTag && oldTag !== dto.tag) {
        removeInboundLocal(oldTag);
        upsertInboundLocal({
          tag: dto.tag,
          proto: composeProto(dto.protocol, dto.transport, dto.security),
          port: dto.port,
          status: dto.status as "online" | "maintenance" | "disabled",
          users: 0,
          txGb: 0,
        });
      } else {
        const prev = wireInbounds.find((x) => x.tag === (oldTag ?? dto.tag));
        upsertInboundLocal({
          tag: dto.tag,
          proto: composeProto(dto.protocol, dto.transport, dto.security),
          port: dto.port,
          status: dto.status as "online" | "maintenance" | "disabled",
          users: prev?.users ?? 0,
          txGb: prev?.txGb ?? 0,
        });
      }

      setRows((prev) => {
        const base = prev ?? [];
        return editing
          ? base.map((r) => (r.id === dto.id ? dto : r))
          : [...base, dto];
      });
      setDialogOpen(false);
      toast({
        title: lfmt(editing ? t.inbounds.toastUpdated : t.inbounds.toastCreated, { tag: dto.tag }),
      });
      if (!editing) void load(); // canonical ordering for fresh rows
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/inbounds/${deleting.id}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        removeInboundLocal(deleting.tag);
        setRows((prev) => (prev ?? []).filter((r) => r.id !== deleting.id));
        toast({ title: lfmt(t.inbounds.toastDeleted, { tag: deleting.tag }) });
        setDeleting(null);
      } else {
        toast({ title: t.inbounds.toastFail, variant: "destructive" });
      }
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    } finally {
      setDeleteBusy(false);
    }
  };

  const setStatus = async (row: InboundDTO, status: string) => {
    try {
      const res = await fetch(`/api/inbounds/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => ({}))) as { inbound?: InboundDTO };
      if (!res.ok || !data.inbound) {
        toast({ title: t.inbounds.toastFail, variant: "destructive" });
        return;
      }
      upsertInboundLocal({
        tag: row.tag,
        proto: composeProto(row.protocol, row.transport, row.security),
        port: row.port,
        status: status as "online" | "maintenance" | "disabled",
        users: statsByTag.get(row.tag)?.users ?? 0,
        txGb: statsByTag.get(row.tag)?.txGb ?? 0,
      });
      setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? data.inbound! : r)));
      toast({ title: lfmt(t.inbounds.toastUpdated, { tag: row.tag }) });
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    }
  };

  const copyLink = async (row: InboundDTO) => {
    const scheme = SCHEME[row.protocol] ?? row.protocol;
    const link = `${scheme}://user@0.0.0.0:${row.port}?type=${row.transport}&security=${row.security}#${encodeURIComponent(row.tag)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: t.inbounds.toastCopied });
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    }
  };

  /* ---------- render helpers ---------- */

  const StatusText: Record<string, string> = {
    online: t.inbounds.stOnline,
    maintenance: t.inbounds.stMaint,
    disabled: t.inbounds.stDisabled,
  };

  const KPI = ({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) => (
    <div className="glass hover-glow flex items-center gap-3.5 rounded-2xl px-4 py-3.5">
      <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        <Icon className="h-4.5 w-4.5 text-primary" />
      </span>
      <div className="min-w-0">
        <p className="truncate font-mono text-lg font-bold leading-tight text-silver tabular-nums">{value}</p>
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-block rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-primary">
            {t.inbounds.badge}
          </span>
          <h1 className="text-silver mt-3 text-2xl font-bold md:text-3xl">{t.nav.inbounds}</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {t.inbounds.subtitle}
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="glow-cyan gap-2 rounded-full px-5 font-semibold shadow-lg shadow-primary/20"
        >
          <Plus className="h-4 w-4" />
          {t.inbounds.new}
        </Button>
      </div>

      {/* ── KPI strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <KPI icon={RadioTower} value={String(counts.all)} label={t.inbounds.kpiTotal} />
        <KPI icon={Wifi} value={String(counts.online)} label={t.inbounds.kpiOnline} />
        <KPI icon={Users} value={String(totals.users)} label={t.inbounds.kpiUsers} />
        <KPI icon={ArrowLeftRight} value={fmtTraffic(totals.traffic)} label={t.inbounds.kpiTraffic} />
      </div>

      {/* ── toolbar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="glass relative h-10 min-w-0 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.inbounds.searchPh}
            aria-label={t.inbounds.searchPh}
            className="h-full w-full bg-transparent ps-9 pe-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="glass flex flex-wrap items-center rounded-full p-1" role="group" aria-label={t.nav.inbounds}>
          {(
            [
              ["all", t.inbounds.fAll, counts.all],
              ["online", t.inbounds.fOnline, counts.online],
              ["maintenance", t.inbounds.fMaint, counts.maintenance],
              ["disabled", t.inbounds.fDisabled, counts.disabled],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              aria-pressed={statusFilter === key}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors",
                statusFilter === key
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {key !== "all" && (
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[key])} aria-hidden="true" />
              )}
              {label}
              <span className="font-mono text-[10px] tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── load error ─────────────────────────────────────── */}
      {loadErr && rows === null && (
        <div className="glass flex items-center gap-3 rounded-2xl border-chart-5/30 px-5 py-4 text-sm text-chart-5">
          <RadioTower className="h-4 w-4 shrink-0" />
          {t.inbounds.loadFail}
          <Button variant="outline" size="sm" onClick={() => void load()} className="ms-auto rounded-full" aria-label="retry">
            ↻
          </Button>
        </div>
      )}

      {/* ── cards / empty / loading ────────────────────────── */}
      {rows === null ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="glass h-60 rounded-2xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        counts.all === 0 ? (
          <div className="glass hover-glow flex flex-col items-center rounded-3xl px-8 py-14 text-center">
            <span className="glass glow-cyan mb-5 flex h-16 w-16 items-center justify-center rounded-2xl">
              <RadioTower className="h-7 w-7 text-primary" />
            </span>
            <h3 className="text-silver text-lg font-bold">{t.inbounds.emptyTitle}</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t.inbounds.emptyDesc}</p>
            <Button onClick={openCreate} className="glow-cyan mt-6 gap-2 rounded-full px-5 font-semibold">
              <Plus className="h-4 w-4" />
              {t.inbounds.new}
            </Button>
          </div>
        ) : (
          <p className="glass rounded-2xl px-5 py-6 text-center text-sm text-muted-foreground">
            {t.inbounds.noMatch}
          </p>
        )
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((row) => {
            const protoKey = PROTOCOLS.includes(row.protocol as (typeof PROTOCOLS)[number])
              ? row.protocol
              : "vless";
            return (
              <article
                key={row.id}
                className="glass hover-glow fade-up group relative flex flex-col gap-3.5 rounded-2xl p-5"
              >
                {/* proto badge + status */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider ring-1",
                      PROTO_CLS[protoKey]
                    )}
                  >
                    {PROTO_LABEL[row.protocol] ?? row.protocol.toUpperCase()}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        STATUS_DOT[row.status] ?? "bg-muted-foreground",
                        row.status === "online" && "animate-pulse"
                      )}
                      aria-hidden="true"
                    />
                    {StatusText[row.status] ?? row.status}
                  </span>
                </div>

                {/* tag + port */}
                <div className="min-w-0">
                  <h3 className="truncate font-mono text-sm font-semibold text-silver" title={row.tag}>
                    {row.tag}
                  </h3>
                  <p className="mt-1 flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold leading-none text-silver tabular-nums">
                      {row.port}
                    </span>
                    <span className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground">
                      PORT
                    </span>
                  </p>
                </div>

                {/* transport / security chips */}
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-white/10">
                    {row.transport === "ws"
                      ? t.inbounds.trWs
                      : row.transport === "grpc"
                        ? t.inbounds.trGrpc
                        : row.transport === "httpupgrade"
                          ? t.inbounds.trHttpUp
                          : t.inbounds.trTcp}
                  </span>
                  <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-white/10">
                    {row.security === "tls" ? t.inbounds.secTls : t.inbounds.secNone}
                  </span>
                  {row.note && (
                    <span
                      className="max-w-full truncate rounded-md bg-primary/8 px-2 py-0.5 text-[10px] text-primary/90 ring-1 ring-primary/20"
                      title={row.note}
                    >
                      {row.note}
                    </span>
                  )}
                </div>

                {/* live stats */}
                <div className="mt-auto grid grid-cols-2 gap-3 border-t border-white/5 pt-3.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t.inbounds.usersLabel}
                    </p>
                    <p className="font-mono text-base font-bold text-silver tabular-nums">{row.users}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t.inbounds.trafficLabel}
                    </p>
                    <p className="font-mono text-base font-bold text-silver tabular-nums">
                      {fmtTraffic(row.txGb)}
                    </p>
                  </div>
                </div>

                {/* actions */}
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void copyLink(row)}
                    className="h-8 gap-1.5 rounded-full px-3 text-[11px] text-muted-foreground hover:text-foreground"
                    aria-label={t.inbounds.copyLink}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t.inbounds.copyLink}</span>
                  </Button>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(row)}
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                      aria-label={t.inbounds.edit}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                          aria-label={t.inbounds.setStatus}
                        >
                          <EllipsisVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="glass-strong min-w-44">
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {t.inbounds.setStatus}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {STATUSES.map((s) => (
                          <DropdownMenuItem
                            key={s}
                            onClick={() => void setStatus(row, s)}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="flex items-center gap-2">
                              <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[s])} />
                              {StatusText[s]}
                            </span>
                            {row.status === s && <CircleCheck className="h-3.5 w-3.5 text-primary" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleting(row)}
                      className="h-8 w-8 rounded-full text-muted-foreground hover:bg-chart-5/10 hover:text-chart-5"
                      aria-label={t.inbounds.deleteAction}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ── create / edit dialog ───────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-strong max-h-[90vh] overflow-y-auto border-white/10 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-silver">
              {editing ? t.inbounds.dialogEdit : t.inbounds.dialogCreate}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t.inbounds.subtitle}
            </DialogDescription>
          </DialogHeader>

          {topErr && (
            <p className="rounded-xl bg-chart-5/10 px-3.5 py-2.5 text-xs font-medium text-chart-5 ring-1 ring-chart-5/30">
              {topErr}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ib-protocol">{t.inbounds.fieldProtocol}</Label>
              <Select
                value={form.protocol}
                onValueChange={(v) => setForm((f) => ({ ...f, protocol: v }))}
              >
                <SelectTrigger id="ib-protocol" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {PROTOCOLS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROTO_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ib-status">{t.inbounds.fieldStatus}</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger id="ib-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {StatusText[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ib-tag">{t.inbounds.fieldTag}</Label>
              <Input
                id="ib-tag"
                value={form.tag}
                onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
                placeholder={t.inbounds.phTag}
                className="font-mono"
                autoComplete="off"
                dir="ltr"
              />
              {fieldErr.tag && <p className="text-[11px] text-chart-5">{fieldErr.tag}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ib-port">{t.inbounds.fieldPort}</Label>
              <Input
                id="ib-port"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                placeholder={t.inbounds.phPort}
                inputMode="numeric"
                className="font-mono tabular-nums"
                autoComplete="off"
                dir="ltr"
              />
              {fieldErr.port && <p className="text-[11px] text-chart-5">{fieldErr.port}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ib-transport">{t.inbounds.fieldTransport}</Label>
              <Select
                value={form.transport}
                onValueChange={(v) => setForm((f) => ({ ...f, transport: v }))}
              >
                <SelectTrigger id="ib-transport" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {TRANSPORTS.map((tr) => (
                    <SelectItem key={tr} value={tr}>
                      {tr === "ws"
                        ? t.inbounds.trWs
                        : tr === "grpc"
                          ? t.inbounds.trGrpc
                          : tr === "httpupgrade"
                            ? t.inbounds.trHttpUp
                            : t.inbounds.trTcp}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ib-security">{t.inbounds.fieldSecurity}</Label>
              <Select
                value={form.security}
                onValueChange={(v) => setForm((f) => ({ ...f, security: v }))}
              >
                <SelectTrigger id="ib-security" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  <SelectItem value="none">{t.inbounds.secNone}</SelectItem>
                  <SelectItem value="tls">{t.inbounds.secTls}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ib-note">{t.inbounds.fieldNote}</Label>
              <Textarea
                id="ib-note"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={t.inbounds.phNote}
                rows={2}
                className="resize-none"
              />
              {fieldErr.note && <p className="text-[11px] text-chart-5">{fieldErr.note}</p>}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="rounded-full border-border bg-white/4 hover:bg-white/8"
            >
              {t.inbounds.cancel}
            </Button>
            <Button onClick={() => void save()} disabled={saving} className="glow-cyan gap-2 rounded-full font-semibold">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? t.inbounds.saving : t.inbounds.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── delete confirm ─────────────────────────────────── */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-silver">{t.inbounds.delTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? lfmt(t.inbounds.delDesc, { tag: deleting.tag, port: deleting.port })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-full border-border bg-white/4 hover:bg-white/8">
              {t.inbounds.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleteBusy}
              className="rounded-full bg-chart-5 text-white hover:bg-chart-5/90"
            >
              {deleteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deleteBusy ? t.inbounds.deleting : t.inbounds.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
