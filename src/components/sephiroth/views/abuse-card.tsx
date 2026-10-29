"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Check, CircleAlert, Loader2, ShieldBan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Task 2-e — Anti-abuse card (item 2.4)

   forceChannel + banNotify settings (own `abuse` section,
   served by /api/telegram/abuse so the shared /api/settings
   route stays untouched) + the banned-users table with a ban
   form and per-row unban. The sales-worker enforces both at
   the top of update handling (admins bypass, errors fail open).
   ============================================================ */

interface AbuseSettingsDTO {
  forceChannel: string;
  banNotify: boolean;
}

interface BannedRowDTO {
  chatId: string;
  username: string;
  reason: string;
  bannedAt: string | null;
}

interface AbuseStateDTO {
  abuse: AbuseSettingsDTO;
  banned: BannedRowDTO[];
}

const LOCALES: Record<string, string> = {
  fa: "fa-IR",
  ar: "ar",
  zh: "zh-CN",
  tr: "tr-TR",
  ru: "ru-RU",
  en: "en-US",
};

export function AbuseCard() {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].abuse;
  const { toast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [forceChannel, setForceChannel] = useState("");
  const [banNotify, setBanNotify] = useState(true);

  const [banned, setBanned] = useState<BannedRowDTO[]>([]);
  const [banChatId, setBanChatId] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banBusy, setBanBusy] = useState(false);
  const [unbanning, setUnbanning] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/abuse", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as AbuseStateDTO;
      if (mounted.current) {
        setForceChannel(data.abuse?.forceChannel ?? "");
        setBanNotify(Boolean(data.abuse?.banNotify));
        setBanned(Array.isArray(data.banned) ? data.banned : []);
        setLoadFailed(false);
        setLoaded(true);
      }
    } catch {
      if (mounted.current) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/telegram/abuse", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceChannel: forceChannel.trim(), banNotify }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { fields?: { field: string; code: string }[] };
        const detail = (data.fields ?? []).map((f) => `${f.field}: ${f.code}`).join(" · ");
        toast({ variant: "destructive", description: detail || fx.errSave });
        return;
      }
      const data = (await res.json()) as AbuseStateDTO;
      if (mounted.current) {
        setForceChannel(data.abuse?.forceChannel ?? "");
        setBanNotify(Boolean(data.abuse?.banNotify));
      }
      toast({ description: fx.savedToast });
    } catch {
      toast({ variant: "destructive", description: fx.errSave });
    }
    setSaving(false);
  };

  const ban = async () => {
    setBanBusy(true);
    try {
      const res = await fetch("/api/telegram/abuse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ban", chatId: banChatId.trim(), reason: banReason.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as AbuseStateDTO;
        if (mounted.current) {
          setBanned(Array.isArray(data.banned) ? data.banned : []);
          setBanChatId("");
          setBanReason("");
        }
        toast({ description: fx.bannedToast });
      } else if (res.status === 404) {
        toast({ variant: "destructive", description: fx.userNotFound });
      } else {
        toast({ variant: "destructive", description: fx.errSave });
      }
    } catch {
      toast({ variant: "destructive", description: fx.errSave });
    }
    setBanBusy(false);
  };

  const unban = async (chatId: string) => {
    setUnbanning(chatId);
    try {
      const res = await fetch("/api/telegram/abuse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unban", chatId }),
      });
      if (res.ok) {
        const data = (await res.json()) as AbuseStateDTO;
        if (mounted.current) setBanned(Array.isArray(data.banned) ? data.banned : []);
        toast({ description: fx.unbannedToast });
      } else {
        toast({ variant: "destructive", description: fx.errSave });
      }
    } catch {
      toast({ variant: "destructive", description: fx.errSave });
    }
    setUnbanning(null);
  };

  const chatIdValid = /^-?\d{3,20}$/.test(banChatId.trim());
  const canBan = chatIdValid && !banBusy;

  return (
    <section className="glass rounded-2xl p-5 md:p-6" aria-label={fx.title}>
      <div className="flex items-start gap-3">
        <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
          <ShieldBan className="h-5 w-5 text-primary" aria-hidden="true" />
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

      {loaded && !loadFailed && (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="abuse-channel">{fx.forceChannelLabel}</Label>
              <Input
                id="abuse-channel"
                dir="ltr"
                className="font-mono"
                value={forceChannel}
                onChange={(e) => setForceChannel(e.target.value)}
                placeholder={fx.forceChannelPh}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">{fx.forceChannelHint}</p>
            </div>
            <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 p-3">
              <div>
                <Label htmlFor="abuse-ban-notify" className="text-sm">
                  {fx.banNotifyLabel}
                </Label>
                <p className="mt-1 text-[11px] text-muted-foreground">{fx.banNotifyHint}</p>
              </div>
              <Switch
                id="abuse-ban-notify"
                checked={banNotify}
                onCheckedChange={setBanNotify}
                aria-label={fx.banNotifyLabel}
              />
            </div>
          </div>

          <div className="mt-4">
            <Button onClick={() => void save()} disabled={saving} className="min-h-11 gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4" aria-hidden="true" />
              )}
              {saving ? fx.saving : fx.save}
            </Button>
          </div>

          {/* banned users */}
          <div className="mt-6">
            <h4 className="text-sm font-semibold text-foreground">{fx.bannedTitle}</h4>

            {banned.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground" role="status">
                {fx.bannedEmpty}
              </p>
            )}

            {banned.length > 0 && (
              <div className="mt-3 max-h-64 overflow-y-auto pe-1">
                <table className="w-full text-start text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                        {fx.colChatId}
                      </th>
                      <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                        {fx.colUser}
                      </th>
                      <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                        {fx.colReason}
                      </th>
                      <th scope="col" className="py-1.5 pe-2 text-start font-medium">
                        {fx.colDate}
                      </th>
                      <th scope="col" className="py-1.5 text-start font-medium">
                        <span className="sr-only">{fx.unbanBtn}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {banned.map((r) => (
                      <tr key={r.chatId} className="transition-colors hover:bg-white/[0.03]">
                        <td className="py-2 pe-2">
                          <span className="font-mono text-foreground" dir="ltr">
                            {r.chatId}
                          </span>
                        </td>
                        <td className="py-2 pe-2">
                          <span className="font-mono text-foreground" dir="ltr">
                            {r.username || "—"}
                          </span>
                        </td>
                        <td className="max-w-[10rem] truncate py-2 pe-2" dir="auto" title={r.reason || undefined}>
                          {r.reason || <span className="text-muted-foreground">{fx.noReason}</span>}
                        </td>
                        <td className="py-2 pe-2">
                          <time
                            dateTime={r.bannedAt ?? undefined}
                            className="font-mono text-muted-foreground"
                            dir="ltr"
                          >
                            {r.bannedAt
                              ? new Date(r.bannedAt).toLocaleDateString(LOCALES[lang] ?? "en-US", {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })
                              : "—"}
                          </time>
                        </td>
                        <td className="py-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void unban(r.chatId)}
                            disabled={unbanning === r.chatId}
                            className="min-h-11 gap-1.5 px-3"
                            aria-label={fx.unbanAria.replace("{user}", r.username || r.chatId)}
                          >
                            {unbanning === r.chatId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Ban className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
                            )}
                            {fx.unbanBtn}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ban form */}
          <div className="mt-5 rounded-xl border border-border/60 p-4">
            <h4 className="text-sm font-semibold text-foreground">{fx.banFormTitle}</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="abuse-ban-chatid">{fx.banChatIdLabel}</Label>
                <Input
                  id="abuse-ban-chatid"
                  dir="ltr"
                  inputMode="numeric"
                  className={cn("font-mono", banChatId.trim() !== "" && !chatIdValid && "border-chart-5")}
                  value={banChatId}
                  onChange={(e) => setBanChatId(e.target.value.replace(/[^\d-]/g, ""))}
                  placeholder={fx.banChatIdPh}
                  autoComplete="off"
                  aria-invalid={banChatId.trim() !== "" && !chatIdValid}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="abuse-ban-reason">{fx.banReasonLabel}</Label>
                <Input
                  id="abuse-ban-reason"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder={fx.banReasonPh}
                  maxLength={500}
                  autoComplete="off"
                />
              </div>
            </div>
            <Button
              variant="destructive"
              onClick={() => void ban()}
              disabled={!canBan}
              className="mt-3 min-h-11 gap-2"
            >
              {banBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Ban className="h-4 w-4" aria-hidden="true" />
              )}
              {fx.banBtn}
            </Button>
            {banChatId.trim() !== "" && !chatIdValid && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-chart-5" role="alert">
                <CircleAlert className="h-3 w-3" aria-hidden="true" />
                <span dir="ltr">{fx.banChatIdPh}</span>
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
