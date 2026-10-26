"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Gauge,
  Lightbulb,
  Lock,
  MonitorSmartphone,
  PackagePlus,
  RefreshCw,
  Search,
  SquarePen,
  Store,
  Trash2,
  TriangleAlert,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { sfmt } from "@/lib/i18n/sub-dictionary";
import type { ResellerDTO, TemplateDTO } from "@/lib/resellers";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ResellerPaymentPanel } from "@/components/sephiroth/views/reseller-payment-panel";

/* ============================================================
   Sephiroth · Phase 6 — Resellers view (admin)
   Scoped sellers with quotas + one-click sale templates.
   Two state-driven tabs: Resellers (quota bars, optimistic
   enable switches, delete releases users) and Sale Templates
   (preset grid). Every section carries a plain-language tip;
   all strings come from the 6-language dictionary (resellers
   section). Username is immutable after creation; empty
   password on edit = keep current.
   ============================================================ */

interface ResellerForm {
  username: string;
  password: string;
  note: string;
  maxUsers: string; // "" = unlimited
  quotaGb: string; // "" = unlimited
  enabled: boolean;
}

interface TemplateForm {
  name: string;
  trafficGb: string; // "" = unlimited
  expiryDays: string; // "" = unlimited
  ipLimit: string; // "" = 0 (unlimited)
}

const EMPTY_RESELLER: ResellerForm = {
  username: "",
  password: "",
  note: "",
  maxUsers: "",
  quotaGb: "",
  enabled: true,
};

const EMPTY_TEMPLATE: TemplateForm = {
  name: "",
  trafficGb: "",
  expiryDays: "",
  ipLimit: "",
};

const USERNAME_OK = /^[a-zA-Z0-9_-]{3,32}$/;

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

/* compact GB number: 12.5 → "12.5", 137.2 → "137" */
function fmtGb(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded >= 100 ? String(Math.round(rounded)) : String(rounded);
}

/* percent against a nullable cap; null cap → no bar */
function pctOf(used: number, cap: number | null): number | null {
  if (cap === null) return null;
  if (cap <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, (used / cap) * 100);
}

/* emerald → amber → red past 85% */
function barClass(pct: number | null): string {
  if (pct === null) return "bg-primary";
  if (pct >= 85) return "bg-chart-5";
  if (pct >= 65) return "bg-chart-4";
  return "bg-chart-3";
}

