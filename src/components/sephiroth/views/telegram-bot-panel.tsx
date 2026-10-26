"use client";

import { useState } from "react";
import {
  Bot,
  Check,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  Send,
  ShieldCheck,
  Terminal,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";

export function TelegramBotPanel() {
  const lang = useAppStore((s) => s.lang);
  const isFa = lang === "fa" || lang === "ar";
  const { toast } = useToast();

  const [runningCmd, setRunningCmd] = useState<string | null>(null);
  const [botOutput, setBotOutput] = useState<string>(
    isFa
      ? "🤖 ربات تلگرام سفیروت آماده دریافت دستورات مدیریت و استعلام کاربران است.\nیک دستور را از بالا انتخاب کنید تا خروجی زنده را ببینید."
      : "🤖 Sephiroth Orbit Telegram Bot ready.\nSelect a command above to execute against the live core."
  );
  const [lastSubUrl, setLastSubUrl] = useState<string | null>(null);

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
        toast({
          description: isFa
            ? `دستور ${command} با موفقیت در ربات اجرا شد`
            : `Bot command ${command} executed`,
        });
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
            <h3 className="text-base font-bold text-foreground">
              {isFa
                ? "کنسول تعاملی ربات تلگرام، بکاپ خودکار و نگهبان هوشمند (Self-Healing)"
                : "Interactive Telegram Bot Console, Auto-Backup & Self-Healing Guardian"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {isFa
                ? "مدیریت کاربران و سرور از داخل تلگرام، ساخت اکانت تست آنی، ارسال خودکار بکاپ ساعتی و پایش خودترمیم‌گر هسته"
                : "Admin & user Telegram commands, instant trial creation, scheduled encrypted backups, and 60s core self-healing"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: Live Bot Simulator & Command Runner */}
        <div className="rounded-xl bg-black/30 p-4 ring-1 ring-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Terminal className="h-3.5 w-3.5 text-primary" />
              {isFa ? "شبیه‌ساز زنده دستورات ربات تلگرام" : "Live Telegram Bot Command Executor"}
            </span>
            <span className="font-mono text-[10px] text-chart-3" dir="ltr">
              @SephirothOrbitBot · Webhook Active
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { cmd: "/status", label: isFa ? "وضعیت سرور (/status)" : "/status (Telemetry)" },
              { cmd: "/users", label: isFa ? "گزارش کاربران (/users)" : "/users (Top Quota)" },
              {
                cmd: "/create_trial",
                label: isFa ? "ساخت اکانت تست (/create_trial)" : "/create_trial (5GB/7d)",
              },
              {
                cmd: "/backup_now",
                label: isFa ? "ارسال بکاپ آنی (/backup_now)" : "/backup_now (Snapshot)",
              },
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
            {botOutput}
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
                {isFa ? "مشاهده صفحه اشتراک" : "Open Pass Page"}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        {/* Right: Automation & Self-Healing Toggles */}
        <div className="rounded-xl bg-black/20 p-4 ring-1 ring-white/10 space-y-3.5">
          <div className="flex items-center justify-between gap-3 py-1">
            <div>
              <p className="text-sm font-medium text-foreground">
                {isFa ? "پنل سلف‌سرویس کاربران در ربات" : "User Self-Service Bot Portal"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isFa
                  ? "امکان استعلام حجم باقی‌مانده، دریافت QR و لینک Clash/Sing-box توسط خود کاربر"
                  : "Allow users to query remaining GB, get QR codes, and fetch Clash/Sing-box links"}
              </p>
            </div>
            <Switch checked={selfService} onCheckedChange={setSelfService} />
          </div>

          <div className="flex items-center justify-between gap-3 py-1 border-t border-white/10 pt-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {isFa ? "تأیید رسید کارت‌به‌کارت و تمدید خودکار" : "Card-to-Card Receipt Approval"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isFa
                  ? "ارسال تصویر فیش واریزی توسط کاربر یا نماینده به ادمین با دکمه تأیید آنی"
                  : "Forward payment receipts to admin chat with one-tap approve/reject inline buttons"}
              </p>
            </div>
            <Switch checked={receiptApprove} onCheckedChange={setReceiptApprove} />
          </div>

          <div className="flex items-center justify-between gap-3 py-1 border-t border-white/10 pt-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {isFa ? "نگهبان خودترمیم‌گر (Self-Healing Guardian)" : "Self-Healing Core Guardian"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isFa
                  ? "بررسی سلامت هسته Xray و لینک‌های اشتراک هر ۶۰ ثانیه و ری‌استارت خودکار در صورت خطا"
                  : "Checks Xray core & sub-links every 60s and auto-heals stalled workers"}
              </p>
            </div>
            <Switch checked={guardianHeal} onCheckedChange={setGuardianHeal} />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {isFa ? "دوره ارسال خودکار بکاپ به تلگرام" : "Automated Telegram Backup Cadence"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isFa
                  ? "ارسال فایل JSON دیتابیس و کانفیگ‌ها به چت ادمین"
                  : "Push full database & inbound snapshot to admin Telegram"}
              </p>
            </div>
            <Select value={autoBackupInterval} onValueChange={setAutoBackupInterval}>
              <SelectTrigger className="h-8 w-32 text-xs font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-strong">
                <SelectItem value="1h">Every 1h</SelectItem>
                <SelectItem value="6h">Every 6h</SelectItem>
                <SelectItem value="12h">Every 12h</SelectItem>
                <SelectItem value="24h">Daily (24h)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </section>
  );
}
