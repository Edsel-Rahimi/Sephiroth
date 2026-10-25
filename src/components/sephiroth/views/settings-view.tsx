"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  Copy,
  DatabaseBackup,
  Download,
  KeyRound,
  Lightbulb,
  Loader2,
  LogOut,
  Palette,
  RadioTower,
  RotateCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppStore, type GlowPref } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { dictionaries, LANGS, LANG_META, type Lang } from "@/lib/i18n/dictionaries";
import { sfmt } from "@/lib/i18n/sub-dictionary";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 7 — Settings & System (admin)
   Five orbit tabs: General (language + appearance), Core Driver
   (adapter + real TCP test + live-feed interval that the core
   simulator applies live), Telegram (bot + notifications +
   real test message), Backup (full export / typed-confirm
   restore) and Security (password, one-time recovery key,
   revoke all sessions). All strings ×6 languages.
   ============================================================ */

type Tab = "general" | "core" | "telegram" | "backup" | "security";

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

const TAB_ICONS: Record<Tab, React.ComponentType<{ className?: string }>> = {
  general: Settings2,
  core: RadioTower,
  telegram: Send,
  backup: DatabaseBackup,
  security: ShieldCheck,
};

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
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
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
  const coreStatus = useCoreStore((s) => s.status);
  const { toast } = useToast();

  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.settings;

  const [tab, setTab] = useState<Tab>("general");
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

  /* security */
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwErr, setPwErr] = useState<Partial<Record<"current" | "next" | "confirm", string>>>({});
  const [pwSaving, setPwSaving] = useState(false);
  const [rkBusy, setRkBusy] = useState(false);
  const [rkConfirmOpen, setRkConfirmOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [ssBusy, setSsBusy] = useState(false);
  const [ssConfirmOpen, setSsConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(false);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const d = (await res.json()) as { core: CoreSettingsDTO; telegram: TelegramSettingsDTO };
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
    } catch {
      setLoadErr(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  /* ---------- security ---------- */

  const changePassword = async () => {
    setPwErr({});
    if (!pw.current) {
      setPwErr({ current: u.errCurrent });
      return;
    }
    if (pw.next.length < 6) {
      setPwErr({ next: u.errShort });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwErr({ confirm: u.errMismatch });
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: pw.current, next: pw.next }),
      });
      if (res.status === 403) {
        setPwErr({ current: u.errCurrent });
        return;
      }
      if (res.status === 400) {
        setPwErr({ next: u.errShort });
        return;
      }
      if (!res.ok) throw new Error("pw");
      setPw({ current: "", next: "", confirm: "" });
      toast({ description: u.pwChanged });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setPwSaving(false);
  };

  const rotateKey = async () => {
    setRkConfirmOpen(false);
    setRkBusy(true);
    try {
      const res = await fetch("/api/auth/recovery/rotate", { method: "POST" });
      if (!res.ok) throw new Error("rk");
      const d = (await res.json()) as { recoveryKey?: string };
      if (d.recoveryKey) setNewKey(d.recoveryKey);
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setRkBusy(false);
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      toast({ description: t.inbounds.toastCopied });
    } catch {
      /* clipboard unavailable */
    }
  };

  const revokeSessions = async () => {
    setSsConfirmOpen(false);
    setSsBusy(true);
    try {
      const res = await fetch("/api/auth/revoke-sessions", { method: "POST" });
      if (!res.ok) throw new Error("ss");
      toast({ description: u.ssDone });
      setTimeout(async () => {
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          /* session already invalid */
        }
        window.location.reload();
      }, 600);
      return;
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setSsBusy(false);
  };

  /* ---------- render helpers ---------- */

  const feedLive = coreStatus === "live";

  if (loading) {
    return (
      <div className="fade-up space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-11 w-full max-w-xl rounded-full" />
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

      {/* orbit tabs */}
      <nav aria-label={t.nav.settings}>
        <ul className="orbit-pill glass no-scrollbar flex list-none items-center gap-1 overflow-x-auto rounded-full p-1.5 lg:w-fit">
          {(Object.keys(TAB_ICONS) as Tab[]).map((id) => {
            const Icon = TAB_ICONS[id];
            const active = tab === id;
            return (
              <li key={id} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setTab(id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring md:px-4",
                    active
                      ? "bg-gradient-to-br from-primary/20 to-primary/5 text-foreground glow-cyan"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  <Icon
                    className={cn("h-3.5 w-3.5", active ? "text-primary" : "opacity-70")}
                    aria-hidden="true"
                  />
                  <span className="whitespace-nowrap">{tabLabel(u, id)}</span>
                </button>
                {active && <span className="orbit-dot" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ═══ GENERAL ═══ */}
      {tab === "general" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard icon={Settings2} title={u.langTitle} desc={u.langDesc}>
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
        </div>
      )}

      {/* ═══ CORE ═══ */}
      {tab === "core" && (
        <div className="grid gap-4 lg:grid-cols-2">
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
      )}

      {/* ═══ TELEGRAM ═══ */}
      {tab === "telegram" && (
        <div className="grid gap-4 lg:grid-cols-2">
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
        </div>
      )}

      {/* ═══ BACKUP ═══ */}
      {tab === "backup" && (
        <div className="grid gap-4 lg:grid-cols-2">
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
      )}

      {/* ═══ SECURITY ═══ */}
      {tab === "security" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard icon={ShieldCheck} title={u.pwTitle} desc={u.pwDesc}>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pw-current">{u.pwCurrent}</Label>
                <Input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={pw.current}
                  onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
                />
                {pwErr.current && <p className="text-xs text-chart-5">{pwErr.current}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-next">{u.pwNew}</Label>
                <Input
                  id="pw-next"
                  type="password"
                  autoComplete="new-password"
                  value={pw.next}
                  onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                />
                {pwErr.next && <p className="text-xs text-chart-5">{pwErr.next}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-confirm">{u.pwConfirm}</Label>
                <Input
                  id="pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={pw.confirm}
                  onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                />
                {pwErr.confirm && <p className="text-xs text-chart-5">{pwErr.confirm}</p>}
              </div>
              <Button onClick={() => void changePassword()} disabled={pwSaving} className="gap-2">
                {pwSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-4 w-4" aria-hidden="true" />
                )}
                {t.subgroups.save}
              </Button>
            </div>
          </SectionCard>

          <div className="space-y-4">
            <SectionCard icon={KeyRound} title={u.rkTitle} desc={u.rkDesc}>
              {newKey ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-primary/[0.06] px-4 py-3 ring-1 ring-primary/30">
                    <code className="font-mono text-sm font-bold tracking-wider text-primary" dir="ltr">
                      {newKey}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyKey()}
                      aria-label={t.inbounds.toastCopied}
                      className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary transition-shadow hover:glow-cyan"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <p className="flex items-center gap-1.5 text-[11px] text-chart-4">
                    <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {u.rkOnce}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setRkConfirmOpen(true)}
                    disabled={rkBusy}
                    className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
                  >
                    {rkBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCw className="h-4 w-4" aria-hidden="true" />
                    )}
                    {rkBusy ? u.rkRotating : u.rkRotate}
                  </Button>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    SEPH-••••-••••-••••
                  </span>
                </div>
              )}
            </SectionCard>

            <SectionCard icon={LogOut} title={u.ssTitle} desc={u.ssDesc}>
              <Button
                variant="outline"
                onClick={() => setSsConfirmOpen(true)}
                disabled={ssBusy}
                className="gap-2 rounded-full border-chart-5/40 text-chart-5 hover:bg-chart-5/10 hover:text-chart-5"
              >
                {ssBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                )}
                {ssBusy ? u.ssRevoking : u.ssRevoke}
              </Button>
            </SectionCard>
          </div>
        </div>
      )}

      {/* recovery key rotate confirm */}
      <AlertDialog open={rkConfirmOpen} onOpenChange={setRkConfirmOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{u.rkConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{u.rkConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.inbounds.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rotateKey()}>{u.rkConfirmBtn}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* revoke sessions confirm */}
      <AlertDialog open={ssConfirmOpen} onOpenChange={setSsConfirmOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{u.ssConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{u.ssConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.inbounds.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void revokeSessions()}
              className="bg-chart-5 text-white hover:bg-chart-5/90"
            >
              {u.ssConfirmBtn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* tab labels resolve from the settings dict */
function tabLabel(
  u: (typeof dictionaries)["en"]["settings"],
  id: Tab
): string {
  switch (id) {
    case "general":
      return u.tabGeneral;
    case "core":
      return u.tabCore;
    case "telegram":
      return u.tabTelegram;
    case "backup":
      return u.tabBackup;
    case "security":
      return u.tabSecurity;
  }
}
