"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Braces,
  Check,
  DatabaseBackup,
  Download,
  FileJson,
  KeyRound,
  Languages,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  Network,
  Palette,
  PanelsTopLeft,
  RadioTower,
  RotateCw,
  Route,
  Send,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Timer,
  TriangleAlert,
  Wifi,
  WifiOff,
  Wrench,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useAppStore,
  type GlowPref,
  type ModuleVisibility,
} from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { dictionaries, LANGS, LANG_META, type Lang } from "@/lib/i18n/dictionaries";
import { sfmt } from "@/lib/i18n/sub-dictionary";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 8 — Settings & System (admin)
   Two tabs: General (language, appearance, top-bar modules,
   panel preferences, Telegram bot, backup) and Expert (core
   driver + real TCP test, Xray configs, raw JSON template,
   TLS certificates, session lifetime). Password / recovery
   key / session-revocation moved to the Profile view.
   All strings ×6 languages.
   ============================================================ */

type TabId = "general" | "expert";

type XrayLogLevel = "none" | "warning" | "info" | "debug";
type DomStrategy = "AsIs" | "IPIfNonMatch" | "IPOnDemand";
type FreedomStrategy = "AsIs" | "UseIP" | "UseIPv4" | "UseIPv6";
type XrayField =
  | "logLevel"
  | "dnsServers"
  | "domainStrategy"
  | "freedomStrategy"
  | "connIdle"
  | "bufferSize";

interface CoreSettingsDTO {
  driver: "simulator" | "xray";
  apiHost: string;
  apiPort: number;
  tickSeconds: number;
}

interface TelegramSettingsDTO {
  enabled: boolean;
  chatId: string;
  tokenConfigured: boolean;
  tokenMasked: string;
  notify: {
    userCreated: boolean;
    userExpired: boolean;
    trafficAlert: boolean;
    loginAlert: boolean;
  };
}

interface GeneralSettingsDTO {
  datepicker: "gregorian" | "jalalian";
  pageSize: number;
}

interface ExpertSettingsDTO {
  logLevel: XrayLogLevel;
  dnsServers: string;
  domainStrategy: DomStrategy;
  freedomStrategy: FreedomStrategy;
  connIdle: number;
  bufferSize: number;
  rawJson: string;
  certFile: string;
  keyFile: string;
  sessionMaxAge: number;
}

interface NavDTO {
  hosts: boolean;
  nodes: boolean;
  outbounds: boolean;
  routing: boolean;
}

interface CoreForm {
  driver: "simulator" | "xray";
  apiHost: string;
  apiPort: string;
  tickSeconds: string;
}

interface TgForm {
  enabled: boolean;
  token: string;
  chatId: string;
  notify: TelegramSettingsDTO["notify"];
}

interface GeneralForm {
  datepicker: "gregorian" | "jalalian";
  pageSize: string;
}

interface ExpertForm {
  logLevel: XrayLogLevel;
  dnsServers: string;
  domainStrategy: DomStrategy;
  freedomStrategy: FreedomStrategy;
  connIdle: string;
  bufferSize: string;
}

interface BackupSummary {
  exportedAt: string;
  counts: {
    inbounds: number;
    users: number;
    subGroups: number;
    resellers: number;
    saleTemplates: number;
  };
}

type CoreTestState =
  | { busy: false; result: null }
  | { busy: true; result: null }
  | { busy: false; result: { ok: true; ms: number } }
  | { busy: false; result: { ok: false; msg: string } };

type TgTestState =
  | { busy: false; result: null }
  | { busy: true; result: null }
  | { busy: false; result: { ok: true; ms: number } }
  | { busy: false; result: { ok: false; msg: string } };

