"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Check,
  CircleAlert,
  CircleCheck,
  CircleX,
  Copy,
  Loader2,
  RadioTower,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dictionaries, type Dict } from "@/lib/i18n/dictionaries";
import { lfmt } from "@/lib/i18n/live-strings";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Task 25-b — One-Port Autopilot WIZARD (frontend)

   Three-step Dialog over the frozen POST /api/inbounds/autopilot
   contract:  1) Source (clone a template | multi-protocol pick)
              2) Plan  (live ports / engine / users, all client-side)
              3) Launch (single POST → live checklist → final report)
   Kept OUT of the giant inbounds-view.tsx on purpose.
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

interface AutopilotLink {
  tag: string;
  protocol: string;
  port: number;
  link: string | null;
  text: string;
  extra: string | null;
}

interface AutopilotResult {
  created: InboundDTO[];
  /** Task 4-b — single-port mode also returns the mutated MAIN inbound */
  main?: InboundDTO;
  links: AutopilotLink[];
  warnings: string[];
}

type RowState = "spin" | "ok" | "fail";
type Phase = "form" | "launching" | "report" | "error";
type EngineKey = "xray" | "sing" | "mtg" | "sidecar" | "awg";

type Inb = Dict["inbounds"];

/* protocol palette — mirrors inbounds-view.tsx (kept local: the view's
   constants are module-private and importing the view would be circular) */
const PROTOCOLS = [
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "hysteria2",
  "tuic",
  "wireguard",
  "dokodemo-door",
  "socks",
  "http",
  "mixed",
  "mtproto",
  "amnezia-wg",
] as const;

const PROTO_LABEL: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria2: "Hysteria2",
  tuic: "TUIC",
  wireguard: "WireGuard",
  "dokodemo-door": "Dokodemo",
  socks: "SOCKS",
  http: "HTTP",
  mixed: "Mixed",
  mtproto: "MTProto",
  "amnezia-wg": "AmneziaWG",
};

const PROTO_CLS: Record<string, string> = {
  vless: "bg-primary/10 text-primary ring-primary/30",
  vmess: "bg-[#8b8cf8]/10 text-[#8b8cf8] ring-[#8b8cf8]/30",
  trojan: "bg-chart-4/10 text-chart-4 ring-chart-4/30",
  shadowsocks: "bg-chart-3/10 text-chart-3 ring-chart-3/30",
  hysteria2: "bg-chart-5/10 text-chart-5 ring-chart-5/30",
  tuic: "bg-[#2dd4bf]/10 text-[#2dd4bf] ring-[#2dd4bf]/30",
  wireguard: "bg-[#c084fc]/10 text-[#c084fc] ring-[#c084fc]/30",
  "dokodemo-door": "bg-[#f472b6]/10 text-[#f472b6] ring-[#f472b6]/30",
  socks: "bg-[#fde047]/10 text-[#fde047] ring-[#fde047]/30",
  http: "bg-[#fb923c]/10 text-[#fb923c] ring-[#fb923c]/30",
  mixed: "bg-[#38bdf8]/10 text-[#38bdf8] ring-[#38bdf8]/30",
  mtproto: "bg-[#f59e0b]/10 text-[#f59e0b] ring-[#f59e0b]/30",
  "amnezia-wg": "bg-[#a3e635]/10 text-[#a3e635] ring-[#a3e635]/30",
};

/* per-protocol accent color (css color string) — used for the selected
   chip glow, same visual language as the view's PROTO_VAR hover glows */
const PROTO_VAR: Record<string, string> = {
  vless: "var(--primary)",
  vmess: "#8b8cf8",
  trojan: "var(--chart-4)",
  shadowsocks: "var(--chart-3)",
  hysteria2: "var(--chart-5)",
  tuic: "#2dd4bf",
  wireguard: "#c084fc",
  "dokodemo-door": "#f472b6",
  socks: "#fde047",
  http: "#fb923c",
  mixed: "#38bdf8",
  mtproto: "#f59e0b",
  "amnezia-wg": "#a3e635",
};

/* engine attribution — mirrors the autopilot route semantics */
const ENGINE_OF: Record<string, { label: string; key: EngineKey }> = {
  vless: { label: "Xray", key: "xray" },
  vmess: { label: "Xray", key: "xray" },
  trojan: { label: "Xray", key: "xray" },
  shadowsocks: { label: "Xray", key: "xray" },
  "dokodemo-door": { label: "Xray", key: "xray" },
  socks: { label: "Xray", key: "xray" },
  http: { label: "Xray", key: "xray" },
  hysteria2: { label: "sing-box", key: "sing" },
  tuic: { label: "sing-box", key: "sing" },
  mixed: { label: "sing-box", key: "sing" },
  mtproto: { label: "mtg", key: "mtg" },
  "amnezia-wg": { label: "awg", key: "awg" },
  wireguard: { label: "sidecar", key: "sidecar" },
};

