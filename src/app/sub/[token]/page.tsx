"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import QRCode from "react-qr-code";
import {
  BadgeCheck,
  Check,
  Clock3,
  Copy,
  Fingerprint,
  Gauge,
  Infinity as InfinityIcon,
  KeyRound,
  Languages,
  Link2,
  ListChecks,
  Loader2,
  LockKeyhole,
  Orbit,
  SearchX,
  ShieldOff,
  Smartphone,
  Users,
} from "lucide-react";
import { BrandMark } from "@/components/sephiroth/brand";
import { Starfield } from "@/components/sephiroth/starfield";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LANG_META, LANGS, RTL_LANGS, type Lang } from "@/lib/i18n/dictionaries";
import { sfmt, subDictionaries } from "@/lib/i18n/sub-dictionary";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 5 — public subscription pass page
   /sub/[token] — token resolves to a user (subId) or a group.
   Zero admin chrome: Starfield + holographic Orbit Pass + glowing
   QR + one-click app import + config list. Language is resolved
   from ?lang= → localStorage → navigator → en (6 languages).
   ============================================================ */

/* ---------- payload types (mirror lib/sub-groups) ---------- */

type UserStatus = "active" | "expired" | "capped" | "disabled" | "onhold";

interface SubConfig {
  id: string;
  owner: string | null;
  ownerStatus: UserStatus;
  tag: string;
  protocol: string;
  port: number;
  transport: string;
  security: string;
  status: string;
  email: string;
  link: string | null;
  text: string;
}

interface SubPayload {
  kind: "user" | "group";
  token: string;
  name: string;
  note: string | null;
  infoLine: string | null;
  locked: false;
  enabled: boolean;
  status: UserStatus;
  usage: { usedGb: number; limitGb: number | null };
  expiry: { daysLeft: number | null; never: boolean; endsAtIso: string | null };
  /** 26-c — reseller white-label (null = Sephiroth default branding). */
  brand: { name: string; logo: string | null; accent: string | null } | null;
  members: { username: string; status: UserStatus; usedGb: number; limitGb: number | null; daysLeft: number | null }[] | null;
  configs: SubConfig[];
}

type Phase = "loading" | "locked" | "ready" | "notfound" | "error" | "blocked";

/* ---------- chrome (mirrors users-view) ---------- */

const PROTO_LABEL: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria2: "Hysteria2",
  wireguard: "WireGuard",
  "dokodemo-door": "Dokodemo",
  socks: "SOCKS",
  http: "HTTP",
};

const PROTO_CLS: Record<string, string> = {
  vless: "bg-primary/10 text-primary ring-primary/30",
  vmess: "bg-[#8b8cf8]/10 text-[#8b8cf8] ring-[#8b8cf8]/30",
  trojan: "bg-chart-4/10 text-chart-4 ring-chart-4/30",
  shadowsocks: "bg-chart-3/10 text-chart-3 ring-chart-3/30",
  hysteria2: "bg-chart-5/10 text-chart-5 ring-chart-5/30",
  wireguard: "bg-[#c084fc]/10 text-[#c084fc] ring-[#c084fc]/30",
  "dokodemo-door": "bg-[#f472b6]/10 text-[#f472b6] ring-[#f472b6]/30",
  socks: "bg-[#fde047]/10 text-[#fde047] ring-[#fde047]/30",
  http: "bg-[#fb923c]/10 text-[#fb923c] ring-[#fb923c]/30",
};

const STATUS_PILL: Record<UserStatus, string> = {
  active: "ring-chart-3/40 bg-chart-3/10 text-chart-3",
  expired: "ring-chart-5/40 bg-chart-5/10 text-chart-5",
  capped: "ring-chart-4/40 bg-chart-4/10 text-chart-4",
  disabled: "ring-border bg-muted/40 text-muted-foreground",
  onhold: "ring-amber-400/40 bg-amber-400/10 text-amber-400",
};

function fmtGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1)} GB`;
}

/* ---------- one-click apps ---------- */

type Device = "android" | "ios" | "desktop";

interface AppEntry {
  id: string;
  name: string;
  mark: string;
  href: string;
  platforms: Device[];
}

function b64urlNoPad(s: string): string {
  const std = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return std.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildApps(subUrl: string): AppEntry[] {
  const enc = encodeURIComponent(subUrl);
  return [
    { id: "v2rayng", name: "v2rayNG", mark: "V2", href: `v2rayng://install-sub?url=${enc}`, platforms: ["android"] },
    { id: "hiddify", name: "Hiddify", mark: "HD", href: `hiddify://import/${subUrl}`, platforms: ["android", "ios", "desktop"] },
    { id: "streisand", name: "Streisand", mark: "SB", href: `streisand://import/${subUrl}`, platforms: ["ios"] },
    { id: "v2box", name: "V2Box", mark: "VB", href: `v2box://install-sub?url=${enc}`, platforms: ["ios"] },
    { id: "shadowrocket", name: "Shadowrocket", mark: "SR", href: `sub://${b64urlNoPad(subUrl)}`, platforms: ["ios"] },
    { id: "clashmeta", name: "Clash Meta", mark: "CM", href: `clashmeta://install-config?url=${enc}`, platforms: ["android", "desktop"] },
  ];
}

function detectDevice(): Device {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  return "desktop";
}

/* ---------- copy feedback hook ---------- */

function useCopyFeedback() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
    } catch {
      /* clipboard unavailable — noop */
    }
  }, []);
  return { copiedKey, copy };
}

/* ============================================================ */