function expertFromDTO(e: ExpertSettingsDTO): ExpertForm {
  return {
    logLevel: e.logLevel,
    dnsServers: e.dnsServers,
    domainStrategy: e.domainStrategy,
    freedomStrategy: e.freedomStrategy,
    connIdle: String(e.connIdle),
    bufferSize: String(e.bufferSize),
  };
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

function SectionCard({
  icon: Icon,
  title,
  desc,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass rounded-2xl p-5 md:p-6", className)}>
      <div className="mb-4 flex items-start gap-3">
        <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function SwitchRow({
  label,
  desc,
  checked,
  onCheckedChange,
  disabled,
  icon: Icon,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span className="glass flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
            <Icon className="h-3.5 w-3.5 text-primary/90" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}

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

export function SettingsView() {
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const starfield = useAppStore((s) => s.starfield);
  const setStarfield = useAppStore((s) => s.setStarfield);
  const glow = useAppStore((s) => s.glow);
  const setGlow = useAppStore((s) => s.setGlow);
  const reduceMotion = useAppStore((s) => s.reduceMotion);
  const setReduceMotion = useAppStore((s) => s.setReduceMotion);
  const modules = useAppStore((s) => s.modules);
  const setModule = useAppStore((s) => s.setModule);
  const setModules = useAppStore((s) => s.setModules);
  const coreStatus = useCoreStore((s) => s.status);
  const { toast } = useToast();

  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.settings;

  const [tab, setTab] = useState<TabId>("general");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);

  const [coreForm, setCoreForm] = useState<CoreForm>({
    driver: "simulator",
    apiHost: "127.0.0.1",
    apiPort: "10085",
    tickSeconds: "1",
  });
  const [tgForm, setTgForm] = useState<TgForm>({
    enabled: false,
    token: "",
    chatId: "",
    notify: { userCreated: true, userExpired: true, trafficAlert: true, loginAlert: false },
  });
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [tokenMasked, setTokenMasked] = useState("");

  const [generalForm, setGeneralForm] = useState<GeneralForm>({
    datepicker: "gregorian",
    pageSize: "25",
  });
  const [generalErr, setGeneralErr] = useState<string | null>(null);
  const [savingGeneral, setSavingGeneral] = useState(false);

  const [expertForm, setExpertForm] = useState<ExpertForm>({
    logLevel: "warning",
    dnsServers: "1.1.1.1\n8.8.8.8",
    domainStrategy: "AsIs",
    freedomStrategy: "AsIs",
    connIdle: "300",
    bufferSize: "512",
  });
  const [xrayErrs, setXrayErrs] = useState<Partial<Record<XrayField, string>>>({});
  const [savingXray, setSavingXray] = useState(false);

  const [rawJson, setRawJson] = useState("");
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [savingJson, setSavingJson] = useState(false);
  const [jsonResetOpen, setJsonResetOpen] = useState(false);

  const [certForm, setCertForm] = useState({ certFile: "", keyFile: "" });
  const [certErr, setCertErr] = useState<string | null>(null);
  const [savingCert, setSavingCert] = useState(false);

  const [sessionAge, setSessionAge] = useState("360");
  const [sessionErr, setSessionErr] = useState<string | null>(null);
  const [savingSession, setSavingSession] = useState(false);

  const [savingCore, setSavingCore] = useState(false);
  const [savingTg, setSavingTg] = useState(false);
  const [coreTest, setCoreTest] = useState<CoreTestState>({ busy: false, result: null });
  const [tgTest, setTgTest] = useState<TgTestState>({ busy: false, result: null });

  /* backup */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<BackupSummary | null>(null);
  const [backupRaw, setBackupRaw] = useState<unknown>(null);
  const [backupErr, setBackupErr] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(false);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const d = (await res.json()) as {
        core: CoreSettingsDTO;
        telegram: TelegramSettingsDTO;
        nav: NavDTO;
        general: GeneralSettingsDTO;
        expert: ExpertSettingsDTO;
      };
      setCoreForm({
        driver: d.core.driver,
        apiHost: d.core.apiHost,
        apiPort: String(d.core.apiPort),
        tickSeconds: String(d.core.tickSeconds),
      });
      setTgForm({
        enabled: d.telegram.enabled,
        token: "",
        chatId: d.telegram.chatId,
        notify: d.telegram.notify,
      });
      setTokenConfigured(d.telegram.tokenConfigured);
      setTokenMasked(d.telegram.tokenMasked);
      setGeneralForm({
        datepicker: d.general.datepicker,
        pageSize: String(d.general.pageSize),
      });
      setExpertForm(expertFromDTO(d.expert));
      setRawJson(d.expert.rawJson);
      setCertForm({ certFile: d.expert.certFile, keyFile: d.expert.keyFile });
      setSessionAge(String(d.expert.sessionMaxAge));
      /* sync the zustand store so the top bar matches the server */
      setModules({
        hosts: d.nav.hosts,
        nodes: d.nav.nodes,
        outbounds: d.nav.outbounds,
        routing: d.nav.routing,
      });
    } catch {
      setLoadErr(true);
    }
    setLoading(false);
  }, [setModules]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- top-bar modules (optimistic, live) ---------- */

  const toggleModule = (key: keyof ModuleVisibility, v: boolean) => {
    const prev = { ...useAppStore.getState().modules };
    setModule(key, v); /* top bar reacts instantly */
    void (async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: "nav", ...prev, [key]: v }),
        });
        if (!res.ok) throw new Error("nav");
      } catch {
        setModules(prev); /* revert on failure */
        toast({ description: t.inbounds.errGeneric });
      }
    })();
  };

  /* ---------- general panel preferences ---------- */

  const saveGeneral = async () => {
    const pageSize = Number(generalForm.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 10 || pageSize > 100) {
      setGeneralErr(u.pageSizeDesc);
      return;
    }
    setGeneralErr(null);
    setSavingGeneral(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "general",
          datepicker: generalForm.datepicker,
          pageSize,
        }),
      });
      if (!res.ok) {
        if (res.status === 400) {
          setGeneralErr(u.pageSizeDesc);
          return;
        }
        throw new Error("save");
      }
      const d = (await res.json()) as { general: GeneralSettingsDTO };
      setGeneralForm({
        datepicker: d.general.datepicker,
        pageSize: String(d.general.pageSize),
      });
      toast({ description: u.generalSaved });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    } finally {
      setSavingGeneral(false);
    }
  };

  /* ---------- core ---------- */

  const saveCore = async () => {
    setSavingCore(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "core",
          driver: coreForm.driver,
          apiHost: coreForm.apiHost.trim(),
          apiPort: Number(coreForm.apiPort),
          tickSeconds: Number(coreForm.tickSeconds),
        }),
      });
      if (!res.ok) throw new Error("save");
      const d = (await res.json()) as { core: CoreSettingsDTO };
      setCoreForm({
        driver: d.core.driver,
        apiHost: d.core.apiHost,
        apiPort: String(d.core.apiPort),
        tickSeconds: String(d.core.tickSeconds),
      });
      toast({ description: u.coreSaved });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setSavingCore(false);
  };

  const testCore = async () => {
    setCoreTest({ busy: true, result: null });
    try {
      const res = await fetch("/api/settings/test-core", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: coreForm.apiHost.trim(), port: Number(coreForm.apiPort) }),
      });
      const d = (await res.json()) as { ok?: boolean; latencyMs?: number; error?: string };
      if (d.ok) {
        setCoreTest({ busy: false, result: { ok: true, ms: d.latencyMs ?? 0 } });
      } else {
        const msg =
          d.error === "refused"
            ? u.testRefused
            : d.error === "timeout"
              ? u.testTimeout
              : d.error === "unreachable"
                ? u.testUnreachable
                : u.testFail;
        setCoreTest({ busy: false, result: { ok: false, msg } });
      }
    } catch {
      setCoreTest({ busy: false, result: { ok: false, msg: u.testFail } });
    }
  };

  /* ---------- expert · xray configs ---------- */

  const expertFieldError = (field: string): string => {
    switch (field) {
      case "dnsServers":
        return u.dnsDesc;
      case "connIdle":
        return u.connIdleDesc;
      case "bufferSize":
        return u.bufferSizeDesc;
      case "rawJson":
        return u.jsonDesc;
      case "certFile":
      case "keyFile":
        return u.certDesc;
      case "sessionMaxAge":
        return u.sessionAgeDesc;
      case "logLevel":
      case "domainStrategy":
      case "freedomStrategy":
        return u.xrayDesc;
      default:
        return t.inbounds.errGeneric;
    }
  };

  const saveXray = async () => {
    const errs: Partial<Record<XrayField, string>> = {};
    const connIdle = Number(expertForm.connIdle);
    if (!Number.isInteger(connIdle) || connIdle < 4 || connIdle > 86400) {
      errs.connIdle = u.connIdleDesc;
    }
    const bufferSize = Number(expertForm.bufferSize);
    if (!Number.isInteger(bufferSize) || bufferSize < 4 || bufferSize > 65535) {
      errs.bufferSize = u.bufferSizeDesc;
    }
    setXrayErrs(errs);
    if (Object.keys(errs).length > 0) return;
    setSavingXray(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "expert",
          logLevel: expertForm.logLevel,
          dnsServers: expertForm.dnsServers,
          domainStrategy: expertForm.domainStrategy,
          freedomStrategy: expertForm.freedomStrategy,
          connIdle,
          bufferSize,
        }),
      });
      if (!res.ok) {
        if (res.status === 400) {
          const d = (await res.json()) as { fields?: { field: string; code: string }[] };
          const mapped: Partial<Record<XrayField, string>> = {};
          for (const f of d.fields ?? []) {
            mapped[f.field as XrayField] = expertFieldError(f.field);
          }
          setXrayErrs(mapped);
          return;
        }
        throw new Error("save");
      }
      const d = (await res.json()) as { expert: ExpertSettingsDTO };
      setExpertForm(expertFromDTO(d.expert));
      toast({ description: u.expertSaved });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    } finally {
      setSavingXray(false);
    }
  };

  /* ---------- expert · raw JSON template ---------- */

  const saveRawJson = async (override?: string) => {
    const value = override ?? rawJson;
    if (value.trim() !== "") {
      try {
        JSON.parse(value);
      } catch (e) {
        setJsonErr(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setJsonErr(null);
    setSavingJson(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "expert", rawJson: value }),
      });
      if (!res.ok) {
        if (res.status === 400) {
          setJsonErr(u.jsonDesc);
          return;
        }
        throw new Error("save");
      }
      const d = (await res.json()) as { expert: ExpertSettingsDTO };
      setRawJson(d.expert.rawJson);
      toast({ description: override !== undefined ? u.jsonResetDone : u.jsonSaved });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    } finally {
      setSavingJson(false);
    }
  };

  /* ---------- expert · certificates ---------- */

  const saveCert = async () => {
    setCertErr(null);
    setSavingCert(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "expert",
          certFile: certForm.certFile.trim(),
          keyFile: certForm.keyFile.trim(),
        }),
      });
      if (!res.ok) {
        if (res.status === 400) {
          setCertErr(u.certDesc);
          return;
        }
        throw new Error("save");
      }
      const d = (await res.json()) as { expert: ExpertSettingsDTO };
      setCertForm({ certFile: d.expert.certFile, keyFile: d.expert.keyFile });
      toast({ description: u.expertSaved });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    } finally {
      setSavingCert(false);
    }
  };

  /* ---------- expert · sessions ---------- */

  const saveSession = async () => {
    const n = Number(sessionAge);
    if (!Number.isInteger(n) || n < 5 || n > 43200) {
      setSessionErr(u.sessionAgeDesc);
      return;
    }
    setSessionErr(null);
    setSavingSession(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "expert", sessionMaxAge: n }),
      });
      if (!res.ok) {
        if (res.status === 400) {
          setSessionErr(u.sessionAgeDesc);
          return;
        }
        throw new Error("save");
      }
      const d = (await res.json()) as { expert: ExpertSettingsDTO };
      setSessionAge(String(d.expert.sessionMaxAge));
      toast({ description: u.expertSaved });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    } finally {
      setSavingSession(false);
    }
  };

  /* ---------- telegram ---------- */

  const saveTelegram = async (tokenOverride?: string | null) => {
    setSavingTg(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "telegram",
          enabled: tgForm.enabled,
          chatId: tgForm.chatId.trim(),
          token: tokenOverride !== undefined ? tokenOverride : tgForm.token.trim(),
          notify: tgForm.notify,
        }),
      });
      if (res.status === 400) {
        toast({ description: u.tgErrFormat });
        setSavingTg(false);
        return;
      }
      if (!res.ok) throw new Error("save");
      const d = (await res.json()) as { telegram: TelegramSettingsDTO };
      setTgForm((prev) => ({ ...prev, token: "" }));
      setTokenConfigured(d.telegram.tokenConfigured);
      setTokenMasked(d.telegram.tokenMasked);
      toast({ description: u.tgSaved });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setSavingTg(false);
  };

  const testTelegram = async () => {
    if (!tokenConfigured && !tgForm.token.trim()) {
      setTgTest({ busy: false, result: { ok: false, msg: u.tgErrNoToken } });
      return;
    }
    if (!tgForm.chatId.trim()) {
      setTgTest({ busy: false, result: { ok: false, msg: u.tgErrNoChat } });
      return;
    }
    setTgTest({ busy: true, result: null });
    try {
      const res = await fetch("/api/settings/test-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tgForm.token.trim() || undefined, chatId: tgForm.chatId.trim() }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        latencyMs?: number;
        error?: string;
        detail?: string;
      };
      if (d.ok) {
        setTgTest({ busy: false, result: { ok: true, ms: d.latencyMs ?? 0 } });
      } else {
        const msg =
          d.error === "no_token"
            ? u.tgErrNoToken
            : d.error === "no_chat"
              ? u.tgErrNoChat
              : d.error === "timeout"
                ? u.tgErrTimeout
                : d.error === "network"
                  ? u.tgErrNetwork
                  : d.error === "telegram_error" && d.detail
                    ? sfmt(u.tgErrTelegram, { detail: d.detail })
                    : u.tgErrFormat;
        setTgTest({ busy: false, result: { ok: false, msg } });
      }
    } catch {
      setTgTest({ busy: false, result: { ok: false, msg: u.tgErrNetwork } });
    }
  };

  /* ---------- backup ---------- */

  const downloadBackup = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/settings/backup", { cache: "no-store" });
      if (!res.ok) throw new Error("export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sephiroth-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ description: u.bkDone });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setExporting(false);
  };

  const onFilePicked = async (file: File | undefined) => {
    setBackup(null);
    setBackupRaw(null);
    setBackupErr(null);
    setConfirmText("");
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as {
        app?: string;
        exportedAt?: string;
        counts?: BackupSummary["counts"];
        data?: unknown;
      };
      if (parsed.app !== "sephiroth" || !parsed.counts || !parsed.data) {
        setBackupErr(u.bkInvalid);
        return;
      }
      setBackup({
        exportedAt: parsed.exportedAt ?? "",
        counts: parsed.counts,
      });
      setBackupRaw(parsed);
    } catch {
      setBackupErr(u.bkInvalid);
    }
  };

  const doRestore = async () => {
    if (!backupRaw || confirmText !== "RESTORE") return;
    setRestoring(true);
    try {
      const res = await fetch("/api/settings/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESTORE", backup: backupRaw }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        restored?: BackupSummary["counts"];
        error?: string;
      };
      if (d.ok && d.restored) {
        const c = d.restored;
        toast({
          description: sfmt(u.bkRestored, {
            counts: `${c.inbounds} / ${c.users} / ${c.subGroups} / ${c.resellers} / ${c.saleTemplates}`,
          }),
        });
        setBackup(null);
        setBackupRaw(null);
        setConfirmText("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        await load();
      } else if (d.error === "invalid_backup") {
        setBackupErr(u.bkInvalid);
      } else {
        setBackupErr(u.bkFail);
      }
    } catch {
      setBackupErr(u.bkFail);
    }
    setRestoring(false);
  };

  /* ---------- render helpers ---------- */

  const feedLive = coreStatus === "live";
  const xrayErr = (k: XrayField) =>
    xrayErrs[k] ? (
      <p role="alert" className="text-xs text-chart-5">
        {xrayErrs[k]}
      </p>
    ) : null;

  if (loading) {
    return (
      <div className="fade-up space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-11 w-full max-w-md rounded-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
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
          <Settings2 className="h-3 w-3" aria-hidden="true" />
          {u.badge}
        </span>
        <h1 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">
          {t.nav.settings}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{u.subtitle}</p>
        <Tip className="mt-3 max-w-2xl">{u.tipTab}</Tip>
      </section>

      {/* two glass tabs: General / Expert */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-5">
        <TabsList
          className="orbit-pill glass no-scrollbar h-11 w-full gap-1 overflow-x-auto rounded-full p-1.5 lg:w-fit"
          aria-label={t.nav.settings}
        >
          <TabsTrigger
            value="general"
            className={cn(
              "relative h-8 gap-2 rounded-full border-transparent bg-transparent px-4 text-[13px] font-medium text-muted-foreground hover:text-foreground md:px-5 data-[state=active]:border-transparent data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary/20 data-[state=active]:to-primary/5 data-[state=active]:text-foreground",
              tab === "general" && "glow-cyan"
            )}
          >
            <LayoutDashboard
              className={cn("h-3.5 w-3.5", tab === "general" ? "text-primary" : "opacity-70")}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap">{u.tabGeneral}</span>
            {tab === "general" && <span className="orbit-dot" aria-hidden="true" />}
          </TabsTrigger>
          <TabsTrigger
            value="expert"
            className={cn(
              "relative h-8 gap-2 rounded-full border-transparent bg-transparent px-4 text-[13px] font-medium text-muted-foreground hover:text-foreground md:px-5 data-[state=active]:border-transparent data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary/20 data-[state=active]:to-primary/5 data-[state=active]:text-foreground",
              tab === "expert" && "glow-cyan"
            )}
          >
            <Wrench
              className={cn("h-3.5 w-3.5", tab === "expert" ? "text-primary" : "opacity-70")}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap">{u.tabExpert}</span>
            {tab === "expert" && <span className="orbit-dot" aria-hidden="true" />}
          </TabsTrigger>
        </TabsList>

        {/* ═══════════ GENERAL ═══════════ */}
        <TabsContent value="general">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* language */}
            <SectionCard icon={Languages} title={u.langTitle} desc={u.langDesc}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {LANGS.map((l: Lang) => {
                  const active = l === lang;
                  return (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLang(l)}
                      aria-pressed={active}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-gradient-to-br from-primary/25 to-primary/5 text-foreground ring-1 ring-primary/40"
                          : "text-muted-foreground ring-1 ring-border hover:bg-white/5 hover:text-foreground"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {LANG_META[l].code}
                        </span>
                        <span className="truncate">{LANG_META[l].native}</span>
                      </span>
                      {active ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      ) : (
                        <span className="shrink-0 text-[10px] uppercase text-muted-foreground/60">
                          {LANG_META[l].dir}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <Tip className="mt-4">{u.tipLang}</Tip>
            </SectionCard>

            {/* appearance */}
            <SectionCard icon={Palette} title={u.lookTitle} desc={u.lookDesc}>
              <div className="divide-y divide-border/60">
                <SwitchRow
                  label={u.starfield}
                  desc={u.starfieldDesc}
                  checked={starfield}
                  onCheckedChange={setStarfield}
                />
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <p className="text-sm font-medium text-foreground">{u.glow}</p>
                  <div className="flex items-center gap-1.5">
                    <Chip active={glow === "on"} onClick={() => setGlow("on" as GlowPref)}>
                      {u.glowOn}
                    </Chip>
                    <Chip active={glow === "soft"} onClick={() => setGlow("soft" as GlowPref)}>
                      {u.glowSoft}
                    </Chip>
                    <Chip active={glow === "off"} onClick={() => setGlow("off" as GlowPref)}>
                      {u.glowOff}
                    </Chip>
                  </div>
                </div>
                <SwitchRow
                  label={u.motion}
                  desc={u.motionDesc}
                  checked={reduceMotion}
                  onCheckedChange={setReduceMotion}
                />
              </div>
              <Tip className="mt-4">{u.tipLook}</Tip>
            </SectionCard>

            {/* top-bar modules (live) */}
            <SectionCard icon={PanelsTopLeft} title={u.navTitle} desc={u.navDesc}>
              <div className="divide-y divide-border/60">
                <SwitchRow
                  icon={Network}
                  label={u.navHosts}
                  desc={u.navHostsDesc}
                  checked={modules.hosts}
                  onCheckedChange={(v) => toggleModule("hosts", v)}
                />
                <SwitchRow
                  icon={Server}
                  label={u.navNodes}
                  desc={u.navNodesDesc}
                  checked={modules.nodes}
                  onCheckedChange={(v) => toggleModule("nodes", v)}
                />
                <SwitchRow
                  icon={ArrowRightLeft}
                  label={u.navOutbounds}
                  desc={u.navOutboundsDesc}
                  checked={modules.outbounds}
                  onCheckedChange={(v) => toggleModule("outbounds", v)}
                />
                <SwitchRow
                  icon={Route}
                  label={u.navRouting}
                  desc={u.navRoutingDesc}
                  checked={modules.routing}
                  onCheckedChange={(v) => toggleModule("routing", v)}
                />
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Zap className="h-3 w-3 shrink-0 text-primary/80" aria-hidden="true" />
                {u.navHint}
              </p>
            </SectionCard>

            {/* panel preferences */}
            <SectionCard icon={SlidersHorizontal} title={u.panelTitle} desc={u.panelDesc}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="gen-datepicker">{u.datepicker}</Label>
                  <Select
                    value={generalForm.datepicker}
                    onValueChange={(v) =>
                      setGeneralForm((p) => ({
                        ...p,
                        datepicker: v as GeneralSettingsDTO["datepicker"],
                      }))
                    }
                  >
                    <SelectTrigger id="gen-datepicker" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="glass-strong">
                      <SelectItem value="gregorian">{u.dpGregorian}</SelectItem>
                      <SelectItem value="jalalian">{u.dpJalalian}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gen-pagesize">{u.pageSize}</Label>
                  <Input
                    id="gen-pagesize"
                    dir="ltr"
                    inputMode="numeric"
                    className="font-mono"
                    value={generalForm.pageSize}
                    onChange={(e) =>
                      setGeneralForm((p) => ({
                        ...p,
                        pageSize: e.target.value.replace(/[^0-9]/g, ""),
                      }))
                    }
                    placeholder="25"
                  />
                  <p className="text-[11px] text-muted-foreground">{u.pageSizeDesc}</p>
                  {generalErr && (
                    <p role="alert" className="text-xs text-chart-5">
                      {generalErr}
                    </p>
                  )}
                </div>
              </div>
              <div className="pt-4">
                <Button onClick={() => void saveGeneral()} disabled={savingGeneral} className="gap-2">
                  {savingGeneral ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t.subgroups.save}
                </Button>
              </div>
            </SectionCard>

            {/* telegram bot */}
            <SectionCard icon={Send} title={u.tgTitle} desc={u.tgDesc}>
              <div className="space-y-4">
                <SwitchRow
                  label={u.tgEnabled}
                  checked={tgForm.enabled}
                  onCheckedChange={(v) => setTgForm((p) => ({ ...p, enabled: v }))}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="tg-token">{u.tgToken}</Label>
                  <Input
                    id="tg-token"
                    dir="ltr"
                    type="password"
                    autoComplete="off"
                    className="font-mono"
                    value={tgForm.token}
                    onChange={(e) => setTgForm((p) => ({ ...p, token: e.target.value }))}
                    placeholder={tokenConfigured ? tokenMasked : u.tgTokenPh}
                  />
                  {tokenConfigured ? (
                    <p className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>{u.tgTokenKeep}</span>
                      <button
                        type="button"
                        onClick={() => void saveTelegram(null)}
                        disabled={savingTg}
                        className="text-chart-5 underline-offset-2 hover:underline"
                      >
                        {u.tgRemoveToken}
                      </button>
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tg-chat">{u.tgChatId}</Label>
                  <Input
                    id="tg-chat"
                    dir="ltr"
                    className="font-mono"
                    value={tgForm.chatId}
                    onChange={(e) => setTgForm((p) => ({ ...p, chatId: e.target.value }))}
                    placeholder={u.tgChatIdPh}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button onClick={() => void saveTelegram()} disabled={savingTg} className="gap-2">
                    {savingTg ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t.subgroups.save}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void testTelegram()}
                    disabled={tgTest.busy}
                    className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
                  >
                    {tgTest.busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden="true" />
                    )}
                    {tgTest.busy ? u.testing : u.tgTest}
                  </Button>
                </div>
                {tgTest.result && (
                  <p
                    role="status"
                    className={cn(
                      "rounded-lg px-2.5 py-2 text-xs ring-1",
                      tgTest.result.ok
                        ? "bg-chart-3/10 text-chart-3 ring-chart-3/30"
                        : "bg-chart-5/10 text-chart-5 ring-chart-5/30"
                    )}
                    dir="auto"
                  >
                    {tgTest.result.ok ? sfmt(u.testOk, { ms: tgTest.result.ms }) : tgTest.result.msg}
                  </p>
                )}
              </div>
              <Tip className="mt-4">{u.tipTg}</Tip>
            </SectionCard>

            {/* telegram notifications */}
            <SectionCard icon={Sparkles} title={u.tgNotify}>
              <div className="divide-y divide-border/60">
                <SwitchRow
                  label={u.tgNCreated}
                  checked={tgForm.notify.userCreated}
                  onCheckedChange={(v) =>
                    setTgForm((p) => ({ ...p, notify: { ...p.notify, userCreated: v } }))
                  }
                />
                <SwitchRow
                  label={u.tgNExpired}
                  checked={tgForm.notify.userExpired}
                  onCheckedChange={(v) =>
                    setTgForm((p) => ({ ...p, notify: { ...p.notify, userExpired: v } }))
                  }
                />
                <SwitchRow
                  label={u.tgNTraffic}
                  checked={tgForm.notify.trafficAlert}
                  onCheckedChange={(v) =>
                    setTgForm((p) => ({ ...p, notify: { ...p.notify, trafficAlert: v } }))
                  }
                />
                <SwitchRow
                  label={u.tgNLogin}
                  checked={tgForm.notify.loginAlert}
                  onCheckedChange={(v) =>
                    setTgForm((p) => ({ ...p, notify: { ...p.notify, loginAlert: v } }))
                  }
                />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">{u.tgTestDesc}</p>
            </SectionCard>

            {/* backup export */}
            <SectionCard icon={Download} title={u.bkTitle} desc={u.bkDesc}>
              <Button onClick={() => void downloadBackup()} disabled={exporting} className="glow-cyan gap-2">
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4" aria-hidden="true" />
                )}
                {exporting ? u.bkDownloading : u.bkDownload}
              </Button>
              <Tip className="mt-4">{u.tipBackup}</Tip>
            </SectionCard>

            {/* backup restore */}
            <SectionCard
              icon={DatabaseBackup}
              title={u.bkRestoreTitle}
              desc={u.bkRestoreDesc}
              className="ring-1 ring-chart-5/25"
            >
              <div className="space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  id="restore-file"
                  onChange={(e) => void onFilePicked(e.target.files?.[0])}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2 rounded-xl border-border bg-white/4 hover:bg-white/8"
                >
                  <DatabaseBackup className="h-4 w-4" aria-hidden="true" />
                  {u.bkPick}
                </Button>

                {backupErr && (
                  <p role="alert" className="rounded-lg bg-chart-5/10 px-2.5 py-2 text-xs text-chart-5 ring-1 ring-chart-5/30" dir="auto">
                    {backupErr}
                  </p>
                )}

                {backup && (
                  <div className="space-y-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-border/70">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{u.bkExportedAt}</span>
                      <span className="font-mono text-foreground" dir="ltr">
                        {backup.exportedAt ? backup.exportedAt.slice(0, 19).replace("T", " ") : "—"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {[
                        [u.bkInbounds, backup.counts.inbounds],
                        [u.bkUsers, backup.counts.users],
                        [u.bkGroups, backup.counts.subGroups],
                        [u.bkResellers, backup.counts.resellers],
                        [u.bkTemplates, backup.counts.saleTemplates],
                      ].map(([label, value]) => (
                        <div
                          key={String(label)}
                          className="rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-border/60"
                        >
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {label}
                          </p>
                          <p className="font-mono text-sm font-semibold text-foreground" dir="ltr">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="restore-confirm">{u.bkConfirmPh}</Label>
                      <Input
                        id="restore-confirm"
                        dir="ltr"
                        autoComplete="off"
                        className="font-mono"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                        placeholder="RESTORE"
                      />
                      <p className="flex items-center gap-1.5 text-[11px] text-chart-5">
                        <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {u.bkConfirmHint}
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => void doRestore()}
                      disabled={restoring || confirmText !== "RESTORE"}
                      className="gap-2"
                    >
                      {restoring ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <DatabaseBackup className="h-4 w-4" aria-hidden="true" />
                      )}
                      {restoring ? u.bkRestoring : u.bkRestore}
                    </Button>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        {/* ═══════════ EXPERT ═══════════ */}
        <TabsContent value="expert">
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* core driver */}
              <SectionCard icon={RadioTower} title={u.coreTitle} desc={u.coreDesc}>
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="core-driver">{u.driver}</Label>
                      <Select
                        value={coreForm.driver}
                        onValueChange={(v) =>
                          setCoreForm((p) => ({ ...p, driver: v as CoreForm["driver"] }))
                        }
                      >
                        <SelectTrigger id="core-driver" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="glass-strong">
                          <SelectItem value="simulator">{u.driverSim}</SelectItem>
                          <SelectItem value="xray">{u.driverXray}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="core-host">{u.apiHost}</Label>
                      <Input
                        id="core-host"
                        dir="ltr"
                        className="font-mono"
                        value={coreForm.apiHost}
                        onChange={(e) => setCoreForm((p) => ({ ...p, apiHost: e.target.value }))}
                        placeholder="127.0.0.1"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="core-port">{u.apiPort}</Label>
                      <Input
                        id="core-port"
                        dir="ltr"
                        inputMode="numeric"
                        className="font-mono"
                        value={coreForm.apiPort}
                        onChange={(e) =>
                          setCoreForm((p) => ({ ...p, apiPort: e.target.value.replace(/[^0-9]/g, "") }))
                        }
                        placeholder="10085"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="core-tick">{u.tick}</Label>
                      <Select
                        value={coreForm.tickSeconds}
                        onValueChange={(v) => setCoreForm((p) => ({ ...p, tickSeconds: v }))}
                      >
                        <SelectTrigger id="core-tick" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="glass-strong">
                          {["1", "2", "3", "5"].map((s) => (
                            <SelectItem key={s} value={s} dir="ltr">
                              {s} {u.tickSec}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button onClick={() => void saveCore()} disabled={savingCore} className="gap-2">
                      {savingCore ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                      {t.subgroups.save}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void testCore()}
                      disabled={coreTest.busy}
                      className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
                    >
                      {coreTest.busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Wifi className="h-4 w-4" aria-hidden="true" />
                      )}
                      {coreTest.busy ? u.testing : u.coreTest}
                    </Button>
                  </div>

                  {coreTest.result && (
                    <p
                      role="status"
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs ring-1",
                        coreTest.result.ok
                          ? "bg-chart-3/10 text-chart-3 ring-chart-3/30"
                          : "bg-chart-5/10 text-chart-5 ring-chart-5/30"
                      )}
                      dir="auto"
                    >
                      {coreTest.result.ok ? (
                        <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {coreTest.result.ok ? sfmt(u.testOk, { ms: coreTest.result.ms }) : coreTest.result.msg}
                    </p>
                  )}
                </div>
                <Tip className="mt-4">{u.tipCore}</Tip>
              </SectionCard>

              {/* live feed */}
              <SectionCard icon={Sparkles} title={u.feedTitle} desc={u.feedDesc}>
                <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] px-4 py-3.5 ring-1 ring-border/70">
                  <div className="flex items-center gap-2.5">
                    <span className="relative flex h-2.5 w-2.5">
                      {feedLive && (
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      )}
                      <span
                        className={cn(
                          "relative inline-flex h-2.5 w-2.5 rounded-full",
                          feedLive ? "bg-emerald-400" : "bg-chart-5"
                        )}
                      />
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {feedLive ? u.statusLive : u.statusDown}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {coreForm.tickSeconds} {u.tickSec}
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                  <p className="flex items-center justify-between gap-2">
                    <span>{u.driver}</span>
                    <span className="font-medium text-foreground">
                      {coreForm.driver === "simulator" ? u.driverSim : u.driverXray}
                    </span>
                  </p>
                  <p className="flex items-center justify-between gap-2">
                    <span>{u.apiHost}</span>
                    <span className="font-mono text-foreground" dir="ltr">
                      {coreForm.apiHost}
                    </span>
                  </p>
                  <p className="flex items-center justify-between gap-2">
                    <span>{u.apiPort}</span>
                    <span className="font-mono text-foreground" dir="ltr">
                      {coreForm.apiPort}
                    </span>
                  </p>
                </div>
              </SectionCard>
            </div>

            {/* xray configs */}
            <SectionCard icon={Braces} title={u.xrayTitle} desc={u.xrayDesc}>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="x-log">{u.logLevel}</Label>
                    <Select
                      value={expertForm.logLevel}
                      onValueChange={(v) =>
                        setExpertForm((p) => ({ ...p, logLevel: v as ExpertForm["logLevel"] }))
                      }
                    >
                      <SelectTrigger id="x-log" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="glass-strong">
                        <SelectItem value="none">{u.logNone}</SelectItem>
                        <SelectItem value="warning">{u.logWarning}</SelectItem>
                        <SelectItem value="info">{u.logInfo}</SelectItem>
                        <SelectItem value="debug">{u.logDebug}</SelectItem>
                      </SelectContent>
                    </Select>
                    {xrayErr("logLevel")}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="x-dom">{u.domStrategy}</Label>
                    <Select
                      value={expertForm.domainStrategy}
                      onValueChange={(v) =>
                        setExpertForm((p) => ({
                          ...p,
                          domainStrategy: v as ExpertForm["domainStrategy"],
                        }))
                      }
                    >
                      <SelectTrigger id="x-dom" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="glass-strong">
                        <SelectItem value="AsIs">{u.strategyAsIs}</SelectItem>
                        <SelectItem value="IPIfNonMatch">{u.strategyIPIfNonMatch}</SelectItem>
                        <SelectItem value="IPOnDemand">{u.strategyIPOnDemand}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">{u.domStrategyDesc}</p>
                    {xrayErr("domainStrategy")}
                  </div>
                  <div className="space-y-1.5 sm:max-lg:col-span-2">
                    <Label htmlFor="x-freedom">{u.freedomStrategy}</Label>
                    <Select
                      value={expertForm.freedomStrategy}
                      onValueChange={(v) =>
                        setExpertForm((p) => ({
                          ...p,
                          freedomStrategy: v as ExpertForm["freedomStrategy"],
                        }))
                      }
                    >
                      <SelectTrigger id="x-freedom" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="glass-strong">
                        <SelectItem value="AsIs">{u.freedomAsIs}</SelectItem>
                        <SelectItem value="UseIP">{u.freedomUseIP}</SelectItem>
                        <SelectItem value="UseIPv4">{u.freedomV4}</SelectItem>
                        <SelectItem value="UseIPv6">{u.freedomV6}</SelectItem>
                      </SelectContent>
                    </Select>
                    {xrayErr("freedomStrategy")}
                  </div>
                </div>

                <div className="space-y-1.5 rounded-xl bg-white/[0.02] p-3 ring-1 ring-border/50">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {u.dnsTitle}
                  </p>
                  <Label htmlFor="x-dns">{u.dnsServers}</Label>
                  <Textarea
                    id="x-dns"
                    dir="ltr"
                    rows={4}
                    className="font-mono text-xs"
                    value={expertForm.dnsServers}
                    onChange={(e) =>
                      setExpertForm((p) => ({ ...p, dnsServers: e.target.value }))
                    }
                    placeholder={u.dnsPh}
                  />
                  <p className="text-[11px] text-muted-foreground">{u.dnsDesc}</p>
                  {xrayErr("dnsServers")}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="x-idle">{u.connIdle}</Label>
                    <Input
                      id="x-idle"
                      dir="ltr"
                      inputMode="numeric"
                      className="font-mono"
                      value={expertForm.connIdle}
                      onChange={(e) =>
                        setExpertForm((p) => ({ ...p, connIdle: e.target.value.replace(/[^0-9]/g, "") }))
                      }
                      placeholder="300"
                    />
                    <p className="text-[11px] text-muted-foreground">{u.connIdleDesc}</p>
                    {xrayErr("connIdle")}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="x-buf">{u.bufferSize}</Label>
                    <Input
                      id="x-buf"
                      dir="ltr"
                      inputMode="numeric"
                      className="font-mono"
                      value={expertForm.bufferSize}
                      onChange={(e) =>
                        setExpertForm((p) => ({ ...p, bufferSize: e.target.value.replace(/[^0-9]/g, "") }))
                      }
                      placeholder="512"
                    />
                    <p className="text-[11px] text-muted-foreground">{u.bufferSizeDesc}</p>
                    {xrayErr("bufferSize")}
                  </div>
                </div>

                <div className="pt-1">
                  <Button onClick={() => void saveXray()} disabled={savingXray} className="gap-2">
                    {savingXray ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t.subgroups.save}
                  </Button>
                </div>
              </div>
            </SectionCard>

            {/* raw JSON template */}
            <SectionCard icon={FileJson} title={u.jsonTitle} desc={u.jsonDesc}>
              <div className="space-y-3">
                <Textarea
                  dir="ltr"
                  rows={8}
                  className="h-40 resize-y font-mono text-xs"
                  value={rawJson}
                  onChange={(e) => {
                    setRawJson(e.target.value);
                    if (jsonErr) setJsonErr(null);
                  }}
                  placeholder={u.jsonPh}
                  aria-invalid={jsonErr ? true : undefined}
                  spellCheck={false}
                />
                {jsonErr && (
                  <p role="alert" className="font-mono text-xs text-chart-5" dir="ltr">
                    {jsonErr}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void saveRawJson()} disabled={savingJson} className="gap-2">
                    {savingJson ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t.subgroups.save}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setJsonResetOpen(true)}
                    disabled={savingJson}
                    className="gap-2 text-chart-5 hover:bg-chart-5/10 hover:text-chart-5"
                  >
                    <RotateCw className="h-4 w-4" aria-hidden="true" />
                    {u.jsonReset}
                  </Button>
                </div>
              </div>
            </SectionCard>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* certificates */}
              <SectionCard icon={KeyRound} title={u.certTitle} desc={u.certDesc}>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cert-file">{u.certFile}</Label>
                    <Input
                      id="cert-file"
                      dir="ltr"
                      className="font-mono"
                      value={certForm.certFile}
                      onChange={(e) => setCertForm((p) => ({ ...p, certFile: e.target.value }))}
                      placeholder={u.certFilePh}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="key-file">{u.keyFile}</Label>
                    <Input
                      id="key-file"
                      dir="ltr"
                      className="font-mono"
                      value={certForm.keyFile}
                      onChange={(e) => setCertForm((p) => ({ ...p, keyFile: e.target.value }))}
                      placeholder={u.keyFilePh}
                    />
                  </div>
                  {certErr && (
                    <p role="alert" className="text-xs text-chart-5">
                      {certErr}
                    </p>
                  )}
                  <div className="pt-1">
                    <Button onClick={() => void saveCert()} disabled={savingCert} className="gap-2">
                      {savingCert ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                      {t.subgroups.save}
                    </Button>
                  </div>
                </div>
              </SectionCard>

              {/* sessions */}
              <SectionCard icon={Timer} title={u.sessionTitle} desc={u.sessionDesc}>
                <div className="space-y-1.5">
                  <Label htmlFor="session-age">{u.sessionAge}</Label>
                  <Input
                    id="session-age"
                    dir="ltr"
                    inputMode="numeric"
                    className="font-mono"
                    value={sessionAge}
                    onChange={(e) =>
                      setSessionAge(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="360"
                  />
                  <p className="text-[11px] text-muted-foreground">{u.sessionAgeDesc}</p>
                  {sessionErr && (
                    <p role="alert" className="text-xs text-chart-5">
                      {sessionErr}
                    </p>
                  )}
                </div>
                <div className="pt-4">
                  <Button onClick={() => void saveSession()} disabled={savingSession} className="gap-2">
                    {savingSession ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t.subgroups.save}
                  </Button>
                </div>
              </SectionCard>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* raw JSON reset confirm */}
      <AlertDialog open={jsonResetOpen} onOpenChange={setJsonResetOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{u.jsonResetTitle}</AlertDialogTitle>
            <AlertDialogDescription>{u.jsonResetDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.inbounds.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setJsonResetOpen(false);
                void saveRawJson("");
              }}
            >
              {u.jsonResetBtn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
