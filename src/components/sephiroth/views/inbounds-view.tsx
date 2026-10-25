"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  BadgeCheck,
  CircleCheck,
  Copy,
  EllipsisVertical,
  Fingerprint,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Radar,
  RadioTower,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
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
import { Switch } from "@/components/ui/switch";
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
   Sephiroth · Phase 3R — Inbounds management (redesigned)
   Config source of truth = Prisma (`/api/inbounds`), live stats
   = core-store (socket). The create/edit dialog is Xray-grade:
   General / Clients / Transport / Security / Advanced tabs.
   ============================================================ */

interface InboundClientDTO {
  email: string;
  key: string;
  subId: string;
  flow: string;
  ipLimit: number;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  enabled: boolean;
}

interface InboundDTO {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  listen: string;
  transport: string;
  security: string;
  status: string;
  note: string | null;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  clients: InboundClientDTO[];
  sniffing: { enabled: boolean; destOverride: string[]; routeOnly: boolean };
  stream: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = "all" | "online" | "maintenance" | "disabled";
type ViewMode = "grid" | "table";
type TabId = "general" | "clients" | "transport" | "security" | "advanced";

interface ClientForm {
  email: string;
  key: string;
  subId: string;
  flow: string;
  ipLimit: string;
  trafficLimitGb: string;
  expiryDays: string;
  enabled: boolean;
}

interface FallbackForm {
  name: string;
  dest: string;
  alpn: string;
  path: string;
}

interface FormState {
  tag: string;
  protocol: string;
  port: string;
  listen: string;
  transport: string;
  security: string;
  status: string;
  note: string;
  trafficLimitGb: string;
  expiryDays: string;
  clients: ClientForm[];
  sniffing: { enabled: boolean; destOverride: string[]; routeOnly: boolean };
  mux: boolean;
  fallbacks: FallbackForm[];
  stream: Record<string, string>;
}

const PROTOCOLS = ["vless", "vmess", "trojan", "shadowsocks", "hysteria2"] as const;
const TRANSPORTS = ["tcp", "ws", "grpc", "httpupgrade"] as const;
const STATUSES = ["online", "maintenance", "disabled"] as const;
const FLOWS = ["", "xtls-rprx-vision"] as const;
const SNIFF_DESTS = ["http", "tls", "quic", "fakerd"] as const;
const TLS_VERSIONS = ["", "1.0", "1.1", "1.2", "1.3"] as const;
const FINGERPRINTS = [
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "360",
  "qq",
  "random",
] as const;

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
  if (security === "reality") parts.push("REALITY");
  return parts.join(" · ");
}