const ENGINE_SUB: Record<EngineKey, keyof Inb> = {
  xray: "autopilotEngineXray",
  sing: "autopilotEngineSing",
  mtg: "autopilotEngineMtg",
  sidecar: "autopilotEngineSidecar",
  awg: "autopilotEngineSidecar",
};

/** protocols that can sit behind TLS stream settings (route parity) */
const TLS_OK = new Set(["vless", "vmess", "trojan", "shadowsocks"]);

/** preferred public ports, then 10000+ — client mirror of allocatePorts() */
const PREFERRED_PORTS = [443, 8443, 2053, 2083, 2087];

/** sensible default fleet (multi mode preselect) */
const DEFAULT_PROTOS = ["vless", "mtproto", "mixed"];

function allocPorts(count: number, used: Set<number>, portStart?: number): number[] {
  const seq: number[] = [];
  if (portStart && Number.isInteger(portStart) && portStart >= 1 && portStart <= 65535) {
    seq.push(portStart);
  } else {
    seq.push(...PREFERRED_PORTS);
  }
  let p = seq.length ? (seq[seq.length - 1]! < 10000 ? 10000 : seq[seq.length - 1]! + 1) : 10000;
  while (seq.length < count + 64) {
    seq.push(p);
    p++;
  }
  const out: number[] = [];
  for (const c of seq) {
    if (out.length >= count) break;
    if (!used.has(c) && !out.includes(c)) out.push(c);
  }
  return out.slice(0, count);
}

/* ---------- small building blocks ---------- */

function ProtoChip({ proto, className }: { proto: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-lg px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide ring-1",
        PROTO_CLS[proto] ?? PROTO_CLS.vless,
        className
      )}
    >
      {PROTO_LABEL[proto] ?? proto.toUpperCase()}
    </span>
  );
}

/** accent-glowing toggleable protocol chip (44px touch target) */
function ProtoToggle({
  proto,
  on,
  disabled,
  badge,
  onToggle,
  label,
}: {
  proto: string;
  on: boolean;
  disabled?: boolean;
  badge?: string;
  onToggle: () => void;
  label: string;
}) {
  const accent = PROTO_VAR[proto] ?? PROTO_VAR.vless;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      aria-label={`${label}${disabled ? ` · ${badge ?? ""}` : ""}`}
      style={
        on
          ? {
              borderColor: `color-mix(in srgb, ${accent} 55%, transparent)`,
              boxShadow: `0 0 22px -8px ${accent}`,
              color: accent,
              backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
            }
          : undefined
      }
      className={cn(
        "relative flex min-h-11 select-none items-center justify-center gap-1.5 rounded-xl border px-2 text-[11px] font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on
          ? "border-transparent"
          : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/20 hover:text-foreground",
        disabled && "cursor-not-allowed opacity-45"
      )}
    >
      {on && <Check aria-hidden="true" className="h-3 w-3 shrink-0" />}
      <span className="truncate">{PROTO_LABEL[proto] ?? proto}</span>
      {badge && (
        <span className="absolute -top-2 end-1 rounded-full bg-[#f59e0b] px-1.5 text-[8px] font-bold leading-4 text-black">
          {badge}
        </span>
      )}
    </button>
  );
}

/* ============================================================
   Wizard
   ============================================================ */

