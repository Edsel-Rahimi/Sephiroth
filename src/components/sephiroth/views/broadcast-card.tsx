"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2, Megaphone, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FEATURE, type FeatureDict } from "@/lib/i18n/feature-strings";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Task 2-e — Broadcast card (item 2.3)

   Queue + live progress for the admin broadcast (served by
   /api/telegram/broadcast + /cancel). The sender loop runs
   server-side (src/lib/bot/broadcast.ts) fire-and-forget — this
   card only enqueues, polls every 2 s while running, and can
   flip the running job to "cancelled". Honest "bot not
   configured" state mirrors the Telegram status pill.
   ============================================================ */

const MAX_TEXT = 4000;
const POLL_MS = 2000;

type BroadcastFx = FeatureDict["broadcast"];

interface JobDTO {
  id: string;
  text: string;
  parseMode: string;
  total: number;
  sent: number;
  failed: number;
  status: string;
  lastError: string;
  createdAt: string;
  finishedAt: string | null;
}

interface BroadcastStateDTO {
  configured: boolean;
  eligibleCount: number;
  job: JobDTO | null;
  history: JobDTO[];
}

/** {var} interpolation, same helper style as the referral card. */
function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

function statusLabel(status: string, fx: BroadcastFx): string {
  if (status === "running") return fx.statusRunning;
  if (status === "done") return fx.statusDone;
  if (status === "cancelled") return fx.statusCancelled;
  if (status === "interrupted") return fx.statusInterrupted;
  return status;
}

/** history timestamp locale per UI language. */
const LOCALES: Record<string, string> = {
  fa: "fa-IR",
  ar: "ar",
  zh: "zh-CN",
  tr: "tr-TR",
  ru: "ru-RU",
  en: "en-US",
};

