"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  BookOpen,
  Braces,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  DatabaseBackup,
  Download,
  ExternalLink,
  FileJson,
  KeyRound,
  Languages,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  Network,
  Palette,
  PanelsTopLeft,
  Play,
  RadioTower,
  RefreshCw,
  RotateCw,
  Route,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Timer,
  Trash2,
  TriangleAlert,
  Wifi,
  WifiOff,
  Wrench,
  Zap,
} from "lucide-react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SwaggerEmbed } from "@/components/sephiroth/swagger-embed";
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
import { TelegramBotPanel } from "@/components/sephiroth/views/telegram-bot-panel";
import { TelegramBotSettings } from "@/components/sephiroth/views/telegram-bot-settings"; // Task 23-a — bot card
import { DiscordBotSettings } from "@/components/sephiroth/views/discord-bot-settings"; // v2.7 — Discord bot card
import { WebhooksCard } from "@/components/sephiroth/views/webhooks-card"; // v2.7 — outbound webhooks card
import { DiscountCodesCard } from "@/components/sephiroth/views/discount-codes-card"; // Task 2-d — discount codes card
import { ReferralCard } from "@/components/sephiroth/views/referral-card"; // Task 2-d — referral settings + stats card
import { BroadcastCard } from "@/components/sephiroth/views/broadcast-card"; // Task 2-e — broadcast queue card
import { AbuseCard } from "@/components/sephiroth/views/abuse-card"; // Task 2-e — anti-abuse card
import { UpdatesCard } from "@/components/sephiroth/views/updates-card"; // Task 3-c — release channel + update check card
import { SslCard } from "@/components/sephiroth/views/ssl-card"; // Task 23-f — SSL/ACME card

/* ============================================================
   Sephiroth · Phase 8 — Settings & System (admin)
   Two tabs: General (language, appearance, top-bar modules,
   panel preferences, Telegram bot, backup) and Expert (core
   driver + real TCP test, Xray configs, raw JSON template,
   TLS certificates, session lifetime). Password / recovery
   key / session-revocation moved to the Profile view.
   All strings ×6 languages.
   ============================================================ */

type TabId = "general" | "api" | "expert";

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
  xrayBin?: string;
  xrayVersion?: string;
  statsInterval?: number;
  hysteriaVersion?: string;
  hysteriaBin?: string;
  enforceIpLimit?: boolean;
}

interface CoreStatusDTO {
  kind: "sim" | "xray";
  running: boolean;
  version: string;
  pid: number | null;
  startedAt: number;
  uptimeMs: number;
  apiPort: number | null;
  configPath: string | null;
  lastError: string;
  restarts: number;
  fallbackActive: boolean;
  fallbackReason: string;
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
    dailyDigest: boolean;
  };
  botMode: "console" | "sales";
  adminChatIds: string[];
  botProxyUrl: string;
  shopLang: "fa" | "en";
}

interface GeneralSettingsDTO {
  datepicker: "gregorian" | "jalalian";
  pageSize: number;
  publicHost?: string;
  /* Task 1-b — panel-level subscription branding (fallback when no reseller brand) */
  subBrandName?: string;
  subBrandLogo?: string;
  subBrandAccent?: string;
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

interface SecuritySettingsDTO {
  autoBackupEnabled: boolean;
  autoBackupKeep: number;
  totpEnabled: boolean;
  totpConfigured: boolean;
}

interface UpdateInfoDTO {
  current: string;
  latest: string;
  updateAvailable: boolean;
  repoUrl: string;
  isGit: boolean;
  remoteName: string;
}

interface UpdateStatusDTO {
  runId: string;
  state: "pending" | "success" | "failed";
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
}

interface ServerBackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

interface CoreForm {
  driver: "simulator" | "xray";
  apiHost: string;
  apiPort: string;
  tickSeconds: string;
  enforceIpLimit: boolean;
}

interface TgForm {
  enabled: boolean;
  token: string;
  chatId: string;
  notify: TelegramSettingsDTO["notify"];
  botMode: "console" | "sales";
  adminChatIds: string; // raw comma-separated text
  botProxyUrl: string;
  shopLang: "fa" | "en";
}

interface BotStatusDTO {
  mode: "console" | "sales";
  running: boolean;
  startedAt: string | null;
  lastPollAt: string | null;
  handledUpdates: number;
  errors: number;
  lastError: string;
  adminChatIds: number;
  tokenConfigured: boolean;
}

interface ApiTokenDTO {
  id: string;
  name: string;
  prefix: string;
  enabled: boolean;
  lastUsedAt: string | null;
  lastUsedIp: string;
  createdAt: string;
}

interface GeneralForm {
  datepicker: "gregorian" | "jalalian";
  pageSize: string;
  subBrandName: string;
  subBrandLogo: string;
  subBrandAccent: string;
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
  const sys = t.system;
  const core = t.core;

  const [tab, setTab] = useState<TabId>("general");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);

  const [coreForm, setCoreForm] = useState<CoreForm>({
    driver: "simulator",
    apiHost: "127.0.0.1",
    apiPort: "10085",
    tickSeconds: "1",
    enforceIpLimit: false,
  });
  const [tgForm, setTgForm] = useState<TgForm>({
    enabled: false,
    token: "",
    chatId: "",
    notify: { userCreated: true, userExpired: true, trafficAlert: true, loginAlert: false, dailyDigest: false },
    botMode: "console",
    adminChatIds: "",
    botProxyUrl: "",
    shopLang: "en",
  });
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [tokenMasked, setTokenMasked] = useState("");
  const [botStatus, setBotStatus] = useState<BotStatusDTO | null>(null);

  /* Phase 27 — public API tokens */
  const [apiTokens, setApiTokens] = useState<ApiTokenDTO[]>([]);
  const [apiTokensLoaded, setApiTokensLoaded] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [minting, setMinting] = useState(false);
  const [mintedRaw, setMintedRaw] = useState("");

  const [generalForm, setGeneralForm] = useState<GeneralForm>({
    datepicker: "gregorian",
    pageSize: "25",
    subBrandName: "",
    subBrandLogo: "",
    subBrandAccent: "",
  });
  const [generalErr, setGeneralErr] = useState<string | null>(null);
  const [brandErr, setBrandErr] = useState<string | null>(null);
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

  /* core / xray driver (v2.4) — real-process controls */
  const [coreStat, setCoreStat] = useState<CoreStatusDTO | null>(null);
  const [xrayBinDraft, setXrayBinDraft] = useState("");
  const [xrayVersionDraft, setXrayVersionDraft] = useState("");
  const [hysteriaVersionDraft, setHysteriaVersionDraft] = useState("");
  const [statsIntervalDraft, setStatsIntervalDraft] = useState("10");
  const [coreBusy, setCoreBusy] = useState<"" | "install" | "start" | "stop" | "restart" | "reload" | "save">("");
  const [logOpen, setLogOpen] = useState(false);
  const [coreLogLines, setCoreLogLines] = useState<string[]>([]);

