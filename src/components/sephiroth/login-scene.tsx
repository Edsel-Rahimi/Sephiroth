"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
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
   Sephiroth · Phase 1 — Cosmic Login Terminal
   ============================================================ */

type Mode = "login" | "recover";

/* brand showcase visual — concentric orbital rings + satellites */
function OrbitVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px]" aria-hidden="true">
      {/* rings */}
      <div className="login-ring" style={{ width: "100%", height: "100%" }} />
      <div className="login-ring dashed" style={{ width: "76%", height: "76%" }} />
      <div className="login-ring" style={{ width: "52%", height: "52%", borderColor: "rgba(34,216,238,.24)" }} />

      {/* rotating satellites */}
      <div className="orbit-spin absolute inset-0 [animation-duration:16s]">
        <span className="login-sat" />
      </div>
      <div className="orbit-spin absolute inset-[12%] [animation-duration:26s] [animation-direction:reverse]">
        <span className="login-sat" style={{ width: 6, height: 6, opacity: 0.8 }} />
      </div>
      <div className="orbit-spin absolute inset-[24%] [animation-duration:11s]">
        <span className="login-sat" style={{ width: 5, height: 5, opacity: 0.65 }} />
      </div>

      {/* core */}
      <div className="absolute inset-0 grid place-items-center">
        <div className="float-y">
          <BrandMark size={96} pulse />
        </div>
      </div>
    </div>
  );
}

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

const fieldCls =
  "h-11 rounded-xl border-border/60 bg-white/[.03] ps-10 text-[15px] placeholder:text-muted-foreground/60 focus-visible:border-primary/50 focus-visible:ring-primary/25";

