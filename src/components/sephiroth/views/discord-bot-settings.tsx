import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Info, Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · v2.7 — Discord Bot settings card

   The Discord twin of the Telegram bot card: token / admin user
   ids / announce channel / command prefix / bot language + a
   LIVE gateway pill (ready · connecting · reconnecting ·
   stopped) polled from /api/discord/bot-status every 5s. Saving
   PUTs the whole "discord" section (token: "" = keep, so the
   masked token never round-trips through the browser) — the API
   route then re-syncs the gateway worker.
   ============================================================ */

interface DiscordSettingsDTO {
  enabled: boolean;
  tokenConfigured: boolean;
  tokenMasked: string;
  adminUserIds: string[];
  announceChannelId: string;
  botLang: "fa" | "en" | "ar" | "zh" | "tr" | "ru";
  prefix: string;
}

interface BotStatusDTO {
  enabled: boolean;
  running: boolean;
  gateway: "idle" | "connecting" | "ready" | "reconnecting";
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastEventAt: string | null;
  handled: number;
  errors: number;
  lastError: string;
  adminUserIds: number;
  tokenConfigured: boolean;
  botLang: string;
  prefix: string;
}

const LANG_CODES = ["fa", "en", "ar", "zh", "tr", "ru"] as const;
type LangCode = (typeof LANG_CODES)[number];

/* tiny {placeholder} interpolator for feature strings */
const fmt = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