function MiniBar({ pct }: { pct: number | null }) {
  return (
    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", barClass(pct))}
        style={{ width: `${pct === null ? 8 : Math.max(3, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

/* users cell: "n / ∞" without bar when the reseller has no user quota */
function UsersCell({ r }: { r: ResellerDTO }) {
  return (
    <div className="w-[110px]">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]" dir="ltr">
        <span>{r.usersCount}</span>
        <span className="text-muted-foreground">{r.maxUsers === null ? "∞" : r.maxUsers}</span>
      </div>
      {r.maxUsers !== null && <MiniBar pct={pctOf(r.usersCount, r.maxUsers)} />}
    </div>
  );
}

/* traffic cell: allocated vs quota (bar) with used GB as muted subtext */
function TrafficCell({ r }: { r: ResellerDTO }) {
  return (
    <div className="w-[150px]">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]" dir="ltr">
        <span>{fmtGb(r.allocatedGb)} GB</span>
        <span className="text-muted-foreground">
          {r.trafficQuotaGb === null ? "∞" : `${fmtGb(r.trafficQuotaGb)} GB`}
        </span>
      </div>
      {r.trafficQuotaGb !== null && <MiniBar pct={pctOf(r.allocatedGb, r.trafficQuotaGb)} />}
      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground" dir="ltr">
        {fmtGb(r.usedGb)} GB
      </div>
    </div>
  );
}

/* "" → null (unlimited) | number | "invalid" */
function parseNum(s: string): number | null | "invalid" {
  const v = s.trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : "invalid";
}

/* ============================================================ */

export function ResellersView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.resellers;

  const { toast } = useToast();

  const [resellers, setResellers] = useState<ResellerDTO[] | null>(null);
  const [templates, setTemplates] = useState<TemplateDTO[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  /* toolbar */
  const [tab, setTab] = useState<"resellers" | "templates">("resellers");
  const [q, setQ] = useState("");

  /* reseller dialog */
  const [rOpen, setROpen] = useState(false);
  const [rEditing, setREditing] = useState<ResellerDTO | null>(null);
  const [rForm, setRForm] = useState<ResellerForm>(EMPTY_RESELLER);
  const [rErr, setRErr] = useState<Partial<Record<string, string>>>({});
  const [rSaving, setRSaving] = useState(false);

  /* template dialog */
  const [tOpen, setTOpen] = useState(false);
  const [tEditing, setTEditing] = useState<TemplateDTO | null>(null);
  const [tForm, setTForm] = useState<TemplateForm>(EMPTY_TEMPLATE);
  const [tErr, setTErr] = useState<Partial<Record<string, string>>>({});
  const [tSaving, setTSaving] = useState(false);

  /* delete confirms */
  const [rDeleting, setRDeleting] = useState<ResellerDTO | null>(null);
  const [tDeleting, setTDeleting] = useState<TemplateDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const [rr, tr] = await Promise.all([
        fetch("/api/resellers", { cache: "no-store" }),
        fetch("/api/sale-templates", { cache: "no-store" }),
      ]);
      if (!rr.ok || !tr.ok) throw new Error("load");
      const rj = (await rr.json()) as { resellers: ResellerDTO[] };
      const tj = (await tr.json()) as { templates: TemplateDTO[] };
      setResellers(rj.resellers);
      setTemplates(tj.templates);
    } catch {
      setLoadErr(true); // lists stay null → banner instead of content
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- derived ---------- */

  const loading = !loadErr && (resellers === null || templates === null);

  const kpis = useMemo(
    () => ({
      total: resellers?.length ?? 0,
      users: (resellers ?? []).reduce((s, r) => s + r.usersCount, 0),
      templates: templates?.length ?? 0,
    }),
    [resellers, templates]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = [...(resellers ?? [])];
    if (needle) {
      list = list.filter(
        (r) =>
          r.username.toLowerCase().includes(needle) ||
          (r.note ?? "").toLowerCase().includes(needle)
      );
    }
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
  }, [resellers, q]);

  /* ---------- actions ---------- */

  const openResellerCreate = () => {
    setREditing(null);
    setRForm(EMPTY_RESELLER);
    setRErr({});
    setROpen(true);
  };

  const openResellerEdit = (r: ResellerDTO) => {
    setREditing(r);
    setRForm({
      username: r.username,
      password: "",
      note: r.note ?? "",
      maxUsers: r.maxUsers === null ? "" : String(r.maxUsers),
      quotaGb: r.trafficQuotaGb === null ? "" : String(r.trafficQuotaGb),
      enabled: r.enabled,
    });
    setRErr({});
    setROpen(true);
  };

  const saveReseller = async () => {
    setRSaving(true);
    setRErr({});
    const username = rForm.username.trim();
    const password = rForm.password;

    if (!rEditing && !USERNAME_OK.test(username)) {
      setRErr({ username: u.errUsername });
      setRSaving(false);
      return;
    }
    if (password.length > 0 && password.length < 6) {
      setRErr({ password: u.errPassword });
      setRSaving(false);
      return;
    }
    if (!rEditing && password.length < 6) {
      setRErr({ password: u.errPassword });
      setRSaving(false);
      return;
    }
    const maxUsers = parseNum(rForm.maxUsers);
    const trafficQuotaGb = parseNum(rForm.quotaGb);
    if (maxUsers === "invalid" || trafficQuotaGb === "invalid") {
      setRErr({
        maxUsers: maxUsers === "invalid" ? t.inbounds.errGeneric : undefined,
        trafficQuotaGb: trafficQuotaGb === "invalid" ? t.inbounds.errGeneric : undefined,
      });
      setRSaving(false);
      return;
    }

    try {
      const payload: Record<string, unknown> = rEditing
        ? {
            note: rForm.note.trim(),
            enabled: rForm.enabled,
            maxUsers,
            trafficQuotaGb,
            ...(password ? { password } : {}),
          }
        : {
            username,
            password,
            note: rForm.note.trim(),
            enabled: rForm.enabled,
            maxUsers,
            trafficQuotaGb,
          };
      const res = await fetch(rEditing ? `/api/resellers/${rEditing.id}` : "/api/resellers", {
        method: rEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 400 || res.status === 409) {
        const j = (await res.json()) as { fields?: { field: string; code: string }[] };
        const map: Partial<Record<string, string>> = {};
        for (const f of j.fields ?? []) {
          if (f.field === "username") {
            map.username = f.code === "taken" ? u.errTaken : u.errUsername;
          } else if (f.field === "password") {
            map.password = u.errPassword;
          } else {
            map[f.field] = t.inbounds.errGeneric;
          }
        }
        setRErr(map);
        setRSaving(false);
        return;
      }
      if (!res.ok) throw new Error("save");
      await load();
      setROpen(false);
      toast({
        description: rEditing ? u.toastUpdated : `${u.toastCreated} · ${username}`,
      });
    } catch {
      setRErr({ form: t.inbounds.errGeneric });
    }
    setRSaving(false);
  };

  const toggleReseller = async (row: ResellerDTO, enabled: boolean) => {
    setResellers((prev) => (prev ?? []).map((x) => (x.id === row.id ? { ...x, enabled } : x)));
    try {
      const res = await fetch(`/api/resellers/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("toggle");
    } catch {
      setResellers((prev) =>
        (prev ?? []).map((x) => (x.id === row.id ? { ...x, enabled: !enabled } : x))
      );
    }
  };

  const destroyReseller = async (row: ResellerDTO) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/resellers/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      setResellers((prev) => (prev ?? []).filter((x) => x.id !== row.id));
      setRDeleting(null);
      toast({ description: `${u.toastDeleted} · ${row.username}` });
    } catch {
      setRDeleting(null);
    }
    setBusy(false);
  };

  const openTemplateCreate = () => {
    setTEditing(null);
    setTForm(EMPTY_TEMPLATE);
    setTErr({});
    setTOpen(true);
  };

  const openTemplateEdit = (tpl: TemplateDTO) => {
    setTEditing(tpl);
    setTForm({
      name: tpl.name,
      trafficGb: tpl.trafficLimitGb === null ? "" : String(tpl.trafficLimitGb),
      expiryDays: tpl.expiryDays === null ? "" : String(tpl.expiryDays),
      ipLimit: String(tpl.ipLimit),
    });
    setTErr({});
    setTOpen(true);
  };

  const saveTemplate = async () => {
    setTSaving(true);
    setTErr({});
    const name = tForm.name.trim();
    if (!name) {
      setTErr({ name: t.inbounds.errGeneric });
      setTSaving(false);
      return;
    }
    const trafficLimitGb = parseNum(tForm.trafficGb);
    const expiryDays = parseNum(tForm.expiryDays);
    const ipLimit = parseNum(tForm.ipLimit);
    if (trafficLimitGb === "invalid" || expiryDays === "invalid" || ipLimit === "invalid") {
      setTErr({
        trafficGb: trafficLimitGb === "invalid" ? t.inbounds.errGeneric : undefined,
        expiryDays: expiryDays === "invalid" ? t.inbounds.errGeneric : undefined,
        ipLimit: ipLimit === "invalid" ? t.inbounds.errGeneric : undefined,
      });
      setTSaving(false);
      return;
    }

    try {
      const payload = {
        name,
        trafficLimitGb,
        expiryDays,
        ipLimit: ipLimit ?? 0, // empty field = 0 = unlimited devices
      };
      const res = await fetch(
        tEditing ? `/api/sale-templates/${tEditing.id}` : "/api/sale-templates",
        {
          method: tEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (res.status === 400) {
        const j = (await res.json()) as { fields?: { field: string; code: string }[] };
        const map: Partial<Record<string, string>> = {};
        for (const f of j.fields ?? []) {
          map[f.field === "trafficLimitGb" ? "trafficGb" : f.field] = t.inbounds.errGeneric;
        }
        setTErr(map);
        setTSaving(false);
        return;
      }
      if (!res.ok) throw new Error("save");
      await load();
      setTOpen(false);
      toast({ description: tEditing ? u.tToastUpdated : `${u.tToastCreated} · ${name}` });
    } catch {
      setTErr({ name: t.inbounds.errGeneric });
    }
    setTSaving(false);
  };

  const toggleTemplate = async (row: TemplateDTO, enabled: boolean) => {
    setTemplates((prev) => (prev ?? []).map((x) => (x.id === row.id ? { ...x, enabled } : x)));
    try {
      const res = await fetch(`/api/sale-templates/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("toggle");
    } catch {
      setTemplates((prev) =>
        (prev ?? []).map((x) => (x.id === row.id ? { ...x, enabled: !enabled } : x))
      );
    }
  };

  const destroyTemplate = async (row: TemplateDTO) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sale-templates/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      setTemplates((prev) => (prev ?? []).filter((x) => x.id !== row.id));
      setTDeleting(null);
      toast({ description: `${u.tToastDeleted} · ${row.name}` });
    } catch {
      setTDeleting(null);
    }
    setBusy(false);
  };

  /* ---------- render ---------- */

  return (
    <div className="fade-up space-y-6">
      {/* header */}
      <section className="space-y-2">
        <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-primary/90 ring-1 ring-primary/20">
          <Store className="h-3 w-3" aria-hidden="true" />
          {u.badge}
        </span>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">
              {t.nav.resellers}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{u.subtitle}</p>
          </div>
          <Button
            onClick={tab === "templates" ? openTemplateCreate : openResellerCreate}
            className="glow-cyan gap-2"
            aria-label={tab === "templates" ? u.tNew : u.new}
          >
            {tab === "templates" ? (
              <PackagePlus className="h-4 w-4" aria-hidden="true" />
            ) : (
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            )}
            {tab === "templates" ? u.tNew : u.new}
          </Button>
        </div>
        <Tip className="max-w-2xl">{u.tipTab}</Tip>
      </section>

      {/* KPI row */}
      <section className="grid grid-cols-3 gap-3" aria-label={u.kpiTotal}>
        {[
          { label: u.kpiTotal, value: kpis.total, icon: Store, cls: "text-primary" },
          { label: u.kpiUsers, value: kpis.users, icon: UsersRound, cls: "text-chart-3" },
          { label: u.kpiTemplates, value: kpis.templates, icon: PackagePlus, cls: "text-chart-4" },
        ].map(({ label, value, icon: Icon, cls }) => (
          <div key={label} className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
              <span
                className={cn(
                  "glass flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-white/10",
                  cls
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-1.5 font-mono text-2xl font-bold text-foreground md:text-3xl">
              {value}
            </p>
          </div>
        ))}
      </section>

      {/* tabs + search */}
      <section className="space-y-3">
        <div className="glass inline-flex rounded-full p-1 ring-1 ring-white/10" role="group" aria-label={t.nav.resellers}>
          <button
            type="button"
            aria-pressed={tab === "resellers"}
            onClick={() => setTab("resellers")}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              tab === "resellers"
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {u.tabResellers}
          </button>
          <button
            type="button"
            aria-pressed={tab === "templates"}
            onClick={() => setTab("templates")}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              tab === "templates"
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {u.tabTemplates}
          </button>
        </div>
        {tab === "resellers" && (
          <div className="relative max-w-md">
            <Search
              className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={u.searchPh}
              className="h-10 ps-9"
              aria-label={u.searchPh}
            />
          </div>
        )}
        {tab === "templates" && <Tip className="max-w-2xl">{u.tipTemplates}</Tip>}
      </section>

      {/* load error */}
      {loadErr && (
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
            className="ms-auto rounded-full border-white/10 bg-white/[0.03]"
            aria-label="retry"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* ---------------- resellers tab ---------------- */}
      {tab === "resellers" &&
        (loading ? (
          <Skeleton className="h-72 rounded-2xl" />
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center ring-1 ring-white/10">
            <Store className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-4 text-sm font-semibold text-foreground">{u.kpiTotal}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {q.trim() ? u.searchPh : u.subtitle}
            </p>
            {!q.trim() && (
              <Button size="sm" className="mt-4 gap-2" onClick={openResellerCreate}>
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> {u.new}
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* desktop table */}
            <section className="glass hidden overflow-hidden rounded-2xl md:block">
              <div className="max-h-[560px] overflow-y-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 z-10 bg-card/95 text-[11px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                    <tr>
                      <th className="px-3 py-3 text-start font-medium">{u.colReseller}</th>
                      <th className="px-3 py-3 text-start font-medium">{u.colUsers}</th>
                      <th className="px-3 py-3 text-start font-medium">{u.colTraffic}</th>
                      <th className="px-3 py-3 text-start font-medium">{u.colStatus}</th>
                      <th className="px-3 py-3 text-end font-medium">
                        <span className="sr-only">{u.edit}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-t border-border/60 transition-colors hover:bg-primary/[0.03]",
                          !r.enabled && "opacity-60"
                        )}
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-border",
                                avatarColor(r.username)
                              )}
                              aria-hidden="true"
                            >
                              {r.username.slice(0, 1).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium" dir="ltr">
                                {r.username}
                              </div>
                              {r.note && (
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {r.note}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <UsersCell r={r} />
                        </td>
                        <td className="px-3 py-3">
                          <TrafficCell r={r} />
                        </td>
                        <td className="px-3 py-3">
                          <Switch
                            checked={r.enabled}
                            onCheckedChange={(v) => void toggleReseller(r, v)}
                            aria-label={`${u.colStatus} · ${r.username}`}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => openResellerEdit(r)}
                              aria-label={`${u.edit} · ${r.username}`}
                            >
                              <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-chart-5 hover:text-chart-5"
                              onClick={() => setRDeleting(r)}
                              aria-label={`${u.delTitle} · ${r.username}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* mobile cards */}
            <ul className="space-y-3 md:hidden">
              {filtered.map((r) => (
                <li
                  key={r.id}
                  className={cn(
                    "glass hover-glow rounded-2xl p-4 ring-1 ring-white/10",
                    !r.enabled && "opacity-60"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-border",
                          avatarColor(r.username)
                        )}
                        aria-hidden="true"
                      >
                        {r.username.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground" dir="ltr">
                          {r.username}
                        </p>
                        {r.note && (
                          <p className="truncate text-[11px] text-muted-foreground">{r.note}</p>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(v) => void toggleReseller(r, v)}
                      aria-label={`${u.colStatus} · ${r.username}`}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {u.colUsers}
                      </p>
                      <div className="mt-1">
                        <UsersCell r={r} />
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {u.colTraffic}
                      </p>
                      <div className="mt-1">
                        <TrafficCell r={r} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <CalendarDays className="h-3 w-3" aria-hidden="true" />
                      {new Date(r.createdAt).toLocaleDateString(lang)}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => openResellerEdit(r)}
                        aria-label={`${u.edit} · ${r.username}`}
                      >
                        <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-chart-5 hover:text-chart-5"
                        onClick={() => setRDeleting(r)}
                        aria-label={`${u.delTitle} · ${r.username}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ))}

      {/* ---------------- templates tab ---------------- */}
      {tab === "templates" &&
        (loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-2xl" />
            ))}
          </div>
        ) : templates === null ? null : templates.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center ring-1 ring-white/10">
            <PackagePlus className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-4 text-sm font-semibold text-foreground">{u.tEmpty}</p>
            <p className="mt-1 text-xs text-muted-foreground">{u.tEmptyDesc}</p>
            <Button size="sm" className="mt-4 gap-2" onClick={openTemplateCreate}>
              <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" /> {u.tNew}
            </Button>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((tpl) => (
              <li
                key={tpl.id}
                className={cn(
                  "glass hover-glow relative overflow-hidden rounded-2xl p-5 ring-1 ring-white/10",
                  !tpl.enabled && "opacity-60"
                )}
              >
                <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground" dir="auto">
                    {tpl.name}
                  </p>
                  <Switch
                    checked={tpl.enabled}
                    onCheckedChange={(v) => void toggleTemplate(tpl, v)}
                    aria-label={`${u.tEnabled} · ${tpl.name}`}
                  />
                </div>
                <dl className="mt-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Gauge className="h-3 w-3" aria-hidden="true" />
                      {u.tTraffic}
                    </dt>
                    <dd className="font-mono text-xs text-foreground" dir="ltr">
                      {tpl.trafficLimitGb === null ? "∞" : `${fmtGb(tpl.trafficLimitGb)} GB`}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <CalendarDays className="h-3 w-3" aria-hidden="true" />
                      {u.tExpiry}
                    </dt>
                    <dd className="font-mono text-xs text-foreground" dir="ltr">
                      {tpl.expiryDays === null ? "∞" : tpl.expiryDays}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <MonitorSmartphone className="h-3 w-3" aria-hidden="true" />
                      {u.tIpLimit}
                    </dt>
                    <dd className="font-mono text-xs text-foreground" dir="ltr">
                      {tpl.ipLimit === 0 ? "∞" : tpl.ipLimit}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex items-center justify-end gap-1 border-t border-white/5 pt-3">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => openTemplateEdit(tpl)}
                    aria-label={`${u.edit} · ${tpl.name}`}
                  >
                    <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-chart-5 hover:text-chart-5"
                    onClick={() => setTDeleting(tpl)}
                    aria-label={`${u.tDelTitle} · ${tpl.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ))}

      {/* ---------------- reseller create / edit dialog ---------------- */}
      <Dialog open={rOpen} onOpenChange={setROpen}>
        <DialogContent className="glass-strong max-h-[88vh] overflow-y-auto border-white/10 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-silver text-lg font-bold">
              {rEditing ? u.dEditTitle : u.dTitle}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {u.subtitle}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* identity */}
            <div className="space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                {u.colReseller}
              </h3>
              <div className="space-y-1.5">
                <Label
                  htmlFor="res-username"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  {u.dUsername}
                  {rEditing && (
                    <Lock className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
                  )}
                </Label>
                <Input
                  id="res-username"
                  value={rForm.username}
                  disabled={!!rEditing}
                  onChange={(e) => setRForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder={u.dUsernamePh}
                  dir="ltr"
                  autoComplete="off"
                  className="h-10"
                />
                {rErr.username && <p className="text-[11px] text-chart-5">{rErr.username}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-password" className="text-xs text-muted-foreground">
                  {u.dPassword}
                </Label>
                <Input
                  id="res-password"
                  type="password"
                  value={rForm.password}
                  onChange={(e) => setRForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={rEditing ? u.dPasswordKeep : "••••••••"}
                  autoComplete="new-password"
                  className="h-10"
                />
                {rErr.password && <p className="text-[11px] text-chart-5">{rErr.password}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-note" className="text-xs text-muted-foreground">
                  {u.dNote}
                </Label>
                <Input
                  id="res-note"
                  value={rForm.note}
                  onChange={(e) => setRForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder={u.dNotePh}
                  maxLength={200}
                  className="h-10"
                />
              </div>
            </div>

            {/* quotas */}
            <div className="space-y-3 border-t border-white/5 pt-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="res-maxusers" className="text-xs text-muted-foreground">
                    {u.dMaxUsers}
                  </Label>
                  <Input
                    id="res-maxusers"
                    type="number"
                    min="0"
                    value={rForm.maxUsers}
                    onChange={(e) => setRForm((f) => ({ ...f, maxUsers: e.target.value }))}
                    placeholder="∞"
                    className="h-10 font-mono"
                  />
                  {rErr.maxUsers && <p className="text-[11px] text-chart-5">{rErr.maxUsers}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="res-quota" className="text-xs text-muted-foreground">
                    {u.tTraffic}
                  </Label>
                  <Input
                    id="res-quota"
                    type="number"
                    min="0"
                    value={rForm.quotaGb}
                    onChange={(e) => setRForm((f) => ({ ...f, quotaGb: e.target.value }))}
                    placeholder="∞"
                    className="h-10 font-mono"
                  />
                  {rErr.trafficQuotaGb && (
                    <p className="text-[11px] text-chart-5">{rErr.trafficQuotaGb}</p>
                  )}
                </div>
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">{u.dQuotaHint}</p>
              <Tip>{u.tipQuota}</Tip>
            </div>

            {/* enabled + actions */}
            <div className="space-y-4 border-t border-white/5 pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={rForm.enabled}
                  onCheckedChange={(v) => setRForm((f) => ({ ...f, enabled: v }))}
                  aria-label={u.dEnabled}
                />
                {u.dEnabled}
              </label>
              {rErr.form && <p className="text-[11px] text-chart-5">{rErr.form}</p>}
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setROpen(false)}
                  className="h-10 border-white/10 bg-white/[0.03]"
                >
                  {t.users.cancel}
                </Button>
                <Button
                  onClick={() => void saveReseller()}
                  disabled={rSaving}
                  className="glow-cyan h-10 gap-2 bg-primary/90 font-semibold text-black hover:bg-primary"
                >
                  {rSaving ? (
                    <Check className="h-4 w-4 animate-pulse" aria-hidden="true" />
                  ) : rEditing ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {rEditing ? u.save : u.create}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------- template create / edit dialog ---------------- */}
      <Dialog open={tOpen} onOpenChange={setTOpen}>
        <DialogContent className="glass-strong max-h-[88vh] overflow-y-auto border-white/10 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-silver text-lg font-bold">
              {tEditing ? u.edit : u.tNew}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {u.tEmptyDesc}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name" className="text-xs text-muted-foreground">
                {u.tName}
              </Label>
              <Input
                id="tpl-name"
                value={tForm.name}
                onChange={(e) => setTForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={u.tNamePh}
                maxLength={48}
                required
                aria-required="true"
                className="h-10"
              />
              {tErr.name && <p className="text-[11px] text-chart-5">{tErr.name}</p>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-traffic" className="text-xs text-muted-foreground">
                  {u.tTraffic}
                </Label>
                <Input
                  id="tpl-traffic"
                  type="number"
                  min="0"
                  value={tForm.trafficGb}
                  onChange={(e) => setTForm((f) => ({ ...f, trafficGb: e.target.value }))}
                  placeholder="∞"
                  className="h-10 font-mono"
                />
                {tErr.trafficGb && <p className="text-[11px] text-chart-5">{tErr.trafficGb}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-expiry" className="text-xs text-muted-foreground">
                  {u.tExpiry}
                </Label>
                <Input
                  id="tpl-expiry"
                  type="number"
                  min="0"
                  value={tForm.expiryDays}
                  onChange={(e) => setTForm((f) => ({ ...f, expiryDays: e.target.value }))}
                  placeholder="∞"
                  className="h-10 font-mono"
                />
                {tErr.expiryDays && <p className="text-[11px] text-chart-5">{tErr.expiryDays}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-ip" className="text-xs text-muted-foreground">
                  {u.tIpLimit}
                </Label>
                <Input
                  id="tpl-ip"
                  type="number"
                  min="0"
                  value={tForm.ipLimit}
                  onChange={(e) => setTForm((f) => ({ ...f, ipLimit: e.target.value }))}
                  placeholder="0"
                  className="h-10 font-mono"
                />
                <p className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                  0 = ∞
                </p>
                {tErr.ipLimit && <p className="text-[11px] text-chart-5">{tErr.ipLimit}</p>}
              </div>
            </div>
            <Tip>{u.tipTemplates}</Tip>

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setTOpen(false)}
                className="h-10 border-white/10 bg-white/[0.03]"
              >
                {t.users.cancel}
              </Button>
              <Button
                onClick={() => void saveTemplate()}
                disabled={tSaving}
                className="glow-cyan h-10 gap-2 bg-primary/90 font-semibold text-black hover:bg-primary"
              >
                {tSaving ? (
                  <Check className="h-4 w-4 animate-pulse" aria-hidden="true" />
                ) : (
                  <PackagePlus className="h-4 w-4" aria-hidden="true" />
                )}
                {tEditing ? u.save : u.create}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* reseller delete confirm */}
      <AlertDialog open={rDeleting !== null} onOpenChange={(open) => !open && setRDeleting(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-silver">{u.delTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed text-muted-foreground">
              {rDeleting && sfmt(u.delDesc, { name: rDeleting.username })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/[0.03]">
              {t.users.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rDeleting && void destroyReseller(rDeleting)}
              disabled={busy}
              className="gap-1.5 bg-chart-5/90 text-white hover:bg-chart-5"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {u.delConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* template delete confirm */}
      <AlertDialog open={tDeleting !== null} onOpenChange={(open) => !open && setTDeleting(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-silver">{u.tDelTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed text-muted-foreground">
              {tDeleting && sfmt(u.tDelDesc, { name: tDeleting.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/[0.03]">
              {t.users.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => tDeleting && void destroyTemplate(tDeleting)}
              disabled={busy}
              className="gap-1.5 bg-chart-5/90 text-white hover:bg-chart-5"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {u.delConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reseller Payment Gateways & Wallet Hooks */}
      <ResellerPaymentPanel />
    </div>
  );
}
