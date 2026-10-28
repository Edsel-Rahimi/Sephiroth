"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CircleAlert, Loader2, Send } from "lucide-react";
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
import { dictionaries } from "@/lib/i18n/dictionaries";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Task 23-a — Telegram Bot settings card

   Second Telegram card in Settings → General (next to the
   notifications card): mode / language / sales template / pay
   mode / API base / admin chat ids / proxy + a LIVE worker pill
   (running · last poll age) polled from /api/telegram/bot-status.
   Saving PUTs the full telegram section (merged onto a FRESH
   server copy so the two Telegram cards can never clobber each
   other) — the API route then re-syncs the worker.
   ============================================================ */

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
  botMode: "console" | "notify" | "sales";
  adminChatIds: string[];
  botApiBase: string;
  botProxyUrl: string;
  botLang: "fa" | "en" | "ar" | "zh" | "tr" | "ru";
  salesTemplateId: string;
  salesPayMode: "manual" | "zarinpal";
}

interface BotStatusDTO {
  mode: "console" | "notify" | "sales";
  running: boolean;
  lastPollAt: string | null;
  handledUpdates: number;
  errors: number;
  lastError: string;
  adminChatIds: number;
  tokenConfigured: boolean;
}

interface TplDTO {
  id: string;
  name: string;
  enabled: boolean;
  priceToman: number;
}

const LANG_CODES = ["fa", "en", "ar", "zh", "tr", "ru"] as const;
type LangCode = (typeof LANG_CODES)[number];

