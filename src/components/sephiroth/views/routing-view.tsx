"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpLeft,
  Ban,
  Bug,
  ChevronDown,
  ChevronUp,
  Globe,
  Hash,
  Info,
  Loader2,
  MapPin,
  Megaphone,
  Network,
  Pencil,
  Plus,
  RadioTower,
  RotateCw,
  Route,
  Save,
  ScanSearch,
  Send,
  ShieldOff,
  Sparkles,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
   Sephiroth · Phase 8 — Routing (traffic rules, admin)
   Ordered xray rules: first match wins. Local editable list
   (reorder/toggle/add/edit/delete) → bulk PUT with a sticky
   save bar while dirty. Rule dialog builds every match family
   (domain/ip/port/network/protocol/inbound/source). Ready presets:
   one-click proven rules feed the same local-dirty save flow. Strings ×6.
   ============================================================ */

type Strategy = "AsIs" | "IPIfNonMatch" | "IPOnDemand";

interface RoutingRuleDTO {
  id: string;
  enabled: boolean;
  comment: string;
  outboundTag: string;
  domain: string[];
  ip: string[];
  port: string;
  network: string; // "" | tcp | udp | tcp,udp
  protocol: string[];
  inboundTag: string[];
  source: string[];
  sortOrder: number;
}

interface RoutingData {
  domainStrategy: string;
  rules: RoutingRuleDTO[];
}

interface RuleForm {
  enabled: boolean;
  comment: string;
  outboundTag: string;
  domainText: string;
  ipText: string;
  port: string;
  network: string; // "" | tcp | udp | tcp,udp
  protocols: string[];
  inboundTags: string[];
  source: string;
}

interface CondChip {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  title: string;
}

const STRATEGIES: readonly Strategy[] = ["AsIs", "IPIfNonMatch", "IPOnDemand"];

const STRATEGY_LABEL: Record<Strategy, keyof Dict["routing"]> = {
  AsIs: "strategyAsIs",
  IPIfNonMatch: "strategyIPIfNonMatch",
  IPOnDemand: "strategyIPOnDemand",
};

const SNIFF: readonly string[] = ["http", "tls", "quic", "bittorrent"];

/* Radix Select forbids value="" — sentinel for the "any" option */
const NET_ANY = "__any__";

const EMPTY_RULE: RuleForm = {
  enabled: true,
  comment: "",
  outboundTag: "",
  domainText: "",
  ipText: "",
  port: "",
  network: "",
  protocols: [],
  inboundTags: [],
  source: "",
};