function fmtTraffic(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`;
  return `${Math.round(gb)} GB`;
}

/* ---------- id generators (client-side, preview-grade) ---------- */

function b64url(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function genClientKey(protocol: string): string {
  if (protocol === "vless" || protocol === "vmess") {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return b64url(16);
  }
  return b64url(18); // trojan / shadowsocks / hysteria2 password
}

function genSubId(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Preview-grade x25519-style pair (43-char base64url) — visual only. */
function genRealityPair(): { priv: string; pub: string; shortIds: string } {
  return {
    priv: b64url(32),
    pub: b64url(32),
    shortIds: Array.from({ length: 2 }, () =>
      Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("")
    ).join(","),
  };
}

/* ---------- form <-> payload ---------- */

const NUM_STREAM_KEYS = new Set(["maxEarlyData"]);
const BOOL_STREAM_KEYS = new Set(["multiMode", "mux", "allowInsecure"]);

function buildStream(form: FormState): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(form.stream)) {
    if (v === "" || v === undefined || v === null) continue;
    if (NUM_STREAM_KEYS.has(k)) out[k] = Number(v) || 0;
    else if (BOOL_STREAM_KEYS.has(k)) out[k] = v === "true";
    else out[k] = v;
  }
  if (form.security === "tls" || form.security === "reality") {
    out.fingerprint = form.stream.fingerprint || "chrome";
  }
  if (form.transport === "grpc") out.multiMode = form.stream.multiMode === "true";
  out.mux = form.mux;
  const fb = form.fallbacks.filter((f) => f.dest.trim());
  if (fb.length > 0) {
    out.fallbacksJson = JSON.stringify(
      fb.map((f) => ({
        name: f.name.trim() || undefined,
        dest: f.dest.trim(),
        alpn: f.alpn.trim() || undefined,
        path: f.path.trim() || undefined,
      }))
    );
  }
  return out;
}

function buildPayload(form: FormState) {
  return {
    tag: form.tag.trim(),
    protocol: form.protocol,
    port: form.port.trim() === "" ? "" : Number(form.port),
    listen: form.listen.trim(),
    transport: form.transport,
    security: form.security,
    status: form.status,
    note: form.note.trim(),
    trafficLimitGb: form.trafficLimitGb.trim() === "" ? null : Number(form.trafficLimitGb),
    expiryDays: form.expiryDays.trim() === "" ? null : Number(form.expiryDays),
    clients: form.clients.map((c) => ({
      email: c.email.trim(),
      key: c.key.trim(),
      subId: c.subId.trim(),
      flow: form.protocol === "vless" && form.security === "reality" ? c.flow : "",
      ipLimit: c.ipLimit.trim() === "" ? 0 : Number(c.ipLimit),
      trafficLimitGb: c.trafficLimitGb.trim() === "" ? null : Number(c.trafficLimitGb),
      expiryDays: c.expiryDays.trim() === "" ? null : Number(c.expiryDays),
      enabled: c.enabled,
    })),
    sniffing: form.sniffing,
    stream: buildStream(form),
  };
}

function dtoToForm(dto: InboundDTO): FormState {
  const stream: Record<string, string> = {};
  for (const [k, v] of Object.entries(dto.stream ?? {})) {
    stream[k] = BOOL_STREAM_KEYS.has(k) ? String(Boolean(v)) : String(v);
  }
  let fallbacks: FallbackForm[] = [];
  try {
    const raw = stream.fallbacksJson;
    if (raw) {
      const parsed = JSON.parse(raw) as Array<Record<string, string | undefined>>;
      fallbacks = parsed.map((f) => ({
        name: f.name ?? "",
        dest: f.dest ?? "",
        alpn: f.alpn ?? "",
        path: f.path ?? "",
      }));
    }
  } catch {
    fallbacks = [];
  }
  return {
    tag: dto.tag,
    protocol: dto.protocol,
    port: String(dto.port),
    listen: dto.listen ?? "",
    transport: dto.transport,
    security: dto.security,
    status: dto.status,
    note: dto.note ?? "",
    trafficLimitGb: dto.trafficLimitGb === null ? "" : String(dto.trafficLimitGb),
    expiryDays: dto.expiryDays === null ? "" : String(dto.expiryDays),
    clients: (dto.clients ?? []).map((c) => ({
      email: c.email,
      key: c.key,
      subId: c.subId,
      flow: c.flow ?? "",
      ipLimit: String(c.ipLimit ?? 0),
      trafficLimitGb: c.trafficLimitGb === null || c.trafficLimitGb === undefined ? "" : String(c.trafficLimitGb),
      expiryDays: c.expiryDays === null || c.expiryDays === undefined ? "" : String(c.expiryDays),
      enabled: c.enabled,
    })),
    sniffing: {
      enabled: dto.sniffing?.enabled ?? false,
      destOverride: dto.sniffing?.destOverride?.length
        ? dto.sniffing.destOverride
        : ["http", "tls"],
      routeOnly: dto.sniffing?.routeOnly ?? false,
    },
    mux: dto.stream?.mux === true || dto.stream?.mux === "true",
    fallbacks,
    stream,
  };
}

/* ---------- small building blocks ---------- */

function ProtoOrb({ protocol, size = "md" }: { protocol: string; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-10 w-10 text-sm" : "h-9 w-9 text-xs";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl font-mono font-bold ring-1",
        dim,
        PROTO_CLS[protocol] ?? PROTO_CLS.vless
      )}
      aria-hidden="true"
    >
      {(PROTO_LABEL[protocol] ?? protocol).slice(0, 2).toUpperCase()}
    </span>
  );
}

function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 font-mono text-[10px] ring-1",
        accent
          ? "bg-primary/8 text-primary/90 ring-primary/20"
          : "bg-white/5 text-muted-foreground ring-white/10"
      )}
    >
      {children}
    </span>
  );
}

function MiniField({
  id,
  label,
  children,
  error,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-[11px] font-medium text-chart-5">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground/70">{hint}</p>
      ) : null}
    </div>
  );
}

function SecPicker({
  value,
  onChange,
  noneLabel,
  tlsLabel,
  realLabel,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  noneLabel: string;
  tlsLabel: string;
  realLabel: string;
  hint: string;
}) {
  const items = [
    { v: "none", label: noneLabel, icon: CircleCheck },
    { v: "tls", label: tlsLabel, icon: ShieldCheck },
    { v: "reality", label: realLabel, icon: Fingerprint },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={hint}>
        {items.map(({ v, label, icon: Icon }) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "flex h-11 items-center justify-center gap-2 rounded-xl border text-[12px] font-semibold transition-all",
              value === v
                ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_18px_-6px] shadow-primary/40"
                : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/20 hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground/70">{hint}</p>
    </div>
  );
}

/* ============================================================
   Main view
   ============================================================ */

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
  const [protoFilter, setProtoFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  /* create / edit dialog */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InboundDTO | null>(null);
  const [tab, setTab] = useState<TabId>("general");
  const [form, setForm] = useState<FormState>(() => ({
    tag: "",
    protocol: "vless",
    port: "",
    listen: "",
    transport: "tcp",
    security: "none",
    status: "online",
    note: "",
    trafficLimitGb: "",
    expiryDays: "",
    clients: [],
    sniffing: { enabled: false, destOverride: ["http", "tls"], routeOnly: false },
    mux: false,
    fallbacks: [],
    stream: {},
  }));
  const [fieldErr, setFieldErr] = useState<Partial<Record<string, string>>>({});
  const [dupEmails, setDupEmails] = useState<Set<number>>(new Set());
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
    invalid: t.inbounds.errBadValue,
    tooLong: t.inbounds.errBadValue,
    tooMany: t.inbounds.errBadValue,
    dupEmail: t.inbounds.errBadValue,
  };

  /** which tab owns each server-side field error */
  const FIELD_TAB: Record<string, TabId> = {
    tag: "general",
    protocol: "general",
    port: "general",
    listen: "general",
    status: "general",
    note: "general",
    trafficLimitGb: "general",
    expiryDays: "general",
    clients: "clients",
    transport: "transport",
    stream: "transport",
    security: "security",
    sniffing: "advanced",
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
      clients: merged.reduce((acc, r) => acc + (r.clients?.length ?? 0), 0),
    }),
    [merged]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return merged.filter(
      (r) =>
        (statusFilter === "all" || r.status === statusFilter) &&
        (protoFilter === "all" || r.protocol === protoFilter) &&
        (!needle || r.tag.toLowerCase().includes(needle))
    );
  }, [merged, q, statusFilter, protoFilter]);

  /* ---------- mutations ---------- */

  const openCreate = () => {
    const used = new Set((rows ?? []).map((r) => r.port));
    let port = 10000;
    while (used.has(port)) port++;
    setEditing(null);
    setTab("general");
    setForm({
      tag: "",
      protocol: "vless",
      port: String(port),
      listen: "",
      transport: "tcp",
      security: "none",
      status: "online",
      note: "",
      trafficLimitGb: "",
      expiryDays: "",
      clients: [
        {
          email: "",
          key: genClientKey("vless"),
          subId: genSubId(),
          flow: "",
          ipLimit: "0",
          trafficLimitGb: "",
          expiryDays: "",
          enabled: true,
        },
      ],
      sniffing: { enabled: false, destOverride: ["http", "tls"], routeOnly: false },
      mux: false,
      fallbacks: [],
      stream: {},
    });
    setFieldErr({});
    setDupEmails(new Set());
    setTopErr(null);
    setDialogOpen(true);
  };

  const openEdit = (row: InboundDTO) => {
    setEditing(row);
    setTab("general");
    setForm(dtoToForm(row));
    setFieldErr({});
    setDupEmails(new Set());
    setTopErr(null);
    setDialogOpen(true);
  };

  const save = async () => {
    if (saving) return;

    /* local pre-flight */
    const localErrs: Partial<Record<string, string>> = {};
    if (!form.tag.trim()) localErrs.tag = FIELD_ERR.required;
    else if (form.tag.trim().length > 32 || !/^[a-zA-Z0-9_-]+$/.test(form.tag.trim()))
      localErrs.tag = FIELD_ERR.tagFormat;
    const portNum = Number(form.port);
    if (form.port.trim() === "") localErrs.port = FIELD_ERR.portType;
    else if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
      localErrs.port = FIELD_ERR.portRange;

    const dupSet = new Set<number>();
    const seenEmails = new Set<string>();
    form.clients.forEach((c, i) => {
      const email = c.email.trim();
      if (!email || seenEmails.has(email)) dupSet.add(i);
      seenEmails.add(email);
      if (!c.key.trim()) localErrs[`client-${i}-key`] = FIELD_ERR.required;
    });
    setDupEmails(dupSet);

    if (Object.keys(localErrs).length > 0 || dupSet.size > 0) {
      setFieldErr(localErrs);
      setTopErr(t.inbounds.errConfig);
      const firstKey = Object.keys(localErrs)[0];
      const targetTab: TabId =
        dupSet.size > 0 && !firstKey
          ? "clients"
          : FIELD_TAB[firstKey?.startsWith("client-") ? "clients" : (firstKey ?? "general")] ??
            "general";
      setTab(targetTab);
      return;
    }

    setSaving(true);
    setTopErr(null);
    setFieldErr({});
    try {
      const res = await fetch(editing ? `/api/inbounds/${editing.id}` : "/api/inbounds", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
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
        const mapped: Partial<Record<string, string>> = {};
        for (const [k, v] of Object.entries(data.fields)) {
          mapped[k] = FIELD_ERR[v] ?? t.inbounds.errBadValue;
        }
        setFieldErr(mapped);
        setTopErr(t.inbounds.errConfig);
        const firstKey = Object.keys(data.fields)[0];
        setTab(FIELD_TAB[firstKey] ?? "general");
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
        setTab("general");
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
    const first = (row.clients ?? []).find((c) => c.enabled) ?? row.clients?.[0];
    const userPart = first?.key ? `${first.key}@` : "user@";
    const host = row.listen && row.listen !== "0.0.0.0" ? row.listen : "0.0.0.0";
    const params = new URLSearchParams();
    params.set("type", row.transport);
    params.set("security", row.security);
    if (row.stream?.path) params.set("path", String(row.stream.path));
    if (row.stream?.host) params.set("host", String(row.stream.host));
    if (row.stream?.serviceName) params.set("serviceName", String(row.stream.serviceName));
    if (row.stream?.sni) params.set("sni", String(row.stream.sni));
    if (row.stream?.fingerprint) params.set("fp", String(row.stream.fingerprint));
    if (first?.flow) params.set("flow", first.flow);
    const label = first?.email ? `${row.tag} · ${first.email}` : row.tag;
    const link = `${scheme}://${userPart}${host}:${row.port}?${params.toString()}#${encodeURIComponent(label)}`;
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

  const TransportText: Record<string, string> = {
    tcp: t.inbounds.trTcp,
    ws: t.inbounds.trWs,
    grpc: t.inbounds.trGrpc,
    httpupgrade: t.inbounds.trHttpUp,
  };

  const SecurityText: Record<string, string> = {
    none: t.inbounds.secNone,
    tls: t.inbounds.secTls,
    reality: t.inbounds.secReal,
  };

  const KPI = ({
    icon: Icon,
    value,
    label,
  }: {
    icon: LucideIcon;
    value: string;
    label: string;
  }) => (
    <div className="glass hover-glow group relative flex items-center gap-3.5 overflow-hidden rounded-2xl px-4 py-3.5">
      <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        <Icon className="h-4.5 w-4.5 text-primary" />
      </span>
      <div className="min-w-0">
        <p className="truncate font-mono text-lg font-bold leading-tight text-silver tabular-nums">
          {value}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );

  /* ---------- dialog tab renderers ---------- */

  const setS = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const setStream = (key: string, value: string) =>
    setForm((f) => ({ ...f, stream: { ...f.stream, [key]: value } }));

  const renderGeneral = () => (
    <div className="space-y-5">
      {/* protocol picker */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">{t.inbounds.fieldProtocol}</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PROTOCOLS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setS({ protocol: p });
                setForm((f) => ({
                  ...f,
                  clients: f.clients.map((c) => ({
                    ...c,
                    key: genClientKey(p),
                    flow: p === "vless" ? c.flow : "",
                  })),
                }));
              }}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-1 rounded-xl border transition-all",
                form.protocol === p
                  ? "border-primary/40 bg-primary/10 shadow-[0_0_18px_-6px] shadow-primary/40"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
              )}
              aria-pressed={form.protocol === p}
            >
              <ProtoOrb protocol={p} />
              <span
                className={cn(
                  "text-[10px] font-semibold",
                  form.protocol === p ? "text-primary" : "text-muted-foreground"
                )}
              >
                {PROTO_LABEL[p]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MiniField
          id="ib-tag"
          label={t.inbounds.fieldTag}
          error={fieldErr.tag}
          hint={t.inbounds.errTagFormat}
        >
          <Input
            id="ib-tag"
            value={form.tag}
            onChange={(e) => setS({ tag: e.target.value })}
            placeholder={t.inbounds.phTag}
            className="font-mono"
            autoComplete="off"
          />
        </MiniField>

        <MiniField id="ib-port" label={t.inbounds.fieldPort} error={fieldErr.port}>
          <div className="flex gap-2">
            <Input
              id="ib-port"
              value={form.port}
              onChange={(e) => setS({ port: e.target.value })}
              placeholder={t.inbounds.phPort}
              inputMode="numeric"
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const used = new Set((rows ?? []).map((r) => r.port));
                let port = Number(form.port) || 10000;
                while (used.has(port)) port++;
                setS({ port: String(port) });
              }}
              className="shrink-0 gap-1.5 rounded-xl border-white/10 bg-white/[0.03] text-[11px] hover:bg-white/[0.06]"
              title={t.inbounds.randPort}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              {t.inbounds.randPort}
            </Button>
          </div>
        </MiniField>

        <MiniField
          id="ib-listen"
          label={t.inbounds.fieldListen}
          error={fieldErr.listen}
          hint={t.inbounds.listenHint}
        >
          <Input
            id="ib-listen"
            value={form.listen}
            onChange={(e) => setS({ listen: e.target.value })}
            placeholder={t.inbounds.phListen}
            className="font-mono"
            autoComplete="off"
          />
        </MiniField>

        <MiniField id="ib-status" label={t.inbounds.fieldStatus}>
          <Select value={form.status} onValueChange={(v) => setS({ status: v })}>
            <SelectTrigger id="ib-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-strong">
              <SelectItem value="online">{t.inbounds.stOnline}</SelectItem>
              <SelectItem value="maintenance">{t.inbounds.stMaint}</SelectItem>
              <SelectItem value="disabled">{t.inbounds.stDisabled}</SelectItem>
            </SelectContent>
          </Select>
        </MiniField>

        <MiniField
          id="ib-total"
          label={t.inbounds.fieldTotal}
          error={fieldErr.trafficLimitGb}
          hint={t.inbounds.phTotal}
        >
          <Input
            id="ib-total"
            value={form.trafficLimitGb}
            onChange={(e) => setS({ trafficLimitGb: e.target.value })}
            placeholder="0"
            inputMode="decimal"
            className="font-mono"
          />
        </MiniField>

        <MiniField
          id="ib-expiry"
          label={t.inbounds.fieldExpiry}
          error={fieldErr.expiryDays}
          hint={t.inbounds.phExpiry}
        >
          <Input
            id="ib-expiry"
            value={form.expiryDays}
            onChange={(e) => setS({ expiryDays: e.target.value })}
            placeholder="0"
            inputMode="numeric"
            className="font-mono"
          />
        </MiniField>
      </div>

      <MiniField id="ib-note" label={t.inbounds.fieldNote} error={fieldErr.note}>
        <Textarea
          id="ib-note"
          value={form.note}
          onChange={(e) => setS({ note: e.target.value })}
          placeholder={t.inbounds.phNote}
          rows={2}
          className="resize-none"
        />
      </MiniField>
    </div>
  );

  const renderClients = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {lfmt(t.inbounds.clientsCount, { n: form.clients.length })}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setForm((f) => ({
              ...f,
              clients: [
                ...f.clients,
                {
                  email: "",
                  key: genClientKey(f.protocol),
                  subId: genSubId(),
                  flow: "",
                  ipLimit: "0",
                  trafficLimitGb: "",
                  expiryDays: "",
                  enabled: true,
                },
              ],
            }))
          }
          disabled={form.clients.length >= 100}
          className="gap-1.5 rounded-full border-white/10 bg-white/[0.03] text-xs hover:bg-white/[0.06]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.inbounds.addClient}
        </Button>
      </div>

      {form.clients.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-muted-foreground">
          {t.inbounds.errGeneric}
        </div>
      )}

      {form.clients.map((c, i) => {
        const emailDup = dupEmails.has(i);
        const emailBad = fieldErr[`client-${i}-email`];
        const keyErr = fieldErr[`client-${i}-key`];
        return (
          <div
            key={i}
            className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <MiniField
                id={`c-email-${i}`}
                label={t.inbounds.cEmail}
                error={emailDup || emailBad ? t.inbounds.errBadValue : undefined}
              >
                <Input
                  id={`c-email-${i}`}
                  value={c.email}
                  onChange={(e) => {
                    const email = e.target.value;
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, email } : x)),
                    }));
                    setDupEmails((prev) => {
                      const next = new Set(prev);
                      next.delete(i);
                      return next;
                    });
                  }}
                  placeholder={t.inbounds.phEmail}
                  className={cn("font-mono", (emailDup || emailBad) && "border-chart-5/60")}
                  autoComplete="off"
                />
              </MiniField>

              <MiniField
                id={`c-key-${i}`}
                label={t.inbounds.cId}
                error={keyErr}
              >
                <div className="flex gap-1.5">
                  <Input
                    id={`c-key-${i}`}
                    value={c.key}
                    onChange={(e) => {
                      const key = e.target.value;
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) => (j === i ? { ...x, key } : x)),
                      }));
                    }}
                    className="font-mono text-xs"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) =>
                          j === i ? { ...x, key: genClientKey(f.protocol) } : x
                        ),
                      }))
                    }
                    className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground hover:text-primary"
                    title={t.inbounds.genId}
                    aria-label={t.inbounds.genId}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </MiniField>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <MiniField id={`c-sub-${i}`} label={t.inbounds.cSubId}>
                <Input
                  id={`c-sub-${i}`}
                  value={c.subId}
                  onChange={(e) => {
                    const subId = e.target.value;
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, subId } : x)),
                    }));
                  }}
                  placeholder={t.inbounds.phSubId}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </MiniField>

              {form.protocol === "vless" ? (
                <MiniField id={`c-flow-${i}`} label={t.inbounds.cFlow}>
                  <Select
                    value={c.flow || "none"}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) =>
                          j === i ? { ...x, flow: v === "none" ? "" : v } : x
                        ),
                      }))
                    }
                  >
                    <SelectTrigger id={`c-flow-${i}`} className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="glass-strong">
                      <SelectItem value="none">{t.inbounds.flowNone}</SelectItem>
                      <SelectItem value="xtls-rprx-vision">{t.inbounds.flowVision}</SelectItem>
                    </SelectContent>
                  </Select>
                </MiniField>
              ) : (
                <MiniField id={`c-ips-${i}`} label={t.inbounds.cIps} hint={t.inbounds.phIps}>
                  <Input
                    id={`c-ips-${i}`}
                    value={c.ipLimit}
                    onChange={(e) => {
                      const ipLimit = e.target.value;
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) => (j === i ? { ...x, ipLimit } : x)),
                      }));
                    }}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </MiniField>
              )}

              <MiniField
                id={`c-tx-${i}`}
                label={t.inbounds.cTraffic}
              >
                <Input
                  id={`c-tx-${i}`}
                  value={c.trafficLimitGb}
                  onChange={(e) => {
                    const trafficLimitGb = e.target.value;
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, trafficLimitGb } : x)),
                    }));
                  }}
                  placeholder="0"
                  inputMode="decimal"
                  className="font-mono text-xs"
                />
              </MiniField>

              <MiniField id={`c-exp-${i}`} label={t.inbounds.cExpiry}>
                <Input
                  id={`c-exp-${i}`}
                  value={c.expiryDays}
                  onChange={(e) => {
                    const expiryDays = e.target.value;
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, expiryDays } : x)),
                    }));
                  }}
                  placeholder="0"
                  inputMode="numeric"
                  className="font-mono text-xs"
                />
              </MiniField>
            </div>

            {form.protocol === "vless" && (
              <div className="grid gap-3 sm:grid-cols-4">
                <MiniField id={`c-ips2-${i}`} label={t.inbounds.cIps} hint={t.inbounds.phIps}>
                  <Input
                    id={`c-ips2-${i}`}
                    value={c.ipLimit}
                    onChange={(e) => {
                      const ipLimit = e.target.value;
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) => (j === i ? { ...x, ipLimit } : x)),
                      }));
                    }}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </MiniField>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-2.5">
              <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground">
                <Switch
                  checked={c.enabled}
                  onCheckedChange={(enabled) =>
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, enabled } : x)),
                    }))
                  }
                  aria-label={t.inbounds.cEnabled}
                />
                {t.inbounds.cEnabled}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    clients: f.clients.filter((_, j) => j !== i),
                  }))
                }
                className="h-7 gap-1 rounded-full px-2.5 text-[11px] text-muted-foreground hover:bg-chart-5/10 hover:text-chart-5"
              >
                <Trash2 className="h-3 w-3" />
                {t.inbounds.removeClient}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderTransport = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t.inbounds.transportHint}>
        {TRANSPORTS.map((tr) => (
          <button
            key={tr}
            type="button"
            role="radio"
            aria-checked={form.transport === tr}
            onClick={() => setS({ transport: tr })}
            className={cn(
              "flex h-11 items-center justify-center gap-2 rounded-xl border text-[12px] font-semibold transition-all",
              form.transport === tr
                ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_18px_-6px] shadow-primary/40"
                : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/20 hover:text-foreground"
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            {TransportText[tr] ?? tr}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground/70">{t.inbounds.transportHint}</p>

      {form.transport === "tcp" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniField id="st-tcp" label={t.inbounds.tcpType}>
            <Select
              value={form.stream.headerType === "http" ? "http" : "none"}
              onValueChange={(v) => setStream("headerType", v)}
            >
              <SelectTrigger id="st-tcp" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-strong">
                <SelectItem value="none">{t.inbounds.tcpNone}</SelectItem>
                <SelectItem value="http">{t.inbounds.tcpHttp}</SelectItem>
              </SelectContent>
            </Select>
          </MiniField>
          {form.stream.headerType === "http" && (
            <>
              <MiniField id="st-reqpath" label={t.inbounds.reqPath}>
                <Input
                  id="st-reqpath"
                  value={form.stream.requestPath ?? ""}
                  onChange={(e) => setStream("requestPath", e.target.value)}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </MiniField>
              <MiniField id="st-reqhost" label={t.inbounds.reqHost}>
                <Input
                  id="st-reqhost"
                  value={form.stream.requestHost ?? ""}
                  onChange={(e) => setStream("requestHost", e.target.value)}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </MiniField>
            </>
          )}
        </div>
      )}

      {form.transport === "ws" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniField id="st-wspath" label={t.inbounds.wsPath}>
            <Input
              id="st-wspath"
              value={form.stream.path ?? ""}
              onChange={(e) => setStream("path", e.target.value)}
              placeholder={t.inbounds.phWsPath}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-wshost" label={t.inbounds.wsHost}>
            <Input
              id="st-wshost"
              value={form.stream.host ?? ""}
              onChange={(e) => setStream("host", e.target.value)}
              placeholder={t.inbounds.phHost}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-ed" label="Max early data">
            <Input
              id="st-ed"
              value={form.stream.maxEarlyData ?? ""}
              onChange={(e) => setStream("maxEarlyData", e.target.value)}
              placeholder="2048"
              inputMode="numeric"
              className="font-mono text-xs"
            />
          </MiniField>
          <MiniField id="st-edh" label="Early data header">
            <Input
              id="st-edh"
              value={form.stream.earlyDataHeaderName ?? ""}
              onChange={(e) => setStream("earlyDataHeaderName", e.target.value)}
              placeholder="ed=2048"
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
        </div>
      )}

      {form.transport === "grpc" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniField id="st-svc" label={t.inbounds.grpcService}>
            <Input
              id="st-svc"
              value={form.stream.serviceName ?? ""}
              onChange={(e) => setStream("serviceName", e.target.value)}
              placeholder={t.inbounds.phGrpc}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-auth" label={t.inbounds.grpcAuthority}>
            <Input
              id="st-auth"
              value={form.stream.authority ?? ""}
              onChange={(e) => setStream("authority", e.target.value)}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground sm:col-span-2">
            <Switch
              checked={form.stream.multiMode === "true"}
              onCheckedChange={(v) => setStream("multiMode", String(v))}
              aria-label={t.inbounds.grpcMulti}
            />
            {t.inbounds.grpcMulti}
          </label>
        </div>
      )}

      {form.transport === "httpupgrade" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniField id="st-xup" label={t.inbounds.xuPath}>
            <Input
              id="st-xup"
              value={form.stream.path ?? ""}
              onChange={(e) => setStream("path", e.target.value)}
              placeholder={t.inbounds.phWsPath}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-xuh" label={t.inbounds.xuHost}>
            <Input
              id="st-xuh"
              value={form.stream.host ?? ""}
              onChange={(e) => setStream("host", e.target.value)}
              placeholder={t.inbounds.phHost}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
        </div>
      )}
    </div>
  );

  const renderSecurity = () => (
    <div className="space-y-5">
      <SecPicker
        value={form.security}
        onChange={(v) => setS({ security: v })}
        noneLabel={t.inbounds.secNone}
        tlsLabel={t.inbounds.secTls}
        realLabel={t.inbounds.secReal}
        hint={t.inbounds.secHint}
      />

      {form.security === "tls" && (
        <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-silver">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            TLS
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniField id="tls-sni" label={t.inbounds.tlsServerName}>
              <Input
                id="tls-sni"
                value={form.stream.sni ?? ""}
                onChange={(e) => setStream("sni", e.target.value)}
                placeholder={t.inbounds.phSni}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="tls-alpn" label={t.inbounds.alpn} hint={t.inbounds.alpnHint}>
              <Input
                id="tls-alpn"
                value={form.stream.alpn ?? ""}
                onChange={(e) => setStream("alpn", e.target.value)}
                placeholder="h2, http/1.1"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="tls-fp" label={t.inbounds.fingerprint}>
              <Select
                value={form.stream.fingerprint || "chrome"}
                onValueChange={(v) => setStream("fingerprint", v)}
              >
                <SelectTrigger id="tls-fp" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {FINGERPRINTS.map((f) => (
                    <SelectItem key={f} value={f} className="font-mono text-xs">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MiniField>
            <div className="grid grid-cols-2 gap-3">
              <MiniField id="tls-min" label={t.inbounds.minVer}>
                <Select
                  value={form.stream.minVer || "1.2"}
                  onValueChange={(v) => setStream("minVer", v)}
                >
                  <SelectTrigger id="tls-min" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    {TLS_VERSIONS.filter(Boolean).map((v) => (
                      <SelectItem key={v} value={v} className="font-mono text-xs">
                        TLS {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </MiniField>
              <MiniField id="tls-max" label={t.inbounds.maxVer}>
                <Select
                  value={form.stream.maxVer || "1.3"}
                  onValueChange={(v) => setStream("maxVer", v)}
                >
                  <SelectTrigger id="tls-max" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    {TLS_VERSIONS.filter(Boolean).map((v) => (
                      <SelectItem key={v} value={v} className="font-mono text-xs">
                        TLS {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </MiniField>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground sm:col-span-2">
              <Switch
                checked={form.stream.allowInsecure === "true"}
                onCheckedChange={(v) => setStream("allowInsecure", String(v))}
                aria-label={t.inbounds.allowInsecure}
              />
              {t.inbounds.allowInsecure}
            </label>
          </div>

          <div className="space-y-3 border-t border-white/5 pt-3">
            <p className="text-xs font-semibold text-silver">{t.inbounds.certTitle}</p>
            <MiniField id="tls-certpub" label={t.inbounds.certPublic}>
              <Textarea
                id="tls-certpub"
                value={form.stream.certPublic ?? ""}
                onChange={(e) => setStream("certPublic", e.target.value)}
                rows={2}
                className="resize-none font-mono text-[10px]"
              />
            </MiniField>
            <MiniField id="tls-certpriv" label={t.inbounds.certPrivate} hint={t.inbounds.certHint}>
              <Textarea
                id="tls-certpriv"
                value={form.stream.certPrivate ?? ""}
                onChange={(e) => setStream("certPrivate", e.target.value)}
                rows={2}
                className="resize-none font-mono text-[10px]"
              />
            </MiniField>
          </div>
        </div>
      )}

      {form.security === "reality" && (
        <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-silver">
              <Fingerprint className="h-3.5 w-3.5 text-primary" />
              {t.inbounds.realTitle}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const pair = genRealityPair();
                setForm((f) => ({
                  ...f,
                  stream: {
                    ...f.stream,
                    privateKey: pair.priv,
                    publicKey: pair.pub,
                    shortIds: f.stream.shortIds || pair.shortIds,
                  },
                }));
              }}
              className="h-7 gap-1.5 rounded-full border-primary/30 bg-primary/10 px-3 text-[11px] text-primary hover:bg-primary/20"
            >
              <RefreshCcw className="h-3 w-3" />
              {t.inbounds.genKeys}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniField id="r-dest" label={t.inbounds.realDest}>
              <Input
                id="r-dest"
                value={form.stream.dest ?? ""}
                onChange={(e) => setStream("dest", e.target.value)}
                placeholder={t.inbounds.phDest}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-snames" label={t.inbounds.realServerNames}>
              <Input
                id="r-snames"
                value={form.stream.serverNames ?? ""}
                onChange={(e) => setStream("serverNames", e.target.value)}
                placeholder={t.inbounds.phServerNames}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-short" label={t.inbounds.realShortIds}>
              <Input
                id="r-short"
                value={form.stream.shortIds ?? ""}
                onChange={(e) => setStream("shortIds", e.target.value)}
                placeholder={t.inbounds.phShortIds}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-fp" label={t.inbounds.fingerprint}>
              <Select
                value={form.stream.fingerprint || "chrome"}
                onValueChange={(v) => setStream("fingerprint", v)}
              >
                <SelectTrigger id="r-fp" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {FINGERPRINTS.map((f) => (
                    <SelectItem key={f} value={f} className="font-mono text-xs">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MiniField>
            <MiniField id="r-priv" label={t.inbounds.realPriv}>
              <Input
                id="r-priv"
                value={form.stream.privateKey ?? ""}
                onChange={(e) => setStream("privateKey", e.target.value)}
                className="font-mono text-[11px]"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-pub" label={t.inbounds.realPub}>
              <Input
                id="r-pub"
                value={form.stream.publicKey ?? ""}
                onChange={(e) => setStream("publicKey", e.target.value)}
                className="font-mono text-[11px]"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-spider" label={t.inbounds.realSpider}>
              <Input
                id="r-spider"
                value={form.stream.spiderX ?? ""}
                onChange={(e) => setStream("spiderX", e.target.value)}
                placeholder={t.inbounds.phSpider}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
          </div>
        </div>
      )}

      {form.security === "none" && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-4 py-6 text-xs text-muted-foreground">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          {t.inbounds.secHint}
        </div>
      )}
    </div>
  );

  const renderAdvanced = () => (
    <div className="space-y-4">
      {/* sniffing */}
      <div className="space-y-3.5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-silver">
              <Radar className="h-3.5 w-3.5 text-primary" />
              {t.inbounds.sniffTitle}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t.inbounds.sniffDesc}
            </p>
          </div>
          <Switch
            checked={form.sniffing.enabled}
            onCheckedChange={(enabled) =>
              setS({ sniffing: { ...form.sniffing, enabled } })
            }
            aria-label={t.inbounds.sniffOn}
          />
        </div>
        <div
          className={cn(
            "grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-4",
            !form.sniffing.enabled && "pointer-events-none opacity-40"
          )}
          role="group"
          aria-label={t.inbounds.destOverride}
        >
          {SNIFF_DESTS.map((d) => {
            const on = form.sniffing.destOverride.includes(d);
            const label =
              d === "http"
                ? t.inbounds.ovHttp
                : d === "tls"
                  ? t.inbounds.ovTls
                  : d === "quic"
                    ? t.inbounds.ovQuic
                    : t.inbounds.ovFake;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setS({
                    sniffing: {
                      ...form.sniffing,
                      destOverride: on
                        ? form.sniffing.destOverride.filter((x) => x !== d)
                        : [...form.sniffing.destOverride, d],
                    },
                  })
                }
                className={cn(
                  "h-8 rounded-lg border font-mono text-[11px] transition-all",
                  on
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-white/10 bg-white/[0.02] text-muted-foreground hover:border-white/20"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="flex cursor-pointer items-start gap-2.5">
          <Switch
            checked={form.sniffing.routeOnly}
            disabled={!form.sniffing.enabled}
            onCheckedChange={(routeOnly) =>
              setS({ sniffing: { ...form.sniffing, routeOnly } })
            }
            aria-label={t.inbounds.routeOnly}
          />
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="block font-medium text-foreground">{t.inbounds.routeOnly}</span>
            {t.inbounds.routeOnlyDesc}
          </span>
        </label>
      </div>

      {/* mux */}
      <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-silver">
            <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
            Mux
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t.inbounds.muxDesc}</p>
        </div>
        <Switch
          checked={form.mux}
          onCheckedChange={(mux) => setS({ mux })}
          aria-label={t.inbounds.muxOn}
        />
      </div>

      {/* fallbacks */}
      <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <p className="text-xs font-semibold text-silver">{t.inbounds.fallbacks}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t.inbounds.fbHint}</p>
        </div>
        {form.fallbacks.map((fb, i) => (
          <div key={i} className="grid gap-2.5 sm:grid-cols-[1fr_1.2fr_1fr_1fr_auto]">
            <Input
              value={fb.name}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.map((x, j) =>
                    j === i ? { ...x, name: e.target.value } : x
                  ),
                }))
              }
              placeholder={t.inbounds.fbName}
              className="h-9 text-xs"
              aria-label={t.inbounds.fbName}
            />
            <Input
              value={fb.dest}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.map((x, j) =>
                    j === i ? { ...x, dest: e.target.value } : x
                  ),
                }))
              }
              placeholder={t.inbounds.fbDest}
              className="h-9 font-mono text-xs"
              aria-label={t.inbounds.fbDest}
            />
            <Input
              value={fb.alpn}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.map((x, j) =>
                    j === i ? { ...x, alpn: e.target.value } : x
                  ),
                }))
              }
              placeholder={t.inbounds.fbAlpn}
              className="h-9 font-mono text-xs"
              aria-label={t.inbounds.fbAlpn}
            />
            <Input
              value={fb.path}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.map((x, j) =>
                    j === i ? { ...x, path: e.target.value } : x
                  ),
                }))
              }
              placeholder={t.inbounds.fbPath}
              className="h-9 font-mono text-xs"
              aria-label={t.inbounds.fbPath}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.filter((_, j) => j !== i),
                }))
              }
              className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-chart-5/10 hover:text-chart-5"
              aria-label={t.inbounds.removeClient}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setForm((f) => ({
              ...f,
              fallbacks: [...f.fallbacks, { name: "", dest: "", alpn: "", path: "" }],
            }))
          }
          className="gap-1.5 rounded-full border-white/10 bg-white/[0.03] text-xs hover:bg-white/[0.06]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.inbounds.addFallback}
        </Button>
      </div>

      {/* live JSON preview */}
      <details className="group rounded-xl border border-white/10 bg-black/30">
        <summary className="cursor-pointer px-4 py-3 text-[11px] font-semibold tracking-wide text-muted-foreground transition-colors hover:text-foreground">
          Xray JSON · preview
        </summary>
        <pre className="max-h-56 overflow-auto border-t border-white/5 px-4 py-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {JSON.stringify(
            {
              protocol: form.protocol,
              port: Number(form.port) || 0,
              listen: form.listen || "0.0.0.0",
              settings: {
                clients: form.clients.map((c) => ({ email: c.email, id: c.key, flow: c.flow })),
              },
              streamSettings: {
                network: form.transport,
                security: form.security,
                ...buildStream(form),
              },
              sniffing: form.sniffing,
            },
            null,
            2
          )}
        </pre>
      </details>
    </div>
  );

  const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
    { id: "general", label: t.inbounds.tabGeneral, icon: RadioTower },
    { id: "clients", label: t.inbounds.tabClients, icon: Users },
    { id: "transport", label: t.inbounds.tabTransport, icon: Layers },
    { id: "security", label: t.inbounds.tabSecurity, icon: ShieldCheck },
    { id: "advanced", label: t.inbounds.tabAdvanced, icon: SlidersHorizontal },
  ];

  const tabHasError = (id: TabId): boolean =>
    Object.keys(fieldErr).some(
      (k) => FIELD_TAB[k.replace(/-\d+$/, "")] === id || FIELD_TAB[k] === id
    ) || (id === "clients" && dupEmails.size > 0);

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
        <div className="flex items-center gap-2">
          <div
            className="glass flex items-center rounded-full p-1"
            role="group"
            aria-label={t.inbounds.viewGrid}
          >
            {(
              [
                ["grid", t.inbounds.viewGrid, RadioTower],
                ["table", t.inbounds.viewTable, Layers],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                aria-label={label}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  viewMode === mode
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <Button
            onClick={openCreate}
            className="glow-cyan gap-2 rounded-full px-5 font-semibold shadow-lg shadow-primary/20"
          >
            <Plus className="h-4 w-4" />
            {t.inbounds.new}
          </Button>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <KPI icon={RadioTower} value={String(counts.all)} label={t.inbounds.kpiTotal} />
        <KPI icon={Wifi} value={String(counts.online)} label={t.inbounds.kpiOnline} />
        <KPI icon={Users} value={String(totals.users)} label={t.inbounds.kpiUsers} />
        <KPI
          icon={ArrowLeftRight}
          value={fmtTraffic(totals.traffic)}
          label={t.inbounds.kpiTraffic}
        />
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
        <div
          className="glass flex flex-wrap items-center rounded-full p-1"
          role="group"
          aria-label={t.nav.inbounds}
        >
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
        <Select value={protoFilter} onValueChange={setProtoFilter}>
          <SelectTrigger className="h-10 w-40 rounded-full border-white/10 bg-white/[0.04] text-xs" aria-label={t.inbounds.fieldProtocol}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="glass-strong">
            <SelectItem value="all" className="text-xs">
              {t.inbounds.protocolAll}
            </SelectItem>
            {PROTOCOLS.map((p) => (
              <SelectItem key={p} value={p} className="font-mono text-xs">
                {PROTO_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── load error ─────────────────────────────────────── */}
      {loadErr && rows === null && (
        <div className="glass flex items-center gap-3 rounded-2xl border-chart-5/30 px-5 py-4 text-sm text-chart-5">
          <RadioTower className="h-4 w-4 shrink-0" />
          {t.inbounds.loadFail}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="ms-auto rounded-full"
            aria-label="retry"
          >
            ↻
          </Button>
        </div>
      )}

      {/* ── grid / table / empty / loading ─────────────────── */}
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
            <Button
              onClick={openCreate}
              className="glow-cyan mt-6 gap-2 rounded-full px-5 font-semibold"
            >
              <Plus className="h-4 w-4" />
              {t.inbounds.new}
            </Button>
          </div>
        ) : (
          <p className="glass rounded-2xl px-5 py-6 text-center text-sm text-muted-foreground">
            {t.inbounds.noMatch}
          </p>
        )
      ) : viewMode === "grid" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((row) => (
            <article
              key={row.id}
              className="glass hover-glow fade-up group relative flex flex-col gap-3.5 overflow-hidden rounded-2xl p-5"
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              />
              {/* proto + status */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <ProtoOrb protocol={row.protocol} />
                  <span
                    className={cn(
                      "font-mono text-[11px] font-bold tracking-wider",
                      row.protocol === "vless"
                        ? "text-primary"
                        : row.protocol === "vmess"
                          ? "text-chart-2"
                          : row.protocol === "trojan"
                            ? "text-chart-4"
                            : row.protocol === "hysteria2"
                              ? "text-chart-5"
                              : "text-silver"
                    )}
                  >
                    {PROTO_LABEL[row.protocol] ?? row.protocol.toUpperCase()}
                  </span>
                </div>
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
                  {row.listen && row.listen !== "0.0.0.0" && (
                    <span className="font-mono text-[10px] text-muted-foreground/70">
                      @ {row.listen}
                    </span>
                  )}
                </p>
              </div>

              {/* chips */}
              <div className="flex flex-wrap gap-1.5">
                <Chip>{TransportText[row.transport] ?? row.transport}</Chip>
                <Chip accent={row.security !== "none"}>
                  {SecurityText[row.security] ?? row.security}
                </Chip>
                {(row.clients?.length ?? 0) > 0 && (
                  <Chip>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-2.5 w-2.5" />
                      {row.clients.length}
                    </span>
                  </Chip>
                )}
                {row.trafficLimitGb !== null && <Chip>≤ {fmtTraffic(row.trafficLimitGb)}</Chip>}
                {row.expiryDays !== null && <Chip>{row.expiryDays}d</Chip>}
                {row.note && (
                  <Chip accent>
                    <span className="max-w-40 truncate" title={row.note}>
                      {row.note}
                    </span>
                  </Chip>
                )}
              </div>

              {/* live stats */}
              <div className="mt-auto grid grid-cols-2 gap-3 border-t border-white/5 pt-3.5">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t.inbounds.usersLabel}
                  </p>
                  <p className="font-mono text-base font-bold text-silver tabular-nums">
                    {row.users}
                  </p>
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
          ))}
        </div>
      ) : (
        /* ── table view ── */
        <div className="glass overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-white/5 text-start text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblTag}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblProto}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblPort}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblSec}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblClients}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblTraffic}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblStatus}</th>
                <th className="px-4 py-3 text-end font-medium">{t.inbounds.tblActions}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.03]"
                >
                  <td className="max-w-44 px-4 py-3">
                    <p className="truncate font-mono text-xs font-semibold text-silver">{row.tag}</p>
                    {row.note && (
                      <p className="truncate text-[10px] text-muted-foreground">{row.note}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ring-1",
                        PROTO_CLS[row.protocol] ?? PROTO_CLS.vless
                      )}
                    >
                      {PROTO_LABEL[row.protocol] ?? row.protocol.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-silver">{row.port}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {TransportText[row.transport]} · {SecurityText[row.security]}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {row.clients?.length ?? 0}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-silver">
                    {fmtTraffic(row.txGb)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          STATUS_DOT[row.status],
                          row.status === "online" && "animate-pulse"
                        )}
                      />
                      {StatusText[row.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void copyLink(row)}
                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={t.inbounds.copyLink}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(row)}
                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={t.inbounds.edit}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(row)}
                        className="h-7 w-7 rounded-full text-muted-foreground hover:bg-chart-5/10 hover:text-chart-5"
                        aria-label={t.inbounds.deleteAction}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── create / edit dialog (Xray-grade) ──────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-strong flex max-h-[90vh] flex-col gap-0 overflow-hidden border-white/10 p-0 sm:max-w-[920px]">
          <DialogHeader className="border-b border-white/5 px-5 py-4 text-start md:px-6">
            <DialogTitle className="flex items-center gap-3 text-silver">
              <span className="glass flex h-9 w-9 items-center justify-center rounded-xl">
                <RadioTower className="h-4 w-4 text-primary" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base">
                  {editing ? t.inbounds.dialogEdit : t.inbounds.dialogCreate}
                </span>
                <DialogDescription className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
                  {t.inbounds.dlgSub}
                </DialogDescription>
              </span>
              <span
                className={cn(
                  "ms-auto hidden shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold ring-1 sm:block",
                  PROTO_CLS[form.protocol] ?? PROTO_CLS.vless
                )}
              >
                {composeProto(form.protocol, form.transport, form.security)}
              </span>
            </DialogTitle>
          </DialogHeader>

          {/* mobile tab chips */}
          <div className="flex gap-1.5 overflow-x-auto px-4 pt-3 md:hidden" role="tablist">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-colors",
                  tab === id
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
                {tabHasError(id) && (
                  <span className="absolute end-1.5 top-1 h-1.5 w-1.5 rounded-full bg-chart-5" />
                )}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1">
            {/* desktop tab rail */}
            <div className="hidden w-48 shrink-0 flex-col gap-1 border-e border-white/5 p-3 md:flex" role="tablist">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "relative flex h-10 items-center gap-2.5 rounded-xl px-3 text-[12px] font-medium transition-colors",
                    tab === id
                      ? "bg-primary/12 text-primary ring-1 ring-primary/25"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  {tabHasError(id) && (
                    <span className="absolute end-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-chart-5" />
                  )}
                </button>
              ))}

              <div className="mt-auto space-y-2 px-2 pb-1">
                {editing && (
                  <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                    <BadgeCheck className="me-1 inline h-3 w-3 text-primary" />
                    {editing.tag} · {editing.updatedAt.slice(0, 10)}
                  </p>
                )}
              </div>
            </div>

            {/* content */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
              {topErr && (
                <p className="mb-4 rounded-xl bg-chart-5/10 px-3.5 py-2.5 text-xs font-medium text-chart-5 ring-1 ring-chart-5/30">
                  {topErr}
                </p>
              )}
              {tab === "general" && renderGeneral()}
              {tab === "clients" && renderClients()}
              {tab === "transport" && renderTransport()}
              {tab === "security" && renderSecurity()}
              {tab === "advanced" && renderAdvanced()}
            </div>
          </div>

          <DialogFooter className="border-t border-white/5 px-5 py-3.5 md:px-6">
            <div className="flex w-full items-center justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {saving ? t.inbounds.saving : ""}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  className="rounded-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                >
                  {t.inbounds.cancel}
                </Button>
                <Button
                  onClick={() => void save()}
                  disabled={saving}
                  className="glow-cyan min-w-32 gap-2 rounded-full font-semibold"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                  {saving ? t.inbounds.saving : t.inbounds.save}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── delete confirm ─────────────────────────────────── */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-silver">{t.inbounds.delTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {lfmt(t.inbounds.delDesc, {
                tag: deleting?.tag ?? "",
                port: String(deleting?.port ?? ""),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-white/[0.03]">
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
              {deleteBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t.inbounds.delete
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
