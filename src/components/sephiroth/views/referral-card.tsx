"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Info, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Task 2-d — Referral program settings card

   Own-section settings (served by /api/referral/settings, so
   the shared /api/settings route stays untouched) + a "top
   referrers" table from /api/referral/stats. Rewards credit
   the SAME wallet the v2.8 /credit flow tops up (Toman).
   ============================================================ */

interface ReferralSettingsDTO {
  enabled: boolean;
  rewardAmount: number;
  currency: string;
}

interface ReferralStatsDTO {
  totalReferred: number;
  totalRewarded: number;
  top: {
    tgId: string;
    username: string;
    code: string;
    referrals: number;
    rewarded: number;
    earnedToman: number;
  }[];
}

/** {var} interpolation, same helper style as the webhooks card. */
function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export function ReferralCard() {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].referral;
  const { toast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [reward, setReward] = useState("0");
  const [currency, setCurrency] = useState("Toman");

  const [stats, setStats] = useState<ReferralStatsDTO | null>(null);
  const [statsError, setStatsError] = useState(false);
  const mounted = useRef(true);

  const loadSettings = useCallback(async (): Promise<ReferralSettingsDTO | null> => {
    try {
      const res = await fetch("/api/referral/settings", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { referral: ReferralSettingsDTO };
      return data.referral;
    } catch {
      return null;
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/referral/stats", { cache: "no-store" });
      if (!res.ok) throw new Error("stats");
      const data = (await res.json()) as ReferralStatsDTO;
      if (mounted.current) {
        setStats(data);
        setStatsError(false);
      }
    } catch {
      if (mounted.current) setStatsError(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const s = await loadSettings();
      if (s && mounted.current) {
        setEnabled(Boolean(s.enabled));
        setReward(String(Math.max(0, Math.floor(Number(s.rewardAmount) || 0))));
        setCurrency(s.currency || "Toman");
        setLoaded(true);
      }
      await loadStats();
    })();
    return () => {
      mounted.current = false;
    };
  }, [loadSettings, loadStats]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/referral/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          rewardAmount: reward.trim() === "" ? 0 : Number(reward.trim()),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { fields?: { field: string; code: string }[] };
        const detail = (data.fields ?? []).map((f) => `${f.field}: ${f.code}`).join(" · ");
        throw new Error(detail || "save");
      }
      const data = (await res.json()) as { referral: ReferralSettingsDTO };
      if (mounted.current && data.referral) {
        setEnabled(Boolean(data.referral.enabled));
        setReward(String(Math.max(0, Math.floor(Number(data.referral.rewardAmount) || 0))));
        setCurrency(data.referral.currency || "Toman");
      }
      toast({ description: fx.savedToast });
      await loadStats();
    } catch (err) {
      toast({ variant: "destructive", description: err instanceof Error && err.message !== "save" ? err.message : fx.statsError });
    }
    setSaving(false);
  };

  return (
    <section className="glass rounded-2xl p-5 md:p-6" aria-label={fx.title}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
            <Users className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-bold text-foreground">{fx.title}</h3>
            <p className="max-w-md text-xs text-muted-foreground">{fx.desc}</p>
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!loaded}
            aria-label={fx.enabled}
          />
          {fx.enabled}
        </label>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ref-reward">{fx.rewardLabel}</Label>
          <Input
            id="ref-reward"
            dir="ltr"
            inputMode="numeric"
            className="font-mono"
            value={reward}
            onChange={(e) => setReward(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={fx.rewardPh}
            autoComplete="off"
          />
        </div>
        <div className="flex items-end pb-1">
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground" dir="auto">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {fx.currencyNote}
            <span className="sr-only">{currency}</span>
          </p>
        </div>
      </div>

      <div className="mt-4">
        <Button onClick={() => void save()} disabled={saving || !loaded} className="min-h-11 gap-2">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
          {saving ? fx.saving : fx.save}
        </Button>
      </div>

      {/* top referrers */}
      <div className="mt-6">
        <h4 className="text-sm font-semibold text-foreground">{fx.statsTitle}</h4>

        {!stats && !statsError && (
          <div className="mt-3 text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          </div>
        )}

        {statsError && (
          <p className="mt-3 text-xs text-chart-5" role="alert">
            {fx.statsError}
          </p>
        )}

        {stats && !statsError && stats.top.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            {fx.statsEmpty}
          </p>
        )}

        {stats && !statsError && stats.top.length > 0 && (
          <div className="mt-3 max-h-64 overflow-y-auto pe-1">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                    {fx.colUser}
                  </th>
                  <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                    {fx.colReferrals}
                  </th>
                  <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                    {fx.colRewarded}
                  </th>
                  <th scope="col" className="py-1.5 text-start font-medium">
                    {fx.colEarned}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {stats.top.map((r) => (
                  <tr
                    key={r.tgId}
                    aria-label={fmt(fx.userAria, { user: r.username || r.tgId })}
                    className={cn("transition-colors hover:bg-white/[0.03]")}
                  >
                    <td className="py-2 pe-2">
                      <span className="font-mono text-foreground" dir="ltr">
                        {r.username || r.tgId}
                      </span>
                    </td>
                    <td className="py-2 pe-2 font-mono text-foreground" dir="ltr">
                      {fmt(fx.referralsFmt, { n: r.referrals })}
                    </td>
                    <td className="py-2 pe-2 font-mono text-foreground" dir="ltr">
                      {fmt(fx.rewardedFmt, { n: r.rewarded })}
                    </td>
                    <td className="py-2 font-mono text-foreground" dir="ltr">
                      {fmt(fx.earnedFmt, { n: r.earnedToman.toLocaleString("en-US") })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