export function InboundsAutopilot({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const s = t.inbounds;
  const { toast } = useToast();

  /* data (self-contained — fetched from GET /api/inbounds on open) */
  const [rows, setRows] = useState<InboundDTO[] | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);

  /* wizard state */
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<"clone" | "multi" | "single">("multi");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [cloneProtos, setCloneProtos] = useState<string[]>([]);
  const [multiProtos, setMultiProtos] = useState<string[]>([...DEFAULT_PROTOS]);
  const [singleMainId, setSingleMainId] = useState<string | null>(null);
  const [portStartRaw, setPortStartRaw] = useState("");
  const [tls, setTls] = useState(false);
  const [shareUsers, setShareUsers] = useState(false);
  const [portOverrides, setPortOverrides] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("form");
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [result, setResult] = useState<AutopilotResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* reset + fetch existing inbounds whenever the dialog opens */
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setMode("multi");
    setTemplateId(null);
    setCloneProtos([]);
    setMultiProtos([...DEFAULT_PROTOS]);
    setSingleMainId(null);
    setPortStartRaw("");
    setTls(false);
    setShareUsers(false);
    setPortOverrides({});
    setPhase("form");
    setRowStates({});
    setResult(null);
    setCopiedKey(null);
    let alive = true;
    setRows(null);
    setRowsLoading(true);
    fetch("/api/inbounds", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { inbounds?: InboundDTO[] }) => {
        if (alive) setRows(d.inbounds ?? []);
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setRowsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  /* clear the copy flash timer on unmount */
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const template = useMemo(
    () => (rows ?? []).find((r) => r.id === templateId) ?? null,
    [rows, templateId]
  );

  /* Task 4-b — single-port mode: only inbounds that can HOST a fallback
     (vless|trojan + tls + tcp — the server 400s on anything else, so the
     picker stays honest) */
  const singleCandidates = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (r.protocol === "vless" || r.protocol === "trojan") &&
          r.security === "tls" &&
          r.transport === "tcp"
      ),
    [rows]
  );
  const singleMain = useMemo(
    () => singleCandidates.find((r) => r.id === singleMainId) ?? null,
    [singleCandidates, singleMainId]
  );
  /* the complementary protocol is NOT a free choice — shown, never picked */
  const complementProto = singleMain ? (singleMain.protocol === "vless" ? "trojan" : "vless") : null;

  /* canonical protocol order (drives plan rows + the request payload) */
  const canonical = useMemo(() => {
    if (mode === "single") return complementProto ? [complementProto] : [];
    return PROTOCOLS.filter((p) => (mode === "clone" ? cloneProtos : multiProtos).includes(p));
  }, [mode, cloneProtos, multiProtos, complementProto]);

  const portStartNum = useMemo(() => {
    const n = Number(portStartRaw.trim());
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
  }, [portStartRaw]);

  /* auto-allocated defaults — recomputed when the fleet changes */
  const defPorts = useMemo(() => {
    const used = new Set((rows ?? []).map((r) => r.port));
    const ports = allocPorts(canonical.length, used, portStartNum ?? undefined);
    const m: Record<string, number> = {};
    canonical.forEach((proto, i) => {
      m[proto] = ports[i] ?? 0;
    });
    return m;
  }, [rows, canonical, portStartNum]);

  /* live plan + validation — an emptied port field is an error, never a
     silent fallback (honest plan before one atomic POST) */
  const plan = useMemo(() => {
    // single-port mode: the fallback rides the MAIN's public port — the
    // internal listener port is allocated server-side (44301+) and is
    // intentionally NOT an editable field
    if (mode === "single") {
      return singleMain && complementProto
        ? [{ proto: complementProto, port: singleMain.port, err: null as "range" | "dup" | null }]
        : [];
    }
    const seen = new Set<number>();
    return canonical.map((proto) => {
      const raw = portOverrides[proto];
      const v = raw === undefined ? defPorts[proto] : Number(raw);
      const valid = raw !== "" && Number.isInteger(v) && v >= 1 && v <= 65535;
      let err: "range" | "dup" | null = valid ? null : "range";
      if (valid) {
        if (seen.has(v as number)) err = "dup";
        else seen.add(v as number);
      }
      return { proto, port: valid ? (v as number) : null, err };
    });
  }, [mode, singleMain, complementProto, canonical, portOverrides, defPorts]);

  const planValid = plan.length > 0 && plan.every((r) => r.err === null);
  const plannedPorts = plan.filter((r) => r.port !== null).map((r) => r.port as number);
  const canContinue =
    mode === "clone"
      ? !!templateId && cloneProtos.length > 0
      : mode === "single"
        ? !!singleMainId
        : multiProtos.length > 0;
  const existingProtos = useMemo(() => new Set((rows ?? []).map((r) => r.protocol)), [rows]);
  const busy = phase === "launching";

  /* ---------- actions ---------- */

  const copyText = async (key: string, text: string, withToast = false) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedKey(null), 1500);
      if (withToast) toast({ title: s.toastCopied });
    } catch {
      toast({ title: s.toastFail, variant: "destructive" });
    }
  };

  const errTitle = (code?: string): string => {
    if (code === "unauthorized") return s.autopilotErrAuth;
    if (code === "template_not_found") return s.autopilotErrTpl;
    if (code === "duplicate_port" || code === "no_free_ports") return s.autopilotErrPorts;
    if (code === "validation") return s.autopilotErrValidation;
    if (code === "no_protocols") return s.autopilotErrNoProto;
    if (
      code === "single_mode_main_invalid" ||
      code === "main_not_found" ||
      code === "main_stream_unparseable"
    )
      return s.autopilotErrMainInvalid;
    return s.autopilotErrGeneric;
  };

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const tp = (rows ?? []).find((r) => r.id === id)?.protocol;
    setCloneProtos((prev) => {
      const base = prev.length ? prev : [...DEFAULT_PROTOS];
      return base.filter((p) => p !== tp);
    });
  };

  const launch = async () => {
    if (!planValid || busy || step !== 2) return;
    const protocols = canonical;
    const body =
      mode === "single"
        ? {
            mode: "single",
            mainInboundId: singleMainId ?? undefined,
            protocol: complementProto ?? undefined,
          }
        : mode === "clone"
          ? { mode: "clone", templateId: templateId ?? undefined, protocols, portStart: portStartNum ?? undefined }
          : {
              mode: "multi",
              protocols,
              portStart: portStartNum ?? undefined,
              shareUsers,
              tls,
            };
    setPhase("launching");
    setStep(3);
    setRowStates(Object.fromEntries(protocols.map((p) => [p, "spin" as RowState])));
    setResult(null);
    try {
      const res = await fetch("/api/inbounds/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        created?: InboundDTO[];
        main?: InboundDTO;
        links?: AutopilotLink[];
        warnings?: string[];
        error?: string;
      };
      // 201 = built · 200 = idempotent replay (already_fallbacked) — both render
      if ((res.status === 201 || res.status === 200) && Array.isArray(data.created)) {
        const created = data.created;
        const states: Record<string, RowState> = {};
        for (const p of protocols) states[p] = created.some((c) => c.protocol === p) ? "ok" : "fail";
        setRowStates(states);
        setResult({
          created,
          main: data.main,
          links: Array.isArray(data.links) ? data.links : [],
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        });
        setPhase("report");
        toast({ title: lfmt(s.autopilotCreated, { n: created.length }) });
      } else {
        setRowStates(Object.fromEntries(protocols.map((p) => [p, "fail" as RowState])));
        setPhase("error");
        toast({ title: errTitle(data.error), variant: "destructive" });
      }
    } catch {
      setRowStates(Object.fromEntries(protocols.map((p) => [p, "fail" as RowState])));
      setPhase("error");
      toast({ title: s.autopilotErrGeneric, variant: "destructive" });
    }
  };

  /** close — refresh the parent grid when a fleet was actually built */
  const handleClose = (o: boolean) => {
    if (!o && phase === "report") onCreated();
    onOpenChange(o);
  };

  /* ---------- step header ---------- */

  const stepDefs: { n: 1 | 2 | 3; label: string }[] = [
    { n: 1, label: s.autopilotStepSource },
    { n: 2, label: s.autopilotStepPlan },
    { n: 3, label: phase === "report" ? s.autopilotReport : s.autopilotStepLaunch },
  ];

  const StepPill = ({ n, label }: { n: 1 | 2 | 3; label: string }) => {
    const done = step > n;
    const active = step === n;
    return (
      <span
        aria-current={active ? "step" : undefined}
        className={cn(
          "flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all",
          active
            ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_16px_-6px_var(--primary)]"
            : done
              ? "border-chart-3/30 bg-chart-3/10 text-chart-3"
              : "border-white/10 bg-white/[0.03] text-muted-foreground"
        )}
      >
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold",
            active ? "bg-primary/20" : done ? "bg-chart-3/20" : "bg-white/5"
          )}
        >
          {done ? <Check className="h-2.5 w-2.5" /> : n}
        </span>
        {label}
      </span>
    );
  };

  const ModeCard = ({
    id,
    icon: Icon,
    title,
    desc,
    className,
  }: {
    id: "clone" | "multi" | "single";
    icon: LucideIcon;
    title: string;
    desc: string;
    className?: string;
  }) => {
    const on = mode === id;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setMode(id)}
        className={cn(
          "flex min-h-11 flex-col items-start gap-1.5 rounded-2xl border p-4 text-start transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
          on
            ? "border-primary/40 bg-primary/[0.06] shadow-[0_0_26px_-10px_var(--primary)]"
            : "border-white/10 bg-white/[0.03] hover:border-white/20",
          className
        )}
      >
        <span className="flex w-full items-center gap-2.5">
          <span
            className={cn(
              "glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              on && "text-primary"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className={cn("min-w-0 flex-1 text-sm font-bold", on ? "text-primary" : "text-silver")}>
            {title}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
              on ? "border-primary bg-primary/20" : "border-white/20"
            )}
          >
            {on && <span className="h-2 w-2 rounded-full bg-primary" />}
          </span>
        </span>
        <span className="text-[11px] leading-relaxed text-muted-foreground">{desc}</span>
      </button>
    );
  };

  const summaryText = lfmt(s.autopilotSummary, { n: plan.length });
  const usersText =
    mode === "clone"
      ? s.autopilotUsersClone
      : mode === "single"
        ? s.autopilotUsersSingle
        : shareUsers
          ? s.autopilotUsersShared
          : s.autopilotUsersFresh;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="glass-strong max-h-[92dvh] overflow-y-auto border-white/10 p-0 sm:max-w-[680px]">
        <DialogHeader className="border-b border-white/5 px-5 py-4 text-start">
          <DialogTitle className="flex items-center gap-3 text-silver">
            <span className="glass flex h-9 w-9 items-center justify-center rounded-xl">
              <Rocket className="h-4 w-4 text-[#f59e0b]" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base">{s.autopilotTitle}</span>
              <DialogDescription className="mt-0.5 block text-[11px] font-normal leading-relaxed text-muted-foreground">
                {s.autopilotDesc}
              </DialogDescription>
            </span>
          </DialogTitle>
          <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label={s.autopilotTitle}>
            {stepDefs.map((d) => (
              <StepPill key={d.n} n={d.n} label={d.label} />
            ))}
          </div>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {/* ════ STEP 1 — SOURCE ════ */}
          {step === 1 && (
            <div className="fade-up space-y-4" role="group" aria-label={s.autopilotStepSource}>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={s.autopilotTitle}>
                <ModeCard
                  id="clone"
                  icon={Copy}
                  title={s.autopilotCloneMode}
                  desc={s.autopilotCloneDesc}
                />
                <ModeCard
                  id="multi"
                  icon={Rocket}
                  title={s.autopilotMultiMode}
                  desc={s.autopilotMultiDesc}
                />
                <ModeCard
                  id="single"
                  icon={RadioTower}
                  title={s.autopilotSingleMode}
                  desc={s.autopilotSingleDesc}
                  className="sm:col-span-2"
                />
              </div>

              {/* clone — template picker */}
              {mode === "clone" && (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                    <RadioTower className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    {s.autopilotPickTemplate}
                  </p>
                  {rowsLoading ? (
                    <p className="flex min-h-11 items-center gap-2 rounded-xl bg-black/20 px-3 text-[11px] text-muted-foreground" role="status">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      {s.autopilotRowsLoading}
                    </p>
                  ) : !rows || rows.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
                      {s.autopilotNoRows}
                    </p>
                  ) : (
                    <div
                      role="radiogroup"
                      aria-label={s.autopilotPickTemplate}
                      className="max-h-64 space-y-1.5 overflow-y-auto pe-1"
                    >
                      {rows.map((row) => {
                        const on = row.id === templateId;
                        return (
                          <button
                            key={row.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => pickTemplate(row.id)}
                            className={cn(
                              "flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              on
                                ? "border-primary/40 bg-primary/[0.07] shadow-[0_0_20px_-8px_var(--primary)]"
                                : "border-white/10 bg-white/[0.02] hover:border-white/20"
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                on ? "border-primary bg-primary/25" : "border-white/25"
                              )}
                            >
                              {on && <span className="h-2 w-2 rounded-full bg-primary" />}
                            </span>
                            <ProtoChip proto={row.protocol} />
                            <span
                              dir="ltr"
                              className="min-w-0 flex-1 truncate font-mono text-xs text-silver"
                              title={row.tag}
                            >
                              {row.tag}
                            </span>
                            <span dir="ltr" className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                              :{row.port}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* protocols to recreate from the template */}
                  {template && (
                    <div className="space-y-2 pt-1">
                      <p className="text-[11px] font-bold text-muted-foreground">{s.autopilotProtoHint}</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {PROTOCOLS.map((p) => {
                          const isTpl = template.protocol === p;
                          const on = !isTpl && cloneProtos.includes(p);
                          return (
                            <ProtoToggle
                              key={p}
                              proto={p}
                              on={on}
                              disabled={isTpl}
                              badge={isTpl ? s.autopilotTemplateBadge : undefined}
                              label={PROTO_LABEL[p] ?? p}
                              onToggle={() =>
                                setCloneProtos((prev) =>
                                  prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
                                )
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* multi — protocol chips */}
              {mode === "multi" && (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="text-[11px] font-bold text-muted-foreground">{s.autopilotProtoHint}</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {PROTOCOLS.map((p) => {
                      const on = multiProtos.includes(p);
                      return (
                        <ProtoToggle
                          key={p}
                          proto={p}
                          on={on}
                          label={PROTO_LABEL[p] ?? p}
                          onToggle={() =>
                            setMultiProtos((prev) =>
                              prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
                            )
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Task 4-b — single-port: main picker (only valid hosts) */}
              {mode === "single" && (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                    <RadioTower className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    {s.autopilotSinglePickMain}
                  </p>
                  {rowsLoading ? (
                    <p className="flex min-h-11 items-center gap-2 rounded-xl bg-black/20 px-3 text-[11px] text-muted-foreground" role="status">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      {s.autopilotRowsLoading}
                    </p>
                  ) : singleCandidates.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
                      {s.autopilotSingleNoMain}
                    </p>
                  ) : (
                    <div
                      role="radiogroup"
                      aria-label={s.autopilotSinglePickMain}
                      className="max-h-64 space-y-1.5 overflow-y-auto pe-1"
                    >
                      {singleCandidates.map((row) => {
                        const on = row.id === singleMainId;
                        return (
                          <button
                            key={row.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setSingleMainId(row.id)}
                            className={cn(
                              "flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              on
                                ? "border-primary/40 bg-primary/[0.07] shadow-[0_0_20px_-8px_var(--primary)]"
                                : "border-white/10 bg-white/[0.02] hover:border-white/20"
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                on ? "border-primary bg-primary/25" : "border-white/25"
                              )}
                            >
                              {on && <span className="h-2 w-2 rounded-full bg-primary" />}
                            </span>
                            <ProtoChip proto={row.protocol} />
                            <span
                              dir="ltr"
                              className="min-w-0 flex-1 truncate font-mono text-xs text-silver"
                              title={row.tag}
                            >
                              {row.tag}
                            </span>
                            <span dir="ltr" className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                              :{row.port}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* the complementary protocol is shown, never chosen */}
                  {singleMain && complementProto && (
                    <div className="space-y-1.5 pt-1">
                      <p className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.05] px-3 py-2 text-[11px] font-semibold text-primary">
                        <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <ProtoChip proto={complementProto} />
                        {lfmt(s.autopilotSingleComplement, { proto: PROTO_LABEL[complementProto] ?? complementProto })}
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{s.autopilotSingleHint}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ════ STEP 2 — PLAN ════ */}
          {step === 2 && (
            <div className="fade-up space-y-3" aria-label={s.autopilotStepPlan}>
              {/* header row (desktop) */}
              <div className="hidden gap-3 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1.05fr)_104px_minmax(0,1.15fr)_minmax(0,1.35fr)]">
                <span>{s.autopilotProtoHint}</span>
                <span>{s.autopilotPortCol}</span>
                <span>{s.autopilotEngineCol}</span>
                <span>{s.autopilotUsersCol}</span>
              </div>

              {plan.map((row) => {
                const eng = ENGINE_OF[row.proto] ?? ENGINE_OF.vless!;
                const accent = PROTO_VAR[row.proto] ?? PROTO_VAR.vless;
                return (
                  <div
                    key={row.proto}
                    className="grid gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-[minmax(0,1.05fr)_104px_minmax(0,1.15fr)_minmax(0,1.35fr)] sm:items-center sm:gap-3"
                  >
                    {/* protocol */}
                    <span className="flex min-h-9 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-6 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: accent }}
                      />
                      <ProtoChip proto={row.proto} />
                    </span>
                    {/* port — single-port mode: the MAIN's public port (read-only); the
                        internal loopback listener is allocated server-side (44301+) */}
                    <span className="block">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:hidden">
                        {s.autopilotPortCol}
                      </span>
                      {mode === "single" ? (
                        <span className="flex min-h-10 items-center gap-2">
                          <code
                            dir="ltr"
                            className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 font-mono text-xs tabular-nums text-foreground/90"
                          >
                            :{row.port ?? "—"}
                          </code>
                          <Badge
                            variant="outline"
                            className="border-[#f59e0b]/30 bg-[#f59e0b]/[0.06] font-mono text-[10px] font-bold text-[#f59e0b]"
                          >
                            {s.autopilotSingleBadge}
                          </Badge>
                        </span>
                      ) : (
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={65535}
                          dir="ltr"
                          value={portOverrides[row.proto] ?? String(defPorts[row.proto] ?? "")}
                          onChange={(e) =>
                            setPortOverrides((prev) => ({ ...prev, [row.proto]: e.target.value }))
                          }
                          aria-label={`${s.autopilotPortCol} · ${PROTO_LABEL[row.proto] ?? row.proto}`}
                          aria-invalid={row.err !== null}
                          className={cn(
                            "h-10 rounded-lg border-white/10 bg-black/30 font-mono text-xs tabular-nums",
                            row.err !== null &&
                              "border-chart-5/60 text-chart-5 ring-1 ring-chart-5/40 focus-visible:ring-chart-5/40"
                          )}
                        />
                      )}
                      {row.err !== null && (
                        <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-chart-5">
                          <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {row.err === "dup" ? s.autopilotErrDup : s.autopilotErrPort}
                        </span>
                      )}
                    </span>
                    {/* engine */}
                    <span className="flex min-h-9 flex-col justify-center gap-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:hidden">
                        {s.autopilotEngineCol}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="border-white/15 bg-white/[0.04] font-mono text-[10px] font-bold text-foreground/90"
                        >
                          {eng.label}
                        </Badge>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {s[ENGINE_SUB[eng.key]]}
                        </span>
                      </span>
                    </span>
                    {/* users */}
                    <span className="flex min-h-9 flex-col justify-center gap-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:hidden">
                        {s.autopilotUsersCol}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] leading-snug text-muted-foreground">
                        <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-chart-3" aria-hidden="true" />
                        {usersText}
                      </span>
                    </span>
                  </div>
                );
              })}

              {/* options */}
              <div className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-3">
                {mode === "multi" && (
                  <>
                    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-xs text-foreground sm:flex-col sm:items-start sm:justify-center">
                      <span className="flex items-center gap-2 font-semibold">
                        <Switch checked={tls} onCheckedChange={setTls} aria-label={s.autopilotTlsOpt} />
                        {s.autopilotTlsOpt}
                      </span>
                      <span dir="ltr" className="font-mono text-[10px] text-muted-foreground">
                        {[...TLS_OK].map((p) => PROTO_LABEL[p]).join(" · ")}
                      </span>
                    </label>
                    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-xs text-foreground sm:flex-col sm:items-start sm:justify-center">
                      <span className="flex items-center gap-2 font-semibold">
                        <Switch
                          checked={shareUsers}
                          onCheckedChange={setShareUsers}
                          aria-label={s.autopilotShareUsers}
                        />
                        {s.autopilotShareUsers}
                      </span>
                      <span className="text-[10px] leading-snug text-muted-foreground">
                        {s.autopilotUsersShared}
                      </span>
                    </label>
                  </>
                )}
                {mode !== "single" && (
                  <label className="flex min-h-11 flex-col justify-center gap-1 text-xs text-foreground">
                    <span className="font-semibold">{s.autopilotPortStart}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={65535}
                      dir="ltr"
                      value={portStartRaw}
                      onChange={(e) => setPortStartRaw(e.target.value)}
                      placeholder="30000"
                      aria-label={s.autopilotPortStart}
                      className="h-10 rounded-lg border-white/10 bg-black/30 font-mono text-xs tabular-nums"
                    />
                  </label>
                )}
              </div>

              {/* contiguous preview */}
              {portStartNum !== null && plannedPorts.length > 1 && (
                <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{s.autopilotContiguous}:</span>
                  <code
                    dir="ltr"
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-[10.5px] text-foreground/90"
                  >
                    {plannedPorts.join(" → ")}
                  </code>
                </p>
              )}

              {/* summary strip */}
              <div
                className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-3 text-center font-mono text-[11px] leading-relaxed text-primary"
                role="status"
              >
                <span>{summaryText}</span>
                <span aria-hidden="true" className="opacity-50">·</span>
                <span className="font-sans">{s.autopilotPortCol}:</span>
                <code dir="ltr" className="rounded-md bg-black/25 px-1.5 py-0.5 tabular-nums">
                  {plannedPorts.length > 0 ? plannedPorts.join(", ") : "—"}
                </code>
              </div>

              {/* Task 4-b — honest single-port mechanics note */}
              {mode === "single" && singleMain && (
                <p className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {lfmt(s.autopilotSinglePlanNote, { tag: singleMain.tag })}
                </p>
              )}

              {/* honest duplicates warning (single-port fallbacks are exempt —
                  a fallback is not a second copy of the protocol) */}
              {mode !== "single" && plan.some((r) => existingProtos.has(r.proto)) && (
                <div className="space-y-1.5" role="alert">
                  {plan
                    .filter((r) => existingProtos.has(r.proto))
                    .map((r) => (
                      <p
                        key={r.proto}
                        className="flex items-center gap-2 rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/[0.06] px-3 py-2 text-[11px] leading-relaxed text-[#f59e0b]"
                      >
                        <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {lfmt(s.autopilotAlreadyThere, { proto: PROTO_LABEL[r.proto] ?? r.proto })}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ════ STEP 3 — LAUNCH / REPORT ════ */}
          {step === 3 && (
            <div className="fade-up space-y-3" aria-live="polite">
              {/* live checklist */}
              {plan.map((row) => {
                const st = rowStates[row.proto] ?? "spin";
                return (
                  <div
                    key={row.proto}
                    className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                  >
                    {st === "spin" ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
                    ) : st === "ok" ? (
                      <CircleCheck className="h-4 w-4 shrink-0 text-chart-3" aria-hidden="true" />
                    ) : (
                      <CircleX className="h-4 w-4 shrink-0 text-chart-5" aria-hidden="true" />
                    )}
                    <ProtoChip proto={row.proto} />
                    <span dir="ltr" className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      :{row.port ?? "—"}
                    </span>
                    {st === "spin" && (
                      <span className="ms-auto text-[11px] font-semibold text-muted-foreground">
                        {s.autopilotLaunching}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* ── final report ── */}
              {phase === "report" && result && (
                <div className="space-y-3 pt-1" role="status">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-bold text-chart-3">
                      <CircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
                      {lfmt(s.autopilotCreated, { n: result.created.length })}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-9 gap-1.5 rounded-full border-white/10 bg-white/[0.03] px-3 text-[11px] hover:bg-white/[0.06]"
                      onClick={() =>
                        void copyText(
                          "__all",
                          result.links
                            .flatMap((l) => [l.link ?? l.text, ...(l.extra ? [l.extra] : [])])
                            .join("\n"),
                          true
                        )
                      }
                    >
                      {copiedKey === "__all" ? (
                        <Check className="h-3.5 w-3.5 text-chart-3" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {s.autopilotCopyAll}
                    </Button>
                  </div>

                  {result.warnings.length > 0 && (
                    <div className="space-y-1.5" role="alert">
                      {result.warnings.map((w, i) => (
                        <p
                          key={i}
                          dir="ltr"
                          className="flex items-start gap-2 rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/[0.06] px-3 py-2 text-start font-mono text-[10.5px] leading-relaxed text-[#f59e0b]"
                        >
                          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          {w}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2.5">
                    {result.created.map((c) => {
                      const mat = result.links.find((l) => l.tag === c.tag) ?? null;
                      return (
                        <div
                          key={c.id}
                          className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                        >
                          <div className="flex items-center gap-2">
                            <ProtoChip proto={c.protocol} />
                            <span
                              dir="ltr"
                              className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-silver"
                              title={c.tag}
                            >
                              {c.tag}
                            </span>
                            <span
                              dir="ltr"
                              className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
                            >
                              :{c.port}
                            </span>
                          </div>
                          {mat?.link ? (
                            <CopyRow
                              label={s.autopilotCopyLink}
                              value={mat.link}
                              copied={copiedKey === `${c.id}:link`}
                              onCopy={() => void copyText(`${c.id}:link`, mat.link as string)}
                            />
                          ) : (
                            <pre
                              dir="ltr"
                              className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-start font-mono text-[10.5px] leading-relaxed text-foreground/90"
                            >
                              {mat?.text ?? "—"}
                            </pre>
                          )}
                          {mat?.extra && (
                            <CopyRow
                              label={s.autopilotCopyExtra}
                              value={mat.extra}
                              copied={copiedKey === `${c.id}:extra`}
                              onCopy={() => void copyText(`${c.id}:extra`, mat.extra as string)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Task 4-b — the MAIN inbound was mutated (fallback dest added) */}
                  {mode === "single" && result.main && (
                    <div className="flex min-h-11 flex-wrap items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.05] px-3 py-2">
                      <CircleCheck className="h-4 w-4 shrink-0 text-chart-3" aria-hidden="true" />
                      <ProtoChip proto={result.main.protocol} />
                      <span
                        dir="ltr"
                        className="min-w-0 truncate font-mono text-xs font-semibold text-silver"
                        title={result.main.tag}
                      >
                        {result.main.tag}
                      </span>
                      <span dir="ltr" className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                        :{result.main.port}
                      </span>
                      <span className="text-[11px] leading-snug text-muted-foreground">
                        {complementProto
                          ? lfmt(s.autopilotSingleMainUpdated, {
                              tag: result.main.tag,
                              proto: PROTO_LABEL[complementProto] ?? complementProto,
                            })
                          : ""}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* failure → retry back to the plan */}
              {phase === "error" && (
                <p className="rounded-xl border border-chart-5/30 bg-chart-5/[0.06] px-3 py-2.5 text-center text-[11px] font-semibold leading-relaxed text-chart-5" role="alert">
                  {s.autopilotErrGeneric}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-white/5 px-5 py-4">
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {step === 1 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleClose(false)}
                  className="min-h-11 flex-1 rounded-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06] sm:flex-none"
                >
                  {s.autopilotClose}
                </Button>
                <Button
                  type="button"
                  disabled={!canContinue}
                  onClick={() => setStep(2)}
                  className="glow-cyan min-h-11 flex-1 gap-2 rounded-full font-semibold sm:min-w-32 sm:flex-none"
                >
                  <Rocket className="h-4 w-4" aria-hidden="true" />
                  {s.autopilotStepPlan}
                </Button>
              </>
            )}
            {step === 2 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep(1)}
                  className="min-h-11 flex-1 rounded-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06] sm:flex-none"
                >
                  {s.autopilotBack}
                </Button>
                <Button
                  type="button"
                  disabled={!planValid || busy}
                  onClick={() => void launch()}
                  className="min-h-11 flex-1 gap-2 rounded-full bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#38bdf8] font-bold text-black shadow-[0_0_28px_-8px_#f59e0b] transition-all hover:brightness-110 sm:min-w-36 sm:flex-none"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Rocket className="h-4 w-4" aria-hidden="true" />
                  )}
                  {busy ? s.autopilotLaunching : s.autopilotLaunch}
                </Button>
              </>
            )}
            {step === 3 && phase === "launching" && (
              <Button type="button" disabled className="min-h-11 flex-1 gap-2 rounded-full font-semibold sm:flex-none">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {s.autopilotLaunching}
              </Button>
            )}
            {step === 3 && phase === "error" && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep(2)}
                  className="min-h-11 flex-1 rounded-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06] sm:flex-none"
                >
                  {s.autopilotBack}
                </Button>
                <Button
                  type="button"
                  onClick={() => setStep(2)}
                  variant="outline"
                  className="min-h-11 flex-1 gap-2 rounded-full border-white/10 bg-white/[0.03] font-semibold text-[#f59e0b] hover:bg-white/[0.06] sm:flex-none"
                >
                  <Rocket className="h-4 w-4" aria-hidden="true" />
                  {s.autopilotRetry}
                </Button>
              </>
            )}
            {step === 3 && phase === "report" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleClose(false)}
                className="min-h-11 flex-1 rounded-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06] sm:flex-none"
              >
                {s.autopilotClose}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- report copy row ---------- */

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-bold tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-stretch gap-2">
        <code
          dir="ltr"
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 font-mono text-[10.5px] text-foreground/90"
          title={value}
        >
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0 gap-1 rounded-lg px-2.5 text-[11px]"
          onClick={onCopy}
          aria-label={`${label} — copy`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-chart-3" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {label}
        </Button>
      </div>
    </div>
  );
}
