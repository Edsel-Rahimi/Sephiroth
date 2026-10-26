"use client";

import { useMemo, useState } from "react";
import { Check, Coins, CreditCard, ShieldCheck, Wallet, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";

export function ResellerPaymentPanel() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang].payment, [lang]);
  const { toast } = useToast();

  // TODO(18-3): persist gateway credentials + toggles via /api/settings —
  // settings.ts has no paymentGateway section yet, so fields stay session-only.
  const [zarinpalEnabled, setZarinpalEnabled] = useState(true);
  const [cryptoEnabled, setCryptoEnabled] = useState(true);
  const [cardToCardEnabled, setCardToCardEnabled] = useState(true);
  const [merchantId, setMerchantId] = useState("zp-9a84b712-sephiroth-gateway-2026");
  const [usdtWallet, setUsdtWallet] = useState("TX9kSephirothOrbitTrc20Wallet8892");
  const [cardNumber, setCardNumber] = useState("6037-9975-8412-3091");
  const [pricePerGb, setPricePerGb] = useState("1800");

  const saveHooks = () => {
    // Honest preview toast: nothing is written server-side yet (no settings key).
    toast({ description: t.savePreview });
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
          <div className="pt-1 flex justify-end">
            <Button size="sm" onClick={saveHooks} className="gap-1.5 rounded-full">
              <Check className="h-3.5 w-3.5" />
              {t.save}
            </Button>
          </div>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3 shrink-0" />
        {t.verifyNote}
      </p>
    </section>
  );
}
