"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Webhook,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Task 2-a — Outbound Webhooks settings card

   Settings card that configures OUTBOUND webhooks: endpoint
   URL + HMAC signing secret (write-only — empty input keeps
   the current secret), an 11-event toggle-chip grid, Save /
   Send-test actions (test uses the CURRENT form values so
   unsaved edits are testable) and a compact "recent
   deliveries" feed (≤12, reloaded after every save/test).

   Task 2-a adds: a collapsible "per-event URL overrides"
   grid (one row per event — empty row = use the default
   endpoint) included in the Save PUT body, and a "dead
   letters" queue (failed-after-3-attempts deliveries) with
   per-row retry/delete, clear-all and an empty state.
   ============================================================ */

interface WebhookEventsDTO {
  userCreated: boolean;
  userDeleted: boolean;
  userUpdated: boolean;
  userExpired: boolean;
  trafficAlert: boolean;
  loginAlert: boolean;
  salesDigest: boolean;
  backupDone: boolean;
  panelRestart: boolean;
  inboundCreated: boolean;
  inboundDeleted: boolean;
}

interface WebhookSettingsDTO {
  enabled: boolean;
  url: string;
  secretConfigured: boolean;
  secretMasked?: string;
  events: WebhookEventsDTO;
  eventUrls?: Record<string, string>;
}

interface DeliveryDTO {
  id: string;
  createdAt: string;
  ok: boolean;
  event: string;
  message?: string;
  status?: number;
  attempts?: number;
  ms?: number;
}

interface DeadLetterDTO {
  id: string;
  createdAt: string;
  event: string;
  url?: string;
  status?: number | null;
  error?: string;
  attempts?: number;
  payload?: string;
  sign?: string;
}

/* event field order ↔ fx.ev* label keys */
const EVENT_KEYS = [
  "userCreated",
  "userDeleted",
  "userUpdated",
  "userExpired",
  "trafficAlert",
  "loginAlert",
  "salesDigest",
  "backupDone",
  "panelRestart",
  "inboundCreated",
  "inboundDeleted",
] as const;

type EventKey = (typeof EVENT_KEYS)[number];
type WebhookFx = (typeof FEATURE)["fa"]["webhooks"];

/* all 15 dispatcher event names — mirrors WEBHOOK_EVENTS from
   @/lib/webhooks, duplicated here because that module is
   server-only (node:fs) and must never reach the client bundle */
const ALL_EVENTS = [
  "user.created",
  "user.deleted",
  "user.updated",
  "user.expired",
  "user.near-expiry",
  "user.quota",
  "user.traffic-reset",
  "user.activated",
  "user.renewed",
  "login.failed",
  "sales.digest",
  "backup.done",
  "panel.restart",
  "inbound.created",
  "inbound.deleted",
] as const;

const EV_LABEL: Record<EventKey, keyof WebhookFx> = {
  userCreated: "evUserCreated",
  userDeleted: "evUserDeleted",
  userUpdated: "evUserUpdated",
  userExpired: "evUserExpired",
  trafficAlert: "evTraffic",
  loginAlert: "evLogin",
  salesDigest: "evDigest",
  backupDone: "evBackup",
  panelRestart: "evRestart",
  inboundCreated: "evInboundCreated",
  inboundDeleted: "evInboundDeleted",
};

/* tiny {var} interpolation for API-shaped strings (testOk / testFail) */
const fmt = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

/* HH:mm in the active locale — never crashes on missing data */
const timeFmt = (iso: string | undefined, lang: string): string => {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "—";
  try {
    return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(t));
  } catch {
    return "—";
  }
};

const EVENTS_OFF: WebhookEventsDTO = {
  userCreated: false,
  userDeleted: false,
  userUpdated: false,
  userExpired: false,
  trafficAlert: false,
  loginAlert: false,
  salesDigest: false,
  backupDone: false,
  panelRestart: false,
  inboundCreated: false,
  inboundDeleted: false,
};

