"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  HelpCircle,
  KeyRound,
  Loader2,
  LogOut,
  Palette,
  RotateCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries, LANGS, LANG_META, type Lang } from "@/lib/i18n/dictionaries";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 8 — Profile view (any signed-in role)
   Identity (all roles) + Security (admin only: password change,
   one-time recovery-key rotate, revoke sessions — same handler
   patterns as settings-view Security tab) + Preferences
   (language chips + shortcut into full settings).
   API: GET/PUT /api/profile · POST /api/auth/change-password
        POST /api/auth/recovery/rotate · POST /api/auth/revoke-sessions
   ============================================================ */

interface ProfileDTO {
  username: string;
  displayName: string;
  role: "admin" | "reseller";
  createdAt: string;
  recoveryConfigured: boolean;
}

function TipBanner({
  title,
  body,
  open,
  onToggle,
}: {
  title: string;
  body: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="glass rounded-2xl ring-1 ring-primary/15" role="note">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-start outline-none transition-colors hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-4 w-4 shrink-0 text-primary/80" aria-hidden="true" />
        <span className="text-xs font-semibold text-foreground">{title}</span>
        <ChevronDown
          className={cn(
            "ms-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <p className="px-4 pb-3.5 ps-11 text-xs leading-relaxed text-muted-foreground">{body}</p>
      )}
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  desc,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  desc?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass hover-glow rounded-2xl p-5 md:p-6", className)}>
      <div className="mb-4 flex items-start gap-3">
        <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function ProfileView() {
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const setView = useAppStore((s) => s.setView);
  const { toast } = useToast();

  const t = useMemo(() => dictionaries[lang], [lang]);
  const p = t.profile;

  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  /* identity */
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  /* security (admin) */
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwErr, setPwErr] = useState<Partial<Record<"current" | "next" | "confirm", string>>>({});
  const [pwSaving, setPwSaving] = useState(false);
  const [rkBusy, setRkBusy] = useState(false);
  const [rkConfirmOpen, setRkConfirmOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [ssBusy, setSsBusy] = useState(false);
  const [ssConfirmOpen, setSsConfirmOpen] = useState(false);

  const [tipOpen, setTipOpen] = useState(true);

  const isAdmin = profile?.role === "admin";

  /* ---------- data ---------- */

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setLoadErr(false);
    void (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error("profile");
        const d = (await res.json()) as { profile: ProfileDTO };
        setProfile(d.profile);
        setName(d.profile.displayName);
      } catch {
        if (!ctrl.signal.aborted) setLoadErr(true);
      }
      if (!ctrl.signal.aborted) setLoading(false);
    })();
    return () => ctrl.abort();
  }, [reloadTick]);

  /* ---------- identity ---------- */

  const saveName = async () => {
    setSavingName(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim() }),
      });
      if (!res.ok) throw new Error("name");
      const d = (await res.json()) as { profile: ProfileDTO };
      setProfile(d.profile);
      setName(d.profile.displayName);
      toast({ description: p.savedDisplayName });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setSavingName(false);
  };

  /* ---------- security: password ---------- */

  const changePassword = async () => {
    setPwErr({});
    if (!pw.current) {
      setPwErr({ current: p.errCurrent });
      return;
    }
    if (pw.next.length < 8) {
      setPwErr({ next: p.errShort });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwErr({ confirm: p.errMismatch });
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: pw.current, next: pw.next }),
      });
      if (res.status === 403) {
        setPwErr({ current: p.errCurrent });
        return;
      }
      if (res.status === 400) {
        setPwErr({ next: p.errShort });
        return;
      }
      if (!res.ok) throw new Error("pw");
      setPw({ current: "", next: "", confirm: "" });
      toast({ description: p.pwChanged });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setPwSaving(false);
  };

  /* ---------- security: recovery key (one-time) ---------- */

  const rotateKey = async () => {
    setRkConfirmOpen(false);
    setRkBusy(true);
    try {
      const res = await fetch("/api/auth/recovery/rotate", { method: "POST" });
      if (!res.ok) throw new Error("rk");
      const d = (await res.json()) as { recoveryKey?: string };
      if (d.recoveryKey) {
        setNewKey(d.recoveryKey);
        if (profile) setProfile({ ...profile, recoveryConfigured: true });
      }
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setRkBusy(false);
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      toast({ description: t.inbounds.toastCopied });
    } catch {
      /* clipboard unavailable */
    }
  };

  /* ---------- security: sessions ---------- */

  const revokeSessions = async () => {
    setSsConfirmOpen(false);
    setSsBusy(true);
    try {
      const res = await fetch("/api/auth/revoke-sessions", { method: "POST" });
      if (!res.ok) throw new Error("ss");
      /* keep this session alive — only a toast here (no logout/reload) */
      toast({ description: p.ssDone });
    } catch {
      toast({ description: t.inbounds.errGeneric });
    }
    setSsBusy(false);
  };

  /* ---------- render ---------- */

  if (loading) {
    return (
      <div className="fade-up space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-16 w-full max-w-2xl rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (loadErr || !profile) {
    return (
      <div className="fade-up space-y-6">
        <div
          className="glass flex items-center gap-3 rounded-2xl border border-chart-5/30 px-5 py-4 text-sm text-chart-5"
          role="alert"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t.inbounds.errGeneric}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReloadTick((n) => n + 1)}
            aria-label="retry"
            className="ms-auto gap-2 rounded-full border-white/10 bg-white/[0.03]"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up space-y-6">
      {/* header */}
      <section className="space-y-2">
        <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-primary/90 ring-1 ring-primary/20">
          <UserRound className="h-3 w-3" aria-hidden="true" />
          {p.badge}
        </span>
        <h2 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">
          {t.topbar.profile}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{p.subtitle}</p>
      </section>

      <TipBanner title={p.tipTitle} body={p.tipBody} open={tipOpen} onToggle={() => setTipOpen((v) => !v)} />

      {/* ═══ identity (full width, all roles) ═══ */}
      <SectionCard icon={Sparkles} title={p.identityTitle} desc={p.identityDesc}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-chart-2/10 font-mono text-2xl font-bold text-primary ring-1 ring-primary/30"
            aria-hidden="true"
          >
            S
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.username}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <p className="font-mono text-lg font-bold text-foreground" dir="ltr">
                {profile.username}
              </p>
              <Badge
                className={cn(
                  isAdmin
                    ? "border-transparent bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "border-border bg-transparent text-muted-foreground"
                )}
              >
                {isAdmin ? p.roleAdmin : p.roleReseller}
              </Badge>
              {profile.recoveryConfigured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-chart-3/10 px-2.5 py-1 text-[10px] font-semibold text-chart-3 ring-1 ring-chart-3/30">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  {p.recovery}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {p.memberSince} ·{" "}
              <span className="font-mono tabular-nums text-foreground/80">
                {new Date(profile.createdAt).toLocaleDateString(lang)}
              </span>
            </p>
          </div>
        </div>

        <Separator className="my-5" />

        {isAdmin ? (
          <div className="space-y-1.5">
            <Label htmlFor="profile-display-name">{p.displayName}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="profile-display-name"
                value={name}
                maxLength={48}
                onChange={(e) => setName(e.target.value)}
                placeholder={p.displayNamePh}
                className="h-9 max-w-sm flex-1"
              />
              <Button
                onClick={() => void saveName()}
                disabled={savingName || name.trim() === profile.displayName}
                className="gap-2"
              >
                {savingName ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-4 w-4" aria-hidden="true" />
                )}
                {p.saveDisplayName}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>{p.resellerNote}</Label>
            <p
              className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm text-muted-foreground ring-1 ring-border/60"
              dir="auto"
            >
              {profile.displayName || "—"}
            </p>
          </div>
        )}
      </SectionCard>

      {/* ═══ security (admin) + preferences ═══ */}
      <div className={cn("grid gap-4", isAdmin && "xl:grid-cols-2")}>
        {isAdmin && (
          <SectionCard icon={ShieldCheck} title={p.secTitle} desc={p.secDesc}>
            {/* password */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <KeyRound className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                {p.pwTitle}
              </h4>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{p.pwDesc}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pf-pw-current">{p.pwCurrent}</Label>
                  <Input
                    id="pf-pw-current"
                    type="password"
                    autoComplete="current-password"
                    value={pw.current}
                    onChange={(e) => setPw((prev) => ({ ...prev, current: e.target.value }))}
                  />
                  {pwErr.current && <p className="text-xs text-chart-5">{pwErr.current}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pf-pw-next">{p.pwNew}</Label>
                  <Input
                    id="pf-pw-next"
                    type="password"
                    autoComplete="new-password"
                    value={pw.next}
                    onChange={(e) => setPw((prev) => ({ ...prev, next: e.target.value }))}
                  />
                  {pwErr.next && <p className="text-xs text-chart-5">{pwErr.next}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pf-pw-confirm">{p.pwConfirm}</Label>
                  <Input
                    id="pf-pw-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={pw.confirm}
                    onChange={(e) => setPw((prev) => ({ ...prev, confirm: e.target.value }))}
                  />
                  {pwErr.confirm && <p className="text-xs text-chart-5">{pwErr.confirm}</p>}
                </div>
              </div>
              <Button
                onClick={() => void changePassword()}
                disabled={pwSaving}
                className="mt-3 gap-2"
              >
                {pwSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-4 w-4" aria-hidden="true" />
                )}
                {pwSaving ? p.pwChanging : p.pwChange}
              </Button>
            </div>

            <Separator className="my-5" />

            {/* recovery key */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                {p.rkTitle}
              </h4>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{p.rkDesc}</p>
              {newKey ? (
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-primary/[0.06] px-4 py-3 ring-1 ring-primary/30">
                    <code className="font-mono text-sm font-bold tracking-wider text-primary" dir="ltr">
                      {newKey}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyKey()}
                      aria-label={t.inbounds.toastCopied}
                      className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary transition-shadow hover:glow-cyan"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <p className="flex items-center gap-1.5 text-[11px] text-chart-4">
                    <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {p.rkOnce}
                  </p>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setRkConfirmOpen(true)}
                    disabled={rkBusy}
                    className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
                  >
                    {rkBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCw className="h-4 w-4" aria-hidden="true" />
                    )}
                    {rkBusy ? p.rkRotating : p.rkRotate}
                  </Button>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    SEPH-••••-••••-••••
                  </span>
                </div>
              )}
            </div>

            <Separator className="my-5" />

            {/* sessions */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <LogOut className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                {p.ssTitle}
              </h4>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{p.ssDesc}</p>
              <Button
                variant="outline"
                onClick={() => setSsConfirmOpen(true)}
                disabled={ssBusy}
                className="mt-3 gap-2 rounded-full border-chart-5/40 text-chart-5 hover:bg-chart-5/10 hover:text-chart-5"
              >
                {ssBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                )}
                {ssBusy ? p.ssRevoking : p.ssRevoke}
              </Button>
            </div>
          </SectionCard>
        )}

        {/* ═══ preferences ═══ */}
        <SectionCard icon={Palette} title={p.prefsTitle} desc={p.prefsDesc}>
          <div>
            <p className="text-xs font-semibold text-foreground">{p.prefLang}</p>
            <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGS.map((l: Lang) => {
                const active = l === lang;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLang(l)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-gradient-to-br from-primary/25 to-primary/5 text-foreground ring-1 ring-primary/40"
                        : "text-muted-foreground ring-1 ring-border hover:bg-white/5 hover:text-foreground"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {LANG_META[l].code}
                      </span>
                      <span className="truncate">{LANG_META[l].native}</span>
                    </span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>

          <Separator className="my-5" />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-foreground">{p.prefLook}</p>
            <Button
              variant="outline"
              onClick={() => setView("settings")}
              className="gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
            >
              <Palette className="h-4 w-4" aria-hidden="true" />
              {p.openSettings}
            </Button>
          </div>
        </SectionCard>
      </div>

      {/* recovery key rotate confirm */}
      <AlertDialog open={rkConfirmOpen} onOpenChange={setRkConfirmOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{p.rkConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{p.rkConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.inbounds.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rotateKey()}>{p.rkConfirmBtn}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* revoke sessions confirm */}
      <AlertDialog open={ssConfirmOpen} onOpenChange={setSsConfirmOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{p.ssConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{p.ssConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.inbounds.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void revokeSessions()}
              disabled={ssBusy}
              className="bg-chart-5 text-white hover:bg-chart-5/90"
            >
              {ssBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="h-4 w-4" aria-hidden="true" />
              )}
              {p.ssConfirmBtn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