export function BroadcastCard() {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].broadcast;
  const { toast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [state, setState] = useState<BroadcastStateDTO | null>(null);
  const [text, setText] = useState("");
  const [parseMode, setParseMode] = useState<"None" | "MarkdownV2">("None");
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mounted = useRef(true);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<BroadcastStateDTO | null> => {
    try {
      const res = await fetch("/api/telegram/broadcast", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as BroadcastStateDTO;
      if (mounted.current) {
        setState(data);
        setLoadFailed(false);
      }
      return data;
    } catch {
      if (mounted.current) setLoadFailed(true);
      return null;
    }
  }, []);

  // initial load + poll while a job is running
  useEffect(() => {
    mounted.current = true;
    void load().then(() => {
      if (mounted.current) setLoaded(true);
    });
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const running = state?.job?.status === "running";

  useEffect(() => {
    if (!running) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    if (pollTimer.current) return;
    pollTimer.current = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [running, load]);

  const send = async () => {
    setConfirmOpen(false);
    setSending(true);
    try {
      const res = await fetch("/api/telegram/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), parseMode }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as BroadcastStateDTO;
        if (mounted.current) {
          setState(data);
          setText("");
        }
        toast({ description: fmt(fx.queuedToast, { n: data.job?.total ?? data.eligibleCount }) });
      } else if (res.status === 409) {
        toast({ variant: "destructive", description: fx.errRunning });
        await load();
      } else if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          variant: "destructive",
          description: data.error === "bot_not_configured" ? fx.notConfigured : fx.errValidation,
        });
      } else {
        toast({ variant: "destructive", description: fx.errServer });
      }
    } catch {
      toast({ variant: "destructive", description: fx.errServer });
    }
    setSending(false);
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch("/api/telegram/broadcast/cancel", { method: "POST" });
      if (res.ok) {
        toast({ description: fx.cancelledToast });
      }
      await load();
    } catch {
      toast({ variant: "destructive", description: fx.errServer });
    }
    setCancelling(false);
  };

  const configured = Boolean(state?.configured);
  const canSend = loaded && configured && !sending && !running && text.trim().length > 0 && text.trim().length <= MAX_TEXT;
  const job = state?.job ?? null;

  const statusBadge = (status: string) =>
    cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
      status === "running" && "bg-primary/15 text-primary",
      status === "done" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      status === "cancelled" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      status === "interrupted" && "bg-chart-5/15 text-chart-5"
    );

  return (
    <section className="glass rounded-2xl p-5 md:p-6" aria-label={fx.title}>
      <div className="flex items-start gap-3">
        <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
          <Megaphone className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-base font-bold text-foreground">{fx.title}</h3>
          <p className="max-w-md text-xs text-muted-foreground">{fx.desc}</p>
        </div>
      </div>

      {!loaded && !loadFailed && (
        <div className="mt-4 text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        </div>
      )}

      {loadFailed && (
        <p className="mt-4 text-xs text-chart-5" role="alert">
          {fx.loadError}
        </p>
      )}

      {loaded && !loadFailed && !configured && (
        <p
          className="mt-4 flex items-start gap-1.5 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400"
          role="status"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {fx.notConfigured}
        </p>
      )}

      {loaded && !loadFailed && (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {/* composer */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bc-text">{fx.textLabel}</Label>
                  <span
                    className={cn(
                      "font-mono text-[11px] tabular-nums",
                      text.trim().length > MAX_TEXT ? "text-chart-5" : "text-muted-foreground"
                    )}
                    dir="ltr"
                    aria-live="polite"
                  >
                    {fmt(fx.counterFmt, { used: text.length, limit: MAX_TEXT })}
                  </span>
                </div>
                <Textarea
                  id="bc-text"
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT + 500))}
                  placeholder={fx.textPh}
                  rows={5}
                  className="resize-y"
                  maxLength={MAX_TEXT + 500}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bc-parse">{fx.parseLabel}</Label>
                <Select value={parseMode} onValueChange={(v) => setParseMode(v === "MarkdownV2" ? "MarkdownV2" : "None")}>
                  <SelectTrigger id="bc-parse" className="w-full" aria-label={fx.parseLabel}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="None">{fx.modeNone}</SelectItem>
                    <SelectItem value="MarkdownV2">{fx.modeMarkdown}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Button onClick={() => setConfirmOpen(true)} disabled={!canSend} className="min-h-11 gap-2">
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                  {sending ? fx.sending : fx.send}
                </Button>
              </div>
            </div>

            {/* telegram-style bubble preview */}
            <div className="space-y-1.5">
              <Label>{fx.previewTitle}</Label>
              <div className="flex justify-end">
                <div
                  className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 px-3 py-2"
                  aria-label={fx.previewTitle}
                >
                  {text.trim() ? (
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground" dir="auto">
                      {text}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground" dir="auto">
                      {fx.textPh}
                    </p>
                  )}
                  <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                    <span dir="ltr">Telegram</span>
                    {parseMode === "MarkdownV2" && <span dir="ltr">· MD</span>}
                  </p>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{fx.previewNote}</p>
            </div>
          </div>

          {/* live progress while running */}
          {running && job && (
            <div className="mt-5 rounded-xl border border-primary/25 bg-primary/5 p-4" role="status" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className={statusBadge("running")}>{statusLabel("running", fx)}</span>
                  <span className="font-mono text-xs tabular-nums text-foreground" dir="ltr">
                    {fmt(fx.progressFmt, { used: job.sent, limit: job.total })}
                  </span>
                  {job.failed > 0 && (
                    <span className="font-mono text-xs tabular-nums text-chart-5" dir="ltr">
                      ✗ {fmt(fx.failedFmt, { n: job.failed })}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void cancel()}
                  disabled={cancelling}
                  className="min-h-11 gap-2"
                >
                  {cancelling ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Square className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {cancelling ? fx.cancelling : fx.cancel}
                </Button>
              </div>
              <Progress
                className="mt-3"
                value={job.total > 0 ? Math.min(100, ((job.sent + job.failed) / job.total) * 100) : 0}
                aria-label={fmt(fx.progressFmt, { used: job.sent, limit: job.total })}
              />
            </div>
          )}

          {/* history */}
          <div className="mt-6">
            <h4 className="text-sm font-semibold text-foreground">{fx.historyTitle}</h4>
            {state && state.history.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground" role="status">
                {fx.historyEmpty}
              </p>
            )}
            {state && state.history.length > 0 && (
              <div className="mt-3 max-h-64 overflow-y-auto pe-1">
                <table className="w-full text-start text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                        {fx.colWhen}
                      </th>
                      <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                        {fx.colStatus}
                      </th>
                      <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                        {fx.colSent}
                      </th>
                      <th scope="col" className="py-1.5 text-start font-medium">
                        {fx.colFailed}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {state.history.map((h) => (
                      <tr key={h.id} className="transition-colors hover:bg-white/[0.03]">
                        <td className="py-2 pe-2">
                          <time dateTime={h.createdAt} className="font-mono text-muted-foreground" dir="ltr">
                            {new Date(h.createdAt).toLocaleString(LOCALES[lang] ?? "en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </td>
                        <td className="py-2 pe-2">
                          <span className={statusBadge(h.status)}>{statusLabel(h.status, fx)}</span>
                        </td>
                        <td className="py-2 pe-2 font-mono tabular-nums text-foreground" dir="ltr">
                          {fmt(fx.progressFmt, { used: h.sent, limit: h.total })}
                        </td>
                        <td className="py-2 font-mono tabular-nums text-foreground" dir="ltr">
                          {fmt(fx.failedFmt, { n: h.failed })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* send confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{fx.confirmTitle}</DialogTitle>
            <DialogDescription>
              {fmt(fx.confirmBody, { n: state?.eligibleCount ?? 0 })}
              {parseMode === "MarkdownV2" ? ` (${fx.modeMarkdown})` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-xl bg-muted/40 p-3 text-sm" dir="auto">
            <p className="whitespace-pre-wrap break-words">{text.trim()}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} className="min-h-11">
              <X className="h-4 w-4" aria-hidden="true" />
              {fx.confirmCancel}
            </Button>
            <Button onClick={() => void send()} disabled={sending} className="min-h-11 gap-2">
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              {fx.confirmSend}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
