"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BotMessageSquare,
  Check,
  Coins,
  CreditCard,
  Loader2,
  Send,
  ShieldCheck,
  ShoppingCart,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { sfmt } from "@/lib/i18n/sub-dictionary";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ResellerBotDTO } from "@/lib/resellers";

/* ============================================================
   Sephiroth · task 3-1 — per-reseller Telegram bot card

   Glass dialog opened from a reseller row (bot icon). Own token
   (masked, dir=ltr, type=password), enabled switch, honest status
   pill, test delivery to the owner's admin chats, mini shop stats
   and the reseller's OWN payment gateway. The token NEVER echoes —
   GET ships a masked hint only; an untouched (or bullet-carrying)
   value means "keep" server-side.
   ============================================================ */

interface ResellerBotCardProps {
  resellerId: string | null;
  resellerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface BotForm {
  token: string; // "" = keep
  enabled: boolean;
  payCardNumber: string; // masked echo = keep
  payCardHolder: string;
  payZarin: string; // masked echo = keep
}

export function ResellerBotCard({ resellerId, resellerName, open, onOpenChange }: ResellerBotCardProps) {
  const lang = useAppStore((s) => s.lang);
  const d = dictionaries[lang];
  const r = FEATURE[lang].resellerBot;
  const { toast } = useToast();

  const [dto, setDto] = useState<ResellerBotDTO | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<BotForm>({ token: "", enabled: false, payCardNumber: "", payCardHolder: "", payZarin: "" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tokenErr, setTokenErr] = useState(false);

  const load = useCallback(async () => {
    if (!resellerId) return;
    setLoading(true);
    setLoadErr(false);
    try {
      const res = await fetch(`/api/resellers/${resellerId}/bot`, { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as ResellerBotDTO;
      setDto(data);
      setForm({
        token: "",
        enabled: data.botEnabled,
        payCardNumber: data.payCardMasked ?? "",
        payCardHolder: data.payCardHolder ?? "",
        payZarin: data.payZarinMasked ?? "",
      });
      setTokenErr(false);
    } catch {
      setLoadErr(true);
      setDto(null);
    }
    setLoading(false);
  }, [resellerId]);

  useEffect(() => {
    if (open && resellerId) void load();
    if (!open) {
      setDto(null);
      setLoadErr(false);
    }
  }, [open, resellerId, load]);

  const save = async () => {
    if (saving || !resellerId) return;
    setSaving(true);
    setTokenErr(false);
    try {
      const res = await fetch(`/api/resellers/${resellerId}/bot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // "" = keep the stored token (masked echo also keeps — same rule
          // as the payment secrets); a fresh value must pass the shape check
          botToken: form.token.trim(),
          botEnabled: form.enabled,
          payCardNumber: form.payCardNumber.trim(),
          payCardHolder: form.payCardHolder.trim(),
          payZarinpalMerchant: form.payZarin.trim(),
        }),
      });
      if (res.status === 400) {
        const j = (await res.json()) as { fields?: { field: string; code: string }[] };
        if ((j.fields ?? []).some((f) => f.field === "botToken")) {
          setTokenErr(true);
        }
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error("save");
      const data = (await res.json()) as ResellerBotDTO;
      setDto(data);
      setForm({
        token: "",
        enabled: data.botEnabled,
        payCardNumber: data.payCardMasked ?? "",
        payCardHolder: data.payCardHolder ?? "",
        payZarin: data.payZarinMasked ?? "",
      });
      toast({ description: r.savedToast });
    } catch {
      toast({ variant: "destructive", description: d.inbounds.errGeneric });
    }
    setSaving(false);
  };

  const sendTest = async () => {
    if (testing || !resellerId) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/resellers/${resellerId}/bot`, { method: "POST" });
      if (!res.ok) throw new Error("test");
      const j = (await res.json()) as { ok: boolean; reason?: string };
      if (j.ok) {
        toast({ description: r.testOk });
      } else {
        toast({ variant: "destructive", description: sfmt(r.testFailFmt, { detail: j.reason ?? "error" }) });
      }
    } catch {
      toast({ variant: "destructive", description: d.inbounds.errGeneric });
    }
    setTesting(false);
  };

  const status = dto?.status;
  const state = status?.state ?? "stopped";
  const payOff = dto ? !dto.payCardConfigured && !dto.payZarinConfigured : false;

  const statCells: { label: string; value: string; icon: typeof Users }[] = dto
    ? [
        { label: r.statsCustomers, value: sfmt(r.statPlainFmt, { count: dto.customers }), icon: Users },
        { label: r.statsOrders, value: sfmt(r.statPlainFmt, { count: dto.ordersTotal }), icon: ShoppingCart },
        { label: r.statsToday, value: sfmt(r.statCountFmt, { count: dto.salesToday.count, n: dto.salesToday.sumToman }), icon: Check },
        { label: r.statsWeek, value: sfmt(r.statCountFmt, { count: dto.salesWeek.count, n: dto.salesWeek.sumToman }), icon: Check },
        { label: r.statsCatalog, value: sfmt(r.statPlainFmt, { count: dto.catalogCount }), icon: BotMessageSquare },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-h-[88vh] overflow-y-auto border-white/10 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-silver flex items-center gap-2 text-lg font-bold">
            <BotMessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />
            {r.title}
            <span className="truncate text-sm font-medium text-muted-foreground" dir="ltr">
              · {resellerName}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            {r.desc}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : loadErr || !dto ? (
          <div
            className="glass flex items-center gap-3 rounded-2xl border border-chart-5/30 px-4 py-3 text-sm text-chart-5"
            role="alert"
          >
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {r.loadError}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="ms-auto rounded-full border-white/10 bg-white/[0.03]"
              aria-label="retry"
            >
              {d.users.cancel}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* status pill + bot username */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ring-1",
                  state === "running" && "bg-chart-3/15 text-chart-3 ring-chart-3/30",
                  state === "stopped" && "bg-muted/40 text-muted-foreground ring-white/10",
                  state === "error" && "bg-chart-5/15 text-chart-5 ring-chart-5/30"
                )}
                role="status"
              >
                {state === "running" && <Check className="h-3 w-3" aria-hidden="true" />}
                {state === "error" && <TriangleAlert className="h-3 w-3" aria-hidden="true" />}
                {state === "running" ? r.statusRunning : state === "error" ? r.statusError : r.statusStopped}
              </span>
              {dto.botUsername ? (
                <Badge variant="outline" className="border-white/10 bg-white/[0.03] font-mono text-[11px]" dir="ltr">
                  @{dto.botUsername}
                </Badge>
              ) : (
                <span className="text-[11px] text-muted-foreground">{r.noUsername}</span>
              )}
              {payOff && (
                <Badge variant="outline" className="border-chart-5/30 bg-chart-5/10 text-[10px] text-chart-5">
                  {r.payOffBadge}
                </Badge>
              )}
            </div>
            {state === "error" && status?.reason && (
              <p className="text-[11px] leading-relaxed text-chart-5">{sfmt(r.statusReasonFmt, { detail: status.reason })}</p>
            )}

            {/* token + enabled */}
            <div className="space-y-3 border-t border-white/5 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="rb-token" className="text-xs text-muted-foreground">
                  {r.tokenLabel}
                </Label>
                <Input
                  id="rb-token"
                  type="password"
                  value={form.token}
                  onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
                  placeholder={dto.tokenConfigured ? dto.tokenMasked : r.tokenPh}
                  dir="ltr"
                  autoComplete="off"
                  aria-invalid={tokenErr}
                  className="h-10 font-mono text-xs"
                />
                {tokenErr && <p className="text-[11px] text-chart-5">{r.errTokenFormat}</p>}
                <p className="text-[10px] leading-relaxed text-muted-foreground">{r.tokenKeepHint}</p>
              </div>
              <div className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                    aria-label={r.enabled}
                  />
                  {r.enabled}
                </label>
                <p className="text-[10px] leading-relaxed text-muted-foreground">{r.enabledHint}</p>
              </div>
            </div>

            {/* mini stats */}
            <div className="space-y-2 border-t border-white/5 pt-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {statCells.map(({ label, value }) => (
                  <div key={label} className="glass rounded-xl px-3 py-2 ring-1 ring-white/10">
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                    <p className="mt-0.5 font-mono text-xs font-semibold text-foreground" dir="ltr">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">{r.tipCatalog}</p>
            </div>

            {/* the reseller's OWN gateway */}
            <div className="space-y-3 border-t border-white/5 pt-4">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                {r.gatewayTitle}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rb-card" className="text-xs text-muted-foreground">
                    {r.gatewayCard}
                  </Label>
                  <Input
                    id="rb-card"
                    value={form.payCardNumber}
                    onChange={(e) => setForm((f) => ({ ...f, payCardNumber: e.target.value }))}
                    dir="ltr"
                    className="h-10 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rb-holder" className="text-xs text-muted-foreground">
                    {r.gatewayHolder}
                  </Label>
                  <Input
                    id="rb-holder"
                    value={form.payCardHolder}
                    onChange={(e) => setForm((f) => ({ ...f, payCardHolder: e.target.value }))}
                    dir="ltr"
                    className="h-10 font-mono text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rb-zarin" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Coins className="h-3 w-3" aria-hidden="true" />
                  {r.gatewayZarin}
                </Label>
                <Input
                  id="rb-zarin"
                  value={form.payZarin}
                  onChange={(e) => setForm((f) => ({ ...f, payZarin: e.target.value }))}
                  dir="ltr"
                  className="h-10 font-mono text-xs"
                />
              </div>
              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {r.gatewayHint}
              </p>
            </div>

            {/* actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 pt-4">
              <Button
                variant="outline"
                onClick={() => void sendTest()}
                disabled={testing || !dto.tokenConfigured}
                className="h-10 gap-2 rounded-full border-white/10 bg-white/[0.03]"
                aria-label={r.test}
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                {testing ? r.testing : r.test}
              </Button>
              <Button
                onClick={() => void save()}
                disabled={saving}
                className="glow-cyan h-10 gap-2 rounded-full bg-primary/90 font-semibold text-black hover:bg-primary"
                aria-label={r.save}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                {saving ? r.saving : r.save}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
