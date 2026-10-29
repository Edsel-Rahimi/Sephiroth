"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Languages,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
  WandSparkles,
  Activity,
  Server,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { BrandMark, BrandWord } from "@/components/sephiroth/brand";
import { Starfield } from "@/components/sephiroth/starfield";
import { useAppStore } from "@/lib/store/app-store";
import {
  dictionaries,
  LANGS,
  LANG_META,
  type Lang,
} from "@/lib/i18n/dictionaries";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 1 — Secure Terminal (framed showcase)
   Fusion: Clever split-frame + Ebolt refined form, cosmic DNA
   ============================================================ */

type Mode = "login" | "recover";

function LangMenu() {
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const t = dictionaries[lang];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.common.language}
        className="glass flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Globe className="h-3.5 w-3.5" />
        {LANG_META[lang].code}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass-strong min-w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t.common.language}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LANGS.map((l: Lang) => (
          <DropdownMenuItem
            key={l}
            onClick={() => setLang(l)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <span className="w-6 font-mono text-[10px] text-muted-foreground">
                {LANG_META[l].code}
              </span>
              <span>{LANG_META[l].native}</span>
            </span>
            {l === lang && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* left showcase panel — generated obsidian dunes + brand + headline */
function ShowcasePanel() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang].auth, [lang]);
  const brand = dictionaries[lang];

  return (
    <div className="relative h-44 sm:h-52 lg:h-auto lg:min-h-[680px]">
      <Image
        src="/login-dunes.png"
        alt="Obsidian dunes under a starry night sky"
        fill
        priority
        sizes="(max-width: 1024px) 100vw, 50vw"
        className="object-cover"
      />
      {/* cinematic grading */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#04080b] via-[#04080b]/20 to-[#04080b]/10" />
      <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-[#04080b]/30" />

      {/* brand top */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-2.5 p-5 md:p-6">
        <BrandMark size={34} />
        <BrandWord tagline={brand.brand.tagline} />
      </div>

      {/* headline bottom */}
      <div className="absolute inset-x-0 bottom-0 p-5 md:p-8">
        <div className="glass mb-4 hidden items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-primary lg:inline-flex">
          <Sparkles className="h-3 w-3" />
          {t.heroBadge}
        </div>
        <h1 className="text-silver max-w-md text-2xl font-bold leading-[1.12] tracking-tight sm:text-3xl lg:text-[2.5rem]">
          {t.heroTitle}
        </h1>
        <p className="mt-2.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground lg:text-sm">
          {t.heroSub}
        </p>
        <div className="mt-4 hidden flex-wrap items-center gap-2 lg:flex">
          {[
            { icon: Server, label: t.chipCore },
            { icon: Activity, label: t.chipLive },
            { icon: Languages, label: t.chipLangs },
          ].map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="glass hover-glow flex h-8 items-center gap-2 rounded-full px-3 text-[11px] text-muted-foreground"
            >
              <Icon className="h-3 w-3 text-primary" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* dotted divider with label (Ebolt) */
function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="flex-1 border-t border-dashed border-border/70" />
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span className="flex-1 border-t border-dashed border-border/70" />
    </div>
  );
}

const fieldCls =
  "h-11 rounded-xl border-border/60 bg-white/[.03] ps-10 text-[15px] placeholder:text-muted-foreground/60 focus-visible:border-primary/50 focus-visible:ring-primary/25";

export function LoginScene({
  onSuccess,
  previewHints = false,
}: {
  onSuccess: (username: string) => void;
  previewHints?: boolean;
}) {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang].auth, [lang]);
  const sysT = useMemo(() => dictionaries[lang].system, [lang]);
  const { toast } = useToast();

  /* login form state */
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  /* TOTP second factor (v2.2) */
  const [totpStep, setTotpStep] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  /* errors + lockout */
  const [error, setError] = useState<{ msg: string; shakeKey: number } | null>(null);
  const [lockSecs, setLockSecs] = useState<number | null>(null);

  /* recovery state */
  const [recKey, setRecKey] = useState("");
  const [newPw, setNewPw] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [recPw, setRecPw] = useState(false);

  const errShake = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* lockout countdown */
  useEffect(() => {
    if (lockSecs === null) return;
    if (lockSecs <= 0) {
      setLockSecs(null);
      return;
    }
    const id = setTimeout(() => setLockSecs((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(id);
  }, [lockSecs]);

  const fail = (msg: string) =>
    setError({ msg, shakeKey: ++errShake.current });

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  /* ---------- actions ---------- */

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (busy || lockSecs !== null) return;
    if (!username.trim() || !password) {
      fail(t.errFields);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          remember,
          ...(totpStep && totpCode ? { totp: totpCode } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        username?: string;
        error?: string;
        attemptsLeft?: number;
        retryAfter?: number;
      };
      if (!mounted.current) return;
      if (res.ok && data.ok && data.username) {
        toast({
          title: t.welcomeToast.replace("{name}", data.username),
          description: t.secureNote,
        });
        onSuccess(data.username);
        return;
      }
      if (res.status === 423 && data.retryAfter) {
        setLockSecs(data.retryAfter);
        fail(t.errLocked.replace("{s}", fmt(data.retryAfter)));
        return;
      }
      if (res.status === 401 && data.error === "totp_required") {
        setTotpStep(true);
        setTotpCode("");
        fail(t.totpPrompt);
        return;
      }
      if (res.status === 401 && data.error === "totp_invalid") {
        setTotpCode("");
        fail(sysT.totpInvalid);
        return;
      }
      if (res.status === 401) {
        if (typeof data.attemptsLeft === "number") {
          fail(
            `${t.errInvalid} ${t.attemptsLeft.replace(
              "{n}",
              String(data.attemptsLeft)
            )}`
          );
          return;
        }
        fail(t.errInvalid);
        return;
      }
      fail(t.errFields);
    } catch {
      if (mounted.current) fail(t.errInvalid);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    if (recBusy || lockSecs !== null) return;
    if (!recKey.trim() || !newPw) {
      fail(t.errFields);
      return;
    }
    if (newPw.length < 8) {
      fail(t.errWeak);
      return;
    }
    setRecBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryKey: recKey.trim(), newPassword: newPw }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        attemptsLeft?: number;
        retryAfter?: number;
      };
      if (!mounted.current) return;
      if (res.ok && data.ok) {
        toast({ title: t.okRecovered });
        setMode("login");
        setRecKey("");
        setNewPw("");
        setPassword("");
        setError(null);
        return;
      }
      if (res.status === 423 && data.retryAfter) {
        setLockSecs(data.retryAfter);
        fail(t.errLocked.replace("{s}", fmt(data.retryAfter)));
        return;
      }
      if (data.error === "weak") {
        fail(t.errWeak);
        return;
      }
      if (res.status === 401) {
        if (typeof data.attemptsLeft === "number") {
          fail(
            `${t.errBadKey} ${t.attemptsLeft.replace(
              "{n}",
              String(data.attemptsLeft)
            )}`
          );
          return;
        }
        fail(t.errBadKey);
        return;
      }
      fail(t.errFields);
    } catch {
      if (mounted.current) fail(t.errBadKey);
    } finally {
      if (mounted.current) setRecBusy(false);
    }
  }

  const autofill = () => {
    setUsername("admin");
    setPassword("sephiroth");
    setError(null);
  };

  const mmss = lockSecs !== null ? fmt(lockSecs) : "";

  const lockBanner = lockSecs !== null && (
    <div
      role="alert"
      className="mt-6 flex items-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-[13px] text-amber-300"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>{t.errLocked.replace("{s}", mmss)}</span>
      <span className="kbd ms-auto border-amber-400/30 bg-amber-400/10 text-amber-200">
        {mmss}
      </span>
    </div>
  );

  const errorBanner =
    error && lockSecs === null ? (
      <div
        key={error.shakeKey}
        role="alert"
        className="shake mt-6 flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive-foreground"
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span>{error.msg}</span>
      </div>
    ) : null;

  /* ---------- render ---------- */

  return (
    <div className="bg-cosmic fixed inset-0 z-50 overflow-y-auto">
      <Starfield />
      <div className="login-horizon" aria-hidden="true" />

      {/* floating controls */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-end px-5 py-4 md:px-8">
        <LangMenu />
      </header>

      <main className="relative z-10 mx-auto flex min-h-full w-full max-w-[1120px] flex-col items-center justify-center gap-5 px-4 py-8 md:px-8 lg:py-12">
        {/* ── framed showcase ── */}
        <div className="glass-frame fade-up relative w-full rounded-[2.1rem] p-2 md:p-2.5">
          <div className="grid overflow-hidden rounded-[1.6rem] border border-white/[.06] bg-background-deep/70 lg:grid-cols-[1.04fr_0.96fr]">
            <ShowcasePanel />

            {/* ── form side ── */}
            <div className="flex flex-col justify-center px-6 py-9 sm:px-10 md:px-12 md:py-12">
              {mode === "login" ? (
                <div key="login">
                  {/* head */}
                  <div className="glass glow-cyan flex h-14 w-14 items-center justify-center rounded-2xl">
                    <BrandMark size={38} />
                  </div>
                  <h2 className="mt-5 text-[1.7rem] font-bold leading-tight tracking-tight text-foreground">
                    {t.welcome}
                  </h2>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {t.welcomeSub}
                  </p>

                  {lockBanner}
                  {errorBanner}

                  {/* form */}
                  <form onSubmit={handleLogin} className="mt-7 space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="login-username" className="text-[13px] font-medium">
                        {t.username}
                      </Label>
                      <div className="relative">
                        <User className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="login-username"
                          autoComplete="username"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder={t.usernamePh}
                          disabled={busy || lockSecs !== null}
                          className={fieldCls}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="login-password" className="text-[13px] font-medium">
                          {t.password}
                        </Label>
                        <button
                          type="button"
                          onClick={() => {
                            setMode("recover");
                            setError(null);
                          }}
                          className="text-xs font-medium text-primary underline-offset-4 outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t.forgotShort}
                        </button>
                      </div>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="login-password"
                          type={showPw ? "text" : "password"}
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={t.passwordPh}
                          disabled={busy || lockSecs !== null}
                          className={cn(fieldCls, "pe-11")}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw((v) => !v)}
                          aria-label={showPw ? "Hide password" : "Show password"}
                          className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {totpStep && (
                      <div className="space-y-2">
                        <Label htmlFor="login-totp" className="text-[13px] font-medium">
                          {t.totpPrompt}
                        </Label>
                        <div className="relative">
                          <ShieldCheck className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
                          <Input
                            id="login-totp"
                            dir="ltr"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            value={totpCode}
                            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                            placeholder={sysT.totpCodePh}
                            disabled={busy || lockSecs !== null}
                            className={cn(fieldCls, "font-mono tracking-[0.4em]")}
                          />
                        </div>
                      </div>
                    )}

                    <label
                      htmlFor="login-remember"
                      className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted-foreground"
                    >
                      <Checkbox
                        id="login-remember"
                        checked={remember}
                        onCheckedChange={(v) => setRemember(v === true)}
                        disabled={busy || lockSecs !== null}
                        className="border-border/70"
                      />
                      {t.remember}
                    </label>

                    <Button
                      type="submit"
                      disabled={busy || lockSecs !== null}
                      className="relative mt-1 h-12 w-full overflow-hidden rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground shadow-[0_0_26px_-8px_rgba(34,216,238,0.6)] transition-all hover:bg-primary/90 hover:shadow-[0_0_34px_-6px_rgba(34,216,238,0.7)] disabled:opacity-60"
                    >
                      {busy ? (
                        <>
                          <Loader2 className="me-2 h-4 w-4 animate-spin" />
                          {t.signingIn}
                        </>
                      ) : (
                        <>
                          <Lock className="me-2 h-3.5 w-3.5 opacity-70" />
                          {t.signIn}
                        </>
                      )}
                      {!busy && lockSecs === null && (
                        <span
                          aria-hidden="true"
                          className="shine-sweep pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                        />
                      )}
                    </Button>
                  </form>

                  {/* or divider */}
                  <div className="mt-6">
                    <OrDivider label={t.or} />
                  </div>

                  {/* utility row (in place of social logins) */}
                  <div className={cn("mt-6 grid gap-3", previewHints ? "grid-cols-2" : "grid-cols-1")}>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setMode("recover");
                        setError(null);
                      }}
                      disabled={lockSecs !== null}
                      className="glass hover-glow h-11 rounded-xl border-border/60 bg-transparent text-[13px] font-medium text-foreground"
                    >
                      <ShieldCheck className="me-2 h-4 w-4 text-primary" />
                      {t.useRecovery}
                    </Button>
                    {previewHints && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={autofill}
                        disabled={lockSecs !== null}
                        className="glass hover-glow h-11 rounded-xl border-border/60 bg-transparent text-[13px] font-medium text-foreground"
                      >
                        <WandSparkles className="me-2 h-4 w-4 text-primary" />
                        {t.demoFill}
                      </Button>
                    )}
                  </div>

                  {/* preview credentials — only in preview environments */}
                  {previewHints && (
                    <p className="mt-5 text-center text-[11px] text-muted-foreground/85">
                      {t.demoLabel}
                      <span className="mx-1.5 text-border">·</span>
                      <span className="font-mono text-foreground/80">admin / sephiroth</span>
                    </p>
                  )}
                </div>
              ) : (
                /* ── recovery mode ── */
                <div key="recover">
                  <div className="glass glow-cyan flex h-14 w-14 items-center justify-center rounded-2xl text-primary">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <h2 className="mt-5 text-[1.7rem] font-bold leading-tight tracking-tight text-foreground">
                    {t.recoverTitle}
                  </h2>
                  <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    {t.recoverSub}
                  </p>

                  {lockBanner}
                  {errorBanner}

                  <form onSubmit={handleRecover} className="mt-7 space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="rec-key" className="text-[13px] font-medium">
                        {t.recoveryKey}
                      </Label>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="rec-key"
                          value={recKey}
                          onChange={(e) => setRecKey(e.target.value)}
                          placeholder={t.recoveryKeyPh}
                          spellCheck={false}
                          disabled={recBusy || lockSecs !== null}
                          className={cn(fieldCls, "font-mono tracking-wide")}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="rec-pw" className="text-[13px] font-medium">
                        {t.newPassword}
                      </Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="rec-pw"
                          type={recPw ? "text" : "password"}
                          autoComplete="new-password"
                          value={newPw}
                          onChange={(e) => setNewPw(e.target.value)}
                          placeholder={t.newPasswordPh}
                          disabled={recBusy || lockSecs !== null}
                          className={cn(fieldCls, "pe-11")}
                        />
                        <button
                          type="button"
                          onClick={() => setRecPw((v) => !v)}
                          aria-label={recPw ? "Hide password" : "Show password"}
                          className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {recPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      disabled={recBusy || lockSecs !== null}
                      className="relative mt-1 h-12 w-full overflow-hidden rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground shadow-[0_0_26px_-8px_rgba(34,216,238,0.6)] transition-all hover:bg-primary/90 disabled:opacity-60"
                    >
                      {recBusy ? (
                        <>
                          <Loader2 className="me-2 h-4 w-4 animate-spin" />
                          {t.resetting}
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="me-2 h-4 w-4 opacity-70" />
                          {t.resetPassword}
                        </>
                      )}
                      {!recBusy && (
                        <span
                          aria-hidden="true"
                          className="shine-sweep pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                        />
                      )}
                    </Button>
                  </form>

                  {/* preview key hint — only in preview environments */}
                  {previewHints && (
                    <div className="mt-6 flex items-center gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[.05] px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="font-mono">{t.previewHint}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setError(null);
                    }}
                    className="mt-5 flex w-full items-center justify-center gap-1.5 text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
                    {t.backToLogin}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* under-frame note */}
        <p className="fade-up d-2 flex items-center gap-2 text-[11px] text-muted-foreground/80">
          <Lock className="h-3 w-3" />
          {t.secureNote}
        </p>

        {/* crafted-by signature */}
        <p className="fade-up d-3 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          {dictionaries[lang].footer.crafted}{" "}
          <a
            href="https://github.com/Edsel-Rahimi"
            target="_blank"
            rel="noreferrer"
            className="font-mono font-semibold text-primary hover:glow-cyan transition-colors"
          >
            Edsel-Rahimi
          </a>
        </p>
      </main>
    </div>
  );
}
