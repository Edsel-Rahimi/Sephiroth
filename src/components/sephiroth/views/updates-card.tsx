"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpCircle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Task 3-c — Updates settings card

   Release channel (stable | beta) lives in the `updates`
   settings section; "Check now" asks /api/system/update-check,
   which compares the running version against the public GitHub
   releases and answers honestly (including an offline state)
   with a 5-minute server-side cache.
   ============================================================ */

type Channel = "stable" | "beta";

interface UpdateSettingsDTO {
  channel: Channel;
}

interface UpdateCheckDTO {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  channel: Channel;
  releaseUrl: string;
  publishedAt: string | null;
  checkedAt: string;
  error?: string;
}

export function UpdatesCard() {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].updates;
  const { toast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [channel, setChannel] = useState<Channel>("stable");

  const [current, setCurrent] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<UpdateCheckDTO | null>(null);
  // transport-level failure (the API itself answers 200 even when offline)
  const [checkError, setCheckError] = useState(false);
  const mounted = useRef(true);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { updates?: UpdateSettingsDTO };
      if (data?.updates && mounted.current) {
        setChannel(data.updates.channel === "beta" ? "beta" : "stable");
        setLoaded(true);
      }
    } catch {
      /* card keeps defaults until a successful load */
    }
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/system/update-check", { cache: "no-store" });
      if (!res.ok) throw new Error("check");
      const data = (await res.json()) as UpdateCheckDTO;
      if (mounted.current) {
        setCheck(data);
        setCurrent(data.current || null);
      }
    } catch {
      if (mounted.current) {
        // the endpoint answers 200 even offline; reaching here means
        // the request itself failed — surface the same honest state
        setCheckError(true);
      }
    }
    if (mounted.current) setChecking(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      await loadSettings();
      await runCheck();
    })();
    return () => {
      mounted.current = false;
    };
  }, [loadSettings, runCheck]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "updates", channel }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { fields?: { field: string; code: string }[] };
        const detail = (data.fields ?? []).map((f) => `${f.field}: ${f.code}`).join(" · ");
        throw new Error(detail || "save");
      }
      const data = (await res.json()) as { updates?: UpdateSettingsDTO };
      if (mounted.current && data.updates) {
        setChannel(data.updates.channel === "beta" ? "beta" : "stable");
      }
      toast({ description: fx.saved });
      // channel changed → the previous cached answer may be the other line
      await runCheck();
    } catch {
      toast({ variant: "destructive", description: fx.offline });
    }
    setSaving(false);
  };

  const offline = checkError || Boolean(check?.error);
  const showResult = !checking && (offline || check !== null);

  return (
    <section className="glass rounded-2xl p-5 md:p-6" aria-label={fx.title}>
      {/* header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
            <Rocket className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-bold text-foreground">{fx.title}</h3>
            <p className="max-w-md text-xs text-muted-foreground">{fx.desc}</p>
          </div>
        </div>
        {current && (
          <Badge
            variant="outline"
            className="shrink-0 gap-1.5 rounded-full border-border bg-white/4 px-3 py-1 font-mono text-xs"
            title={fx.current}
          >
            <span className="text-muted-foreground" dir="auto">{fx.current}</span>
            <span dir="ltr">v{current}</span>
          </Badge>
        )}
      </div>

      {/* channel picker */}
      <div className="mt-5" role="radiogroup" aria-label={fx.channel}>
        <Label className="text-xs font-medium text-muted-foreground">{fx.channel}</Label>
        <RadioGroup
          value={channel}
          onValueChange={(v) => setChannel(v === "beta" ? "beta" : "stable")}
          disabled={!loaded || saving}
          className="mt-2 grid gap-3 sm:grid-cols-2"
        >
          {(["stable", "beta"] as const).map((ch) => (
            <label
              key={ch}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                "hover:bg-white/[0.04]",
                channel === ch ? "border-primary/50 bg-white/[0.05]" : "border-border/70"
              )}
            >
              <RadioGroupItem value={ch} className="mt-0.5" aria-label={ch === "stable" ? fx.stable : fx.beta} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  {ch === "stable" ? fx.stable : fx.beta}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground" dir="auto">
                  {ch === "stable" ? fx.stableHint : fx.betaHint}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={saving || !loaded} className="min-h-11 gap-2">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
          {saving ? fx.saving : fx.save}
        </Button>
        <Button
          variant="outline"
          onClick={() => void runCheck()}
          disabled={checking || saving}
          className="min-h-11 gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
        >
          {checking ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          {checking ? fx.checking : fx.checkNow}
        </Button>
      </div>

      {/* check result */}
      <div className="mt-4" aria-live="polite">
        {checking && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {fx.checking}
          </p>
        )}

        {showResult && !checking && offline && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-lg bg-chart-5/10 px-2.5 py-2 text-xs text-chart-5 ring-1 ring-chart-5/30"
            dir="auto"
          >
            <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {fx.offline}
          </p>
        )}

        {showResult && !checking && !offline && check && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2 text-xs ring-1",
              check.updateAvailable
                ? "bg-chart-3/10 text-chart-3 ring-chart-3/30"
                : "bg-white/[0.04] text-muted-foreground ring-border/60"
            )}
          >
            {check.updateAvailable ? (
              <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span dir="auto">{check.updateAvailable ? fx.updateAvail : fx.upToDate}</span>
            {check.latest && (
              <Badge
                variant="outline"
                className="rounded-full border-border bg-white/4 font-mono text-[11px]"
                title={check.publishedAt ?? undefined}
              >
                <span dir="ltr">v{check.latest}</span>
              </Badge>
            )}
            {check.releaseUrl && (
              <a
                href={check.releaseUrl}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {fx.releaseUrl}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