function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function csvOf(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasCondition(r: {
  domain: string[];
  ip: string[];
  port: string;
  network: string;
  protocol: string[];
  inboundTag: string[];
  source: string[];
}): boolean {
  return Boolean(
    r.domain.length ||
      r.ip.length ||
      r.port ||
      r.network ||
      r.protocol.length ||
      r.inboundTag.length ||
      r.source.length
  );
}

function listChip(values: string[]): { text: string; title: string } {
  const title = values.join(" · ");
  const first = values[0] ?? "";
  const head = first.length > 16 ? `${first.slice(0, 15)}…` : first;
  const text = values.length > 1 ? `${head} +${values.length - 1}` : head;
  return { text, title };
}

function netLabel(network: string, u: Dict["routing"]): string {
  if (network === "tcp") return u.netTcp;
  if (network === "udp") return u.netUdp;
  if (network === "tcp,udp" || network === "udp,tcp") return u.netBoth;
  return network;
}

function obChipCls(tag: string): string {
  if (tag === "direct") return "ring-chart-3/40 bg-chart-3/10 text-chart-3";
  if (tag === "blocked") return "ring-chart-5/40 bg-chart-5/10 text-chart-5";
  return "ring-primary/40 bg-primary/10 text-primary";
}

function obDotCls(tag: string): string {
  if (tag === "direct") return "bg-chart-3";
  if (tag === "blocked") return "bg-chart-5";
  return "bg-primary";
}

function chipsOf(rule: RoutingRuleDTO, u: Dict["routing"]): CondChip[] {
  const chips: CondChip[] = [];
  if (rule.domain.length) {
    const c = listChip(rule.domain);
    chips.push({ icon: Globe, text: c.text, title: c.title });
  }
  if (rule.ip.length) {
    const c = listChip(rule.ip);
    chips.push({ icon: MapPin, text: c.text, title: c.title });
  }
  if (rule.port) {
    chips.push({ icon: Hash, text: rule.port, title: rule.port });
  }
  if (rule.network) {
    chips.push({ icon: Network, text: netLabel(rule.network, u), title: rule.network });
  }
  if (rule.protocol.length) {
    const c = listChip(rule.protocol);
    chips.push({ icon: ScanSearch, text: c.text, title: c.title });
  }
  if (rule.inboundTag.length) {
    const c = listChip(rule.inboundTag);
    chips.push({ icon: RadioTower, text: c.text, title: c.title });
  }
  if (rule.source.length) {
    const c = listChip(rule.source);
    chips.push({ icon: ArrowUpLeft, text: c.text, title: c.title });
  }
  return chips;
}

function toForm(r: RoutingRuleDTO): RuleForm {
  return {
    enabled: r.enabled,
    comment: r.comment,
    outboundTag: r.outboundTag,
    domainText: r.domain.join("\n"),
    ipText: r.ip.join("\n"),
    port: r.port,
    network: r.network,
    protocols: [...r.protocol],
    inboundTags: [...r.inboundTag],
    source: r.source.join(", "),
  };
}

/* ---------- ready presets (one-click proven rules) ---------- */

type PresetKey = "ads" | "porn" | "malware" | "iran" | "quic" | "tg";

interface PresetDef {
  key: PresetKey;
  icon: React.ComponentType<{ className?: string }>;
  payload: Pick<RoutingRuleDTO, "outboundTag" | "domain" | "ip" | "port" | "network">;
}

/* tg.outboundTag is resolved at add-time: first custom outbound */
const PRESETS: readonly PresetDef[] = [
  {
    key: "ads",
    icon: Megaphone,
    payload: {
      outboundTag: "blocked",
      domain: ["geosite:category-ads-all"],
      ip: [],
      port: "",
      network: "",
    },
  },
  {
    key: "porn",
    icon: ShieldOff,
    payload: {
      outboundTag: "blocked",
      domain: ["geosite:category-porn"],
      ip: [],
      port: "",
      network: "",
    },
  },
  {
    key: "malware",
    icon: Bug,
    payload: {
      outboundTag: "blocked",
      domain: ["geosite:category-malware", "geosite:category-phishing"],
      ip: [],
      port: "",
      network: "",
    },
  },
  {
    key: "iran",
    icon: MapPin,
    payload: {
      outboundTag: "direct",
      domain: ["geosite:category-ir", "regexp:.*\\.ir$"],
      ip: ["geoip:ir"],
      port: "",
      network: "",
    },
  },
  {
    key: "quic",
    icon: Network,
    payload: {
      outboundTag: "blocked",
      domain: [],
      ip: [],
      port: "443",
      network: "udp",
    },
  },
  {
    key: "tg",
    icon: Send,
    payload: {
      outboundTag: "",
      domain: ["geosite:telegram"],
      ip: ["geoip:telegram"],
      port: "",
      network: "",
    },
  },
];

export function RoutingView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.routing;
  const { toast } = useToast();

  const [strategy, setStrategy] = useState<Strategy>("AsIs");
  const [rules, setRules] = useState<RoutingRuleDTO[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  /* selects source data */
  const [inboundTags, setInboundTags] = useState<string[]>([]);
  const [outboundTags, setOutboundTags] = useState<string[]>([]);

  /* dirty tracking */
  const [dirty, setDirty] = useState(false);
  const [changes, setChanges] = useState(0);
  const [saving, setSaving] = useState(false);

  /* dialog */
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE);

  /* delete */
  const [delIndex, setDelIndex] = useState<number | null>(null);

  const markDirty = useCallback(() => {
    setDirty(true);
    setChanges((c) => c + 1);
  }, []);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const res = await fetch("/api/routing", { cache: "no-store" });
      if (!res.ok) throw new Error("routing");
      const d = (await res.json()) as RoutingData;
      setStrategy(
        (STRATEGIES as readonly string[]).includes(d.domainStrategy)
          ? (d.domainStrategy as Strategy)
          : "AsIs"
      );
      setRules(d.rules);
      setDirty(false);
      setChanges(0);
    } catch {
      setRules([]);
      setLoadErr(true);
      return;
    }
    /* auxiliary selects — non fatal if they fail */
    try {
      const ir = await fetch("/api/inbounds", { cache: "no-store" });
      if (ir.ok) {
        const d = (await ir.json()) as { inbounds?: { tag?: string }[] };
        setInboundTags(
          (d.inbounds ?? [])
            .map((x) => (typeof x.tag === "string" ? x.tag : ""))
            .filter(Boolean)
        );
      }
    } catch {
      setInboundTags([]);
    }
    try {
      const or = await fetch("/api/outbounds", { cache: "no-store" });
      if (or.ok) {
        const d = (await or.json()) as { outbounds?: { tag?: string }[] };
        setOutboundTags(
          (d.outbounds ?? [])
            .map((x) => (typeof x.tag === "string" ? x.tag : ""))
            .filter(Boolean)
        );
      }
    } catch {
      setOutboundTags([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* first outbound that is neither direct nor blocked — feeds the tg preset */
  const tgTag = useMemo(
    () => outboundTags.find((tag) => tag !== "direct" && tag !== "blocked"),
    [outboundTags]
  );

  /* ---------- derived ---------- */

  const kpis = useMemo(() => {
    const list = rules ?? [];
    return {
      total: list.length,
      active: list.filter((r) => r.enabled).length,
      blocked: list.filter((r) => r.outboundTag === "blocked").length,
      direct: list.filter((r) => r.outboundTag === "direct").length,
    };
  }, [rules]);

  /* ---------- list mutations (local, dirty) ---------- */

  const toggleEnabled = (i: number, enabled: boolean) => {
    setRules((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[i] = { ...next[i], enabled };
      return next;
    });
    markDirty();
  };

  const move = (i: number, dir: -1 | 1) => {
    setRules((prev) => {
      if (!prev) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return next;
    });
    markDirty();
  };

  const removeRule = () => {
    if (delIndex === null) return;
    setRules((prev) => (prev ? prev.filter((_, i) => i !== delIndex) : prev));
    setDelIndex(null);
    markDirty();
    toast({ description: u.deleted });
  };

  /* ---------- rule dialog ---------- */

  const openCreate = () => {
    setEditIndex(null);
    setForm(EMPTY_RULE);
    setDlgOpen(true);
  };

  const openEdit = (i: number) => {
    const list = rules ?? [];
    if (!list[i]) return;
    setEditIndex(i);
    setForm(toForm(list[i]));
    setDlgOpen(true);
  };

  const toggleIn = (key: "protocols" | "inboundTags", value: string, on: boolean) => {
    setForm((f) => {
      const set = new Set(f[key]);
      if (on) set.add(value);
      else set.delete(value);
      return { ...f, [key]: [...set] };
    });
  };

  const applyRule = () => {
    const list = rules ?? [];
    if (!form.outboundTag) {
      toast({ variant: "destructive", description: u.errNeedOutbound });
      return;
    }
    const domain = linesOf(form.domainText);
    const ip = linesOf(form.ipText);
    const source = csvOf(form.source);
    const port = form.port.trim();
    if (!hasCondition({ domain, ip, port, network: form.network, protocol: form.protocols, inboundTag: form.inboundTags, source })) {
      toast({ variant: "destructive", description: u.errNeedCondition });
      return;
    }
    const rule: RoutingRuleDTO = {
      id:
        editIndex !== null && list[editIndex]
          ? list[editIndex].id
          : `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      enabled: form.enabled,
      comment: form.comment.trim().slice(0, 80),
      outboundTag: form.outboundTag,
      domain,
      ip,
      port,
      network: form.network,
      protocol: [...form.protocols],
      inboundTag: [...form.inboundTags],
      source,
      sortOrder: editIndex !== null && list[editIndex] ? list[editIndex].sortOrder : list.length,
    };
    setRules((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      if (editIndex !== null && next[editIndex]) next[editIndex] = rule;
      else next.push(rule);
      return next;
    });
    setDlgOpen(false);
    markDirty();
    if (editIndex === null) toast({ description: u.created });
  };

  /* ---------- ready presets (client-side, local-dirty) ---------- */

  const addPreset = (key: PresetKey) => {
    const def = PRESETS.find((p) => p.key === key);
    if (!def) return;
    const list = rules ?? [];
    let outboundTag = def.payload.outboundTag;
    if (key === "tg") {
      if (!tgTag) {
        toast({ variant: "destructive", description: t.routingPresets.needOb });
        return;
      }
      outboundTag = tgTag;
    }
    const name = t.routingPresets[key];
    if (list.some((r) => r.comment === name)) {
      toast({ description: t.routingPresets.dup });
      return;
    }
    const rule: RoutingRuleDTO = {
      id: `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      enabled: true,
      comment: name,
      outboundTag,
      domain: [...def.payload.domain],
      ip: [...def.payload.ip],
      port: def.payload.port,
      network: def.payload.network,
      protocol: [],
      inboundTag: [],
      source: [],
      sortOrder: list.length,
    };
    setRules((prev) => (prev ? [...prev, rule] : prev));
    markDirty();
    toast({ description: t.routingPresets.added });
  };

  /* ---------- bulk save ---------- */

  const save = async () => {
    const list = rules ?? [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r.outboundTag) {
        toast({ variant: "destructive", description: `#${i + 1} · ${u.errNeedOutbound}` });
        return;
      }
      if (!hasCondition(r)) {
        toast({ variant: "destructive", description: `#${i + 1} · ${u.errNeedCondition}` });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domainStrategy: strategy,
          rules: list.map((r) => ({
            enabled: r.enabled,
            comment: r.comment,
            outboundTag: r.outboundTag,
            domain: r.domain,
            ip: r.ip,
            port: r.port,
            network: r.network,
            protocol: r.protocol,
            inboundTag: r.inboundTag,
            source: r.source,
          })),
        }),
      });
      if (!res.ok) {
        toast({ variant: "destructive", description: t.inbounds.errGeneric });
        setSaving(false);
        return;
      }
      const d = (await res.json()) as RoutingData;
      setStrategy(
        (STRATEGIES as readonly string[]).includes(d.domainStrategy)
          ? (d.domainStrategy as Strategy)
          : "AsIs"
      );
      setRules(d.rules);
      setDirty(false);
      setChanges(0);
      toast({ description: u.saved });
    } catch {
      toast({ variant: "destructive", description: t.inbounds.errGeneric });
    }
    setSaving(false);
  };

  const loading = rules === null;

  /* ---------- render ---------- */

  if (loading) {
    return (
      <div className="fade-up space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
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
          <Route className="h-3 w-3" aria-hidden="true" />
          {u.badge}
        </span>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">
              {t.nav.routing}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{u.subtitle}</p>
          </div>
          <Button onClick={openCreate} className="glow-cyan gap-2" aria-label={u.new}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {u.new}
          </Button>
        </div>
      </section>

      {/* tip banner */}
      <div className="glass max-w-2xl rounded-2xl">
        <p className="flex items-start gap-2 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">{u.tipTitle}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {u.tipBody}
            </span>
          </span>
        </p>
      </div>

      {/* strategy card */}
      <section className="glass rounded-2xl p-5 md:p-6" aria-label={u.strategy}>
        <div className="mb-4 flex items-start gap-3">
          <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
            <Network className="h-4 w-4 text-primary" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{u.strategy}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{u.strategyDesc}</p>
          </div>
        </div>
        <Select
          value={strategy}
          onValueChange={(v) => {
            setStrategy(v as Strategy);
            markDirty();
          }}
        >
          <SelectTrigger className="w-full max-w-md" aria-label={u.strategy}>
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
      </section>

      {/* KPI row */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={u.kpiRules}>
        {[
          { label: u.kpiRules, value: kpis.total, icon: Route, cls: "text-primary" },
          { label: u.kpiActive, value: kpis.active, icon: Zap, cls: "text-chart-4" },
          { label: u.kpiBlocked, value: kpis.blocked, icon: Ban, cls: "text-chart-5" },
          { label: u.kpiDirect, value: kpis.direct, icon: ArrowRight, cls: "text-chart-3" },
        ].map(({ label, value, icon: Icon, cls }) => (
          <div key={label} className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
              <span className={cn("glass flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-white/10", cls)}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-1.5 font-mono text-2xl font-bold text-foreground md:text-3xl">{value}</p>
          </div>
        ))}
      </section>

      {/* ready presets — one-click proven rules */}
      <section className="space-y-3" aria-label={t.routingPresets.title}>
        <div className="flex items-start gap-3">
          <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{t.routingPresets.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t.routingPresets.desc}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PRESETS.map(({ key, icon: Icon, payload }) => {
            const name = t.routingPresets[key];
            const tag = key === "tg" ? (tgTag ?? "") : payload.outboundTag;
            return (
              <div
                key={key}
                className="glass hover-glow group flex min-w-0 flex-col rounded-2xl p-4 ring-1 ring-white/10"
              >
                <div className="flex items-center gap-2.5">
                  <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-white/10 transition-shadow duration-300 group-hover:shadow-[0_0_18px_-4px_var(--primary)]">
                    <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {t.routingPresets[`${key}D`]}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ring-1",
                      obChipCls(tag)
                    )}
                    dir="ltr"
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", obDotCls(tag))} aria-hidden="true" />
                    {tag || "?"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {payload.domain.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-white/10"
                    >
                      <Globe className="h-2.5 w-2.5 shrink-0 text-primary/70" aria-hidden="true" />
                      <span className="font-mono" dir="ltr">
                        {m}
                      </span>
                    </span>
                  ))}
                  {payload.ip.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-white/10"
                    >
                      <MapPin className="h-2.5 w-2.5 shrink-0 text-primary/70" aria-hidden="true" />
                      <span className="font-mono" dir="ltr">
                        {m}
                      </span>
                    </span>
                  ))}
                  {payload.port && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-white/10">
                      <Hash className="h-2.5 w-2.5 shrink-0 text-primary/70" aria-hidden="true" />
                      <span className="font-mono" dir="ltr">
                        {payload.port}
                      </span>
                    </span>
                  )}
                  {payload.network && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-white/10">
                      <Network className="h-2.5 w-2.5 shrink-0 text-primary/70" aria-hidden="true" />
                      <span className="font-mono" dir="ltr">
                        {netLabel(payload.network, u)}
                      </span>
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addPreset(key)}
                  className="mt-3 h-9 shrink-0 gap-1.5 self-start rounded-full border-primary/30 bg-primary/10 px-4 text-xs font-semibold text-primary hover:bg-primary/20 hover:text-primary"
                  aria-label={`${t.routingPresets.add} — ${name}`}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.routingPresets.add}
                </Button>
              </div>
            );
          })}
          {/* Cloudflare WARP+ Clean-IP Preset */}
          <div className="glass hover-glow group flex flex-col rounded-2xl p-4 ring-1 ring-primary/30 bg-primary/[0.03]">
            <div className="flex items-center gap-2.5">
              <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30 transition-shadow duration-300 group-hover:shadow-[0_0_18px_-4px_var(--primary)]">
                <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">
                  {t.routingPresets.warp}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {t.routingPresets.warpD}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ring-1",
                  obChipCls("warp")
                )}
                dir="ltr"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                warp
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {["geosite:openai", "geosite:google", "geosite:netflix", "geosite:spotify"].map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-white/10"
                >
                  <Globe className="h-2.5 w-2.5 shrink-0 text-primary/70" aria-hidden="true" />
                  <span className="font-mono" dir="ltr">
                    {m}
                  </span>
                </span>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const list = rules ?? [];
                const comment = "OpenAI, Google & Streaming via Cloudflare WARP";
                if (list.some((r) => r.comment === comment)) {
                  toast({ description: t.routingPresets.dup });
                  return;
                }
                const rule: RoutingRuleDTO = {
                  id: `tmp-${Date.now().toString(36)}-warp`,
                  enabled: true,
                  comment,
                  outboundTag: outboundTags.includes("warp") ? "warp" : (outboundTags[0] || "direct"),
                  domain: ["geosite:openai", "geosite:google", "geosite:netflix", "geosite:spotify"],
                  ip: [],
                  port: "",
                  network: "",
                  protocol: [],
                  inboundTag: [],
                  source: [],
                  sortOrder: list.length,
                };
                setRules((prev) => (prev ? [...prev, rule] : prev));
                markDirty();
                toast({ description: `${t.routingPresets.added}: ${t.routingPresets.warp}` });
              }}
              className="mt-3 h-9 shrink-0 gap-1.5 self-start rounded-full border-primary/30 bg-primary/10 px-4 text-xs font-semibold text-primary hover:bg-primary/20 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t.routingPresets.add}
            </Button>
          </div>
        </div>
      </section>

      {/* rules list */}
      {rules.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center ring-1 ring-white/10">
          <Route className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-4 text-sm font-semibold text-foreground">{u.empty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{u.emptyDesc}</p>
          <Button onClick={openCreate} className="glow-cyan mt-5 gap-2 rounded-full">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {u.new}
          </Button>
        </div>
      ) : (
        <section className="space-y-3" aria-label={u.kpiRules}>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden="true" />
            {u.orderHint}
          </p>
          <ol className="space-y-3">
            {rules.map((r, i) => {
              const chips = chipsOf(r, u);
              return (
                <li
                  key={r.id}
                  className={cn(
                    "glass hover-glow relative overflow-hidden rounded-2xl p-4 ring-1 ring-white/10",
                    !r.enabled && "opacity-60"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="glass mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold text-primary ring-1 ring-primary/40">
                      {i + 1}
                    </span>
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(v) => toggleEnabled(i, v)}
                      aria-label={u.fieldEnabled}
                      className="mt-1 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-foreground">
                          {r.comment || (
                            <span className="font-normal text-muted-foreground/60">{u.phComment}</span>
                          )}
                        </p>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ring-1",
                            obChipCls(r.outboundTag)
                          )}
                          dir="ltr"
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", obDotCls(r.outboundTag))} />
                          {r.outboundTag || "?"}
                        </span>
                      </div>
                      {chips.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {chips.map((c, ci) => (
                            <span
                              key={ci}
                              title={c.title}
                              className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-white/10"
                            >
                              <c.icon className="h-2.5 w-2.5 shrink-0 text-primary/70" aria-hidden="true" />
                              <span className="truncate font-mono" dir="ltr">
                                {c.text}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={u.moveUp}
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => move(i, 1)}
                        disabled={i === rules.length - 1}
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={u.moveDown}
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(i)}
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={u.edit}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDelIndex(i)}
                        className="h-8 w-8 rounded-full text-muted-foreground hover:bg-chart-5/15 hover:text-chart-5"
                        aria-label={u.del}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* sticky dirty save bar */}
      {dirty && (
        <div className="sticky bottom-4 z-30 flex justify-center pt-2">
          <div
            className="glass-strong flex items-center gap-3 rounded-full px-4 py-2 shadow-lg shadow-black/40 ring-1 ring-primary/30"
            role="status"
            aria-live="polite"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-chart-4" aria-hidden="true" />
            {saving ? (
              <span className="text-xs font-medium text-muted-foreground">{u.saving}</span>
            ) : (
              <span className="font-mono text-sm font-bold text-primary" dir="ltr">
                {changes}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving}
              className="glow-cyan h-8 gap-2 rounded-full px-4"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {u.save}
            </Button>
          </div>
        </div>
      )}

      {/* ── rule dialog ── */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="glass-strong max-h-[90vh] overflow-y-auto rounded-2xl border-white/10 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editIndex !== null ? u.edit : u.new}</DialogTitle>
            <DialogDescription>{u.conditionsDesc}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-white/10">
              <p className="text-sm font-medium text-foreground">{u.fieldEnabled}</p>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                aria-label={u.fieldEnabled}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rl-comment">{u.fieldComment}</Label>
              <Input
                id="rl-comment"
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder={u.phComment}
                maxLength={80}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rl-outbound">{u.fieldOutbound}</Label>
              <Select
                value={form.outboundTag}
                onValueChange={(v) => setForm((f) => ({ ...f, outboundTag: v }))}
              >
                <SelectTrigger id="rl-outbound" className="w-full">
                  <SelectValue placeholder={u.fieldOutbound} />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {outboundTags.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      <span className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", obDotCls(tag))} aria-hidden="true" />
                        <span className="font-mono text-xs" dir="ltr">
                          {tag}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* conditions */}
            <div className="space-y-1.5 border-t border-white/10 pt-4">
              <p className="text-sm font-semibold text-foreground">{u.conditions}</p>
              <p className="text-xs text-muted-foreground">{u.conditionsDesc}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rl-domain">{u.fieldDomain}</Label>
                <Textarea
                  id="rl-domain"
                  dir="ltr"
                  rows={3}
                  className="font-mono text-xs"
                  value={form.domainText}
                  onChange={(e) => setForm((f) => ({ ...f, domainText: e.target.value }))}
                  placeholder={u.phDomain}
                />
                <p className="font-mono text-[10px] leading-relaxed text-muted-foreground" dir="ltr">
                  {u.matchersHint}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rl-ip">{u.fieldIp}</Label>
                <Textarea
                  id="rl-ip"
                  dir="ltr"
                  rows={3}
                  className="font-mono text-xs"
                  value={form.ipText}
                  onChange={(e) => setForm((f) => ({ ...f, ipText: e.target.value }))}
                  placeholder={u.phIp}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rl-port">{u.fieldPort}</Label>
                <Input
                  id="rl-port"
                  dir="ltr"
                  className="font-mono"
                  value={form.port}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, port: e.target.value.replace(/[^0-9,\-]/g, "") }))
                  }
                  placeholder={u.phPort}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rl-network">{u.fieldNetwork}</Label>
                <Select
                  value={form.network || NET_ANY}
                  onValueChange={(v) => setForm((f) => ({ ...f, network: v === NET_ANY ? "" : v }))}
                >
                  <SelectTrigger id="rl-network" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    <SelectItem value={NET_ANY}>{u.netAny}</SelectItem>
                    <SelectItem value="tcp" dir="ltr">
                      {u.netTcp}
                    </SelectItem>
                    <SelectItem value="udp" dir="ltr">
                      {u.netUdp}
                    </SelectItem>
                    <SelectItem value="tcp,udp" dir="ltr">
                      {u.netBoth}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rl-source">{u.fieldSource}</Label>
                <Input
                  id="rl-source"
                  dir="ltr"
                  className="font-mono"
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                  placeholder="10.0.0.0/8, 192.168.0.0/16"
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">{u.fieldProtocol}</p>
              <div className="flex flex-wrap gap-2">
                {SNIFF.map((p) => {
                  const on = form.protocols.includes(p);
                  return (
                    <label
                      key={p}
                      className={cn(
                        "flex h-8 cursor-pointer items-center gap-2 rounded-full px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        on
                          ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                          : "text-muted-foreground ring-1 ring-border hover:bg-white/5 hover:text-foreground"
                      )}
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) => toggleIn("protocols", p, v === true)}
                        aria-label={p}
                        className="h-3.5 w-3.5"
                      />
                      <span className="font-mono" dir="ltr">
                        {p}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {inboundTags.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">{u.fieldInboundTag}</p>
                <div className="flex flex-wrap gap-2">
                  {inboundTags.map((tag) => {
                    const on = form.inboundTags.includes(tag);
                    return (
                      <label
                        key={tag}
                        className={cn(
                          "flex h-8 cursor-pointer items-center gap-2 rounded-full px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                          on
                            ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                            : "text-muted-foreground ring-1 ring-border hover:bg-white/5 hover:text-foreground"
                        )}
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(v) => toggleIn("inboundTags", tag, v === true)}
                          aria-label={tag}
                          className="h-3.5 w-3.5"
                        />
                        <span className="max-w-[160px] truncate font-mono" dir="ltr" title={tag}>
                          {tag}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
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
            <Button onClick={applyRule} className="glow-cyan gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {editIndex !== null ? u.edit : u.new}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── delete confirm ── */}
      <AlertDialog open={delIndex !== null} onOpenChange={(o) => !o && setDelIndex(null)}>
        <AlertDialogContent className="glass-strong rounded-2xl border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>{u.del}</AlertDialogTitle>
            <AlertDialogDescription>
              {delIndex !== null && (rules[delIndex]?.comment || `#${delIndex + 1}`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-white/[0.03]">
              {t.users.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                removeRule();
              }}
              className="bg-chart-5 text-white hover:bg-chart-5/90"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {u.del}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