export function LoginScene({ onSuccess }: { onSuccess: (username: string) => void }) {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang].auth, [lang]);
  const { toast } = useToast();

  /* login form state */
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

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
        fail(t.errLocked.replace("{s}", String(data.retryAfter)));
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
        fail(t.errLocked.replace("{s}", String(data.retryAfter)));
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

  /* ---------- render ---------- */

  return (
    <div className="bg-cosmic fixed inset-0 z-50 overflow-y-auto">
      <Starfield />
      <div className="login-horizon" aria-hidden="true" />

      {/* top bar of the terminal */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-4 md:px-8">
        <div className="flex items-center gap-2.5">
          <BrandMark size={30} />
          <BrandWord tagline={dictionaries[lang].brand.tagline} className="hidden sm:flex" />
        </div>
        <LangMenu />
      </header>

      <main className="relative z-10 mx-auto grid min-h-full w-full max-w-6xl items-center gap-10 px-5 pb-14 pt-24 md:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:pt-16">
        {/* ── showcase (desktop) ── */}
        <section className="hidden lg:block">
          <div className="fade-up d-1 glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-primary">
            <Sparkles className="h-3 w-3" />
            {t.heroBadge}
          </div>
          <h1 className="fade-up d-2 mt-5 text-5xl font-bold leading-[1.08] tracking-tight text-silver xl:text-6xl">
            {t.heroTitle}
          </h1>
          <p className="fade-up d-3 mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            {t.heroSub}
          </p>

          <div className="fade-up d-4 mt-8">
            <OrbitVisual />
          </div>

          <div className="fade-up d-5 mt-8 flex flex-wrap items-center gap-2.5">
            {[
              { icon: Server, label: t.chipCore },
              { icon: Activity, label: t.chipLive },
              { icon: Languages, label: t.chipLangs },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="glass hover-glow flex h-9 items-center gap-2 rounded-full px-3.5 text-xs text-muted-foreground"
              >
                <Icon className="h-3.5 w-3.5 text-primary" />
                {label}
              </span>
            ))}
          </div>
        </section>

        {/* ── terminal card ── */}
        <section className="flex justify-center lg:justify-end">
          <div className="w-full max-w-[430px]">
            {/* compact hero for mobile */}
            <div className="fade-up d-1 mb-6 flex flex-col items-center text-center lg:hidden">
              <BrandMark size={64} pulse />
              <h1 className="text-silver mt-3 text-2xl font-bold tracking-tight">
                {t.welcome}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{t.welcomeSub}</p>
            </div>

            <div
              key={mode}
              className="fade-up d-2 glass-strong orbit-pill hover-glow relative rounded-3xl p-6 md:p-8"
            >
              {mode === "login" ? (
                <>
                  {/* head */}
                  <div className="hidden items-center gap-3.5 lg:flex">
                    <BrandMark size={52} pulse />
                    <div className="leading-tight">
                      <h2 className="text-xl font-bold tracking-tight text-foreground">
                        {t.welcome}
                      </h2>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {t.welcomeSub}
                      </p>
                    </div>
                  </div>

                  {/* lockout banner */}
                  {lockSecs !== null && (
                    <div
                      role="alert"
                      className="mt-5 flex items-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-[13px] text-amber-300"
                    >
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      <span>{t.errLocked.replace("{s}", mmss)}</span>
                      <span className="kbd ms-auto border-amber-400/30 bg-amber-400/10 text-amber-200">
                        {mmss}
                      </span>
                    </div>
                  )}

                  {/* error (hidden while locked — amber banner takes over) */}
                  {error && lockSecs === null && (
                    <div
                      key={error.shakeKey}
                      role="alert"
                      className="shake mt-5 flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive-foreground"
                    >
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <span>{error.msg}</span>
                    </div>
                  )}

                  {/* form */}
                  <form
                    onSubmit={handleLogin}
                    className={cn("mt-6 space-y-4", !error && "lg:mt-6")}
                  >
                    <div className="space-y-1.5">
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

                    <div className="space-y-1.5">
                      <Label htmlFor="login-password" className="text-[13px] font-medium">
                        {t.password}
                      </Label>
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

                    <div className="flex items-center justify-between gap-3 pt-0.5">
                      <label
                        htmlFor="login-remember"
                        className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted-foreground"
                      >
                        <Switch
                          id="login-remember"
                          checked={remember}
                          onCheckedChange={setRemember}
                          disabled={busy || lockSecs !== null}
                        />
                        {t.remember}
                      </label>
                    </div>

                    <Button
                      type="submit"
                      disabled={busy || lockSecs !== null}
                      className="relative mt-1 h-11 w-full overflow-hidden rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground shadow-[0_0_24px_-8px_rgba(34,216,238,0.55)] transition-all hover:bg-primary/90 hover:shadow-[0_0_30px_-6px_rgba(34,216,238,0.65)] disabled:opacity-60"
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

                  {/* forgot */}
                  <div className="mt-5 flex items-center justify-center gap-2 text-[13px]">
                    <span className="text-muted-foreground">{t.lostAccess}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("recover");
                        setError(null);
                      }}
                      className="font-medium text-primary underline-offset-4 outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t.useRecovery}
                    </button>
                  </div>

                  {/* preview credentials */}
                  <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border/70 bg-white/[.02] px-3.5 py-2 text-xs text-muted-foreground">
                    <span className="min-w-0">
                      <span className="block">{t.demoLabel}</span>
                      <span className="block truncate font-mono text-foreground/85">
                        admin / sephiroth
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={autofill}
                      disabled={lockSecs !== null}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                    >
                      <WandSparkles className="h-3.5 w-3.5" />
                      {t.demoFill}
                    </button>
                  </div>
                </>
              ) : (
                /* ── recovery mode ── */
                <>
                  <div className="flex items-center gap-3.5">
                    <span className="glass flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-primary glow-cyan">
                      <ShieldCheck className="h-6 w-6" />
                    </span>
                    <div className="leading-tight">
                      <h2 className="text-xl font-bold tracking-tight text-foreground">
                        {t.recoverTitle}
                      </h2>
                      <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                        {t.recoverSub}
                      </p>
                    </div>
                  </div>

                  {/* lockout banner */}
                  {lockSecs !== null && (
                    <div
                      role="alert"
                      className="mt-5 flex items-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-[13px] text-amber-300"
                    >
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      <span>{t.errLocked.replace("{s}", mmss)}</span>
                      <span className="kbd ms-auto border-amber-400/30 bg-amber-400/10 text-amber-200">
                        {mmss}
                      </span>
                    </div>
                  )}

                  {/* error (hidden while locked — amber banner takes over) */}
                  {error && lockSecs === null && (
                    <div
                      key={error.shakeKey}
                      role="alert"
                      className="shake mt-5 flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive-foreground"
                    >
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <span>{error.msg}</span>
                    </div>
                  )}

                  <form onSubmit={handleRecover} className="mt-6 space-y-4">
                    <div className="space-y-1.5">
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

                    <div className="space-y-1.5">
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
                      className="relative mt-1 h-11 w-full overflow-hidden rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground shadow-[0_0_24px_-8px_rgba(34,216,238,0.55)] transition-all hover:bg-primary/90 disabled:opacity-60"
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

                  {/* preview key hint */}
                  <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[.05] px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="font-mono">{t.previewHint}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setError(null);
                    }}
                    className="mt-4 flex w-full items-center justify-center gap-1.5 text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
                    {t.backToLogin}
                  </button>
                </>
              )}
            </div>

            {/* under-card note */}
            <p className="fade-up d-3 mt-5 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/80">
              <Lock className="h-3 w-3" />
              {t.secureNote}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