export function DiscordBotSettings() {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].discord;
  const { toast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [tokenMasked, setTokenMasked] = useState("");

  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [adminIds, setAdminIds] = useState("");
  const [channelId, setChannelId] = useState("");
  const [prefix, setPrefix] = useState("!");
  const [botLang, setBotLang] = useState<LangCode>("fa");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [botStatus, setBotStatus] = useState<BotStatusDTO | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  const loadSettings = useCallback(async (): Promise<DiscordSettingsDTO | null> => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { discord: DiscordSettingsDTO };
      return data.discord;
    } catch {
      return null;
    }
  }, []);

  const apply = useCallback((dc: DiscordSettingsDTO) => {
    setEnabled(dc.enabled);
    setBotLang(dc.botLang);
    setAdminIds(dc.adminUserIds.join(", "));
    setChannelId(dc.announceChannelId);
    setPrefix(dc.prefix || "!");
    setToken(""); // input always starts empty — "" = keep the saved token
    setTokenConfigured(dc.tokenConfigured);
    setTokenMasked(dc.tokenMasked);
  }, []);

  /* drop one validation error as soon as its field is touched */
  const clearErr = (key: string) =>
    setFieldErrors((f) => (f[key] ? { ...f, [key]: "" } : f));

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const dc = await loadSettings();
      if (dc && mounted.current) {
        apply(dc);
        setLoaded(true);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [loadSettings, apply]);

  // live gateway pill — poll every 5s
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/discord/bot-status", { cache: "no-store" });
        if (res.ok && alive) {
          const data = (await res.json()) as BotStatusDTO;
          setBotStatus(data);
        }
      } catch {
        /* pill keeps its last state */
      }
    };
    void pull();
    const iv = setInterval(() => {
      setNow(Date.now());
      void pull();
    }, 5_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "discord",
          enabled,
          token: token.trim(), // "" = keep the saved token (never send the mask back)
          adminUserIds: adminIds.trim(),
          announceChannelId: channelId.trim(),
          botLang,
          prefix: prefix.trim(),
        }),
      });
      if (res.status === 400) {
        // { error: "validation", fields: [{ field, code }] }
        const data = (await res.json().catch(() => ({}))) as {
          fields?: { field: string; code: string }[];
        };
        const errs: Record<string, string> = {};
        for (const f of data.fields ?? []) errs[f.field] = f.code;
        setFieldErrors(errs);
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error("save");
      const data = (await res.json()) as { discord: DiscordSettingsDTO };
      apply(data.discord);
      setFieldErrors({});
      toast({ description: fx.savedToast });
    } catch {
      toast({ variant: "destructive", description: fmt(fx.testFail, { detail: "network" }) });
    }
    setSaving(false);
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/discord/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        latencyMs?: number;
        error?: string;
        detail?: string;
      };
      if (data.ok) {
        toast({ description: fmt(fx.testOk, { ms: data.latencyMs ?? 0 }) });
      } else {
        toast({
          variant: "destructive",
          description: fmt(fx.testFail, { detail: data.detail ?? data.error ?? "error" }),
        });
      }
    } catch {
      toast({ variant: "destructive", description: fmt(fx.testFail, { detail: "network" }) });
    }
    setTesting(false);
  };

  /* ---------- gateway pill + counters ---------- */

  const gateway = botStatus?.gateway ?? "idle";
  const gatewayOn = gateway === "ready" || gateway === "connecting" || gateway === "reconnecting";
  const pillCls = cn(
    "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1",
    gateway === "ready"
      ? "bg-chart-3/10 text-chart-3 ring-chart-3/30"
      : gateway === "connecting" || gateway === "reconnecting"
        ? "bg-amber-400/10 text-amber-400 ring-amber-400/30"
        : "bg-white/[0.04] text-muted-foreground ring-white/10"
  );
  const pillDot = cn(
    "relative inline-flex h-2 w-2 rounded-full",
    gateway === "ready"
      ? "bg-chart-3"
      : gateway === "connecting" || gateway === "reconnecting"
        ? "bg-amber-400"
        : "bg-muted-foreground/50"
  );
  const pillLabel =
    gateway === "ready"
      ? fx.statusRunning
      : gateway === "connecting"
        ? fx.statusConnecting
        : gateway === "reconnecting"
          ? fx.statusReconnecting
          : fx.statusStopped;

  const lastEventAge = useMemo(() => {
    if (!botStatus?.lastEventAt) return fx.never;
    // language-neutral compact age ("12s" / "3m" / "1h")
    const age = Math.max(0, Math.round((now - Date.parse(botStatus.lastEventAt)) / 1000));
    if (age < 60) return `${age}s`;
    const m = Math.round(age / 60);
    if (m < 60) return `${m}m`;
    return `${Math.round(m / 60)}h`;
  }, [botStatus?.lastEventAt, now, fx.never]);

  return (
    <section className="glass rounded-2xl p-5 md:p-6" aria-label={fx.title}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
            <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-bold text-foreground">{fx.title}</h3>
            <p className="max-w-md text-xs text-muted-foreground">{fx.desc}</p>
          </div>
        </div>
        {/* gateway status pill + enabled switch */}
        <div className="flex flex-wrap items-center gap-3">
          <span
            role="status"
            aria-live="polite"
            className={pillCls}
            title={botStatus?.lastError || undefined}
          >
            <span className="relative flex h-2 w-2" aria-hidden="true">
              {gatewayOn && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
              )}
              <span className={pillDot} />
            </span>
            {pillLabel}
          </span>
          <span className="flex items-center gap-2">
            <Switch
              id="dc-bot-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!loaded}
              aria-label={fx.enabled}
            />
            <Label
              htmlFor="dc-bot-enabled"
              className="cursor-pointer text-xs font-medium text-muted-foreground"
            >
              {fx.enabled}
            </Label>
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {/* token — masked value shows as placeholder while one is saved */}
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="dc-bot-token">{fx.token}</Label>
          <Input
            id="dc-bot-token"
            type="password"
            dir="ltr"
            className="font-mono"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              clearErr("token");
            }}
            placeholder={tokenConfigured && tokenMasked ? tokenMasked : fx.tokenPh}
            autoComplete="off"
          />
          {tokenConfigured ? (
            <p className="text-[11px] text-muted-foreground">{fx.keepHint}</p>
          ) : null}
          {fieldErrors.token ? (
            <p className="text-[11px] text-rose-500" role="alert">
              {fieldErrors.token}
            </p>
          ) : null}
        </div>

        {/* admin user ids */}
        <div className="space-y-1.5">
          <Label htmlFor="dc-bot-admins">{fx.adminIds}</Label>
          <Input
            id="dc-bot-admins"
            dir="ltr"
            className="font-mono"
            value={adminIds}
            onChange={(e) => {
              setAdminIds(e.target.value);
              clearErr("adminUserIds");
            }}
            placeholder={fx.adminIdsPh}
            autoComplete="off"
          />
          {fieldErrors.adminUserIds ? (
            <p className="text-[11px] text-rose-500" role="alert">
              {fieldErrors.adminUserIds}
            </p>
          ) : null}
        </div>

        {/* announce channel */}
        <div className="space-y-1.5">
          <Label htmlFor="dc-bot-channel">{fx.channelId}</Label>
          <Input
            id="dc-bot-channel"
            dir="ltr"
            className="font-mono"
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value);
              clearErr("announceChannelId");
            }}
            placeholder={fx.channelIdPh}
            autoComplete="off"
          />
          {fieldErrors.announceChannelId ? (
            <p className="text-[11px] text-rose-500" role="alert">
              {fieldErrors.announceChannelId}
            </p>
          ) : null}
        </div>

        {/* command prefix */}
        <div className="space-y-1.5">
          <Label htmlFor="dc-bot-prefix">{fx.prefix}</Label>
          <Input
            id="dc-bot-prefix"
            dir="ltr"
            className="font-mono"
            maxLength={4}
            value={prefix}
            onChange={(e) => {
              setPrefix(e.target.value);
              clearErr("prefix");
            }}
            placeholder={fx.prefixPh}
            autoComplete="off"
          />
          {fieldErrors.prefix ? (
            <p className="text-[11px] text-rose-500" role="alert">
              {fieldErrors.prefix}
            </p>
          ) : null}
        </div>

        {/* bot language */}
        <div className="space-y-1.5">
          <Label htmlFor="dc-bot-lang">{fx.botLang}</Label>
          <Select value={botLang} onValueChange={(v) => setBotLang(v as LangCode)}>
            <SelectTrigger id="dc-bot-lang" dir="auto" aria-label={fx.botLang}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-strong">
              <SelectItem value="fa">فارسی</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ar">العربية</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="tr">Türkçe</SelectItem>
              <SelectItem value="ru">Русский</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={saving || !loaded} className="gap-2">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          {saving ? fx.saving : fx.save}
        </Button>
        <Button
          variant="outline"
          onClick={() => void sendTest()}
          disabled={testing}
          className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {testing ? fx.testing : fx.test}
        </Button>
      </div>

      {/* live counters */}
      {botStatus && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
          <span>{fmt(fx.handled, { n: botStatus.handled })}</span>
          <span>{fmt(fx.errors, { n: botStatus.errors })}</span>
          <span>{fmt(fx.lastEvent, { time: lastEventAge })}</span>
        </div>
      )}

      {/* command cheat-sheet — always reflects the prefix in the form */}
      <p dir="auto" className="mt-4 font-mono text-[11px] text-muted-foreground">
        {fx.commandsHint.replace(/\{prefix\}/g, prefix || "!")}
      </p>

      {/* MESSAGE_CONTENT privileged intent reminder */}
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {fx.hint}
      </p>
    </section>
  );
}