  /* backup */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<BackupSummary | null>(null);
  const [backupRaw, setBackupRaw] = useState<unknown>(null);
  const [backupErr, setBackupErr] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  /* security / system (v2.2) — self-update, auto backup, TOTP, MTProto */
  const [sec, setSec] = useState<SecuritySettingsDTO>({
    autoBackupEnabled: false,
    autoBackupKeep: 7,
    totpEnabled: false,
    totpConfigured: false,
  });
  const [abKeepDraft, setAbKeepDraft] = useState("7");
  const [abList, setAbList] = useState<ServerBackupFile[]>([]);
  const [abLastRun, setAbLastRun] = useState("");
  const [abBusy, setAbBusy] = useState(false);
  const [upd, setUpd] = useState<UpdateInfoDTO | null>(null);
  const [updState, setUpdState] = useState<"idle" | "checking" | "updating" | "success" | "failed">("idle");
  const [updNote, setUpdNote] = useState<string | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [totpEnroll, setTotpEnroll] = useState(false);
  const [totpSecretGen, setTotpSecretGen] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpErr, setTotpErr] = useState<string | null>(null);
  const [mtpHost, setMtpHost] = useState("");
  const [mtpPort, setMtpPort] = useState("443");
  const [mtpMode, setMtpMode] = useState<"dd" | "plain">("dd");
  const [mtpSecret, setMtpSecret] = useState("");

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
        security: SecuritySettingsDTO;
      };
      setCoreForm({
        driver: d.core.driver,
        apiHost: d.core.apiHost,
        apiPort: String(d.core.apiPort),
        tickSeconds: String(d.core.tickSeconds),
        enforceIpLimit: d.core.enforceIpLimit === true,
      });
      setXrayBinDraft(d.core.xrayBin ?? "");
      setXrayVersionDraft(d.core.xrayVersion ?? "");
      setHysteriaVersionDraft(d.core.hysteriaVersion ?? "");
      setStatsIntervalDraft(String(d.core.statsInterval ?? 10));
      setTgForm({
        enabled: d.telegram.enabled,
        token: "",
        chatId: d.telegram.chatId,
        notify: d.telegram.notify,
        botMode: d.telegram.botMode ?? "console",
        adminChatIds: (d.telegram.adminChatIds ?? []).join(", "),
        botProxyUrl: d.telegram.botProxyUrl ?? "",
        shopLang: d.telegram.shopLang ?? "en",
      });
      setTokenConfigured(d.telegram.tokenConfigured);
      setTokenMasked(d.telegram.tokenMasked);
      setGeneralForm({
        datepicker: d.general.datepicker,
        pageSize: String(d.general.pageSize),
        subBrandName: d.general.subBrandName ?? "",
        subBrandLogo: d.general.subBrandLogo ?? "",
        subBrandAccent: d.general.subBrandAccent ?? "",
      });
      setSec(d.security);
      setAbKeepDraft(String(d.security.autoBackupKeep));
      if (!mtpHost && d.general.publicHost) setMtpHost(d.general.publicHost);
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

  /* ---------- server backups / system (v2.2) ---------- */

  const loadServerBackups = useCallback(async () => {
    try {
      const res = await fetch("/api/system/backups", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { backups: ServerBackupFile[]; lastRun: string };
      setAbList(d.backups ?? []);
      setAbLastRun(d.lastRun ?? "");
    } catch {
      /* silent — the card keeps its last state */
    }
  }, []);

  useEffect(() => {
    void loadServerBackups();
  }, [loadServerBackups]);

  /* ---------- Phase 27 — public API tokens ---------- */

  const loadApiTokens = useCallback(async () => {
    try {
      const res = await fetch("/api/api-tokens", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { tokens: ApiTokenDTO[] };
      setApiTokens(d.tokens ?? []);
      setApiTokensLoaded(true);
    } catch {
      /* silent — the card keeps its last state */
    }
  }, []);

  useEffect(() => {
    if (tab === "api") void loadApiTokens();
  }, [tab, loadApiTokens]);

  const mintApiToken = async () => {
    const name = newTokenName.trim();
    if (!name || minting) return;
    setMinting(true);
    try {
      const res = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !d.token) {
        toast({ description: t.inbounds.errGeneric, variant: "destructive" });
        return;
      }
      setMintedRaw(d.token);
      setNewTokenName("");
      await loadApiTokens();
      toast({ description: u.apiTokenCreatedToast });
    } catch {
      toast({ description: t.inbounds.errGeneric, variant: "destructive" });
    } finally {
      setMinting(false);
    }
  };

  const revokeApiToken = async (row: ApiTokenDTO) => {
    try {
      const res = await fetch(`/api/api-tokens/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ description: t.inbounds.errGeneric, variant: "destructive" });
        return;
      }
      await loadApiTokens();
      toast({ description: u.apiTokenRevokedToast });
    } catch {
      toast({ description: t.inbounds.errGeneric, variant: "destructive" });
    }
  };

  const toggleApiToken = async (row: ApiTokenDTO, enabled: boolean) => {
    try {
      const res = await fetch(`/api/api-tokens/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) return;
      await loadApiTokens();
    } catch {
      /* silent */
    }
  };

  const saveSecurityQuick = async (
    patch: Record<string, unknown>
  ): Promise<true | "invalid" | false> => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "security", ...patch }),
      });
      if (!res.ok) return res.status === 400 ? "invalid" : false;
      const d = (await res.json()) as { security: SecuritySettingsDTO };
      setSec(d.security);
      setAbKeepDraft(String(d.security.autoBackupKeep));
      return true;
    } catch {
      return false;
    }
  };

  const saveAbKeep = async (raw: string) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      setAbKeepDraft(String(sec.autoBackupKeep));
      return;
    }
    await saveSecurityQuick({ autoBackupKeep: n });
  };

  const runBackupNow = async () => {
    setAbBusy(true);
    try {
      const res = await fetch("/api/system/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      if (!res.ok) throw new Error("run");
      toast({ description: sys.abDone });
      await loadServerBackups();
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setAbBusy(false);
  };

  const downloadServerBackup = async (name: string) => {
    try {
      const res = await fetch(`/api/system/backups?name=${encodeURIComponent(name)}&dl=1`);
      if (!res.ok) throw new Error("dl");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
  };

  const deleteServerBackup = async (name: string) => {
    try {
      const res = await fetch(`/api/system/backups?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("del");
      await loadServerBackups();
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
  };

  /* ---------- software self-update (v2.2) ---------- */

  const checkUpdate = async () => {
    setUpdState("checking");
    setUpdNote(null);
    try {
      const res = await fetch("/api/system/update-info", { cache: "no-store" });
      const d = (await res.json()) as UpdateInfoDTO & { error?: string };
      if (!res.ok || d.error) {
        setUpdState("failed");
        setUpdNote(sys.updCheckFail);
        return;
      }
      setUpd(d);
      setUpdState("idle");
      setUpdNote(d.updateAvailable ? sys.updAvailable : sys.updUpToDate);
    } catch {
      setUpdState("failed");
      setUpdNote(sys.updCheckFail);
    }
  };

  const pollUpdateStatus = (runId: string): Promise<void> =>
    new Promise((resolve) => {
      const started = Date.now();
      const tick = async () => {
        try {
          const res = await fetch("/api/system/update-status", { cache: "no-store" });
          const d = (await res.json()) as { status: UpdateStatusDTO | null };
          if (d.status && d.status.runId === runId && d.status.state !== "pending") {
            resolve();
            return;
          }
        } catch {
          /* keep polling */
        }
        if (Date.now() - started > 10 * 60_000) {
          resolve();
          return;
        }
        setTimeout(() => void tick(), 3000);
      };
      void tick();
    });

  const applyUpdate = async () => {
    setUpdState("updating");
    setUpdNote(null);
    try {
      const res = await fetch("/api/system/update", { method: "POST" });
      const d = (await res.json()) as { ok?: boolean; runId?: string; reason?: string };
      if (!res.ok || !d.ok || !d.runId) {
        setUpdState("failed");
        setUpdNote(d.reason === "not_git" || d.reason === "no_remote" ? sys.updNotGitHint : sys.updFailed);
        return;
      }
      await pollUpdateStatus(d.runId);
      const st = (await (await fetch("/api/system/update-status", { cache: "no-store" })).json()) as {
        status: UpdateStatusDTO | null;
      };
      if (st.status?.state === "success") {
        setUpdState("success");
        setUpdNote(sys.updSuccess);
      } else {
        setUpdState("failed");
        setUpdNote(sys.updFailed);
      }
    } catch {
      setUpdState("failed");
      setUpdNote(sys.updFailed);
    }
  };

  const restartPanel = async () => {
    setRestartBusy(true);
    try {
      await fetch("/api/system/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESTART" }),
      });
    } catch {
      /* restarting anyway */
    }
    setTimeout(() => {
      window.location.reload();
    }, 2500);
  };

  /* ---------- TOTP 2FA (v2.2) ---------- */

  const totpUri = useMemo(
    () =>
      `otpauth://totp/Sephiroth:admin?secret=${totpSecretGen}&issuer=Sephiroth&algorithm=SHA1&digits=6&period=30`,
    [totpSecretGen]
  );

  const totpBegin = () => {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    let bits = 0;
    let val = 0;
    let out = "";
    for (const b of bytes) {
      val = (val << 8) | b;
      bits += 8;
      while (bits >= 5) {
        out += A[(val >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += A[(val << (5 - bits)) & 31];
    setTotpSecretGen(out);
    setTotpCode("");
    setTotpErr(null);
    setTotpEnroll(true);
  };

  const totpCancelEnroll = () => {
    setTotpEnroll(false);
    setTotpSecretGen("");
    setTotpCode("");
    setTotpErr(null);
  };

  const totpVerifyEnroll = async () => {
    setTotpBusy(true);
    setTotpErr(null);
    const r = await saveSecurityQuick({ totpSecret: totpSecretGen, totpCode, totpEnabled: true });
    if (r === true) {
      toast({ description: sys.totpOn });
      totpCancelEnroll();
    } else if (r === "invalid") {
      setTotpErr(sys.totpInvalid);
    } else {
      toast({ description: t.inbounds.errGeneric });
    }
    setTotpBusy(false);
  };

  const totpDisable = async () => {
    setTotpBusy(true);
    setTotpErr(null);
    const r = await saveSecurityQuick({ totpEnabled: false, totpCode });
    if (r === true) {
      toast({ description: sys.totpOff });
      setTotpCode("");
    } else if (r === "invalid") {
      setTotpErr(sys.totpInvalid);
    } else {
      toast({ description: t.inbounds.errGeneric });
    }
    setTotpBusy(false);
  };

  /** re-enable 2FA on an existing secret (code verified server-side) */
  const totpReenable = async () => {
    setTotpBusy(true);
    setTotpErr(null);
    const r = await saveSecurityQuick({ totpEnabled: true, totpCode });
    if (r === true) {
      toast({ description: sys.totpOn });
      setTotpCode("");
    } else if (r === "invalid") {
      setTotpErr(sys.totpInvalid);
    } else {
      toast({ description: t.inbounds.errGeneric });
    }
    setTotpBusy(false);
  };

  /* ---------- MTProto proxy generator (v2.2) ---------- */

  const mtpGenerate = () => {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    setMtpSecret(mtpMode === "dd" ? `dd${hex}` : hex);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ description: t.inbounds.toastCopied });
    } catch {
      toast({ description: t.inbounds.toastFail, variant: "destructive" });
    }
  };

  const mtpHostClean = mtpHost.trim();
  const mtpLinkTg =
    mtpSecret && mtpHostClean
      ? `tg://proxy?server=${encodeURIComponent(mtpHostClean)}&port=${mtpPort}&secret=${mtpSecret}`
      : "";
  const mtpLinkHttps =
    mtpSecret && mtpHostClean
      ? `https://t.me/proxy?server=${encodeURIComponent(mtpHostClean)}&port=${mtpPort}&secret=${mtpSecret}`
      : "";
  const mtpSetupCmds = `# 1) mtg v2 — FakeTLS daemon (recommended)
docker run -d --name mtg --restart=always -p ${mtpPort || "443"}:3128 ghcr.io/9seconds/mtg/v2:latest \\
  simple-run -n 16 "$(docker run --rm ghcr.io/9seconds/mtg/v2:latest generate-secret tls -c cloudflare.com)"

# 2) erlang MTProtoProxy — uses the secret generated above
docker run -d --name mtproxy --restart=always -p ${mtpPort || "443"}:443 \\
  -e SECRET=${mtpSecret || "<secret>"} seriyps777/mtproto-proxy:latest

# invite link
# ${mtpLinkTg || "tg://proxy?server=<host>&port=<port>&secret=<secret>"}`;

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
    setBrandErr(null);
    setSavingGeneral(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "general",
          datepicker: generalForm.datepicker,
          pageSize,
          subBrandName: generalForm.subBrandName.trim(),
          subBrandLogo: generalForm.subBrandLogo.trim(),
          subBrandAccent: generalForm.subBrandAccent.trim(),
        }),
      });
      if (!res.ok) {
        if (res.status === 400) {
          /* validateGeneralPatch field errors → inline text under the field */
          try {
            const e = (await res.json()) as { fields?: { field: string; code: string }[] };
            const f = e.fields?.find(
              (x) => x.field === "subBrandName" || x.field === "subBrandLogo" || x.field === "subBrandAccent"
            );
            if (f) {
              const label =
                f.field === "subBrandLogo"
                  ? u.subBrandLogo
                  : f.field === "subBrandAccent"
                    ? u.subBrandAccent
                    : u.subBrandName;
              setBrandErr(`${label} · ${f.code}`);
              return;
            }
          } catch {
            /* fall through to the generic message */
          }
          setGeneralErr(u.pageSizeDesc);
          return;
        }
        throw new Error("save");
      }
      const d = (await res.json()) as { general: GeneralSettingsDTO };
      setGeneralForm({
        datepicker: d.general.datepicker,
        pageSize: String(d.general.pageSize),
        subBrandName: d.general.subBrandName ?? "",
        subBrandLogo: d.general.subBrandLogo ?? "",
        subBrandAccent: d.general.subBrandAccent ?? "",
      });
      toast({ description: u.generalSaved });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    } finally {
      setSavingGeneral(false);
    }
  };

  /* ---------- core ---------- */

  const loadCoreStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/system/core-status", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { status: CoreStatusDTO };
      setCoreStat(d.status);
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    void loadCoreStatus();
    const iv = setInterval(() => void loadCoreStatus(), 10_000);
    return () => clearInterval(iv);
  }, [loadCoreStatus]);

  /* collapsible log viewer — refresh on a 5s poll while open */
  useEffect(() => {
    if (!logOpen) return;
    let alive = true;
    const pull = async (): Promise<void> => {
      try {
        const res = await fetch("/api/system/core-log?n=40", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as { lines: string[] };
        if (alive) setCoreLogLines(d.lines ?? []);
      } catch {
        /* keep last known */
      }
    };
    void pull();
    const iv = setInterval(() => void pull(), 5_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [logOpen]);

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
          xrayBin: xrayBinDraft.trim(),
          xrayVersion: xrayVersionDraft.trim(),
          hysteriaVersion: hysteriaVersionDraft.trim(),
          statsInterval: Math.max(5, Math.min(120, Number(statsIntervalDraft) || 10)),
          enforceIpLimit: coreForm.enforceIpLimit,
        }),
      });
      if (!res.ok) throw new Error("save");
      const d = (await res.json()) as { core: CoreSettingsDTO };
      setCoreForm((p) => ({
        ...p,
        driver: d.core.driver,
        apiHost: d.core.apiHost,
        apiPort: String(d.core.apiPort),
        tickSeconds: String(d.core.tickSeconds),
        enforceIpLimit: d.core.enforceIpLimit === true,
      }));
      setXrayBinDraft(d.core.xrayBin ?? "");
      setXrayVersionDraft(d.core.xrayVersion ?? "");
      setHysteriaVersionDraft(d.core.hysteriaVersion ?? "");
      setStatsIntervalDraft(String(d.core.statsInterval ?? 10));
      toast({ description: u.coreSaved });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setSavingCore(false);
  };

  const saveCoreCard = async () => {
    setCoreBusy("save");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "core",
          driver: coreForm.driver,
          xrayBin: xrayBinDraft.trim(),
          xrayVersion: xrayVersionDraft.trim(),
          hysteriaVersion: hysteriaVersionDraft.trim(),
          statsInterval: Math.max(5, Math.min(120, Number(statsIntervalDraft) || 10)),
          enforceIpLimit: coreForm.enforceIpLimit,
        }),
      });
      if (!res.ok) throw new Error("save");
      const d = (await res.json()) as { core: CoreSettingsDTO };
      setCoreForm((p) => ({ ...p, driver: d.core.driver, enforceIpLimit: d.core.enforceIpLimit === true }));
      setXrayBinDraft(d.core.xrayBin ?? "");
      setXrayVersionDraft(d.core.xrayVersion ?? "");
      setHysteriaVersionDraft(d.core.hysteriaVersion ?? "");
      setStatsIntervalDraft(String(d.core.statsInterval ?? 10));
      toast({ description: u.coreSaved });
      void loadCoreStatus();
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setCoreBusy("");
  };

  const coreAction = async (action: "start" | "stop" | "restart" | "reload") => {
    setCoreBusy(action);
    try {
      const res = await fetch("/api/system/core-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = (await res.json()) as { ok?: boolean; message?: string; status?: CoreStatusDTO };
      if (d.status) setCoreStat(d.status);
      if (d.ok) {
        toast({
          description:
            action === "start"
              ? core.actStart
              : action === "stop"
                ? core.actStop
                : action === "restart"
                  ? core.actRestart
                  : core.actReload,
        });
      } else {
        const noop = d.message === "sim_selected" || d.message === "sim_no_stop";
        toast({ description: noop ? core.actNoop : core.actFail });
      }
    } catch {
      toast({ description: core.actFail });
    }
    setCoreBusy("");
    void loadCoreStatus();
  };

  const coreInstall = async () => {
    setCoreBusy("install");
    try {
      const res = await fetch("/api/system/core-install", { method: "POST" });
      const d = (await res.json()) as { ok?: boolean; version?: string };
      if (d.ok) {
        toast({ description: sfmt(core.installOk, { v: d.version ?? "" }) });
      } else {
        toast({ description: core.installFail });
      }
    } catch {
      toast({ description: core.installFail });
    }
    setCoreBusy("");
    void loadCoreStatus();
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
          botMode: tgForm.botMode,
          adminChatIds: tgForm.adminChatIds.trim(),
          botProxyUrl: tgForm.botProxyUrl.trim(),
          shopLang: tgForm.shopLang,
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            value="api"
            className={cn(
              "relative h-8 gap-2 rounded-full border-transparent bg-transparent px-4 text-[13px] font-medium text-muted-foreground hover:text-foreground md:px-5 data-[state=active]:border-transparent data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary/20 data-[state=active]:to-primary/5 data-[state=active]:text-foreground",
              tab === "api" && "glow-cyan"
            )}
          >
            <Braces
              className={cn("h-3.5 w-3.5", tab === "api" ? "text-primary" : "opacity-70")}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap">{u.tabApi}</span>
            {tab === "api" && <span className="orbit-dot" aria-hidden="true" />}
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

            {/* Task 1-b — subscription branding (fallback when no reseller brand) */}
            <SectionCard icon={Sparkles} title={u.subBrandTitle} desc={u.subBrandDesc}>
              <div className="grid gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="gen-brand-name">{u.subBrandName}</Label>
                  <Input
                    id="gen-brand-name"
                    value={generalForm.subBrandName}
                    maxLength={40}
                    onChange={(e) =>
                      setGeneralForm((p) => ({ ...p, subBrandName: e.target.value }))
                    }
                    placeholder={u.subBrandNamePh}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gen-brand-logo">{u.subBrandLogo}</Label>
                  <Input
                    id="gen-brand-logo"
                    dir="ltr"
                    className="font-mono"
                    value={generalForm.subBrandLogo}
                    maxLength={500}
                    onChange={(e) =>
                      setGeneralForm((p) => ({ ...p, subBrandLogo: e.target.value }))
                    }
                    placeholder={u.subBrandLogoPh}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gen-brand-accent">{u.subBrandAccent}</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="gen-brand-accent"
                      type="color"
                      aria-label={u.subBrandAccent}
                      className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-1"
                      value={
                        /^#[0-9a-fA-F]{6}$/.test(generalForm.subBrandAccent)
                          ? generalForm.subBrandAccent
                          : "#22d8ee"
                      }
                      onChange={(e) =>
                        setGeneralForm((p) => ({ ...p, subBrandAccent: e.target.value }))
                      }
                    />
                    <Input
                      dir="ltr"
                      className="flex-1 font-mono"
                      value={generalForm.subBrandAccent}
                      maxLength={7}
                      onChange={(e) =>
                        setGeneralForm((p) => ({ ...p, subBrandAccent: e.target.value }))
                      }
                      placeholder="#22d8ee"
                    />
                  </div>
                </div>
                {brandErr && (
                  <p role="alert" className="text-xs text-chart-5">
                    {brandErr}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setGeneralForm((p) => ({ ...p, subBrandName: "", subBrandLogo: "", subBrandAccent: "" }))
                    }
                    className="h-8 gap-1.5 border-white/10 bg-white/[0.03] text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {u.subBrandReset}
                  </Button>
                  <Button onClick={() => void saveGeneral()} disabled={savingGeneral} className="gap-2">
                    {savingGeneral ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t.subgroups.save}
                  </Button>
                </div>
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

            {/* telegram bot (23-a — worker / sales config + live pill) */}
            <TelegramBotSettings />

            {/* v2.7 — Discord bot (gateway worker + live pill) */}
            <DiscordBotSettings />

            {/* v2.7 — outbound webhooks (event fan-out + delivery log) */}
            <WebhooksCard />

            {/* Task 2-d — bot shop discount codes (cart checkout) */}
            <DiscountCodesCard />

            {/* Task 2-d — referral program settings + top referrers */}
            <ReferralCard />

            {/* Task 2-e — broadcast queue (enqueue + live progress + history) */}
            <BroadcastCard />

            {/* Task 2-e — anti-abuse (force channel + bans) */}
            <AbuseCard />

            {/* Task 3-c — release channel (stable/beta) + GitHub update check */}
            <UpdatesCard />

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
                <SwitchRow
                  label={u.tgNDigest}
                  checked={tgForm.notify.dailyDigest}
                  onCheckedChange={(v) =>
                    setTgForm((p) => ({ ...p, notify: { ...p.notify, dailyDigest: v } }))
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

            {/* ── core / xray real driver (v2.4) ── */}
            <SectionCard icon={Cpu} title={core.cardTitle} desc={core.cardDesc} className="lg:col-span-2">
              <div className="space-y-4">
                {/* status strip */}
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-border/70">
                  <span className="relative flex h-2.5 w-2.5">
                    {coreStat?.running && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    )}
                    <span
                      className={cn(
                        "relative inline-flex h-2.5 w-2.5 rounded-full",
                        coreStat?.running
                          ? "bg-emerald-400"
                          : coreStat?.lastError
                            ? "bg-chart-5"
                            : "bg-muted-foreground"
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                      coreStat?.running
                        ? "bg-emerald-400/10 text-emerald-400 ring-emerald-400/30"
                        : coreStat?.lastError
                          ? "bg-chart-5/10 text-chart-5 ring-chart-5/30"
                          : "bg-muted/10 text-muted-foreground ring-border"
                    )}
                  >
                    {coreStat?.running
                      ? core.statusRunning
                      : coreStat?.lastError
                        ? core.statusFailed
                        : core.statusStopped}
                  </span>
                  {coreStat?.fallbackActive && (
                    <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-400 ring-1 ring-amber-400/30">
                      {core.statusFallback}
                    </span>
                  )}
                  <span className="ms-auto font-mono text-xs text-muted-foreground" dir="ltr">
                    {coreStat?.kind === "xray"
                      ? `${coreStat.version || "xray"} · ${coreStat.running ? Math.floor(coreStat.uptimeMs / 1000) + "s" : "—"}`
                      : core.driverSim}
                  </span>
                </div>

                {/* driver + runtime fields */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="core-driver-real">{core.driver}</Label>
                    <Select
                      value={coreForm.driver}
                      onValueChange={(v) => setCoreForm((p) => ({ ...p, driver: v as CoreForm["driver"] }))}
                    >
                      <SelectTrigger id="core-driver-real" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="glass-strong">
                        <SelectItem value="simulator">{core.driverSim}</SelectItem>
                        <SelectItem value="xray">{core.driverXray}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="core-stats-interval">{core.statsInterval}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="core-stats-interval"
                        dir="ltr"
                        inputMode="numeric"
                        className="font-mono"
                        value={statsIntervalDraft}
                        onChange={(e) =>
                          setStatsIntervalDraft(e.target.value.replace(/[^0-9]/g, ""))
                        }
                        placeholder="10"
                      />
                      <span className="whitespace-nowrap text-xs text-muted-foreground">s</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{core.statsIntervalHint}</p>
                  </div>
                  <div className="space-y-1.5 sm:max-lg:col-span-2">
                    <Label htmlFor="core-xray-bin">{core.binPath}</Label>
                    <Input
                      id="core-xray-bin"
                      dir="ltr"
                      className="font-mono"
                      value={xrayBinDraft}
                      onChange={(e) => setXrayBinDraft(e.target.value)}
                      placeholder={core.binPathPh}
                    />
                  </div>
                  <div className="space-y-1.5 sm:max-lg:col-span-2">
                    <Label htmlFor="core-xray-version">{core.versionPin}</Label>
                    <Input
                      id="core-xray-version"
                      dir="ltr"
                      className="font-mono"
                      value={xrayVersionDraft}
                      onChange={(e) => setXrayVersionDraft(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder={core.versionPinPh}
                    />
                  </div>
                  {/* v2.5 — hysteria2 sidecar engine version pin */}
                  <div className="space-y-1.5 sm:max-lg:col-span-2">
                    <Label htmlFor="core-hy-version">{core.versionPinHy}</Label>
                    <Input
                      id="core-hy-version"
                      dir="ltr"
                      className="font-mono"
                      value={hysteriaVersionDraft}
                      onChange={(e) => setHysteriaVersionDraft(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder={core.versionPinHyPh}
                    />
                    <p className="text-[11px] text-muted-foreground">{core.versionPinHyHint}</p>
                  </div>
                  {/* Task 23-g — opt-in concurrent-IP auto-disable (default OFF) */}
                  <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-border/70 sm:col-span-2">
                    <div className="min-w-0">
                      <Label htmlFor="core-enforce-ip">{core.enforceIp}</Label>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {core.enforceIpHint}
                      </p>
                    </div>
                    <Switch
                      id="core-enforce-ip"
                      checked={coreForm.enforceIpLimit}
                      onCheckedChange={(v) => setCoreForm((p) => ({ ...p, enforceIpLimit: v }))}
                    />
                  </div>
                </div>

                {/* action buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button onClick={() => void saveCoreCard()} disabled={coreBusy !== ""} className="gap-2">
                    {coreBusy === "save" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t.subgroups.save}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void coreInstall()}
                    disabled={coreBusy !== ""}
                    className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
                  >
                    {coreBusy === "install" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="h-4 w-4" aria-hidden="true" />
                    )}
                    {coreBusy === "install" ? core.installing : core.install}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void coreAction("start")}
                    disabled={coreBusy !== ""}
                    className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
                  >
                    {coreBusy === "start" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="h-4 w-4" aria-hidden="true" />
                    )}
                    {core.start}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void coreAction("stop")}
                    disabled={coreBusy !== ""}
                    className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
                  >
                    {coreBusy === "stop" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Square className="h-4 w-4" aria-hidden="true" />
                    )}
                    {core.stop}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void coreAction("restart")}
                    disabled={coreBusy !== ""}
                    className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
                  >
                    {coreBusy === "restart" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCw className="h-4 w-4" aria-hidden="true" />
                    )}
                    {core.restart}
                  </Button>
                </div>

                {/* live core details */}
                {coreStat?.kind === "xray" && (
                  <div className="grid grid-cols-1 gap-2 rounded-xl bg-white/[0.02] p-3 ring-1 ring-border/50 sm:grid-cols-3">
                    <p className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{core.version}</span>
                      <span className="font-mono text-foreground" dir="ltr">{coreStat.version || "—"}</span>
                    </p>
                    <p className="flex items-center justify-between gap-2 text-xs sm:col-span-2">
                      <span className="text-muted-foreground">{core.path}</span>
                      <span className="truncate font-mono text-foreground" dir="ltr">
                        {coreStat.configPath?.replace(/\/config\.json$/, "") || "—"}
                      </span>
                    </p>
                    <p className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{core.apiDoor}</span>
                      <span className="font-mono text-foreground" dir="ltr">{coreStat.apiPort ?? "—"}</span>
                    </p>
                    <p className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{core.uptime}</span>
                      <span className="font-mono text-foreground" dir="ltr">
                        {coreStat.running ? `${Math.floor(coreStat.uptimeMs / 60000)}m` : "—"}
                      </span>
                    </p>
                    <p className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">PID</span>
                      <span className="font-mono text-foreground" dir="ltr">{coreStat.pid ?? "—"}</span>
                    </p>
                  </div>
                )}

                {/* fallback / error surface */}
                {coreStat?.fallbackActive && coreStat.fallbackReason && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-2 text-xs text-amber-400 ring-1 ring-amber-400/30" dir="auto">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="break-all">{coreStat.fallbackReason}</span>
                  </p>
                )}
                {coreStat?.lastError && !coreStat.running && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-chart-5/10 px-2.5 py-2 text-xs text-chart-5 ring-1 ring-chart-5/30" dir="ltr">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="break-all font-mono">{coreStat.lastError}</span>
                  </p>
                )}

                {/* collapsible log viewer */}
                <div className="rounded-xl bg-white/[0.02] ring-1 ring-border/50">
                  <button
                    type="button"
                    onClick={() => setLogOpen((v) => !v)}
                    aria-expanded={logOpen}
                    className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center gap-2">
                      <Terminal className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                      {core.logTitle}
                    </span>
                    {logOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                  {logOpen && (
                    <div className="border-t border-border/50 px-3.5 py-3">
                      {coreLogLines.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">{core.logEmpty}</p>
                      ) : (
                        <pre
                          dir="ltr"
                          className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/90"
                        >
                          {coreLogLines.join("\n")}
                        </pre>
                      )}
                    </div>
                  )}
                </div>

                <Tip>{core.hint}</Tip>
                <Tip>{core.hintReload}</Tip>
              </div>
            </SectionCard>

            {/* ── ssl / acme managed certificates (Task 23-f) ── */}
            <SslCard />

            {/* ── software update (v2.2) ── */}
            <SectionCard icon={RefreshCw} title={sys.updTitle} desc={sys.updDesc} className="lg:col-span-2">
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-border/60">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{sys.updCurrent}</p>
                    <p className="font-mono text-lg font-semibold text-foreground" dir="ltr">
                      {upd?.current ?? "v2.2.0"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-border/60">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{sys.updLatest}</p>
                    <p className="font-mono text-lg font-semibold text-foreground" dir="ltr">
                      {upd?.latest ?? "—"}
                    </p>
                  </div>
                </div>

                {updNote && (
                  <p
                    role="status"
                    className={cn(
                      "rounded-lg px-2.5 py-2 text-xs ring-1",
                      updState === "failed"
                        ? "bg-chart-5/10 text-chart-5 ring-chart-5/30"
                        : upd?.updateAvailable
                          ? "bg-primary/10 text-primary ring-primary/30"
                          : "bg-white/[0.03] text-muted-foreground ring-border/60"
                    )}
                    dir="auto"
                  >
                    {updNote}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2.5">
                  <Button
                    variant="outline"
                    onClick={() => void checkUpdate()}
                    disabled={updState === "checking" || updState === "updating"}
                    className="gap-2 rounded-xl border-border bg-white/4 hover:bg-white/8"
                  >
                    {updState === "checking" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    )}
                    {updState === "checking" ? sys.updChecking : sys.updCheck}
                  </Button>
                  {upd?.updateAvailable && upd.isGit && updState !== "updating" && (
                    <Button onClick={() => void applyUpdate()} className="glow-cyan gap-2 rounded-xl">
                      <Zap className="h-4 w-4" aria-hidden="true" />
                      {sys.updApply}
                    </Button>
                  )}
                  {updState === "updating" && (
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" dir="auto">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      {sys.updApplying}
                    </span>
                  )}
                  {upd?.repoUrl && (
                    <a
                      href={upd.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      {sys.updRepo}
                    </a>
                  )}
                </div>

                {upd && !upd.isGit && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-chart-4/10 px-2.5 py-2 text-[11px] leading-relaxed text-chart-4 ring-1 ring-chart-4/30" dir="auto">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      <strong>{sys.updNotGit} — </strong>
                      {sys.updNotGitHint}
                    </span>
                  </p>
                )}

                {updState === "success" && (
                  <Button onClick={() => setRestartOpen(true)} className="glow-cyan gap-2 rounded-xl">
                    <RotateCw className="h-4 w-4" aria-hidden="true" />
                    {sys.updRestart}
                  </Button>
                )}
              </div>
            </SectionCard>

            {/* ── TOTP two-factor (v2.2) ── */}
            <SectionCard icon={ShieldCheck} title={sys.totpTitle} desc={sys.totpDesc}>
              <div className="space-y-4">
                {sec.totpConfigured ? (
                  <>
                    <p
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
                        sec.totpEnabled
                          ? "bg-chart-2/15 text-chart-2 ring-1 ring-chart-2/30"
                          : "bg-white/5 text-muted-foreground ring-1 ring-border"
                      )}
                      dir="auto"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {sec.totpEnabled ? sys.totpOn : sys.totpOff}
                    </p>
                    {sec.totpEnabled && (
                      <div className="space-y-2">
                        <Label htmlFor="totp-disable">{sys.totpDisableHint}</Label>
                        <div className="flex gap-2">
                          <Input
                            id="totp-disable"
                            dir="ltr"
                            inputMode="numeric"
                            maxLength={6}
                            autoComplete="one-time-code"
                            className="font-mono"
                            placeholder={sys.totpCodePh}
                            value={totpCode}
                            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                          />
                          <Button
                            variant="outline"
                            disabled={totpBusy || totpCode.length !== 6}
                            onClick={() => void totpDisable()}
                            className="gap-2 rounded-xl border-border bg-white/4 hover:bg-white/8"
                          >
                            {totpBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            )}
                            {sys.totpOff}
                          </Button>
                        </div>
                      </div>
                    )}
                    {!sec.totpEnabled && (
                      <div className="space-y-2">
                        <Label htmlFor="totp-reenable">{sys.totpStart}</Label>
                        <div className="flex gap-2">
                          <Input
                            id="totp-reenable"
                            dir="ltr"
                            inputMode="numeric"
                            maxLength={6}
                            autoComplete="one-time-code"
                            className="font-mono"
                            placeholder={sys.totpCodePh}
                            value={totpCode}
                            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                          />
                          <Button
                            disabled={totpBusy || totpCode.length !== 6}
                            onClick={() => void totpReenable()}
                            className="glow-cyan gap-2 rounded-xl"
                          >
                            {totpBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            )}
                            {sys.totpOn}
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : !totpEnroll ? (
                  <Button onClick={totpBegin} className="glow-cyan gap-2 rounded-xl">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    {sys.totpStart}
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col items-center gap-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-border/60 sm:flex-row sm:items-start">
                      <div className="rounded-lg bg-white p-2">
                        <QRCode value={totpUri} size={120} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-xs leading-relaxed text-muted-foreground" dir="auto">
                          {sys.totpScan}
                        </p>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{sys.totpSecretLbl}</p>
                          <p className="break-all font-mono text-xs text-foreground" dir="ltr">
                            {totpSecretGen}
                          </p>
                        </div>
                      </div>
                    </div>
                    <Tip>{sys.totpWarn}</Tip>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-36 flex-1 space-y-1">
                        <Label htmlFor="totp-code">{sys.totpCode}</Label>
                        <Input
                          id="totp-code"
                          dir="ltr"
                          inputMode="numeric"
                          maxLength={6}
                          autoComplete="one-time-code"
                          className="font-mono"
                          placeholder={sys.totpCodePh}
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                      <Button
                        onClick={() => void totpVerifyEnroll()}
                        disabled={totpBusy || totpCode.length !== 6}
                        className="gap-2 rounded-xl"
                      >
                        {totpBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        )}
                        {totpBusy ? sys.totpVerifying : sys.totpVerify}
                      </Button>
                      <Button variant="outline" onClick={totpCancelEnroll} className="rounded-xl border-white/10 bg-white/[0.03] hover:bg-white/[0.06]">
                        {sys.totpCancel}
                      </Button>
                    </div>
                  </div>
                )}
                {totpErr && (
                  <p role="alert" className="rounded-lg bg-chart-5/10 px-2.5 py-2 text-xs text-chart-5 ring-1 ring-chart-5/30" dir="auto">
                    {totpErr}
                  </p>
                )}
              </div>
            </SectionCard>

            {/* ── scheduled server backups (v2.2) ── */}
            <SectionCard icon={CalendarClock} title={sys.abTitle} desc={sys.abDesc} className="lg:col-span-2">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                  <div className="min-w-44 flex-1">
                    <SwitchRow
                      label={sys.abEnable}
                      checked={sec.autoBackupEnabled}
                      onCheckedChange={(v) => void saveSecurityQuick({ autoBackupEnabled: v })}
                      icon={DatabaseBackup}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label htmlFor="ab-keep">{sys.abKeep}</Label>
                    <Input
                      id="ab-keep"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={2}
                      className="font-mono"
                      value={abKeepDraft}
                      onChange={(e) => setAbKeepDraft(e.target.value.replace(/\D/g, ""))}
                      onBlur={(e) => void saveAbKeep(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{sys.abLastRun}</p>
                    <p className="font-mono text-xs text-foreground" dir="ltr">
                      {abLastRun ? abLastRun.slice(0, 19).replace("T", " ") : sys.abNever}
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => void runBackupNow()} disabled={abBusy} className="gap-2 rounded-xl border-border bg-white/4 hover:bg-white/8">
                    {abBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <DatabaseBackup className="h-4 w-4" aria-hidden="true" />
                    )}
                    {abBusy ? sys.abRunning : sys.abRunNow}
                  </Button>
                </div>
                <Tip>{sys.abKeepHint}</Tip>
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{sys.abList}</p>
                  {abList.length === 0 ? (
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {sys.abEmpty}
                    </p>
                  ) : (
                    <div className="max-h-48 space-y-1.5 overflow-y-auto pe-1">
                      {abList.map((b) => (
                        <div
                          key={b.name}
                          className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-border/60"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" dir="ltr" title={b.name}>
                            {b.name}
                          </span>
                          <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:block" dir="ltr">
                            {(b.sizeBytes / 1024).toFixed(1)} KB
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void downloadServerBackup(b.name)}
                            className="h-8 shrink-0 gap-1.5 px-2 text-xs"
                            aria-label={`${sys.abDownload} ${b.name}`}
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            {sys.abDownload}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void deleteServerBackup(b.name)}
                            className="h-8 shrink-0 gap-1.5 px-2 text-xs text-chart-5 hover:text-chart-5"
                            aria-label={`${sys.abDelete} ${b.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {sys.abDelete}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* ── MTProto proxy generator (v2.2) ── */}
            <SectionCard icon={Send} title={sys.mtpTitle} desc={sys.mtpDesc} className="lg:col-span-2">
              <div className="space-y-4">
                <p className="flex items-start gap-1.5 rounded-lg bg-chart-4/10 px-2.5 py-2 text-[11px] leading-relaxed text-chart-4 ring-1 ring-chart-4/25" dir="auto">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{sys.mtpNote}</span>
                </p>
                {/* Task 25-a — the panel can now serve mtproto itself (mtg sidecar) */}
                <p className="text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                  {sys.mtpPanelHint}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="mtp-host">{sys.mtpHost}</Label>
                    <Input
                      id="mtp-host"
                      dir="ltr"
                      autoComplete="off"
                      className="font-mono"
                      value={mtpHost}
                      onChange={(e) => setMtpHost(e.target.value)}
                      placeholder="vpn.example.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="mtp-port">{sys.mtpPort}</Label>
                    <Input
                      id="mtp-port"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={5}
                      className="font-mono"
                      value={mtpPort}
                      onChange={(e) => setMtpPort(e.target.value.replace(/\D/g, ""))}
                      placeholder="443"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{sys.mtpMode}</Label>
                    <Select value={mtpMode} onValueChange={(v) => setMtpMode(v === "plain" ? "plain" : "dd")}>
                      <SelectTrigger aria-label={sys.mtpMode}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dd">FakeTLS · dd</SelectItem>
                        <SelectItem value="plain">Plain · 16B</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] leading-snug text-muted-foreground" dir="auto">
                      {mtpMode === "dd" ? sys.mtpModeDd : sys.mtpModePlain}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button onClick={mtpGenerate} className="glow-cyan gap-2 rounded-xl">
                    {mtpSecret ? (
                      <RotateCw className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                    )}
                    {sys.mtpGen}
                  </Button>
                  {mtpSecret && (
                    <code className="min-w-0 max-w-full truncate rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-primary ring-1 ring-primary/30" dir="ltr">
                      {mtpSecret}
                    </code>
                  )}
                </div>
                {mtpSecret && mtpHostClean && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{sys.mtpLink}</p>
                    {[mtpLinkTg, mtpLinkHttps].map((link) => (
                      <div
                        key={link.slice(0, 16)}
                        className="flex items-center gap-2 rounded-xl bg-black/30 p-2 ring-1 ring-border/60"
                      >
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-muted-foreground" dir="ltr">
                          {link}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void copyText(link)}
                          className="h-8 shrink-0 px-2"
                          aria-label="Copy"
                          title="Copy"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                    <details className="rounded-xl border border-white/10 bg-black/30">
                      <summary className="cursor-pointer px-4 py-3 text-[11px] font-semibold tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                        {sys.mtpSetup}
                      </summary>
                      <pre className="overflow-x-auto border-t border-white/5 px-4 py-3 font-mono text-[10px] leading-relaxed text-muted-foreground" dir="ltr">
                        {mtpSetupCmds}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        {/* ═══════════ PUBLIC API ═══════════ */}
        <TabsContent value="api">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* intro + how-to */}
            <SectionCard icon={Braces} title={u.apiTitle} desc={u.apiDesc}>
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">{u.apiHint}</p>
                <pre className="overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-emerald-300 ring-1 ring-white/10" dir="ltr">
{`curl -H "Authorization: Bearer seph_xxxxxxxxxxxx…" \
     <origin>/api/users`}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <a href="/api/openapi.json" target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full text-[11px]">
                      <FileJson className="h-3 w-3" />
                      {u.apiSpecLink}
                    </Button>
                  </a>
                </div>
              </div>
            </SectionCard>

            {/* tokens */}
            <SectionCard icon={KeyRound} title={u.apiTokensTitle} desc={u.apiTokensDesc}>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    value={newTokenName}
                    onChange={(e) => setNewTokenName(e.target.value)}
                    placeholder={u.apiTokenNamePh}
                    maxLength={48}
                    className="h-9 flex-1 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void mintApiToken();
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => void mintApiToken()}
                    disabled={minting || !newTokenName.trim()}
                    className="h-9 gap-1.5 rounded-full px-4 text-xs"
                  >
                    {minting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                    {u.apiTokenCreate}
                  </Button>
                </div>

                {mintedRaw && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      {u.apiTokenOnceTitle}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{u.apiTokenOnceDesc}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-emerald-200" dir="ltr">
                        {mintedRaw}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void copyText(mintedRaw)}
                        className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-[11px]"
                      >
                        <Copy className="h-3 w-3" />
                        {u.apiTokenCopy}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {!apiTokensLoaded ? (
                    <Skeleton className="h-16 w-full rounded-xl" />
                  ) : apiTokens.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">{u.apiTokenNone}</p>
                  ) : (
                    apiTokens.map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-border"
                      >
                        <span className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                          <Braces className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground">{row.name}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground" dir="ltr">
                            {row.prefix}
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-[10px] text-muted-foreground">{u.apiTokenLastUsed}</p>
                          <p className="text-[10px] font-medium text-foreground">
                            {row.lastUsedAt
                              ? new Date(row.lastUsedAt).toLocaleString(lang === "fa" ? "fa-IR" : lang)
                              : u.apiTokenNever}
                          </p>
                        </div>
                        <Switch
                          checked={row.enabled}
                          onCheckedChange={(v) => void toggleApiToken(row, v)}
                          aria-label={u.apiTokenToggle}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void revokeApiToken(row)}
                          className="h-8 w-8 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          aria-label={u.apiTokenRevoke}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </SectionCard>

            {/* swagger ui — full width */}
            <SectionCard icon={FileJson} title={u.apiSwaggerTitle} desc={u.apiSwaggerDesc} className="lg:col-span-2">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <a href="/api-docs" target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full text-[11px]">
                    <BookOpen className="h-3 w-3" aria-hidden="true" />
                    {u.apiDocsTitle}
                  </Button>
                </a>
                <a href="/api/openapi.json" target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full text-[11px]">
                    <FileJson className="h-3 w-3" aria-hidden="true" />
                    {u.apiOpenSpec}
                  </Button>
                </a>
              </div>
              <SwaggerEmbed />
            </SectionCard>
          </div>
        </TabsContent>

        {/* ═══════════ EXPERT ═══════════ */}
        <TabsContent value="expert">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* core driver */}
              <SectionCard icon={RadioTower} title={u.coreTitle} desc={u.coreDesc}>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

      {/* panel restart confirm (v2.2) */}
      <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2.5">
              <RotateCw className="h-4 w-4 text-primary" aria-hidden="true" />
              {sys.updRestart}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground" dir="auto">
              {sys.updRestartHint}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.inbounds.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={restartBusy}
              onClick={(e) => {
                e.preventDefault();
                void restartPanel();
              }}
            >
              {restartBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCw className="h-4 w-4" aria-hidden="true" />
              )}
              {restartBusy ? sys.updRestarting : sys.updRestart}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Interactive Telegram Bot & Automated Backup Scheduler */}
      <TelegramBotPanel />
    </div>
  );
}