export function TelegramBotSettings() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang].bot, [lang]);
  const d = useMemo(() => dictionaries[lang], [lang]);
  const { toast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tokenConfigured, setTokenConfigured] = useState(false);

  const [mode, setMode] = useState<"console" | "notify" | "sales">("notify");
  const [botLang, setBotLang] = useState<LangCode>("fa");
  const [tplId, setTplId] = useState("");
  const [payMode, setPayMode] = useState<"manual" | "zarinpal">("manual");
  const [apiBase, setApiBase] = useState("https://api.telegram.org");
  const [adminIds, setAdminIds] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");

  const [templates, setTemplates] = useState<TplDTO[]>([]);
  const [botStatus, setBotStatus] = useState<BotStatusDTO | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  const loadSettings = useCallback(async (): Promise<TelegramSettingsDTO | null> => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { telegram: TelegramSettingsDTO };
      return data.telegram;
    } catch {
      return null;
    }
  }, []);

  const apply = useCallback((tg: TelegramSettingsDTO) => {
    setMode(tg.botMode);
    setBotLang(tg.botLang);
    setTplId(tg.salesTemplateId);
    setPayMode(tg.salesPayMode);
    setApiBase(tg.botApiBase || "https://api.telegram.org");
    setAdminIds(tg.adminChatIds.join(", "));
    setProxyUrl(tg.botProxyUrl);
    setTokenConfigured(tg.tokenConfigured);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const tg = await loadSettings();
      if (tg && mounted.current) {
        apply(tg);
        setLoaded(true);
      }
      try {
        const res = await fetch("/api/sale-templates", { cache: "no-store" });
        if (res.ok && mounted.current) {
          const data = (await res.json()) as { templates: TplDTO[] };
          setTemplates(data.templates ?? []);
        }
      } catch {
        /* template list stays empty — select shows only "all" */
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [loadSettings, apply]);

  // live worker pill — poll every 5s
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/telegram/bot-status", { cache: "no-store" });
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
      // merge onto a FRESH server copy — never clobber the other telegram card
      const cur = await loadSettings();
      if (!cur) throw new Error("load");
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "telegram",
          enabled: cur.enabled,
          chatId: cur.chatId,
          token: "", // empty = keep the saved token
          notify: cur.notify,
          botMode: mode,
          adminChatIds: adminIds.trim(),
          botApiBase: apiBase.trim(),
          botProxyUrl: proxyUrl.trim(),
          botLang,
          salesTemplateId: tplId,
          salesPayMode: payMode,
        }),
      });
      if (!res.ok) throw new Error("save");
      const data = (await res.json()) as { telegram: TelegramSettingsDTO };
      apply(data.telegram);
      toast({ description: t.botSaved });
    } catch {
      toast({ variant: "destructive", description: d.inbounds.errGeneric });
    }
    setSaving(false);
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/test-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { ok?: boolean; latencyMs?: number; error?: string };
      if (data.ok) {
        toast({ description: `${d.settings.testOk.replace("{ms}", String(data.latencyMs ?? 0))}` });
      } else {
        toast({ variant: "destructive", description: d.settings.tgTestDesc });
      }
    } catch {
      toast({ variant: "destructive", description: d.settings.tgErrNetwork });
    }
    setTesting(false);
  };

  /* ---------- worker pill ---------- */

  const workerOn = Boolean(botStatus?.running);
  const lastPollAge = useMemo(() => {
    if (!botStatus?.lastPollAt) return t.workerNever;
    // language-neutral compact age ("12s" / "3m" / "1h")
    const age = Math.max(0, Math.round((now - Date.parse(botStatus.lastPollAt)) / 1000));
    if (age < 60) return `${age}s`;
    const m = Math.round(age / 60);
    if (m < 60) return `${m}m`;
    return `${Math.round(m / 60)}h`;
  }, [botStatus?.lastPollAt, now, t.workerNever]);

  return (
    <section className="glass rounded-2xl p-5 md:p-6" aria-label={t.modeLabel}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
            <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-bold text-foreground">{t.modeLabel}</h3>
            <p className="max-w-md text-xs text-muted-foreground">{t.modeDesc}</p>
          </div>
        </div>
        {/* worker status pill */}
        <span
          role="status"
          aria-live="polite"
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1",
            workerOn
              ? "bg-chart-3/10 text-chart-3 ring-chart-3/30"
              : "bg-white/[0.04] text-muted-foreground ring-white/10"
          )}
          title={botStatus?.lastError || undefined}
        >
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {workerOn && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chart-3 opacity-60" />
            )}
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                workerOn ? "bg-chart-3" : "bg-muted-foreground/50"
              )}
            />
          </span>
          {workerOn ? t.workerRunning : t.workerStopped}
          <span className="font-normal text-muted-foreground">· {lastPollAge}</span>
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {/* mode */}
        <div className="space-y-1.5">
          <Label htmlFor="tg-bot-mode">{t.modeLabel}</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <SelectTrigger id="tg-bot-mode" dir="auto" aria-label={t.modeLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-strong">
              <SelectItem value="console">{t.modeConsole}</SelectItem>
              <SelectItem value="notify">{t.modeNotify}</SelectItem>
              <SelectItem value="sales">{t.modeSales}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* language */}
        <div className="space-y-1.5">
          <Label htmlFor="tg-bot-lang">{t.langLabel}</Label>
          <Select value={botLang} onValueChange={(v) => setBotLang(v as LangCode)}>
            <SelectTrigger id="tg-bot-lang" dir="auto" aria-label={t.langLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-strong">
              <SelectItem value="fa">{t.langFa}</SelectItem>
              <SelectItem value="en">{t.langEn}</SelectItem>
              <SelectItem value="ar">{t.langAr}</SelectItem>
              <SelectItem value="zh">{t.langZh}</SelectItem>
              <SelectItem value="tr">{t.langTr}</SelectItem>
              <SelectItem value="ru">{t.langRu}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t.langDesc}</p>
        </div>

        {/* sales template */}
        <div className="space-y-1.5">
          <Label htmlFor="tg-bot-tpl">{t.tplPick}</Label>
          <Select value={tplId || "all"} onValueChange={(v) => setTplId(v === "all" ? "" : v)}>
            <SelectTrigger id="tg-bot-tpl" dir="auto" aria-label={t.tplPick}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-strong">
              <SelectItem value="all">{t.tplAll}</SelectItem>
              {templates.map((tpl) => (
                <SelectItem key={tpl.id} value={tpl.id}>
                  {tpl.name}
                  {tpl.priceToman > 0 ? ` · ${tpl.priceToman.toLocaleString("en-US")} T` : ""}
                  {!tpl.enabled ? " · ⃠" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* pay mode */}
        <div className="space-y-1.5">
          <Label htmlFor="tg-bot-pay">{t.payMode}</Label>
          <Select value={payMode} onValueChange={(v) => setPayMode(v as typeof payMode)}>
            <SelectTrigger id="tg-bot-pay" dir="auto" aria-label={t.payMode}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-strong">
              <SelectItem value="manual">{t.payManual}</SelectItem>
              <SelectItem value="zarinpal">{t.payZarinpal}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* admin chat ids */}
        <div className="space-y-1.5">
          <Label htmlFor="tg-bot-admins">{t.adminChatIds}</Label>
          <Input
            id="tg-bot-admins"
            dir="ltr"
            className="font-mono"
            value={adminIds}
            onChange={(e) => setAdminIds(e.target.value)}
            placeholder={t.adminChatIdsPh}
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">{t.adminChatIdsDesc}</p>
        </div>

        {/* proxy */}
        <div className="space-y-1.5">
          <Label htmlFor="tg-bot-proxy">{t.proxyUrl}</Label>
          <Input
            id="tg-bot-proxy"
            dir="ltr"
            className="font-mono"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder={t.proxyUrlPh}
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">{t.proxyUrlDesc}</p>
        </div>

        {/* api base */}
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="tg-bot-apibase">{t.apiBase}</Label>
          <Input
            id="tg-bot-apibase"
            dir="ltr"
            className="font-mono"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder={t.apiBasePh}
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">{t.apiBaseDesc}</p>
        </div>
      </div>

      {!tokenConfigured && (
        <p className="mt-4 flex items-center gap-2 text-[11px] text-chart-5" role="status">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {d.settings.tgErrNoToken}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={saving || !loaded} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {d.subgroups.save}
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
          {d.settings.tgTest}
        </Button>
        {botStatus && botStatus.handledUpdates > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {t.workerHandled}: {botStatus.handledUpdates}
            {botStatus.errors > 0 ? ` · ${t.workerErrors}: ${botStatus.errors}` : ""}
          </span>
        )}
      </div>
    </section>
  );
}