export default function SubPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";

  /* ---------- language (public visitor, not the admin pref) ---------- */
  const [lang, setLang] = useState<Lang>("en");
  const t = subDictionaries[lang];
  const rtl = RTL_LANGS.has(lang);

  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("lang");
    const stored = window.localStorage.getItem("sephiroth-sub-lang");
    const nav = navigator.language.slice(0, 2);
    const pick =
      LANGS.find((l) => l === q) ??
      LANGS.find((l) => l === stored) ??
      LANGS.find((l) => l === nav) ??
      "en";
    setLang(pick);
  }, []);

  useEffect(() => {
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang, rtl]);

  const pickLang = (l: Lang) => {
    setLang(l);
    try {
      window.localStorage.setItem("sephiroth-sub-lang", l);
    } catch {
      /* private mode */
    }
  };

  /* ---------- data ---------- */
  const [phase, setPhase] = useState<Phase>("loading");
  const [payload, setPayload] = useState<SubPayload | null>(null);
  /* Task 23-b — device-limit meta from the blocked 403 JSON (rendered on the card) */
  const [blockedInfo, setBlockedInfo] = useState<{ devices: number; limit: number } | null>(null);
  const [pw, setPw] = useState(""); // gate input
  const [pwValue, setPwValue] = useState(""); // accepted password (kept for formats)
  const [pwErr, setPwErr] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const fetchPayload = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch(`/api/sub/${token}`, { cache: "no-store" });
      if (res.status === 404) {
        setPhase("notfound");
        return;
      }
      const data = await res.json();
      if (data?.locked) {
        setPhase("locked");
        return;
      }
      if (data?.blocked) {
        // Task 23-b — HWID device limit reached for this subscription
        setBlockedInfo({
          devices: Number(data.devices) || 0,
          limit: Number(data.limit) || 0,
        });
        setPhase("blocked");
        return;
      }
      if (!res.ok || !data?.configs) {
        setPhase("error");
        return;
      }
      setPayload(data as SubPayload);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [token]);

  useEffect(() => {
    if (token) void fetchPayload();
  }, [token, fetchPayload]);

  /* branded page title — "Sephiroth · <profile>" (reacts to payload; 26-c white-label aware) */
  useEffect(() => {
    const brand = payload?.brand?.name;
    document.title = brand
      ? `${brand} · ${payload?.name ?? ""}`.trim()
      : payload?.name
        ? `Sephiroth · ${payload.name}`
        : "Sephiroth";
  }, [payload?.name, payload?.brand?.name]);

  const unlock = async () => {
    setUnlocking(true);
    setPwErr(false);
    try {
      const res = await fetch(`/api/sub/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.status === 401) {
        setPwErr(true);
        return;
      }
      const data = await res.json();
      if (!res.ok || !data?.configs) {
        setPhase("error");
        return;
      }
      setPwValue(pw);
      setPayload(data as SubPayload);
      setPhase("ready");
    } catch {
      setPhase("error");
    } finally {
      setUnlocking(false);
    }
  };

  /* ---------- derived ---------- */
  const { copiedKey, copy } = useCopyFeedback();
  const device = useMemo(detectDevice, []);

  const subUrl = useMemo(() => {
    if (!origin || !payload) return "";
    const q = new URLSearchParams({ format: "b64" });
    if (pwValue) q.set("pw", pwValue);
    return `${origin}/api/sub/${payload.token}?${q.toString()}`;
  }, [origin, payload, pwValue]);

  const rawUrl = useMemo(() => {
    if (!origin || !payload) return "";
    const q = new URLSearchParams({ format: "raw" });
    if (pwValue) q.set("pw", pwValue);
    return `${origin}/api/sub/${payload.token}?${q.toString()}`;
  }, [origin, payload, pwValue]);

  const apps = useMemo(() => {
    if (!subUrl) return [];
    const list = buildApps(subUrl);
    return [...list].sort((a, b) => {
      const am = a.platforms.includes(device) ? 0 : 1;
      const bm = b.platforms.includes(device) ? 0 : 1;
      return am - bm;
    });
  }, [subUrl, device]);

  /* ---------- render ---------- */

  const statusLabel = (s: UserStatus) =>
    s === "active"
      ? t.statusActive
      : s === "onhold"
        ? t.statusOnHold
        : s === "expired"
          ? t.statusExpired
          : s === "capped"
            ? t.statusCapped
            : t.statusDisabled;

  /* 1-b — brand accent (when present) tints the avatar / pass-card through
     --brand-accent; unset ⇒ pixel-identical default appearance. */
  const brandAccentStyle = payload?.brand?.accent
    ? ({ "--brand-accent": payload.brand.accent } as React.CSSProperties)
    : undefined;

  return (
    <div
      className="bg-cosmic relative flex min-h-screen flex-col overflow-hidden"
      style={brandAccentStyle}
    >
      <Starfield />

      {/* ---------- header ---------- */}
      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 pt-6 md:px-6">
        <div className="flex items-center gap-3">
          {/* 26-c — white-label: the owning reseller's brand replaces the panel mark */}
          {payload?.brand ? (
            <>
              {payload.brand.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={payload.brand.logo}
                  alt={payload.brand.name}
                  className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/15"
                />
              ) : (
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black ring-1 ring-white/15"
                  style={{
                    // 1-b — accent via --brand-accent; unset ⇒ inherit (old no-accent look)
                    backgroundColor: "color-mix(in srgb, var(--brand-accent, transparent) 13%, transparent)",
                    color: "var(--brand-accent, currentColor)",
                  }}
                  aria-hidden="true"
                >
                  {payload.brand.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="leading-none">
                <span
                  className="text-silver block text-[13px] font-bold tracking-[0.24em]"
                  style={{ color: "var(--brand-accent, currentColor)" }}
                >
                  {payload.brand.name}
                </span>
                <span className="mt-1 block text-[9px] uppercase tracking-[0.32em] text-muted-foreground/80">
                  {t.tagline}
                </span>
              </div>
            </>
          ) : (
            <>
              <BrandMark size={40} pulse />
              <div className="leading-none">
                <span className="text-silver block text-[13px] font-bold tracking-[0.24em]">SEPHIROTH</span>
                <span className="mt-1 block text-[9px] uppercase tracking-[0.32em] text-muted-foreground/80">
                  {t.tagline}
                </span>
              </div>
            </>
          )}
        </div>
        <nav aria-label={t.langLabel} className="glass flex items-center gap-0.5 rounded-full p-1 ring-1 ring-white/10">
          <Languages className="mx-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => pickLang(l)}
              aria-pressed={lang === l}
              aria-label={LANG_META[l].native}
              className={cn(
                "min-h-[28px] rounded-full px-2 text-[10px] font-semibold tracking-wider transition-colors",
                lang === l
                  ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {LANG_META[l].code}
            </button>
          ))}
        </nav>
      </header>

      {/* ---------- main ---------- */}
      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:px-6">
        {phase === "loading" && <LoadingState label={t.loading} />}

        {phase === "notfound" && (
          <StateCard icon={<SearchX className="h-8 w-8 text-chart-5" />} title={t.notFoundTitle} desc={t.notFoundDesc} />
        )}

        {phase === "error" && (
          <StateCard icon={<ShieldOff className="h-8 w-8 text-chart-5" />} title={t.notFoundTitle} desc={t.notFoundDesc} />
        )}

        {phase === "blocked" && (
          <StateCard
            icon={<Fingerprint className="h-8 w-8 text-chart-4" />}
            title={t.blockedTitle}
            desc={
              blockedInfo && blockedInfo.limit > 0
                ? `${t.blockedDesc} ${sfmt(t.blockedCount, { n: blockedInfo.devices, s: blockedInfo.limit })} ${t.blockedContact}`
                : `${t.blockedDesc} ${t.blockedContact}`
            }
          />
        )}

        {phase === "locked" && (
          <LockedGate
            t={t}
            pw={pw}
            setPw={setPw}
            err={pwErr}
            busy={unlocking}
            onSubmit={() => void unlock()}
          />
        )}

        {phase === "ready" && payload && (
          <div className="fade-up space-y-6">
            {/* ============ orbit pass card ============ */}
            {/* 1-b — accent ring: var falls back to the .pass-card border color */}
            <section
              className="pass-card rounded-2xl p-5 md:p-7"
              aria-label={t.passKind}
              style={{ borderColor: "var(--brand-accent, rgba(148, 184, 205, 0.18))" }}
            >
              <div className="pass-shine" aria-hidden="true" />
              <div className="relative">
                {/* top row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="glass flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-white/10">
                      <Orbit className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.3em] text-primary/90">
                        {t.passKind}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
                        № {payload.token.slice(0, 10).toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1",
                      STATUS_PILL[payload.status]
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", payload.status === "active" ? "bg-chart-3" : payload.status === "capped" ? "bg-chart-4" : payload.status === "expired" ? "bg-chart-5" : "bg-muted-foreground")} />
                    {statusLabel(payload.status)}
                  </span>
                </div>

                {/* identity */}
                <div className="mt-5">
                  <h1 className="text-silver text-2xl font-bold tracking-tight md:text-3xl">{payload.name}</h1>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ring-1 ring-white/10">
                      {payload.kind === "group" ? "GROUP" : "USER"}
                    </span>
                    {payload.note && <span className="truncate">{payload.note}</span>}
                    {payload.infoLine && <span className="truncate text-primary/80">{payload.infoLine}</span>}
                  </p>
                </div>

                {/* stats row */}
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {/* usage */}
                  <div className="glass rounded-xl p-3.5 ring-1 ring-white/10">
                    <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      <Gauge className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                      {t.usageTitle}
                    </p>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="font-mono text-xl font-bold text-foreground md:text-2xl">
                        {fmtGb(payload.usage.usedGb)}
                      </span>
                      {payload.usage.limitGb !== null ? (
                        <span className="text-xs text-muted-foreground">/ {fmtGb(payload.usage.limitGb)}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-primary">
                          <InfinityIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {t.unlimited}
                        </span>
                      )}
                    </div>
                    {payload.usage.limitGb !== null && (
                      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/8 ring-1 ring-white/10">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            payload.usage.usedGb / payload.usage.limitGb > 0.85
                              ? "bg-gradient-to-r from-chart-5/80 to-chart-5"
                              : "bg-gradient-to-r from-primary/60 to-primary"
                          )}
                          style={{
                            width: `${Math.min(100, Math.max(3, (payload.usage.usedGb / payload.usage.limitGb) * 100))}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* expiry */}
                  <div className="glass rounded-xl p-3.5 ring-1 ring-white/10">
                    <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                      {t.expiryTitle}
                    </p>
                    <div className="mt-2">
                      {payload.expiry.never ? (
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                          {t.expiresNever}
                        </span>
                      ) : payload.status === "onhold" ? (
                        // 26-a — waiting subscription: no clock yet, nothing to count down
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-400">
                          <Clock3 className="h-4 w-4" aria-hidden="true" />
                          {t.startsOnConnect}
                        </span>
                      ) : payload.expiry.daysLeft !== null && payload.expiry.daysLeft < 0 ? (
                        <span className="text-sm font-semibold text-chart-5">
                          {sfmt(t.expiredAgo, { n: Math.abs(payload.expiry.daysLeft) })}
                        </span>
                      ) : (
                        <span className="font-mono text-xl font-bold text-foreground md:text-2xl">
                          {payload.expiry.daysLeft ?? 0}
                          <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                            {t.daysLeft.replace("{n}", "").trim()}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* group members */}
                {payload.members && payload.members.length > 0 && (
                  <div className="mt-4">
                    <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      <Users className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                      {t.membersTitle}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {payload.members.map((m) => (
                        <li
                          key={m.username}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ring-1",
                            STATUS_PILL[m.status]
                          )}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {m.username}
                          <span className="font-mono text-[9px] opacity-70">{fmtGb(m.usedGb)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>

            {/* ============ subscription + QR ============ */}
            <section className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="glass hover-glow rounded-2xl p-5">
                <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                  {t.subTitle}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Input
                    readOnly
                    value={subUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-10 flex-1 border-white/10 bg-black/30 font-mono text-[11px] text-muted-foreground"
                    aria-label={t.subTitle}
                  />
                  <CopyBtn
                    label={t.copySub}
                    copiedLabel={t.copied}
                    copied={copiedKey === "sub"}
                    onClick={() => void copy(subUrl, "sub")}
                  />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copy(rawUrl, "raw")}
                    className="h-8 gap-1.5 border-white/10 bg-white/[0.03] text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                    {copiedKey === "raw" ? t.copied : t.copyRaw}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void copy(rawUrl.replace("format=raw", "format=clash"), "clash")
                    }
                    className="h-8 gap-1.5 border-primary/25 bg-primary/10 text-[11px] text-primary hover:bg-primary/20"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {copiedKey === "clash"
                      ? t.copied
                      : lang === "fa"
                        ? "کپی لینک Clash Meta"
                        : "Copy Clash Meta URL"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void copy(rawUrl.replace("format=raw", "format=singbox"), "singbox")
                    }
                    className="h-8 gap-1.5 border-chart-3/25 bg-chart-3/10 text-[11px] text-chart-3 hover:bg-chart-3/20"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {copiedKey === "singbox"
                      ? t.copied
                      : lang === "fa"
                        ? "کپی لینک Sing-Box"
                        : "Copy Sing-Box URL"}
                  </Button>
                </div>
              </div>

              <div className="glass hover-glow flex flex-col items-center justify-center gap-2.5 rounded-2xl p-5">
                <div className="qr-glow rounded-xl bg-white p-2.5">
                  {subUrl ? (
                    <QRCode value={subUrl} size={132} bgColor="#ffffff" fgColor="#07141a" />
                  ) : (
                    <div className="h-[132px] w-[132px]" />
                  )}
                </div>
                <p className="text-center text-[10px] text-muted-foreground">{t.qrHint}</p>
              </div>
            </section>

            {/* ============ one-click apps ============ */}
            <section className="glass rounded-2xl p-5">
              <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <Smartphone className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                {t.appsTitle}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">{t.appsHint}</p>
              <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {apps.map((app) => (
                  <a
                    key={app.id}
                    href={app.href}
                    className="glass hover-glow group flex min-h-[52px] items-center gap-2.5 rounded-xl px-3 py-2.5 ring-1 ring-white/10"
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-bold ring-1 transition-transform group-hover:scale-105",
                        app.platforms.includes(device)
                          ? "bg-primary/15 text-primary ring-primary/40"
                          : "bg-white/5 text-muted-foreground ring-white/10"
                      )}
                    >
                      {app.mark}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-foreground">{app.name}</span>
                      <span className="block text-[9px] uppercase tracking-wider text-muted-foreground/70">
                        {app.platforms.join(" · ")}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            </section>

            {/* ============ config list ============ */}
            <section className="glass rounded-2xl p-5">
              <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <Fingerprint className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                {sfmt(t.configsTitle, { n: payload.configs.length })}
              </p>
              <ul className="mt-3.5 space-y-2">
                {payload.configs.map((cfg) => (
                  <li
                    key={cfg.id}
                    className="glass hover-glow flex items-center gap-3 rounded-xl px-3.5 py-3 ring-1 ring-white/10"
                  >
                    <span
                      className={cn(
                        "hidden shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 sm:inline-flex",
                        PROTO_CLS[cfg.protocol] ?? "bg-muted text-muted-foreground ring-border"
                      )}
                    >
                      {PROTO_LABEL[cfg.protocol] ?? cfg.protocol.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">{cfg.tag}</span>
                        {cfg.owner && payload.kind === "group" && (
                          <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground ring-1 ring-white/10">
                            {cfg.owner}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/80">
                        {cfg.link ?? cfg.text.split("\n")[0]}
                      </span>
                    </span>
                    <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:block">
                      :{cfg.port}
                    </span>
                    <CopyBtn
                      small
                      label={t.copyLink}
                      copiedLabel={t.copied}
                      title={cfg.link ? undefined : t.noLinkHint}
                      copied={copiedKey === `cfg-${cfg.id}`}
                      onClick={() => void copy(cfg.link ?? cfg.text, `cfg-${cfg.id}`)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </main>

      {/* ---------- footer ---------- */}
      {/* 1-b — white-label: the brand replaces "Powered by …" and the
          crafted-by line disappears; unbranded keeps the exact default. */}
      <footer className="relative z-10 mt-auto pb-6 pt-2 text-center">
        {payload?.brand ? (
          <p className="flex items-center justify-center gap-1.5 text-[10px] tracking-wide text-muted-foreground/60">
            {payload.brand.name}
          </p>
        ) : (
          <>
            <p className="flex items-center justify-center gap-1.5 text-[10px] tracking-wide text-muted-foreground/60">
              <Orbit className="h-3 w-3" aria-hidden="true" />
              {t.poweredBy}
            </p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.24em] text-muted-foreground/40">
              Crafted by EPODONIOS
            </p>
          </>
        )}
      </footer>
    </div>
  );
}

/* ---------- small pieces ---------- */

function CopyBtn({
  label,
  copiedLabel,
  copied,
  onClick,
  small,
  title,
}: {
  label: string;
  copiedLabel?: string;
  copied: boolean;
  onClick: () => void;
  small?: boolean;
  title?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      title={title}
      className={cn(
        "shrink-0 gap-1.5 border-primary/25 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
        small ? "h-8 px-2.5 text-[11px]" : "h-10 px-3.5 text-xs"
      )}
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      <span className={small ? "hidden sm:inline" : ""}>{copied ? copiedLabel ?? label : label}</span>
    </Button>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <div className="glass flex h-14 w-14 items-center justify-center rounded-2xl ring-1 ring-white/10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      </div>
      <p className="text-xs tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function StateCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="glass fade-up mx-auto mt-10 max-w-md rounded-2xl p-10 text-center ring-1 ring-white/10">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
        {icon}
      </div>
      <h1 className="text-silver mt-5 text-lg font-bold">{title}</h1>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

function LockedGate({
  t,
  pw,
  setPw,
  err,
  busy,
  onSubmit,
}: {
  t: (typeof subDictionaries)["en"];
  pw: string;
  setPw: (v: string) => void;
  err: boolean;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="glass fade-up mx-auto mt-10 max-w-md rounded-2xl p-8 ring-1 ring-white/10">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/30">
        <LockKeyhole className="h-7 w-7 text-primary" aria-hidden="true" />
      </div>
      <h1 className="text-silver mt-5 text-center text-lg font-bold">{t.lockedTitle}</h1>
      <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">{t.lockedDesc}</p>
      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && pw) onSubmit();
        }}
      >
        <Input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t.password}
          autoComplete="current-password"
          className={cn("h-11 border-white/10 bg-black/30 text-sm", err && "border-chart-5/60 ring-1 ring-chart-5/40")}
          aria-label={t.password}
          aria-invalid={err}
        />
        {err && <p className="text-center text-[11px] text-chart-5">{t.wrongPw}</p>}
        <Button
          type="submit"
          disabled={busy || !pw}
          className="glow-cyan h-11 w-full bg-primary/90 text-[13px] font-semibold text-black hover:bg-primary"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t.unlocking}
            </>
          ) : (
            <>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {t.unlock}
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
