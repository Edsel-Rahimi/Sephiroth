"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  Fingerprint,
  Gauge,
  KeyRound,
  Lightbulb,
  Link2,
  Power,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
  UserPlus,
  Users as UsersIcon,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { lfmt } from "@/lib/i18n/live-strings";
import { daysLeft, forecastUsage, type AccessDTO, type UserDTO, type UserStatus } from "@/lib/user-types";
import { buildShareLink } from "@/lib/share-links";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 4 — Users view
   One panel-level identity per client. Rows carry status,
   linked configs, traffic and expiry; the drawer exposes the
   subscription + per-config share links. Every section carries
   a plain-language tip (user requirement), all strings come
   from the 6-language dictionary.
   ============================================================ */

/* ---------- local inbound lite shape (for the picker) ---------- */

interface InboundLite {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  status: string;
  security: string;
  transport: string;
}

/* ---------- protocol chrome (mirrors inbounds-view) ---------- */

const PROTO_LABEL: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria2: "Hysteria2",
  wireguard: "WireGuard",
  "dokodemo-door": "Dokodemo",
  socks: "SOCKS",
  http: "HTTP",
};

const PROTO_CLS: Record<string, string> = {
  vless: "bg-primary/10 text-primary ring-primary/30",
  vmess: "bg-[#8b8cf8]/10 text-[#8b8cf8] ring-[#8b8cf8]/30",
  trojan: "bg-chart-4/10 text-chart-4 ring-chart-4/30",
  shadowsocks: "bg-chart-3/10 text-chart-3 ring-chart-3/30",
  hysteria2: "bg-chart-5/10 text-chart-5 ring-chart-5/30",
  wireguard: "bg-[#c084fc]/10 text-[#c084fc] ring-[#c084fc]/30",
  "dokodemo-door": "bg-[#f472b6]/10 text-[#f472b6] ring-[#f472b6]/30",
  socks: "bg-[#fde047]/10 text-[#fde047] ring-[#fde047]/30",
  http: "bg-[#fb923c]/10 text-[#fb923c] ring-[#fb923c]/30",
};

const STATUS_STYLE: Record<UserStatus, { dot: string; text: string; ring: string }> = {
  active: { dot: "bg-chart-3", text: "text-chart-3", ring: "ring-chart-3/30 bg-chart-3/10" },
  expired: { dot: "bg-chart-5", text: "text-chart-5", ring: "ring-chart-5/30 bg-chart-5/10" },
  capped: { dot: "bg-chart-4", text: "text-chart-4", ring: "ring-chart-4/30 bg-chart-4/10" },
  disabled: { dot: "bg-muted-foreground", text: "text-muted-foreground", ring: "ring-border bg-muted/40" },
};

/* ---------- helpers ---------- */

function fmtGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1)} GB`;
}

/* ---------- v2.3 · burn-rate forecast chip ---------- */

function ForecastChip({ user, label, title }: { user: UserDTO; label: string; title: string }) {
  const fc = forecastUsage(user);
  if (fc.daysToCap === null || user.status !== "active") return null;
  const tone =
    fc.daysToCap <= 3
      ? "bg-chart-5/10 text-chart-5 ring-chart-5/30"
      : fc.daysToCap <= 7
        ? "bg-amber-400/10 text-amber-400 ring-amber-400/30"
        : "bg-white/[0.04] text-muted-foreground ring-white/10";
  return (
    <p
      className={cn(
        "mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ring-1",
        tone
      )}
      title={title}
    >
      <TrendingUp className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {lfmt(label, { n: fc.daysToCap, rate: fmtGb(fc.gbPerDay) })}
      </span>
    </p>
  );
}

function avatarColor(seed: string): string {
  const palette = [
    "bg-primary/20 text-primary",
    "bg-[#8b8cf8]/20 text-[#8b8cf8]",
    "bg-chart-3/20 text-chart-3",
    "bg-chart-4/20 text-chart-4",
    "bg-[#c084fc]/20 text-[#c084fc]",
    "bg-[#f472b6]/20 text-[#f472b6]",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function Tip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-lg bg-primary/[0.04] px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-primary/10",
        className
      )}
    >
      <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-primary/80" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function ProtoBadge({ protocol }: { protocol: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ring-1",
        PROTO_CLS[protocol] ?? "bg-muted text-muted-foreground ring-border"
      )}
    >
      {PROTO_LABEL[protocol] ?? protocol.toUpperCase()}
    </span>
  );
}

/* ---------- form state ---------- */

/* sale template lite — Phase 6 one-click presets in the create dialog */
interface TplLite {
  id: string;
  name: string;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  enabled: boolean;
}

/* Task 23-g — one /api/users/ip-usage entry (Xray access-log tracker) */
interface IpUsageRow {
  email: string;
  userId: string | null;
  username: string;
  ips: string[];
  count: number;
  limit: number;
  breach: boolean;
}

interface UsrForm {
  username: string;
  note: string;
  enabled: boolean;
  trafficLimitGb: string;
  expiryDays: string;
  ipLimit: string;
  hwidLimit: string;
  inboundIds: Set<string>;
}

const EMPTY_FORM: UsrForm = {
  username: "",
  note: "",
  enabled: true,
  trafficLimitGb: "",
  expiryDays: "",
  ipLimit: "0",
  hwidLimit: "",
  inboundIds: new Set<string>(),
};

type Filter = "all" | UserStatus;
type SortId = "newest" | "name" | "traffic" | "expiry";

/* ---------- synthetic DTO to reuse the protocol-correct link builder ---------- */

function accessShareLink(access: AccessDTO, user: UserDTO): string | null {
  let stream: Record<string, string | number | boolean> = {};
  try {
    stream = JSON.parse(access.inbound.streamJson || "{}");
  } catch {
    stream = {};
  }
  return buildShareLink(
    {
      id: access.inbound.id,
      tag: access.inbound.tag,
      protocol: access.inbound.protocol,
      port: access.inbound.port,
      listen: access.inbound.listen,
      transport: access.inbound.transport,
      security: access.inbound.security,
      status: access.inbound.status,
      note: null,
      trafficLimitGb: null,
      expiryDays: null,
      clients: [],
      sniffing: { enabled: false, destOverride: [], routeOnly: false },
      stream,
      createdAt: "",
      updatedAt: "",
    },
    {
      email: access.email,
      key: access.key,
      subId: user.subId,
      flow: access.flow,
      ipLimit: user.ipLimit,
      trafficLimitGb: user.trafficLimitGb,
      expiryDays: user.expiryDays,
      enabled: user.enabled,
    }
  );
}

/* ============================================================ */

export function UsersView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.users;
  const { toast } = useToast();
  const rtl = lang === "fa" || lang === "ar";

  /* data — null = first load */
  const [users, setUsers] = useState<UserDTO[] | null>(null);
  const [inbounds, setInbounds] = useState<InboundLite[] | null>(null);
  const [templates, setTemplates] = useState<TplLite[]>([]);
  const [loadErr, setLoadErr] = useState(false);
  /* Task 23-g — live concurrent-IP usage from the core driver (empty on sim) */
  const [ipUsage, setIpUsage] = useState<IpUsageRow[]>([]);

  /* toolbar */
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortId>("newest");

  /* selection / bulk */
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  /* create / edit dialog */
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const [form, setForm] = useState<UsrForm>(EMPTY_FORM);
  const [fieldErr, setFieldErr] = useState<Partial<Record<string, string>>>({});
  const [topErr, setTopErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* drawer + delete */
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<UserDTO | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ur, ir, tr, pr] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/inbounds", { cache: "no-store" }),
        fetch("/api/sale-templates", { cache: "no-store" }).catch(() => null),
        fetch("/api/users/ip-usage", { cache: "no-store" }).catch(() => null),
      ]);
      if (!ur.ok || !ir.ok) throw new Error("load");
      const uj = (await ur.json()) as { users: UserDTO[] };
      const ij = (await ir.json()) as { inbounds: InboundLite[] };
      setUsers(uj.users);
      setInbounds(ij.inbounds);
      if (tr && tr.ok) {
        const tj = (await tr.json()) as { templates: TplLite[] };
        setTemplates(tj.templates.filter((x) => x.enabled));
      } else {
        setTemplates([]);
      }
      if (pr && pr.ok) {
        const pj = (await pr.json()) as { usage?: IpUsageRow[] };
        setIpUsage(pj.usage ?? []);
      } else {
        setIpUsage([]);
      }
      setLoadErr(false);
    } catch {
      setUsers([]);
      setLoadErr(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- derived ---------- */

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, expired: 0, capped: 0, disabled: 0 } as Record<Filter, number>;
    for (const x of users ?? []) {
      c.all++;
      c[x.status]++;
    }
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    let list = [...(users ?? [])];
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (x) =>
          x.username.toLowerCase().includes(needle) ||
          (x.note ?? "").toLowerCase().includes(needle) ||
          x.subId.includes(needle)
      );
    }
    if (filter !== "all") list = list.filter((x) => x.status === filter);
    switch (sort) {
      case "name":
        list.sort((a, b) => a.username.localeCompare(b.username));
        break;
      case "traffic":
        list.sort((a, b) => b.usedTrafficGb - a.usedTrafficGb);
        break;
      case "expiry": {
        const key = (x: UserDTO) =>
          x.expiryDays === null ? Number.POSITIVE_INFINITY : daysLeft(x.expiryDays, x.createdAt) ?? 0;
        list.sort((a, b) => key(a) - key(b));
        break;
      }
      default:
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list;
  }, [users, q, filter, sort]);

  const allShownSelected = filtered.length > 0 && filtered.every((x) => sel.has(x.id));
  const drawerUser = useMemo(
    () => (users ?? []).find((x) => x.id === drawerId) ?? null,
    [users, drawerId]
  );

  /* Task 23-g — per-user IP usage (union of every email's IPs) */
  const usageByUsername = useMemo(() => {
    const m = new Map<string, { ips: string[]; breach: boolean }>();
    for (const row of ipUsage) {
      const prev = m.get(row.username);
      const ips = prev ? [...new Set([...prev.ips, ...row.ips])] : row.ips;
      m.set(row.username, { ips, breach: (prev?.breach ?? false) || row.breach });
    }
    return m;
  }, [ipUsage]);

  const FIELD_ERR: Record<string, string> = {
    format: u.errNameFormat,
    taken: u.errNameTaken,
    required: u.errNoInbounds,
    unknown: u.errNoInbounds,
    range: u.errNameFormat,
  };

  /* ---------- handlers ---------- */

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, inboundIds: new Set() });
    setFieldErr({});
    setTopErr(null);
    setDlgOpen(true);
  };

  const openEdit = (user: UserDTO) => {
    setEditing(user);
    setForm({
      username: user.username,
      note: user.note ?? "",
      enabled: user.enabled,
      trafficLimitGb: user.trafficLimitGb === null ? "" : String(user.trafficLimitGb),
      expiryDays: user.expiryDays === null ? "" : String(user.expiryDays),
      ipLimit: String(user.ipLimit),
      hwidLimit: user.hwidLimit === null ? "" : String(user.hwidLimit),
      inboundIds: new Set(user.accesses.map((a) => a.inboundId)),
    });
    setFieldErr({});
    setTopErr(null);
    setDlgOpen(true);
  };

  const toggleInbound = (id: string) => {
    setForm((f) => {
      const next = new Set(f.inboundIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...f, inboundIds: next };
    });
  };

  const pickAllOnline = () => {
    const online = (inbounds ?? []).filter((i) => i.status === "online").map((i) => i.id);
    setForm((f) => ({ ...f, inboundIds: new Set(online) }));
  };

  const save = async () => {
    setSaving(true);
    setFieldErr({});
    setTopErr(null);
    try {
      const payload = {
        username: form.username.trim(),
        note: form.note.trim(),
        enabled: form.enabled,
        trafficLimitGb: form.trafficLimitGb === "" ? null : Number(form.trafficLimitGb),
        expiryDays: form.expiryDays === "" ? null : Number(form.expiryDays),
        ipLimit: Number(form.ipLimit || "0"),
        hwidLimit: form.hwidLimit === "" ? null : Number(form.hwidLimit),
        inboundIds: [...form.inboundIds],
      };
      const res = await fetch(editing ? `/api/users/${editing.id}` : "/api/users", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 400 || res.status === 409) {
        const j = (await res.json()) as { fields?: { field: string; code: string }[] };
        const map: Partial<Record<string, string>> = {};
        for (const f of j.fields ?? []) map[f.field] = FIELD_ERR[f.code] ?? u.errNameFormat;
        setFieldErr(map);
        setSaving(false);
        return;
      }
      /* Phase 6 — reseller quota gates (403) */
      if (res.status === 403) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          j.error === "quota_users"
            ? t.resellers.quotaUsers
            : j.error === "quota_unlimited"
              ? t.resellers.quotaUnlimited
              : t.resellers.quotaTraffic;
        setTopErr(msg);
        toast({ description: msg });
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error("save");
      const j = (await res.json()) as { user: UserDTO };
      setUsers((prev) =>
        editing ? (prev ?? []).map((x) => (x.id === j.user.id ? j.user : x)) : [j.user, ...(prev ?? [])]
      );
      setDlgOpen(false);
      toast({
        description: editing
          ? lfmt(u.toastUpdated, {})
          : `${u.toastCreated} · ${j.user.username}`,
      });
    } catch {
      setTopErr(u.errNameFormat);
    }
    setSaving(false);
  };

  const destroy = async (user: UserDTO) => {
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      setUsers((prev) => (prev ?? []).filter((x) => x.id !== user.id));
      setSel((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
      if (drawerId === user.id) setDrawerId(null);
      setDeleting(null);
      toast({ description: `${u.toastDeleted} · ${user.username}` });
    } catch {
      setDeleting(null);
    }
    setDeleteBusy(false);
  };

  const toggleEnabled = async (user: UserDTO, enabled: boolean) => {
    // optimistic
    setUsers((prev) => (prev ?? []).map((x) => (x.id === user.id ? { ...x, enabled, status: enabled ? "active" : "disabled" } : x)));
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: user.note ?? "",
          enabled,
          trafficLimitGb: user.trafficLimitGb,
          expiryDays: user.expiryDays,
          ipLimit: user.ipLimit,
        }),
      });
      if (!res.ok) throw new Error("toggle");
      const j = (await res.json()) as { user: UserDTO };
      setUsers((prev) => (prev ?? []).map((x) => (x.id === j.user.id ? j.user : x)));
    } catch {
      setUsers((prev) => (prev ?? []).map((x) => (x.id === user.id ? { ...x, enabled: !enabled } : x)));
    }
  };

  const runBulk = async (action: "enable" | "disable" | "delete" | "resetTraffic") => {
    setBulkBusy(true);
    try {
      const res = await fetch("/api/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: [...sel] }),
      });
      if (!res.ok) throw new Error("bulk");
      setSel(new Set());
      setBulkConfirm(false);
      await load();
      toast({
        description:
          action === "resetTraffic"
            ? u.toastReset
            : action === "delete"
              ? u.toastDeleted
              : lfmt(u.toastBulk, { n: sel.size }),
      });
    } catch {
      setBulkConfirm(false);
    }
    setBulkBusy(false);
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ description: label });
    } catch {
      toast({ description: label });
    }
  };

  const subLinkFor = (user: UserDTO) => `sub:${user.subId}`;

  /* Task 23-g — clear every registered HWID device (sub portal re-registers) */
  const resetDevices = async (user: UserDTO) => {
    try {
      const res = await fetch(`/api/users/${user.id}/reset-devices`, { method: "POST" });
      if (!res.ok) throw new Error("reset");
      const j = (await res.json()) as { user: UserDTO };
      setUsers((prev) => (prev ?? []).map((x) => (x.id === j.user.id ? j.user : x)));
      toast({ description: u.toastDevicesReset });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
  };

  /* ---------- render ---------- */

  const loading = users === null;

  return (
    <div className="fade-up space-y-6">
      {/* header */}
      <section className="space-y-2">
        <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-primary/90 ring-1 ring-primary/20">
          <UsersIcon className="h-3 w-3" aria-hidden="true" />
          {u.badge}
        </span>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">{t.nav.users}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{u.subtitle}</p>
          </div>
          <Button onClick={openCreate} className="glow-cyan gap-2" aria-label={u.new}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {u.new}
          </Button>
        </div>
      </section>

      {/* KPI row */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={u.kpiTotal}>
        {(
          [
            { key: "all" as Filter, label: u.kpiTotal, icon: UsersIcon, cls: "text-primary" },
            { key: "active" as Filter, label: u.kpiActive, icon: CheckCircle2, cls: "text-chart-3" },
            { key: "expired" as Filter, label: u.kpiExpired, icon: CalendarClock, cls: "text-chart-5" },
            { key: "capped" as Filter, label: u.kpiCapped, icon: Gauge, cls: "text-chart-4" },
          ]
        ).map(({ key, label, icon: Icon, cls }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(filter === key ? "all" : key)}
            className={cn(
              "glass hover-glow rounded-2xl p-4 text-start transition-all",
              filter === key && "ring-2 ring-primary/40"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {label}
              </span>
              <span className={cn("rounded-lg bg-background/60 p-1.5 ring-1 ring-border", cls)}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
            <div className="mt-2 font-mono text-2xl font-bold md:text-3xl">
              {loading ? <Skeleton className="h-8 w-16" /> : counts[key]}
            </div>
          </button>
        ))}
      </section>

      {/* toolbar */}
      <section className="glass rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={u.searchPh}
              className="ps-9"
              aria-label={u.searchPh}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "active", "expired", "capped", "disabled"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors",
                  filter === f
                    ? "bg-primary/15 text-primary ring-primary/40"
                    : "text-muted-foreground ring-border hover:text-foreground"
                )}
              >
                {f === "all" ? u.fAll : f === "active" ? u.fActive : f === "expired" ? u.fExpired : f === "capped" ? u.fCapped : u.fDisabled}
                <span className="ms-1.5 font-mono text-[10px] opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortId)}>
            <SelectTrigger className="w-[150px]" aria-label={u.sortNewest}>
              <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{u.sortNewest}</SelectItem>
              <SelectItem value="name">{u.sortName}</SelectItem>
              <SelectItem value="traffic">{u.sortTraffic}</SelectItem>
              <SelectItem value="expiry">{u.sortExpiry}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Tip className="mt-3">{u.tipTable}</Tip>
      </section>

      {/* bulk bar */}
      {sel.size > 0 && (
        <section className="glass glow-cyan flex flex-wrap items-center gap-2 rounded-2xl p-3">
          <span className="text-xs font-medium text-primary">{lfmt(u.selected, { n: sel.size })}</span>
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void runBulk("enable")} className="gap-1.5">
              <Power className="h-3.5 w-3.5" aria-hidden="true" /> {u.bulkEnable}
            </Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void runBulk("disable")} className="gap-1.5">
              <Power className="h-3.5 w-3.5" aria-hidden="true" /> {u.bulkDisable}
            </Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void runBulk("resetTraffic")} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {u.bulkReset}
            </Button>
            <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => setBulkConfirm(true)} className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> {u.bulkDelete}
            </Button>
          </div>
        </section>
      )}

      {/* error banner */}
      {loadErr && (
        <div className="glass rounded-2xl border border-destructive/40 p-4 text-sm text-destructive">
          {t.inbounds.errGeneric}
        </div>
      )}

      {/* table (md+) */}
      <section className="glass hidden overflow-hidden rounded-2xl md:block">
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 z-10 bg-card/95 text-[11px] uppercase tracking-wider text-muted-foreground backdrop-blur">
              <tr>
                <th className="w-10 px-3 py-3">
                  <Checkbox
                    checked={allShownSelected}
                    onCheckedChange={(v) => {
                      const next = new Set(sel);
                      for (const x of filtered) {
                        if (v) next.add(x.id);
                        else next.delete(x.id);
                      }
                      setSel(next);
                    }}
                    aria-label={u.colUser}
                  />
                </th>
                <th className="px-3 py-3 text-start font-medium">{u.colUser}</th>
                <th className="px-3 py-3 text-start font-medium">{u.colStatus}</th>
                <th className="px-3 py-3 text-start font-medium">{u.colConfigs}</th>
                <th className="px-3 py-3 text-start font-medium">{u.colTraffic}</th>
                <th className="hidden px-3 py-3 text-start font-medium lg:table-cell">{u.colExpiry}</th>
                <th className="hidden px-3 py-3 text-start font-medium lg:table-cell">{u.colIp}</th>
                <th className="px-3 py-3 text-end font-medium">{u.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td colSpan={8} className="px-3 py-3">
                      <Skeleton className="h-9 w-full" />
                    </td>
                  </tr>
                ))}
              {!loading && filtered.length === 0 && (
                <tr className="border-t border-border/60">
                  <td colSpan={8} className="px-6 py-14 text-center">
                    <UsersIcon className="mx-auto h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
                    <p className="mt-3 text-sm font-medium">{u.empty}</p>
                    <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{u.emptyDesc}</p>
                    <Button size="sm" className="mt-4 gap-2" onClick={openCreate}>
                      <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> {u.new}
                    </Button>
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((user) => {
                  const st = STATUS_STYLE[user.status];
                  const left = daysLeft(user.expiryDays, user.createdAt);
                  const pct =
                    user.trafficLimitGb !== null && user.trafficLimitGb > 0
                      ? Math.min(100, (user.usedTrafficGb / user.trafficLimitGb) * 100)
                      : null;
                  return (
                    <tr
                      key={user.id}
                      className="group cursor-pointer border-t border-border/60 transition-colors hover:bg-primary/[0.03]"
                      onClick={() => setDrawerId(user.id)}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={sel.has(user.id)}
                          onCheckedChange={(v) => {
                            const next = new Set(sel);
                            if (v) next.add(user.id);
                            else next.delete(user.id);
                            setSel(next);
                          }}
                          aria-label={user.username}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-border",
                              avatarColor(user.username)
                            )}
                            aria-hidden="true"
                          >
                            {user.username.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium" dir="ltr">
                              {user.username}
                            </div>
                            {user.note && (
                              <div className="truncate text-[11px] text-muted-foreground">{user.note}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                            st.ring,
                            st.text
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} aria-hidden="true" />
                          {user.status === "active"
                            ? u.stActive
                            : user.status === "expired"
                              ? u.stExpired
                              : user.status === "capped"
                                ? u.stCapped
                                : u.stDisabled}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {user.accesses.slice(0, 3).map((a) => (
                            <ProtoBadge key={a.id} protocol={a.inbound.protocol} />
                          ))}
                          {user.accesses.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">+{user.accesses.length - 3}</span>
                          )}
                          {user.accesses.length === 0 && (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="w-[130px]">
                          <div className="flex items-baseline justify-between gap-2 text-[11px]">
                            <span className="font-mono">{fmtGb(user.usedTrafficGb)}</span>
                            <span className="text-muted-foreground">
                              {user.trafficLimitGb === null ? u.unlimited : fmtGb(user.trafficLimitGb)}
                            </span>
                          </div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                pct !== null && pct >= 100 ? "bg-chart-5" : pct !== null && pct >= 80 ? "bg-chart-4" : "bg-primary"
                              )}
                              style={{ width: `${pct === null ? 8 : pct}%` }}
                            />
                          </div>
                          <ForecastChip user={user} label={u.forecastChip} title={u.forecastTip} />
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 lg:table-cell">
                        {user.expiryDays === null ? (
                          <span className="text-xs text-muted-foreground">{u.expiryNever}</span>
                        ) : left === null ? (
                          "—"
                        ) : left >= 0 ? (
                          <span className={cn("font-mono text-xs", left <= 3 ? "text-chart-5" : "")}>
                            {lfmt(u.expiryLeft, { n: left })}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-chart-5">
                            {lfmt(u.expiredAgo, { n: Math.abs(left) })}
                          </span>
                        )}
                      </td>
                      <td className="hidden px-3 py-3 lg:table-cell">
                        {(() => {
                          const live = usageByUsername.get(user.username);
                          const count = live?.ips.length ?? 0;
                          const breach = count > 0 && user.ipLimit > 0 && count > user.ipLimit;
                          if (count === 0) {
                            return (
                              <span className="font-mono text-xs text-muted-foreground">
                                {user.ipLimit === 0 ? u.unlimited : `0/${user.ipLimit}`}
                              </span>
                            );
                          }
                          const shown = live!.ips.slice(0, 5);
                          const more = count - shown.length;
                          const tip =
                            `${lfmt(u.ipActive, { n: 10 })}\n${shown.join("\n")}` +
                            (more > 0 ? `\n+${more}` : "") +
                            (breach ? `\n${u.ipBreach}` : "");
                          return (
                            <span
                              className={cn(
                                "inline-flex cursor-help items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ring-1",
                                breach
                                  ? "bg-chart-5/10 text-chart-5 ring-chart-5/40"
                                  : "bg-primary/10 text-primary ring-primary/30"
                              )}
                              title={tip}
                            >
                              {count}/{user.ipLimit === 0 ? "∞" : user.ipLimit}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Switch
                            checked={user.enabled}
                            onCheckedChange={(v) => void toggleEnabled(user, v)}
                            aria-label={user.enabled ? u.bulkDisable : u.bulkEnable}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setDrawerId(user.id)}
                            aria-label={u.dlgEdit}
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleting(user)}
                            aria-label={u.bulkDelete}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* mobile cards (below md) */}
      <ul className="space-y-3 md:hidden">
        {loading &&
          Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="glass rounded-2xl p-4">
              <Skeleton className="h-16 w-full" />
            </li>
          ))}
        {!loading && filtered.length === 0 && (
          <li className="glass rounded-2xl p-8 text-center">
            <UsersIcon className="mx-auto h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">{u.empty}</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{u.emptyDesc}</p>
            <Button size="sm" className="mt-4 gap-2" onClick={openCreate}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> {u.new}
            </Button>
          </li>
        )}
        {!loading &&
          filtered.map((user) => {
            const st = STATUS_STYLE[user.status];
            const left = daysLeft(user.expiryDays, user.createdAt);
            const pct =
              user.trafficLimitGb !== null && user.trafficLimitGb > 0
                ? Math.min(100, (user.usedTrafficGb / user.trafficLimitGb) * 100)
                : null;
            return (
              <li
                key={user.id}
                className="glass hover-glow cursor-pointer rounded-2xl p-4 ring-1 ring-white/10"
                onClick={() => setDrawerId(user.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-border",
                        avatarColor(user.username)
                      )}
                      aria-hidden="true"
                    >
                      {user.username.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground" dir="ltr">
                        {user.username}
                      </p>
                      {user.note && (
                        <p className="truncate text-[11px] text-muted-foreground">{user.note}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={user.enabled}
                      onCheckedChange={(v) => void toggleEnabled(user, v)}
                      aria-label={`${u.colStatus} · ${user.username}`}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                      st.ring,
                      st.text
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} aria-hidden="true" />
                    {user.status === "active"
                      ? u.stActive
                      : user.status === "expired"
                        ? u.stExpired
                        : user.status === "capped"
                          ? u.stCapped
                          : u.stDisabled}
                  </span>
                  {user.accesses.slice(0, 3).map((a) => (
                    <ProtoBadge key={a.id} protocol={a.inbound.protocol} />
                  ))}
                  {user.accesses.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">+{user.accesses.length - 3}</span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {u.colTraffic}
                    </p>
                    <div className="mt-1 w-[130px] max-w-full">
                      <div className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="font-mono">{fmtGb(user.usedTrafficGb)}</span>
                        <span className="text-muted-foreground">
                          {user.trafficLimitGb === null ? u.unlimited : fmtGb(user.trafficLimitGb)}
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            pct !== null && pct >= 100 ? "bg-chart-5" : pct !== null && pct >= 80 ? "bg-chart-4" : "bg-primary"
                          )}
                          style={{ width: `${pct === null ? 8 : pct}%` }}
                        />
                      </div>
                      <ForecastChip user={user} label={u.forecastChip} title={u.forecastTip} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {u.colExpiry}
                    </p>
                    <p className="mt-1 text-xs">
                      {user.expiryDays === null ? (
                        <span className="text-muted-foreground">{u.expiryNever}</span>
                      ) : left === null ? (
                        "—"
                      ) : left >= 0 ? (
                        <span className={cn("font-mono", left <= 3 ? "text-chart-5" : "")}>
                          {lfmt(u.expiryLeft, { n: left })}
                        </span>
                      ) : (
                        <span className="font-mono text-chart-5">
                          {lfmt(u.expiredAgo, { n: Math.abs(left) })}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div
                  className="mt-3 flex items-center justify-end gap-1 border-t border-white/5 pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setDrawerId(user.id)}
                    aria-label={`${u.dlgEdit} · ${user.username}`}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleting(user)}
                    aria-label={`${u.bulkDelete} · ${user.username}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
      </ul>

      {/* create / edit dialog */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="glass-strong max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-silver text-xl font-bold">
              {editing ? u.dlgEdit : u.dlgCreate}
            </DialogTitle>
            <DialogDescription className="text-xs">{u.subtitle}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* identity */}
            <div className="space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                {u.secIdentity}
              </h3>
              <div className="space-y-1.5">
                <Label htmlFor="u-username">{u.fieldUsername}</Label>
                <Input
                  id="u-username"
                  value={form.username}
                  disabled={!!editing}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder={u.phUsername}
                  dir="ltr"
                  autoComplete="off"
                />
                {fieldErr.username && <p className="text-[11px] text-destructive">{fieldErr.username}</p>}
                <Tip>{u.tipIdentity}</Tip>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-note">{u.fieldNote}</Label>
                <Input
                  id="u-note"
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder={u.phNote}
                />
              </div>
            </div>

            {/* limits */}
            <div className="space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                {u.secLimits}
              </h3>
              {templates.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {t.resellers.chipsLabel}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            trafficLimitGb:
                              tpl.trafficLimitGb !== null ? String(tpl.trafficLimitGb) : "",
                            expiryDays: tpl.expiryDays !== null ? String(tpl.expiryDays) : "",
                            ipLimit: String(tpl.ipLimit ?? 0),
                          }))
                        }
                        className="glass hover-glow rounded-full px-3 py-1.5 text-xs font-medium text-foreground outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring"
                        title={`${tpl.trafficLimitGb !== null ? `${tpl.trafficLimitGb} GB` : "\u221e"} \u00b7 ${tpl.expiryDays !== null ? `${tpl.expiryDays}d` : "\u221e"} \u00b7 ip ${tpl.ipLimit || "\u221e"}`}
                      >
                        <span className="text-primary">{"\u2726"}</span> {tpl.name}
                      </button>
                    ))}
                  </div>
                  <Tip>{t.resellers.tipTemplates}</Tip>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="u-traffic">{u.fieldTraffic}</Label>
                  <Input
                    id="u-traffic"
                    type="number"
                    min="0"
                    value={form.trafficLimitGb}
                    onChange={(e) => setForm((f) => ({ ...f, trafficLimitGb: e.target.value }))}
                    placeholder="∞"
                  />
                  <p className="text-[10px] text-muted-foreground">{u.unlimitedTraffic}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="u-expiry">{u.fieldExpiry}</Label>
                  <Input
                    id="u-expiry"
                    type="number"
                    min="0"
                    value={form.expiryDays}
                    onChange={(e) => setForm((f) => ({ ...f, expiryDays: e.target.value }))}
                    placeholder="∞"
                  />
                  <p className="text-[10px] text-muted-foreground">{u.neverExpires}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="u-ip">{u.fieldIp}</Label>
                  <Input
                    id="u-ip"
                    type="number"
                    min="0"
                    value={form.ipLimit}
                    onChange={(e) => setForm((f) => ({ ...f, ipLimit: e.target.value }))}
                    placeholder="0"
                  />
                  <p className="text-[10px] text-muted-foreground">{u.ipUnlimited}</p>
                </div>
                {/* Task 23-g — sub-portal HWID device limit */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <Label htmlFor="u-hwid">{u.fieldHwid}</Label>
                    {editing && (editing.devices.length > 0 || (editing.hwidLimit ?? 0) > 0) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 rounded-full px-2 text-[10px]"
                        onClick={() => void resetDevices(editing)}
                        title={lfmt(u.devicesCount, { n: editing.devices.length })}
                      >
                        <RefreshCw className="h-2.5 w-2.5" aria-hidden="true" />
                        {u.resetDevices}
                      </Button>
                    )}
                  </div>
                  <Input
                    id="u-hwid"
                    type="number"
                    min="0"
                    value={form.hwidLimit}
                    onChange={(e) => setForm((f) => ({ ...f, hwidLimit: e.target.value }))}
                    placeholder="0"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {editing ? `${lfmt(u.devicesCount, { n: editing.devices.length })} · ${u.hwidUnlimited}` : u.hwidUnlimited}
                  </p>
                </div>
              </div>
              <Tip>{u.tipLimits}</Tip>
            </div>

            {/* inbounds */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                  {u.secInbounds}
                </h3>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={pickAllOnline}>
                  <Check className="h-3 w-3" aria-hidden="true" /> {u.pickOnline}
                </Button>
              </div>
              <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl bg-background/40 p-2 ring-1 ring-border">
                {(inbounds ?? []).map((inb) => (
                  <div
                    key={inb.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleInbound(inb.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleInbound(inb.id);
                      }
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs transition-colors",
                      form.inboundIds.has(inb.id)
                        ? "bg-primary/10 ring-1 ring-primary/30"
                        : "hover:bg-muted/50"
                    )}
                    aria-pressed={form.inboundIds.has(inb.id)}
                  >
                    <Checkbox
                      checked={form.inboundIds.has(inb.id)}
                      aria-label={inb.tag}
                      tabIndex={-1}
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => toggleInbound(inb.id)}
                    />
                    <ProtoBadge protocol={inb.protocol} />
                    <span className="min-w-0 flex-1 truncate font-medium" dir="ltr">
                      {inb.tag}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                      :{inb.port}
                    </span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        inb.status === "online"
                          ? "bg-chart-3"
                          : inb.status === "maintenance"
                            ? "bg-chart-4"
                            : "bg-chart-5"
                      )}
                      aria-hidden="true"
                    />
                  </div>
                ))}
              </div>
              {fieldErr.inboundIds && <p className="text-[11px] text-destructive">{fieldErr.inboundIds}</p>}
              {form.inboundIds.size > 0 && (
                <p className="text-[11px] text-primary/90">
                  {lfmt(u.previewCreate, { n: form.inboundIds.size })}
                </p>
              )}
              <Tip>{u.tipInbounds}</Tip>
            </div>

            {topErr && <p className="text-xs text-destructive">{topErr}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDlgOpen(false)}>
                {u.cancel}
              </Button>
              <Button onClick={() => void save()} disabled={saving} className="glow-cyan min-w-28">
                {saving ? "…" : u.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* delete single */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{u.delTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? lfmt(u.delDesc, { name: deleting.username }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{u.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) void destroy(deleting);
              }}
            >
              {u.bulkDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* bulk delete confirm */}
      <AlertDialog open={bulkConfirm} onOpenChange={setBulkConfirm}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{u.bulkDelTitle}</AlertDialogTitle>
            <AlertDialogDescription>{lfmt(u.bulkDelDesc, { n: sel.size })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{u.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkBusy}
              onClick={(e) => {
                e.preventDefault();
                void runBulk("delete");
              }}
            >
              {u.bulkDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* user drawer */}
      <Sheet open={!!drawerUser} onOpenChange={(v) => !v && setDrawerId(null)}>
        <SheetContent side={rtl ? "left" : "right"} className="glass-strong w-full overflow-y-auto sm:max-w-md">
          {drawerUser && (
            <>
              <SheetHeader className="pb-0">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full text-base font-bold ring-1 ring-border",
                      avatarColor(drawerUser.username)
                    )}
                    aria-hidden="true"
                  >
                    {drawerUser.username.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <SheetTitle className="truncate font-mono text-lg" dir="ltr">
                      {drawerUser.username}
                    </SheetTitle>
                    <SheetDescription className="truncate text-[11px]">
                      {drawerUser.note || u.drawerSub}
                    </SheetDescription>
                  </div>
                  <span
                    className={cn(
                      "ms-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                      STATUS_STYLE[drawerUser.status].ring,
                      STATUS_STYLE[drawerUser.status].text
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_STYLE[drawerUser.status].dot)} aria-hidden="true" />
                    {drawerUser.status === "active"
                      ? u.stActive
                      : drawerUser.status === "expired"
                        ? u.stExpired
                        : drawerUser.status === "capped"
                          ? u.stCapped
                          : u.stDisabled}
                  </span>
                </div>
              </SheetHeader>

              <div className="mt-4 space-y-5 px-4 pb-8">
                {/* subscription */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                    {u.drawerSub}
                  </h4>
                  <div className="flex items-center gap-2 rounded-xl bg-background/50 p-2.5 ring-1 ring-border">
                    <Fingerprint className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <code className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr">
                      {drawerUser.subId}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => window.open(`/sub/${drawerUser.subId}`, "_blank")}
                      aria-label={u.openPage}
                      title={u.openPage}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => void copyText(subLinkFor(drawerUser), u.copySub)}
                      aria-label={u.copySub}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                  <Tip>{u.tipShare}</Tip>
                </div>

                {/* usage */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                    {u.drawerUsage}
                  </h4>
                  <div className="rounded-xl bg-background/50 p-3 ring-1 ring-border">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-mono text-base font-bold text-primary">
                        {fmtGb(drawerUser.usedTrafficGb)}
                      </span>
                      <span className="text-muted-foreground">
                        {drawerUser.trafficLimitGb === null
                          ? u.unlimited
                          : lfmt(u.usedOf, { used: fmtGb(drawerUser.usedTrafficGb), total: fmtGb(drawerUser.trafficLimitGb) })}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          drawerUser.trafficLimitGb !== null &&
                            drawerUser.usedTrafficGb >= drawerUser.trafficLimitGb
                            ? "bg-chart-5"
                            : "bg-primary"
                        )}
                        style={{
                          width:
                            drawerUser.trafficLimitGb !== null
                              ? `${Math.min(100, (drawerUser.usedTrafficGb / drawerUser.trafficLimitGb) * 100)}%`
                              : "8%",
                        }}
                      />
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>
                        {u.colExpiry}:{" "}
                        {drawerUser.expiryDays === null ? (
                          u.expiryNever
                        ) : (
                          (() => {
                            const left = daysLeft(drawerUser.expiryDays, drawerUser.createdAt);
                            return left !== null && left >= 0 ? lfmt(u.expiryLeft, { n: left }) : u.stExpired;
                          })()
                        )}
                      </span>
                      <span>
                        {u.colIp}: {drawerUser.ipLimit === 0 ? u.unlimited : drawerUser.ipLimit}
                      </span>
                      <span>
                        {lfmt(u.devicesCount, { n: drawerUser.devices.length })}
                        {drawerUser.hwidLimit ? ` / ${drawerUser.hwidLimit}` : ""}
                      </span>
                    </div>
                  </div>
                </div>

                {/* linked configs */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                    {u.drawerConfigs} · {drawerUser.accesses.length}
                  </h4>
                  {drawerUser.accesses.length === 0 ? (
                    <p className="rounded-xl bg-background/50 p-3 text-xs text-muted-foreground ring-1 ring-border">
                      {u.drawerNoConfigs}
                    </p>
                  ) : (
                    <div className="max-h-72 space-y-2 overflow-y-auto pe-1">
                      {drawerUser.accesses.map((a) => {
                        const link = accessShareLink(a, drawerUser);
                        return (
                          <div key={a.id} className="rounded-xl bg-background/50 p-3 ring-1 ring-border">
                            <div className="flex items-center gap-2">
                              <ProtoBadge protocol={a.inbound.protocol} />
                              <span className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr">
                                {a.inbound.tag}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                                :{a.inbound.port}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate font-mono" dir="ltr">
                                  {a.email}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <KeyRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate font-mono" dir="ltr">
                                  {a.key.slice(0, 14)}…
                                </span>
                              </div>
                            </div>
                            <div className="mt-2.5 flex gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 flex-1 gap-1 text-[11px]"
                                disabled={!link}
                                onClick={() => void copyText(link ?? "", u.copyLink)}
                              >
                                <Copy className="h-3 w-3" aria-hidden="true" /> {u.copyLink}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 flex-1 gap-1 text-[11px]"
                                onClick={() => void copyText(a.key, u.copyKey)}
                              >
                                <Copy className="h-3 w-3" aria-hidden="true" /> {u.copyKey}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* drawer actions */}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => openEdit(drawerUser)}>
                    <Power className="h-3.5 w-3.5" aria-hidden="true" /> {u.dlgEdit}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1 gap-1.5"
                    onClick={() => setDeleting(drawerUser)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> {u.bulkDelete}
                  </Button>
                </div>

                {/* danger note */}
                <div className="flex items-start gap-2 rounded-xl bg-destructive/5 p-3 text-[11px] text-destructive/80 ring-1 ring-destructive/20">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{u.drawerDanger}</span>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
