"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, ExternalLink, Loader2, Send, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

export function TelegramBotPanel() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang].tgBot, [lang]);
  const { toast } = useToast();

  const [runningCmd, setRunningCmd] = useState<string | null>(null);
  const [botOutput, setBotOutput] = useState<string | null>(null);
  const [lastSubUrl, setLastSubUrl] = useState<string | null>(null);

  // Honest bot identity: derive from real server settings (token lives server-side,
  // GET /api/settings only exposes tokenConfigured + tokenMasked).
  const [tokenConfigured, setTokenConfigured] = useState<boolean | null>(null);
  const [tokenMasked, setTokenMasked] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (res.ok && alive) {
          const data = (await res.json()) as {
            telegram?: { tokenConfigured?: boolean; tokenMasked?: string };
          };
          setTokenConfigured(Boolean(data.telegram?.tokenConfigured));
          setTokenMasked(data.telegram?.tokenMasked ?? "");
        }
      } catch {
        /* keep simulated state */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // TODO(18-3): persist automation toggles + backup cadence via /api/settings —
  // settings.ts has no telegramAutomation section yet, so these stay session-only.
  const [selfService, setSelfService] = useState(true);
  const [receiptApprove, setReceiptApprove] = useState(true);
  const [autoBackupInterval, setAutoBackupInterval] = useState("6h");
  const [guardianHeal, setGuardianHeal] = useState(true);

  const runBotCommand = async (command: string) => {
    setRunningCmd(command);
    try {
      const res = await fetch("/api/telegram/bot-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          reply: string;
          subUrl?: string;
        };
        setBotOutput(data.reply);
        if (data.subUrl) {
          setLastSubUrl(data.subUrl);
        }
        toast({ description: t.toastOk.replace("{cmd}", command) });
      } else {
        toast({ variant: "destructive", description: t.errorToast });
      }
    } finally {
      setRunningCmd(null);
    }
  };

  return (
    <section className="glass rounded-2xl p-5 md:p-6 space-y-5 ring-1 ring-primary/25">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
            <Bot className="h-5 w-5 text-primary" />
          </span>
          <div>
            <h3 className="text-base font-bold text-foreground">{t.title}</h3>
            <p className="text-xs text-muted-foreground">{t.subtitle}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: Live Bot Simulator & Command Runner */}
        <div className="rounded-xl bg-black/30 p-4 ring-1 ring-white/10 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Terminal className="h-3.5 w-3.5 text-primary" />
              {t.executor}
            </span>
            {tokenConfigured ? (
              <span className="font-mono text-[10px] text-chart-3" dir="ltr">
                {tokenMasked} · {t.tokenOk}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">{t.simulated}</span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { cmd: "/status", label: t.cmdStatus },
              { cmd: "/users", label: t.cmdUsers },
              { cmd: "/create_trial", label: t.cmdTrial },
              { cmd: "/backup_now", label: t.cmdBackup },
            ].map((b) => (
              <Button
                key={b.cmd}
                variant="outline"
                size="sm"
                disabled={runningCmd !== null}
                onClick={() => void runBotCommand(b.cmd)}
                className="h-8 gap-1.5 rounded-full border-primary/30 bg-primary/10 px-3 text-xs text-primary hover:bg-primary/20"
              >
                {runningCmd === b.cmd ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                {b.label}
              </Button>
            ))}
          </div>

          <pre
            dir="ltr"
            className="min-h-[148px] whitespace-pre-wrap rounded-xl bg-black/50 p-3.5 font-mono text-xs leading-relaxed text-foreground/90 ring-1 ring-white/10"
          >
            {botOutput ?? t.terminalIdle}
          </pre>

          {lastSubUrl && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/10 px-3 py-2 ring-1 ring-primary/30">
              <span className="truncate font-mono text-xs text-primary" dir="ltr">
                {lastSubUrl}
              </span>
              <a
                href={lastSubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary"
              >
                {t.openSub}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        {/* Right: Automation & Self-Healing Toggles */}
        <div className="rounded-xl bg-black/20 p-4 ring-1 ring-white/10 space-y-3.5">
          <div className="flex items-center justify-between gap-3 py-1">
            <div>
              <p className="text-sm font-medium text-foreground">{t.selfService}</p>
              <p className="text-xs text-muted-foreground">{t.selfServiceD}</p>
            </div>
            <Switch checked={selfService} onCheckedChange={setSelfService} aria-label={t.selfService} />
          </div>

          <div className="flex items-center justify-between gap-3 py-1 border-t border-white/10 pt-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t.receipt}</p>
              <p className="text-xs text-muted-foreground">{t.receiptD}</p>
            </div>
            <Switch checked={receiptApprove} onCheckedChange={setReceiptApprove} aria-label={t.receipt} />
          </div>

          <div className="flex items-center justify-between gap-3 py-1 border-t border-white/10 pt-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t.guardian}</p>
              <p className="text-xs text-muted-foreground">{t.guardianD}</p>
            </div>
            <Switch checked={guardianHeal} onCheckedChange={setGuardianHeal} aria-label={t.guardian} />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t.backup}</p>
              <p className="text-xs text-muted-foreground">{t.backupD}</p>
            </div>
            <Select value={autoBackupInterval} onValueChange={setAutoBackupInterval}>
              <SelectTrigger id="tg-cadence" className="h-8 w-32 text-xs font-mono" aria-label={t.backup}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-strong">
                <SelectItem value="1h">{t.cad1h}</SelectItem>
                <SelectItem value="6h">{t.cad6h}</SelectItem>
                <SelectItem value="12h">{t.cad12h}</SelectItem>
                <SelectItem value="24h">{t.cad24h}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="border-t border-white/10 pt-3 text-[11px] text-muted-foreground">
            {t.previewNote}
          </p>
        </div>
      </div>
    </section>
  );
}
