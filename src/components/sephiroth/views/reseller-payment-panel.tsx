"use client";

import { useEffect, useState } from "react";
import { Check, Coins, CreditCard, ShieldCheck, Star, Wallet, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";

/** Payment section as shipped by GET/PUT /api/settings — cardNumber,
 *  zarinpalMerchant, usdtWallet and the task 3-a nowpaymentsApiKey /
 *  nowpaymentsIpnSecret arrive MASKED (head+tail bullets) and are only
 *  overwritten server-side when a fresh non-masked value is submitted. */
interface PaymentViewDTO {
  cardToCardEnabled?: boolean;
  zarinpalEnabled?: boolean;
  cryptoEnabled?: boolean;
  cardNumber?: string;
  zarinpalMerchant?: string;
  usdtWallet?: string;
  pricePerGb?: string;
  // task 3-a — NowPayments (crypto) + Telegram Stars
  nowpaymentsEnabled?: boolean;
  nowpaymentsApiKey?: string; // masked
  nowpaymentsIpnSecret?: string; // masked
  nowpaymentsSandbox?: boolean;
  nowpaymentsTomanPerUsd?: number;
  starsEnabled?: boolean;
  starsTomanPerStar?: number;
}

export function ResellerPaymentPanel() {
  const lang = useAppStore((s) => s.lang);
  const d = dictionaries[lang];
  const t = d.payment;
  const p = FEATURE[lang].payment; // task 3-a — crypto + stars strings
  const { toast } = useToast();

  // Task 18-3 — hydrated from GET /api/settings (section "payment"); the save
  // button below does a real PUT. Masked credentials echo back untouched.
  const [zarinpalEnabled, setZarinpalEnabled] = useState(true);
  const [cryptoEnabled, setCryptoEnabled] = useState(true);
  const [cardToCardEnabled, setCardToCardEnabled] = useState(true);
  const [merchantId, setMerchantId] = useState("");
  const [usdtWallet, setUsdtWallet] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [pricePerGb, setPricePerGb] = useState("");
  // task 3-a — NowPayments + Stars state
  const [npEnabled, setNpEnabled] = useState(false);
  const [npApiKey, setNpApiKey] = useState("");
  const [npIpnSecret, setNpIpnSecret] = useState("");
  const [npSandbox, setNpSandbox] = useState(false);
  const [npRate, setNpRate] = useState("");
  const [starsEnabled, setStarsEnabled] = useState(false);
  const [starsRate, setStarsRate] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyView = (v: PaymentViewDTO) => {
    setCardToCardEnabled(v.cardToCardEnabled ?? true);
    setCardNumber(v.cardNumber ?? "");
    setPricePerGb(v.pricePerGb ?? "");
    setZarinpalEnabled(v.zarinpalEnabled ?? true);
    setMerchantId(v.zarinpalMerchant ?? "");
    setCryptoEnabled(v.cryptoEnabled ?? true);
    setUsdtWallet(v.usdtWallet ?? "");
    setNpEnabled(v.nowpaymentsEnabled ?? false);
    setNpApiKey(v.nowpaymentsApiKey ?? "");
    setNpIpnSecret(v.nowpaymentsIpnSecret ?? "");
    setNpSandbox(v.nowpaymentsSandbox ?? false);
    setNpRate(v.nowpaymentsTomanPerUsd ? String(v.nowpaymentsTomanPerUsd) : "");
    setStarsEnabled(v.starsEnabled ?? false);
    setStarsRate(v.starsTomanPerStar ? String(v.starsTomanPerStar) : "");
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (res.ok && alive) {
          const data = (await res.json()) as { payment?: PaymentViewDTO };
          if (data.payment) applyView(data.payment);
        }
      } catch {
        /* inputs stay at their defaults until the next reload */
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const saveHooks = async () => {
    if (saving || !loaded) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "payment",
          cardToCardEnabled,
          cardNumber: cardNumber.trim(),
          pricePerGb: pricePerGb.trim(),
          zarinpalEnabled,
          zarinpalMerchant: merchantId.trim(),
          cryptoEnabled,
          usdtWallet: usdtWallet.trim(),
          // task 3-a — masked secrets echo back untouched (""= keep rule:
          // a bullet-carrying value never overwrites the stored secret)
          nowpaymentsEnabled: npEnabled,
          nowpaymentsApiKey: npApiKey.trim(),
          nowpaymentsIpnSecret: npIpnSecret.trim(),
          nowpaymentsSandbox: npSandbox,
          nowpaymentsTomanPerUsd: npRate.trim() === "" ? 0 : Number(npRate.trim()),
          starsEnabled,
          starsTomanPerStar: starsRate.trim() === "" ? 0 : Number(starsRate.trim()),
        }),
      });
      if (!res.ok) throw new Error("save");
      const data = (await res.json()) as { payment?: PaymentViewDTO };
      // re-hydrate from the server view — secrets come back masked
      if (data.payment) applyView(data.payment);
      toast({ description: d.bot.paySaved });
    } catch {
      toast({ variant: "destructive", description: d.inbounds.errGeneric });
    }
    setSaving(false);
  };

  return (
    <section className="glass rounded-2xl p-5 md:p-6 space-y-5 ring-1 ring-white/10 mt-6">
      <div className="flex items-start gap-3">
        <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
          <Wallet className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h3 className="text-base font-bold text-foreground">{t.title}</h3>
          <p className="text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Card-to-Card */}
        <div className="rounded-xl bg-black/25 p-4 ring-1 ring-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CreditCard className="h-4 w-4 text-primary" />
              {t.cardTitle}
            </span>
            <Switch checked={cardToCardEnabled} onCheckedChange={setCardToCardEnabled} aria-label={t.cardTitle} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-card" className="text-xs text-muted-foreground">
              {t.fCard}
            </Label>
            <Input
              id="pay-card"
              dir="ltr"
              className="font-mono text-xs"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-tariff" className="text-xs text-muted-foreground">
              {t.fTariff}
            </Label>
            <Input
              id="pay-tariff"
              dir="ltr"
              className="font-mono text-xs"
              value={pricePerGb}
              onChange={(e) => setPricePerGb(e.target.value)}
            />
          </div>
        </div>

        {/* Zarinpal / Online Gateway */}
        <div className="rounded-xl bg-black/25 p-4 ring-1 ring-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Zap className="h-4 w-4 text-chart-4" />
              {t.zarinTitle}
            </span>
            <Switch checked={zarinpalEnabled} onCheckedChange={setZarinpalEnabled} aria-label={t.zarinTitle} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-merchant" className="text-xs text-muted-foreground">
              {t.fMerchant}
            </Label>
            <Input
              id="pay-merchant"
              dir="ltr"
              className="font-mono text-xs"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{t.webhookNote}</p>
        </div>

        {/* Crypto USDT */}
        <div className="rounded-xl bg-black/25 p-4 ring-1 ring-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Coins className="h-4 w-4 text-chart-3" />
              {t.tetherTitle}
            </span>
            <Switch checked={cryptoEnabled} onCheckedChange={setCryptoEnabled} aria-label={t.tetherTitle} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-wallet" className="text-xs text-muted-foreground">
              {t.fWallet}
            </Label>
            <Input
              id="pay-wallet"
              dir="ltr"
              className="font-mono text-xs"
              value={usdtWallet}
              onChange={(e) => setUsdtWallet(e.target.value)}
            />
          </div>
        </div>

        {/* task 3-a — NowPayments (crypto invoice gateway) */}
        <div className="rounded-xl bg-black/25 p-4 ring-1 ring-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Coins className="h-4 w-4 text-chart-2" />
              {p.npTitle}
            </span>
            <Switch checked={npEnabled} onCheckedChange={setNpEnabled} aria-label={p.npTitle} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-np-key" className="text-xs text-muted-foreground">
              {p.npKey}
            </Label>
            <Input
              id="pay-np-key"
              dir="ltr"
              className="font-mono text-xs"
              value={npApiKey}
              onChange={(e) => setNpApiKey(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-np-ipn" className="text-xs text-muted-foreground">
              {p.npIpnSecret}
            </Label>
            <Input
              id="pay-np-ipn"
              dir="ltr"
              className="font-mono text-xs"
              value={npIpnSecret}
              onChange={(e) => setNpIpnSecret(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-np-rate" className="text-xs text-muted-foreground">
              {p.npRate}
            </Label>
            <Input
              id="pay-np-rate"
              dir="ltr"
              inputMode="numeric"
              className="font-mono text-xs"
              value={npRate}
              onChange={(e) => setNpRate(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="pay-np-sandbox" className="text-xs text-muted-foreground">
              {p.npSandbox}
            </Label>
            <Switch id="pay-np-sandbox" checked={npSandbox} onCheckedChange={setNpSandbox} aria-label={p.npSandbox} />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{p.npKeyHint}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{p.npIpnHint}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{p.npRateHint}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{p.npSandboxHint}</p>
        </div>

        {/* task 3-a — Telegram Stars (XTR) */}
        <div className="rounded-xl bg-black/25 p-4 ring-1 ring-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Star className="h-4 w-4 text-chart-5" />
              {p.starsTitle}
            </span>
            <Switch checked={starsEnabled} onCheckedChange={setStarsEnabled} aria-label={p.starsTitle} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-stars-rate" className="text-xs text-muted-foreground">
              {p.starsRate}
            </Label>
            <Input
              id="pay-stars-rate"
              dir="ltr"
              inputMode="numeric"
              className="font-mono text-xs"
              value={starsRate}
              onChange={(e) => setStarsRate(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{p.starsRateHint}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{p.starsHint}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{p.keepHint}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void saveHooks()} disabled={saving || !loaded} className="gap-1.5 rounded-full">
          <Check className="h-3.5 w-3.5" />
          {t.save}
        </Button>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3 shrink-0" />
        {t.verifyNote}
      </p>
    </section>
  );
}
