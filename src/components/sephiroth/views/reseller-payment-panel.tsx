"use client";

import { useState } from "react";
import {
  Check,
  Coins,
  CreditCard,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";

export function ResellerPaymentPanel() {
  const lang = useAppStore((s) => s.lang);
  const isFa = lang === "fa" || lang === "ar";
  const { toast } = useToast();

  const [zarinpalEnabled, setZarinpalEnabled] = useState(true);
  const [cryptoEnabled, setCryptoEnabled] = useState(true);
  const [cardToCardEnabled, setCardToCardEnabled] = useState(true);
  const [merchantId, setMerchantId] = useState("zp-9a84b712-sephiroth-gateway-2026");
  const [usdtWallet, setUsdtWallet] = useState("TX9kSephirothOrbitTrc20Wallet8892");
  const [cardNumber, setCardNumber] = useState("6037-9975-8412-3091");
  const [pricePerGb, setPricePerGb] = useState("1800");

  const saveHooks = () => {
    toast({
      description: isFa
        ? "تنظیمات درگاه پرداخت، کیف پول و تعرفه ترافیک نمایندگان ذخیره شد"
        : "Payment hooks, wallet addresses, and reseller GB tariff saved",
    });
  };

  return (
    <section className="glass rounded-2xl p-5 md:p-6 space-y-5 ring-1 ring-white/10 mt-6">
      <div className="flex items-start gap-3">
        <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
          <Wallet className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h3 className="text-base font-bold text-foreground">
            {isFa
              ? "کیف پول نمایندگان، تعرفه ترافیک و وب‌هوک‌های پرداخت خودکار"
              : "Reseller Wallet, Per-GB Tariff & Automated Payment Webhooks"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isFa
              ? "اتصال به درگاه زرین‌پال، کریپتو (USDT TRC20) و کارت‌به‌کارت تلگرام جهت شارژ خودکار سهمیه ترافیک نمایندگان"
              : "Connect Zarinpal, Crypto USDT (TRC20), and Telegram Card-to-Card hooks for automatic reseller traffic quota top-ups"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Card-to-Card */}
        <div className="rounded-xl bg-black/25 p-4 ring-1 ring-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CreditCard className="h-4 w-4 text-primary" />
              {isFa ? "کارت‌به‌کارت هوشمند" : "Smart Card-to-Card"}
            </span>
            <Switch checked={cardToCardEnabled} onCheckedChange={setCardToCardEnabled} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {isFa ? "شماره کارت مقصد" : "Destination Card Number"}
            </Label>
            <Input
              dir="ltr"
              className="font-mono text-xs"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {isFa ? "تعرفه هر گیگابایت نماینده (تومان)" : "Reseller Tariff per GB (IRR/Toman)"}
            </Label>
            <Input
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
              {isFa ? "وب‌هوک درگاه زرین‌پال / آیدی‌پی" : "Zarinpal / IDPay Webhook"}
            </span>
            <Switch checked={zarinpalEnabled} onCheckedChange={setZarinpalEnabled} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Merchant ID / API Key</Label>
            <Input
              dir="ltr"
              className="font-mono text-xs"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {isFa
              ? "پس از تراکنش موفق، سقف ترافیک نماینده (trafficQuotaGb) به صورت آنی افزایش می‌یابد."
              : "Automatically increments reseller trafficQuotaGb immediately upon verified callback."}
          </p>
        </div>

        {/* Crypto USDT */}
        <div className="rounded-xl bg-black/25 p-4 ring-1 ring-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Coins className="h-4 w-4 text-chart-3" />
              {isFa ? "درگاه ارزی تتر (USDT TRC20)" : "Crypto USDT (TRC20) Hook"}
            </span>
            <Switch checked={cryptoEnabled} onCheckedChange={setCryptoEnabled} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">TRC20 Wallet Address</Label>
            <Input
              dir="ltr"
              className="font-mono text-xs"
              value={usdtWallet}
              onChange={(e) => setUsdtWallet(e.target.value)}
            />
          </div>
          <div className="pt-1 flex justify-end">
            <Button size="sm" onClick={saveHooks} className="gap-1.5 rounded-full">
              <Check className="h-3.5 w-3.5" />
              {isFa ? "ذخیره تنظیمات مالی" : "Save Payment Hooks"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