export function WebhooksCard() {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].webhooks;
  const { toast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState(""); // write-only: "" = keep current
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [events, setEvents] = useState<WebhookEventsDTO>(EVENTS_OFF);

  /* Task 2-a — per-event URL overrides ("" = use the default endpoint) */
  const [eventUrls, setEventUrls] = useState<Record<string, string>>({});
  const [ovOpen, setOvOpen] = useState(false);

  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryDTO[]>([]);
  const [deadLetters, setDeadLetters] = useState<DeadLetterDTO[]>([]);
  const [deadLoaded, setDeadLoaded] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const mounted = useRef(true);

  const apply = useCallback((wh: WebhookSettingsDTO) => {
    setEnabled(Boolean(wh?.enabled));
    setUrl(typeof wh?.url === "string" ? wh.url : "");
    setSecret(""); // never reflect the secret back into the form
    setSecretConfigured(Boolean(wh?.secretConfigured));
    const e = wh?.events ?? {};
    setEvents({
      userCreated: Boolean(e.userCreated),
      userDeleted: Boolean(e.userDeleted),
      userUpdated: Boolean(e.userUpdated),
      userExpired: Boolean(e.userExpired),
      trafficAlert: Boolean(e.trafficAlert),
      loginAlert: Boolean(e.loginAlert),
      salesDigest: Boolean(e.salesDigest),
      backupDone: Boolean(e.backupDone),
      panelRestart: Boolean(e.panelRestart),
      inboundCreated: Boolean(e.inboundCreated),
      inboundDeleted: Boolean(e.inboundDeleted),
    });
    // Task 2-a — per-event URL overrides: normalize to ALL_EVENTS keys
    const eu = wh?.eventUrls ?? {};
    const nextUrls: Record<string, string> = {};
    for (const ev of ALL_EVENTS) {
      nextUrls[ev] = typeof eu[ev] === "string" ? (eu[ev] as string) : "";
    }
    setEventUrls(nextUrls);
  }, []);

  const loadDeliveries = useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks/deliveries", { cache: "no-store" });
      if (!res.ok || !mounted.current) return;
      const data = (await res.json()) as { deliveries?: DeliveryDTO[] };
      if (mounted.current) {
        setDeliveries(Array.isArray(data?.deliveries) ? data.deliveries.slice(0, 12) : []);
      }
    } catch {
      /* keep the previous list */
    }
  }, []);

  /* Task 2-a — dead-letter queue feed */
  const loadDeadLetters = useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks/dead-letters", { cache: "no-store" });
      if (!res.ok || !mounted.current) return;
      const data = (await res.json()) as { deadLetters?: DeadLetterDTO[] };
      if (mounted.current) {
        setDeadLetters(Array.isArray(data?.deadLetters) ? data.deadLetters.slice(0, 100) : []);
      }
    } catch {
      /* keep the previous list */
    } finally {
      if (mounted.current) setDeadLoaded(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (res.ok && mounted.current) {
          const data = (await res.json()) as { webhooks?: WebhookSettingsDTO };
          if (data?.webhooks) {
            apply(data.webhooks);
            setLoaded(true);
          }
        }
      } catch {
        /* card keeps defaults */
      }
    })();
    void loadDeliveries();
    void loadDeadLetters();
    return () => {
      mounted.current = false;
    };
  }, [apply, loadDeliveries, loadDeadLetters]);

  const save = async () => {
    setSaving(true);
    try {
      // Task 2-a — the override map is sent for ALL events; "" clears an
      // override server-side (falls back to the default endpoint URL)
      const eventUrlsBody: Record<string, string> = {};
      for (const ev of ALL_EVENTS) {
        eventUrlsBody[ev] = (eventUrls[ev] ?? "").trim();
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "webhooks",
          enabled,
          url: url.trim(),
          secret, // "" = keep current, null clears (we never send null here)
          events,
          eventUrls: eventUrlsBody,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string; fields?: { field: string; code: string }[] }
          | null;
        const detail = err?.fields?.length
          ? err.fields.map((f) => `${f.field}: ${f.code}`).join(" · ")
          : err?.error || `HTTP ${String(res.status)}`;
        toast({ variant: "destructive", description: fmt(fx.testFail, { detail }) });
        return;
      }
      const data = (await res.json()) as { webhooks?: WebhookSettingsDTO };
      if (data?.webhooks) apply(data.webhooks);
      toast({ description: fx.savedToast });
      await loadDeliveries();
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message : "network";
      toast({ variant: "destructive", description: fmt(fx.testFail, { detail }) });
    }
    setSaving(false);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // send the CURRENT form values so unsaved edits are testable;
      // omitted fields fall back to the saved settings server-side
      const body: { url?: string; secret?: string } = {};
      const trimmed = url.trim();
      if (trimmed) body.url = trimmed;
      if (secret) body.secret = secret;
      const res = await fetch("/api/settings/test-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; status?: number; latencyMs?: number; error?: string; detail?: string }
        | null;
      if (data?.ok) {
        setTestResult({
          ok: true,
          text: fmt(fx.testOk, { status: String(data.status ?? 0), ms: String(data.latencyMs ?? 0) }),
        });
      } else {
        const detail = data?.detail || data?.error || `HTTP ${String(res.status)}`;
        setTestResult({ ok: false, text: fmt(fx.testFail, { detail }) });
      }
      await loadDeliveries();
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message : "network";
      setTestResult({ ok: false, text: fmt(fx.testFail, { detail }) });
    }
    setTesting(false);
  };

  const toggleEvent = (k: EventKey) => setEvents((p) => ({ ...p, [k]: !p[k] }));

  /* Task 2-a — derived: override rows + resolved default placeholder */
  const overrideCount = ALL_EVENTS.filter((ev) => (eventUrls[ev] ?? "").trim() !== "").length;
  const defaultPh = url.trim() || fx.urlPh;

  /* ---------- Task 2-a — dead-letter actions ---------- */

  const retryDead = async (id: string) => {
    setRetryingId(id);
    try {
      const res = await fetch("/api/webhooks/dead-letters/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; status?: number; ms?: number; error?: string }
        | null;
      if (res.ok && data?.ok) {
        toast({
          description: fmt(fx.dlRetried, { status: String(data.status ?? 0), ms: String(data.ms ?? 0) }),
        });
      } else {
        const detail = data?.error || `HTTP ${String(res.status)}`;
        toast({ variant: "destructive", description: fmt(fx.dlRetryFail, { detail }) });
      }
      // refresh in both branches — the server updates/keeps/removes the row
      await loadDeadLetters();
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message : "network";
      toast({ variant: "destructive", description: fmt(fx.dlRetryFail, { detail }) });
    }
    setRetryingId(null);
  };

  const deleteDead = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch("/api/webhooks/dead-letters", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        if (mounted.current) setDeadLetters((p) => p.filter((d) => d?.id !== id));
        toast({ description: fx.dlClear });
      } else {
        const detail = `HTTP ${String(res.status)}`;
        toast({ variant: "destructive", description: fmt(fx.testFail, { detail }) });
      }
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message : "network";
      toast({ variant: "destructive", description: fmt(fx.testFail, { detail }) });
    }
    setDeletingId(null);
  };

  const clearDeadAll = async () => {
    setClearingAll(true);
    try {
      const res = await fetch("/api/webhooks/dead-letters?all=true", { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { removed?: number } | null;
      if (res.ok) {
        if (mounted.current) setDeadLetters([]);
        toast({ description: fmt(fx.dlCleared, { n: String(data?.removed ?? deadLetters.length) }) });
      } else {
        const detail = `HTTP ${String(res.status)}`;
        toast({ variant: "destructive", description: fmt(fx.testFail, { detail }) });
      }
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message : "network";
      toast({ variant: "destructive", description: fmt(fx.testFail, { detail }) });
    }
    setClearingAll(false);
  };

  return (
    <section className="glass rounded-2xl p-5 md:p-6" aria-label={fx.title}>
      {/* header row: icon + title/desc + enabled switch */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
            <Webhook className="h-4 w-4 text-primary" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{fx.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{fx.desc}</p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-2 pt-0.5">
          <Label htmlFor="wh-enabled" className="text-xs text-muted-foreground">
            {fx.enabled}
          </Label>
          <Switch
            id="wh-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!loaded}
            aria-label={fx.enabled}
          />
        </span>
      </div>

      {/* endpoint + signing secret */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wh-url">{fx.url}</Label>
          <Input
            id="wh-url"
            dir="ltr"
            className="font-mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={fx.urlPh}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wh-secret">{fx.secret}</Label>
          <Input
            id="wh-secret"
            type="password"
            dir="ltr"
            className="font-mono"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={fx.secretPh}
            autoComplete="new-password"
          />
          {secretConfigured && (
            <p className="text-[11px] text-muted-foreground">{fx.secretKeepHint}</p>
          )}
        </div>
      </div>

      {/* events — toggle chips */}
      <div className="mt-5">
        <p className="text-xs font-semibold text-foreground">{fx.eventsTitle}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {EVENT_KEYS.map((k) => {
            const active = Boolean(events[k]);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleEvent(k)}
                aria-pressed={active}
                disabled={!loaded}
                className={cn(
                  "flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "bg-gradient-to-br from-primary/25 to-primary/5 text-foreground ring-1 ring-primary/40"
                    : "text-muted-foreground ring-1 ring-border hover:bg-white/5 hover:text-foreground"
                )}
              >
                {active && <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
                <span className="truncate">{fx[EV_LABEL[k]]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* per-event URL overrides (Task 2-a) — collapsible */}
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setOvOpen((v) => !v)}
          aria-expanded={ovOpen}
          aria-controls="wh-overrides"
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-1 text-start outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground">
            {fx.ovTitle}
            {overrideCount > 0 && (
              <span
                className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/30"
                dir="ltr"
              >
                {String(overrideCount)}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              ovOpen && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">{fx.ovHint}</p>
        {ovOpen && (
          <div id="wh-overrides" className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pe-1" role="group" aria-label={fx.ovTitle}>
            {ALL_EVENTS.map((ev) => {
              const val = eventUrls[ev] ?? "";
              const hasOverride = val.trim() !== "";
              return (
                <div key={ev} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    title={hasOverride ? fx.ovTitle : undefined}
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                      hasOverride ? "bg-primary" : "ring-1 ring-border"
                    )}
                  />
                  <span
                    className="w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:w-36"
                    dir="ltr"
                    title={ev}
                  >
                    {ev}
                  </span>
                  <Input
                    dir="ltr"
                    className="h-8 min-w-0 flex-1 font-mono text-xs"
                    value={val}
                    onChange={(e) => setEventUrls((p) => ({ ...p, [ev]: e.target.value }))}
                    placeholder={defaultPh}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`${ev} URL`}
                    disabled={!loaded}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* actions */}
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
          onClick={() => void runTest()}
          disabled={testing || !loaded}
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

      {/* inline test result */}
      {testResult && (
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "mt-2 flex items-center gap-1.5 text-xs",
            testResult.ok ? "text-emerald-400" : "text-rose-400"
          )}
        >
          {testResult.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span dir="auto">{testResult.text}</span>
        </p>
      )}

      {/* signing hint */}
      <p className="mt-4 flex items-start gap-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden="true" />
        <span>{fx.hintSign}</span>
      </p>

      {/* recent deliveries */}
      <div className="mt-5">
        <p className="text-xs font-semibold text-foreground">{fx.recentTitle}</p>
        {deliveries.length === 0 ? (
          <p className="mt-2 rounded-xl bg-white/[0.02] px-3.5 py-3 text-xs text-muted-foreground ring-1 ring-border/50">
            {fx.recentEmpty}
          </p>
        ) : (
          <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto pe-1">
            {deliveries.map((d, idx) => (
              <li
                key={String(d?.id ?? idx)}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.02] px-3.5 py-2.5 ring-1 ring-border/50"
              >
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground" dir="ltr">
                  {timeFmt(d?.createdAt, lang)}
                </span>
                <span className="min-w-0 truncate font-mono text-xs text-foreground" dir="ltr">
                  {String(d?.event ?? "")}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0 text-[10px] font-semibold ring-1",
                    d?.ok
                      ? "border-transparent bg-emerald-500/10 text-emerald-400 ring-emerald-500/30"
                      : "border-transparent bg-rose-500/10 text-rose-400 ring-rose-500/30"
                  )}
                >
                  {d?.ok ? fx.okBadge : fx.failBadge}
                </Badge>
                {(typeof d?.status === "number" || typeof d?.ms === "number") && (
                  <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                    {typeof d?.status === "number" ? ` · HTTP ${String(d.status)}` : ""}
                    {typeof d?.ms === "number" ? ` · ${String(d.ms)}ms` : ""}
                  </span>
                )}
                {d?.message ? (
                  <span
                    className="ms-auto hidden max-w-[200px] truncate text-[10px] text-muted-foreground sm:block"
                    title={d.message}
                  >
                    {d.message}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* dead letters (Task 2-a) — failed deliveries awaiting retry */}
      <div className="mt-5" aria-busy={!deadLoaded}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
            {fmt(fx.dlTitle, { n: String(deadLetters.length) })}
            {deadLetters.length > 0 && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400"
              />
            )}
          </p>
          {deadLetters.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => void clearDeadAll()}
              disabled={clearingAll}
              className="min-h-11 gap-1.5 rounded-full px-3 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              {clearingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {fx.dlClearAll}
            </Button>
          )}
        </div>
        {!deadLoaded ? (
          <p className="mt-2 flex items-center gap-2 rounded-xl bg-white/[0.02] px-3.5 py-3 text-xs text-muted-foreground ring-1 ring-border/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          </p>
        ) : deadLetters.length === 0 ? (
          <p className="mt-2 rounded-xl bg-white/[0.02] px-3.5 py-3 text-xs text-muted-foreground ring-1 ring-border/50">
            {fx.dlEmpty}
          </p>
        ) : (
          <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto pe-1" aria-label={fmt(fx.dlTitle, { n: String(deadLetters.length) })}>
            {deadLetters.map((d, idx) => {
              const busyRetry = retryingId === d?.id;
              const busyDelete = deletingId === d?.id;
              const errText = String(d?.error ?? "");
              return (
                <li
                  key={String(d?.id ?? idx)}
                  className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.02] px-3.5 py-2 ring-1 ring-border/50"
                >
                  <span
                    className="shrink-0 font-mono text-[11px] text-muted-foreground"
                    dir="ltr"
                    title={fmt(fx.dlTime, { time: timeFmt(d?.createdAt, lang) })}
                  >
                    {timeFmt(d?.createdAt, lang)}
                  </span>
                  <span className="min-w-0 truncate font-mono text-xs text-foreground" dir="ltr">
                    {String(d?.event ?? "")}
                  </span>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full border-transparent bg-rose-500/10 px-2 py-0 text-[10px] font-semibold text-rose-400 ring-1 ring-rose-500/30"
                  >
                    {typeof d?.status === "number" && d.status > 0 ? `HTTP ${String(d.status)}` : fx.failBadge}
                  </Badge>
                  {errText && (
                    <span
                      className="hidden max-w-[180px] truncate font-mono text-[10px] text-rose-300/80 sm:block"
                      dir="ltr"
                      title={errText}
                    >
                      {errText}
                    </span>
                  )}
                  <span className="ms-auto flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void retryDead(String(d?.id ?? ""))}
                      disabled={busyRetry || busyDelete || clearingAll}
                      className="h-11 w-11 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400"
                      aria-label={busyRetry ? fx.dlRetrying : fx.dlRetry}
                      title={busyRetry ? fx.dlRetrying : fx.dlRetry}
                    >
                      {busyRetry ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void deleteDead(String(d?.id ?? ""))}
                      disabled={busyRetry || busyDelete || clearingAll}
                      className="h-11 w-11 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
                      aria-label={fx.dlDel}
                      title={fx.dlDel}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
