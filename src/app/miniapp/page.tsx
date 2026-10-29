"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Check,
  ChevronLeft,
  CircleDollarSign,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  Gauge,
  Ghost,
  Landmark,
  Loader2,
  Minus,
  Plus,
  SearchX,
  Send,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/sephiroth/brand";
import { Starfield } from "@/components/sephiroth/starfield";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { LANGS, LANG_META, RTL_LANGS, type Lang } from "@/lib/i18n/dictionaries";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { sfmt } from "@/lib/i18n/sub-dictionary";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Task 3-2 — Telegram Mini App storefront (/miniapp)
   OWNER bot only. Reseller mini-apps are future work: they will
   need their own initData secret (per-reseller bot token —
   validateInitData already takes the token as a parameter) and a
   reseller-scoped catalog + currency pipes.

   Bridge protocol:
   • loads https://telegram.org/js/telegram-web-app.js (plain async
     script; the panel ships no CSP headers, and the bridge must be
     available before boot reads window.Telegram.WebApp),
   • reads initData (forwarded verbatim in the x-telegram-init-data
     request header — never in URLs) + initDataUnsafe (user +
     language_code for the UI ONLY — the server never trusts it),
   • calls ready() + expand(), maps themeParams onto --mi-* CSS
     variables so buttons/links/badges follow Telegram dark/light,
     haptic-feedbacks add-to-cart and results, drives BackButton
     between views and MainButton for the checkout confirm.

   Outside Telegram the page renders an honest "open inside
   Telegram" state and fires NO catalog request (no fake data, no
   layout shift — the shell renders identically, only the state
   card differs).
   ============================================================ */

/* ---------- Telegram WebApp bridge (minimal local typing) ---------- */

interface TgThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}

interface TgWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      username?: string;
      first_name?: string;
      language_code?: string;
    };
  };
  version: string;
  colorScheme: "light" | "dark";
  themeParams: TgThemeParams;
  ready(): void;
  expand(): void;
  close(): void;
  openLink(url: string, opts?: { try_instant_view?: boolean }): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  MainButton?: {
    text: string;
    setText(text: string): void;
    setParams(params: { color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
  };
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const TG_SCRIPT_SRC = "https://telegram.org/js/telegram-web-app.js";

/* ---------- payload types (mirror /api/miniapp/*) ---------- */

interface Tpl {
  id: string;
  name: string;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  priceToman: number;
}

type PayMethod = "zarinpal" | "card" | "wallet" | "crypto" | "stars";

interface CatalogPayload {
  lang: string;
  user: { id: string; username: string; firstName: string; languageCode: string };
  balanceToman: number;
  catalog: Tpl[];
  methods: Record<PayMethod, boolean>;
  rates: { tomanPerUsd: number; tomanPerStar: number; usdReady: boolean; starsReady: boolean };
  bot: { username: string; deepLink: string };
}

interface SubRow {
  username: string;
  subId: string;
  subUrl: string;
  usedTrafficGb: number;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  enabled: boolean;
  createdAt: string;
}

interface OrderRow {
  id: string;
  templateName: string;
  amountToman: number;
  method: string;
  status: string;
  createdAt: string;
}

interface MePayload {
  lang: string;
  balanceToman: number;
  subscriptions: SubRow[];
  orders: OrderRow[];
}

type CheckoutPayload =
  | { status: "paid"; orderId: string; totalToman: number; discountToman: number; payableToman: number; code: string; subs: { username: string; subId: string; subUrl: string }[] }
  | { status: "redirect"; orderId: string; totalToman: number; discountToman: number; payableToman: number; code: string; redirectUrl: string; priceUsd?: string }
  | { status: "handoff_bot"; orderId: string; totalToman: number; discountToman: number; payableToman: number; code: string; stars: number; deepLink: string }
  | { status: "await_receipt"; orderId: string; totalToman: number; discountToman: number; payableToman: number; code: string; card: { number: string; holder: string }; deepLink: string };

type Phase = "boot" | "outside" | "loading" | "ready" | "error";
type View = "shop" | "detail" | "cart" | "pay" | "result" | "account";

/* ---------- small utils ---------- */

const fmtToman = (n: number): string => Math.max(0, Math.floor(n)).toLocaleString("en-US");

function fmtGb(gb: number | null): string {
  if (gb === null || gb === undefined) return "∞";
  if (gb >= 1024) return `${(gb / 1024).toFixed(2).replace(/\.00$/, "")} TB`;
  const r = Math.round(gb * 10) / 10;
  return `${r >= 100 ? Math.round(r) : r}`;
}

function mapBridgeLang(code: string | undefined): Lang | null {
  const c = (code ?? "").slice(0, 2).toLowerCase();
  return (LANGS as readonly string[]).includes(c) ? (c as Lang) : null;
}

const CART_KEY = "sephiroth-miniapp-cart-v1";

function loadCart(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const qty = Math.floor(Number(v));
      if (k && Number.isFinite(qty) && qty >= 1 && qty <= 10) out[k] = qty;
    }
    return out;
  } catch {
    return {};
  }
}

/* ============================================================ */

export default function MiniAppPage() {
  const { toast } = useToast();

  /* ---------- bridge ---------- */
  const tgRef = useRef<TgWebApp | null>(null);
  const [tgVersion, setTgVersion] = useState(0); // bump when the bridge lands

  /* ---------- language ---------- */
  const [lang, setLang] = useState<Lang>("en");
  const t = FEATURE[lang].miniapp;
  const rtl = RTL_LANGS.has(lang);
  const pickLang = useCallback((l: Lang) => {
    setLang(l);
    try {
      window.localStorage.setItem("sephiroth-miniapp-lang", l);
    } catch {
      /* private mode */
    }
  }, []);

  /* ---------- boot: inject bridge, read initData, load catalog ---------- */
  const [phase, setPhase] = useState<Phase>("boot");
  const [bootErr, setBootErr] = useState(false);
  const [payload, setPayload] = useState<CatalogPayload | null>(null);
  const initDataRef = useRef("");

  const loadCatalog = useCallback(async (): Promise<boolean> => {
    const tg = tgRef.current;
    if (!tg?.initData) return false;
    setPhase("loading");
    try {
      const res = await fetch("/api/miniapp/catalog", {
        cache: "no-store",
        headers: { "x-telegram-init-data": tg.initData },
      });
      if (res.status === 401 || res.status === 403) {
        setBootErr(true);
        setPhase("error");
        return false;
      }
      const data = (await res.json().catch(() => null)) as CatalogPayload | null;
      if (!res.ok || !data?.catalog) {
        setBootErr(true);
        setPhase("error");
        return false;
      }
      setPayload(data);
      setPhase("ready");
      return true;
    } catch {
      setBootErr(true);
      setPhase("error");
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const boot = () => {
      if (cancelled) return;
      const tg = window.Telegram?.WebApp ?? null;
      tgRef.current = tg;
      setTgVersion((v) => v + 1);
      if (!tg || !tg.initData) {
        // honest outside-Telegram state — no fake data, no API call
        setPhase("outside");
        return;
      }
      try {
        tg.ready();
        tg.expand();
        // blend the native chrome into the cosmic canvas when supported
        tg.setHeaderColor?.("#060b0f");
        tg.setBackgroundColor?.("#05090d");
      } catch {
        /* older bridge — ready/expand best-effort */
      }
      initDataRef.current = tg.initData;
      void loadCatalog();
    };
    if (window.Telegram?.WebApp) {
      boot();
    } else {
      // Telegram docs: the page includes the bridge script itself. In the
      // sandbox (no CSP headers) a plain async script tag is enough.
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${TG_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", boot, { once: true });
        existing.addEventListener("error", () => !cancelled && setPhase("outside"), { once: true });
      } else {
        const el = document.createElement("script");
        el.src = TG_SCRIPT_SRC;
        el.async = true;
        el.onload = boot;
        el.onerror = () => !cancelled && setPhase("outside");
        document.head.appendChild(el);
      }
      // 4s watchdog — no bridge ⇒ outside state (never a spinner forever)
      const wd = window.setTimeout(() => {
        if (!cancelled && !window.Telegram?.WebApp) setPhase((p) => (p === "boot" ? "outside" : p));
      }, 4000);
      return () => {
        cancelled = true;
        window.clearTimeout(wd);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [loadCatalog]);

  /* language: ?lang= (debug) → server-side user pick → bridge code → stored → en */
  useEffect(() => {
    const url = new URL(window.location.href);
    const q = mapBridgeLang(url.searchParams.get("lang") ?? undefined);
    if (q) {
      setLang(q);
      return;
    }
    const serverLang = mapBridgeLang(payload?.lang);
    if (serverLang) {
      setLang(serverLang);
      return;
    }
    const bridgeLang = mapBridgeLang(
      tgRef.current?.initDataUnsafe?.user?.language_code ?? undefined
    );
    if (bridgeLang) {
      setLang(bridgeLang);
      return;
    }
    let stored: Lang | null = null;
    try {
      const s = window.localStorage.getItem("sephiroth-miniapp-lang");
      if (s && (LANGS as readonly string[]).includes(s)) stored = s as Lang;
    } catch {
      /* private mode */
    }
    setLang(stored ?? "en");
  }, [payload?.lang, tgVersion]);

  /* RTL + title follow the active language */
  useEffect(() => {
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    document.title = lang === "fa" ? "Sephiroth · مینی‌اپ" : "Sephiroth · Mini App";
  }, [lang, rtl]);

  /* Telegram theme params → --mi-* CSS variables (dark/light honored on
   * interactive chrome; the cosmic brand backdrop stays for identity) */
  const themeVars = useMemo(() => {
    const tg = tgRef.current;
    const p = tg?.themeParams ?? {};
    const vars: Record<string, string> = {};
    if (p.text_color) vars["--mi-text"] = p.text_color;
    if (p.hint_color) vars["--mi-hint"] = p.hint_color;
    if (p.link_color) vars["--mi-link"] = p.link_color;
    if (p.button_color) vars["--mi-btn"] = p.button_color;
    if (p.button_text_color) vars["--mi-btn-text"] = p.button_text_color;
    if (p.secondary_bg_color) vars["--mi-secondary"] = p.secondary_bg_color;
    return vars as React.CSSProperties;
  }, [tgVersion]);

  /* haptics */
  const haptic = useCallback((kind: "tap" | "ok" | "warn") => {
    const hf = tgRef.current?.HapticFeedback;
    if (!hf) return;
    try {
      if (kind === "tap") hf.impactOccurred("light");
      else hf.notificationOccurred(kind === "ok" ? "success" : "error");
    } catch {
      /* haptics unsupported */
    }
  }, []);

  /* ---------- navigation ---------- */
  const [view, setView] = useState<View>("shop");
  const [detailId, setDetailId] = useState<string | null>(null);
  const viewStack = useRef<View[]>([]);
  const go = useCallback((next: View) => {
    setView((cur) => {
      if (cur !== next) viewStack.current.push(cur);
      return next;
    });
  }, []);
  const goBack = useCallback(() => {
    setView((cur) => viewStack.current.pop() ?? "shop");
    haptic("tap");
  }, [haptic]);
  const resetToShop = useCallback(() => {
    viewStack.current = [];
    setView("shop");
  }, []);

  /* BackButton: visible on every non-root view */
  useEffect(() => {
    const bb = tgRef.current?.BackButton;
    if (!bb) return;
    const handler = () => goBack();
    if (phase === "ready" && view !== "shop") {
      bb.onClick(handler);
      bb.show();
    } else {
      bb.hide();
    }
    return () => {
      bb.offClick(handler);
    };
  }, [view, phase, goBack]);

  /* ---------- cart (client-side; the server is the cart authority) ---------- */
  const [cart, setCart] = useState<Record<string, number>>({});
  useEffect(() => {
    setCart(loadCart());
  }, [tgVersion]);
  const persistCart = useCallback((next: Record<string, number>) => {
    setCart(next);
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  }, []);

  const catalog = payload?.catalog ?? [];
  const tplById = useMemo(() => new Map(catalog.map((tpl) => [tpl.id, tpl])), [catalog]);
  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ tpl: tplById.get(id), qty }))
        .filter((l): l is { tpl: Tpl; qty: number } => Boolean(l.tpl) && l.qty >= 1),
    [cart, tplById]
  );
  const cartCount = cartLines.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cartLines.reduce((s, l) => s + l.tpl.priceToman * l.qty, 0);
  const CART_MAX_LINES = 10; // mirror of orders.ts (server re-validates)
  const CART_MAX_QTY = 10;

  const addToCart = useCallback(
    (tpl: Tpl) => {
      haptic("tap");
      const cur = { ...cart };
      const existing = cur[tpl.id] ?? 0;
      if (existing >= CART_MAX_QTY || (existing === 0 && Object.keys(cur).length >= CART_MAX_LINES)) {
        toast({ description: sfmt(t.cartMaxNote, { limit: CART_MAX_LINES }) });
        haptic("warn");
        return;
      }
      cur[tpl.id] = existing + 1;
      persistCart(cur);
      toast({ description: t.addedToast });
    },
    [cart, persistCart, haptic, t, toast]
  );

  const setQty = useCallback(
    (id: string, qty: number) => {
      const cur = { ...cart };
      if (qty <= 0) delete cur[id];
      else cur[id] = Math.min(CART_MAX_QTY, Math.max(1, Math.floor(qty)));
      persistCart(cur);
    },
    [cart, persistCart]
  );

  /* ---------- checkout ---------- */
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [payErr, setPayErr] = useState("");
  const [result, setResult] = useState<CheckoutPayload | null>(null);
  const [balance, setBalance] = useState<number>(payload?.balanceToman ?? 0);
  useEffect(() => {
    setBalance(payload?.balanceToman ?? 0);
  }, [payload?.balanceToman]);

  const errTextFor = useCallback(
    (status: number, data: { error?: string; problem?: string; payableToman?: number }): string => {
      if (status === 401 || status === 403) return t.errAuth;
      if (status === 429) return t.errRate;
      if (data?.error === "bad_code") {
        return data.problem === "expired"
          ? t.codeExpired
          : data.problem === "limit"
            ? t.codeLimit
            : data.problem === "used"
              ? t.codeUsed
              : t.codeInvalid;
      }
      if (data?.error === "empty_cart" || data?.error === "bad_items") return t.errCart;
      if (data?.error === "insufficient_funds") {
        return sfmt(t.insufficient, {
          value: fmtToman(balance),
          p: fmtToman(Number(data.payableToman) || 0),
        });
      }
      if (data?.error === "method_unavailable" || status === 502) return t.errMethod;
      return t.errServer;
    },
    [t, balance]
  );

  const checkout = useCallback(
    async (method: PayMethod) => {
      if (busy || cartLines.length === 0) return;
      setBusy(true);
      setPayErr("");
      haptic("tap");
      try {
        const res = await fetch("/api/miniapp/checkout", {
          method: "POST",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-telegram-init-data": initDataRef.current,
          },
          body: JSON.stringify({
            items: cartLines.map((l) => ({ templateId: l.tpl.id, qty: l.qty })),
            code: code.trim(),
            method,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<CheckoutPayload> & { error?: string; problem?: string };
        if (!res.ok) {
          setPayErr(errTextFor(res.status, data));
          haptic("warn");
          return;
        }
        const payloadCk = data as CheckoutPayload;
        if (payloadCk.status === "paid") {
          setBalance((b) => Math.max(0, b - payloadCk.payableToman));
        }
        setResult(payloadCk);
        persistCart({});
        setCode("");
        go("result");
        haptic("ok");
      } catch {
        setPayErr(t.errServer);
        haptic("warn");
      } finally {
        setBusy(false);
      }
    },
    [busy, cartLines, code, errTextFor, go, haptic, persistCart, t]
  );

  const openLink = useCallback((url: string) => {
    if (!url) return;
    const tg = tgRef.current;
    if (tg && typeof tg.openLink === "function") {
      try {
        tg.openLink(url);
        return;
      } catch {
        /* fall through to a plain tab */
      }
    }
    window.open(url, "_blank", "noopener");
  }, []);

  const methods = payload?.methods;
  const primaryMethod: PayMethod | null = useMemo(() => {
    if (!methods) return null;
    const order: PayMethod[] = ["zarinpal", "card", "wallet", "crypto", "stars"];
    return order.find((m) => methods[m]) ?? null;
  }, [methods]);

  /* ---------- MainButton: checkout confirm where it feels natural ----------
   * Cart view → the native button opens the payment picker; pay view → it
   * mirrors the PRIMARY (first enabled) method. Busy state shows progress. */
  useEffect(() => {
    const mb = tgRef.current?.MainButton;
    if (!mb) return;
    const mbHandler = () => {
      if (view === "cart" && cartLines.length > 0 && !busy) go("pay");
      else if (view === "pay" && primaryMethod && !busy) void checkout(primaryMethod);
    };
    if (phase !== "ready" || busy) {
      mb.offClick(mbHandler);
      mb.hide();
      return;
    }
    const showIt =
      (view === "cart" && cartLines.length > 0) || (view === "pay" && Boolean(primaryMethod));
    if (!showIt) {
      mb.offClick(mbHandler);
      mb.hide();
      return;
    }
    mb.setText(view === "cart" ? t.cartCheckout : `${t.payNow} · ${fmtToman(cartTotal)}`);
    mb.onClick(mbHandler);
    mb.show();
    return () => {
      mb.offClick(mbHandler);
    };
  }, [phase, view, cartLines.length, cartTotal, t, busy, primaryMethod, go, checkout]);

  /* ---------- account ---------- */
  const [me, setMe] = useState<MePayload | null>(null);
  const [meBusy, setMeBusy] = useState(false);
  const loadMe = useCallback(async () => {
    setMeBusy(true);
    try {
      const res = await fetch("/api/miniapp/me", {
        cache: "no-store",
        headers: { "x-telegram-init-data": initDataRef.current },
      });
      const data = (await res.json().catch(() => null)) as MePayload | null;
      if (res.ok && data) {
        setMe(data);
        setBalance(data.balanceToman);
      }
    } catch {
      /* honest empty state below */
    } finally {
      setMeBusy(false);
    }
  }, []);
  useEffect(() => {
    if (view === "account" && phase === "ready") void loadMe();
  }, [view, phase, loadMe]);

  /* ---------- derived render data ---------- */
  const detailTpl = detailId ? tplById.get(detailId) ?? null : null;
  const statusLabel = (s: string) =>
    s === "completed"
      ? t.stCompleted
      : s === "pending_manual"
        ? t.stPending
        : s === "rejected"
          ? t.stRejected
          : s === "canceled"
            ? t.stCanceled
            : t.stAwaiting;

  /* ---------- render ---------- */

  return (
    <div className="bg-cosmic relative flex min-h-screen flex-col overflow-hidden" style={themeVars}>
      <Starfield />

      {/* ---------- header ---------- */}
      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-4 pt-5 md:px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark size={36} pulse />
          <div className="leading-none">
            <span
              className="text-silver block text-[13px] font-bold tracking-[0.24em]"
              style={{ color: "var(--mi-text, currentColor)" }}
            >
              SEPHIROTH
            </span>
            <span className="mt-1 block text-[9px] uppercase tracking-[0.32em] text-muted-foreground/80">
              {t.tagline}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {phase === "ready" && (
            <>
              <button
                onClick={() => go("account")}
                aria-label={t.accountBtn}
                className="glass flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-white/10 transition-colors hover:text-foreground"
              >
                <UserRound className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
              </button>
              <button
                onClick={() => go("cart")}
                aria-label={sfmt(t.cartBtn, { n: cartCount })}
                className="glass hover-glow relative flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-white/10"
              >
                <ShoppingCart className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
                {cartCount > 0 && (
                  <span className="absolute -end-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold text-black">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </button>
            </>
          )}
          <nav
            aria-label={t.langLabel}
            className="glass hidden items-center gap-0.5 rounded-full p-1 ring-1 ring-white/10 sm:flex"
          >
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
        </div>
      </header>

      {/* ---------- main ---------- */}
      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:px-6">
        {(phase === "boot" || phase === "loading") && <LoadingState label={t.loading} />}

        {phase === "outside" && (
          <StateCard
            icon={<Send className="h-7 w-7 text-primary" />}
            title={t.outsideTitle}
            desc={t.outsideDesc}
          />
        )}

        {phase === "error" && (
          <div className="space-y-4">
            <StateCard
              icon={<SearchX className="h-8 w-8 text-chart-5" />}
              title={t.errTitle}
              desc={bootErr ? t.errAuth : t.errDesc}
            />
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void loadCatalog()}
                className="h-11 gap-2 border-white/10 bg-white/[0.03] px-6 text-xs"
              >
                <Loader2 className="h-4 w-4" aria-hidden="true" />
                {t.retry}
              </Button>
            </div>
          </div>
        )}

        {phase === "ready" && payload && (
          <div className="fade-up">
            {/* balance strip */}
            <div className="glass mb-5 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 ring-1 ring-white/10">
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Wallet className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                {sfmt(t.balance, { value: fmtToman(balance) })}
              </span>
              <span className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60 sm:flex">
                {payload.user.username || payload.user.firstName || `tg ${payload.user.id}`}
              </span>
            </div>

            {view === "shop" && (
              <ShopView
                t={t}
                catalog={catalog}
                onOpen={(id) => {
                  setDetailId(id);
                  go("detail");
                }}
                onAdd={addToCart}
                lang={lang}
              />
            )}

            {view === "detail" && detailTpl && (
              <DetailView
                t={t}
                tpl={detailTpl}
                lang={lang}
                onBack={() => {
                  setDetailId(null);
                  goBack();
                }}
                onAdd={() => addToCart(detailTpl)}
              />
            )}

            {view === "cart" && (
              <CartView
                t={t}
                lines={cartLines}
                total={cartTotal}
                onQty={setQty}
                onClear={() => persistCart({})}
                onBack={goBack}
                busy={busy}
              />
            )}

            {view === "pay" && (
              <PayView
                t={t}
                lines={cartLines}
                total={cartTotal}
                methods={methods ?? null}
                balance={balance}
                code={code}
                setCode={setCode}
                busy={busy}
                payErr={payErr}
                onBack={goBack}
                onPay={(m) => void checkout(m)}
              />
            )}

            {view === "result" && result && (
              <ResultView
                t={t}
                result={result}
                botDeepLink={payload.bot.deepLink}
                onOpen={openLink}
                onDone={resetToShop}
                onCopy={async (text) => {
                  try {
                    await navigator.clipboard.writeText(text);
                    haptic("ok");
                  } catch {
                    /* clipboard unavailable */
                  }
                }}
              />
            )}

            {view === "account" && (
              <AccountView
                t={t}
                me={me}
                busy={meBusy}
                onBack={goBack}
                onOpen={openLink}
                statusLabel={statusLabel}
              />
            )}
          </div>
        )}
      </main>

      {/* ---------- footer (sticks to the bottom on short content) ---------- */}
      <footer className="relative z-10 mt-auto pb-6 pt-2 text-center">
        <p className="flex items-center justify-center gap-1.5 text-[10px] tracking-wide text-muted-foreground/60">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          SEPHIROTH · {t.tagline}
        </p>
      </footer>
    </div>
  );
}

/* ============================================================
   Views
   ============================================================ */

function ShopView({
  t,
  catalog,
  onOpen,
  onAdd,
  lang,
}: {
  t: (typeof FEATURE)["en"]["miniapp"];
  catalog: Tpl[];
  onOpen: (id: string) => void;
  onAdd: (tpl: Tpl) => void;
  lang: Lang;
}) {
  if (catalog.length === 0) {
    return (
      <StateCard
        icon={<Ghost className="h-8 w-8 text-muted-foreground" />}
        title={t.shopEmpty}
        desc={t.shopEmptyHint}
      />
    );
  }
  return (
    <section aria-label={t.shopTitle} className="space-y-3">
      <h1 className="text-silver px-1 text-lg font-bold tracking-tight">{t.shopTitle}</h1>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {catalog.map((tpl) => (
          <li key={tpl.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpen(tpl.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(tpl.id);
                }
              }}
              aria-label={tpl.name}
              className="glass hover-glow flex min-h-[44px] cursor-pointer flex-col rounded-2xl p-4 ring-1 ring-white/10"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-sm font-semibold"
                    style={{ color: "var(--mi-text, currentColor)" }}
                  >
                    {tpl.name}
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    <Chip>
                      <Gauge className="h-3 w-3" aria-hidden="true" />
                      {tpl.trafficLimitGb === null ? t.unlimited : sfmt(t.traffic, { gb: fmtGb(tpl.trafficLimitGb) })}
                    </Chip>
                    <Chip>
                      <Clock3 className="h-3 w-3" aria-hidden="true" />
                      {tpl.expiryDays === null ? t.unlimited : sfmt(t.days, { n: tpl.expiryDays })}
                    </Chip>
                    <Chip>
                      <UserRound className="h-3 w-3" aria-hidden="true" />
                      {tpl.ipLimit === 0 ? t.unlimited : sfmt(t.devices, { n: tpl.ipLimit })}
                    </Chip>
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span
                    className="block font-mono text-sm font-bold"
                    style={{ color: "var(--mi-link, var(--primary))" }}
                  >
                    {tpl.priceToman > 0 ? fmtToman(tpl.priceToman) : t.free}
                  </span>
                  {tpl.priceToman > 0 && (
                    <span className="mt-0.5 block text-[9px] uppercase tracking-widest text-muted-foreground/70">
                      {lang === "fa" ? "تومان" : lang === "ru" ? "туманов" : lang === "zh" ? "托曼" : "Toman"}
                    </span>
                  )}
                </span>
              </div>
              {tpl.priceToman > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-9 w-full gap-1.5 border-primary/25 bg-primary/10 text-[11px] text-primary hover:bg-primary/15 hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(tpl);
                  }}
                  aria-label={`${t.addCart} · ${tpl.name}`}
                >
                  <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.addCart}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-white/10">
      {children}
    </span>
  );
}

function DetailView({
  t,
  tpl,
  lang,
  onBack,
  onAdd,
}: {
  t: (typeof FEATURE)["en"]["miniapp"];
  tpl: Tpl;
  lang: Lang;
  onBack: () => void;
  onAdd: () => void;
}) {
  const free = tpl.priceToman === 0;
  return (
    <section className="pass-card fade-up rounded-2xl p-5" aria-label={tpl.name}>
      <button
        onClick={onBack}
        className="mb-4 inline-flex min-h-[44px] items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-label={t.back}
      >
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t.back}
      </button>
      <h1 className="text-silver text-xl font-bold tracking-tight md:text-2xl">{tpl.name}</h1>
      <ul className="mt-4 space-y-2.5">
        <FeatureRow icon={<Gauge className="h-4 w-4 text-primary/80" />} label={t.traffic.replace("{gb}", "")}>
          {tpl.trafficLimitGb === null ? t.unlimited : `${fmtGb(tpl.trafficLimitGb)} GB`}
        </FeatureRow>
        <FeatureRow icon={<Clock3 className="h-4 w-4 text-primary/80" />} label={t.days.replace("{n}", "").trim()}>
          {tpl.expiryDays === null ? t.unlimited : sfmt(t.days, { n: tpl.expiryDays })}
        </FeatureRow>
        <FeatureRow icon={<UserRound className="h-4 w-4 text-primary/80" />} label={t.devices.replace("{n}", "").trim()}>
          {tpl.ipLimit === 0 ? t.unlimited : sfmt(t.devices, { n: tpl.ipLimit })}
        </FeatureRow>
      </ul>
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
        <span>
          <span
            className="block font-mono text-xl font-bold"
            style={{ color: "var(--mi-link, var(--primary))" }}
          >
            {free ? t.free : fmtToman(tpl.priceToman)}
          </span>
          {!free && (
            <span className="mt-0.5 block text-[9px] uppercase tracking-widest text-muted-foreground/70">
              {lang === "fa" ? "تومان" : lang === "ru" ? "туманов" : lang === "zh" ? "托曼" : "Toman"}
            </span>
          )}
        </span>
        {!free && (
          <Button
            onClick={onAdd}
            className="glow-cyan h-11 gap-2 bg-primary/90 px-6 text-[13px] font-semibold text-black hover:bg-primary"
            style={{ backgroundColor: "var(--mi-btn, var(--primary))", color: "var(--mi-btn-text, black)" }}
            aria-label={`${t.addCart} · ${tpl.name}`}
          >
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            {t.addCart}
          </Button>
        )}
      </div>
    </section>
  );
}

function FeatureRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="glass flex items-center gap-3 rounded-xl px-3.5 py-2.5 ring-1 ring-white/10">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] uppercase tracking-[0.18em] text-muted-foreground/80">
          {label || "—"}
        </span>
        <span className="block font-mono text-xs font-semibold text-foreground">{children}</span>
      </span>
    </li>
  );
}

function CartView({
  t,
  lines,
  total,
  onQty,
  onClear,
  onBack,
  busy,
}: {
  t: (typeof FEATURE)["en"]["miniapp"];
  lines: { tpl: Tpl; qty: number }[];
  total: number;
  onQty: (id: string, qty: number) => void;
  onClear: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  if (lines.length === 0) {
    return (
      <div className="space-y-4">
        <StateCard
          icon={<ShoppingCart className="h-8 w-8 text-muted-foreground" />}
          title={t.cartEmpty}
          desc={t.shopEmptyHint}
        />
        <div className="flex justify-center">
          <BackLink t={t} onClick={onBack} />
        </div>
      </div>
    );
  }
  return (
    <section className="space-y-3" aria-label={t.cartTitle}>
      <div className="flex items-center justify-between px-1">
        <h1 className="text-silver text-lg font-bold tracking-tight">{t.cartTitle}</h1>
        <button
          onClick={onClear}
          className="inline-flex min-h-[44px] items-center gap-1 px-2 text-[11px] text-muted-foreground transition-colors hover:text-chart-5"
          aria-label={t.cartClear}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t.cartClear}
        </button>
      </div>
      <ul className="space-y-2.5">
        {lines.map(({ tpl, qty }) => (
          <li key={tpl.id} className="glass rounded-2xl p-3.5 ring-1 ring-white/10">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">{tpl.name}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {fmtToman(tpl.priceToman)} × {qty} = {sfmt(t.linePrice, { value: fmtToman(tpl.priceToman * qty) })}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <IconBtn
                  label={sfmt(t.decAria, { name: tpl.name })}
                  onClick={() => onQty(tpl.id, qty - 1)}
                  disabled={busy}
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                </IconBtn>
                <span className="min-w-7 text-center font-mono text-xs font-bold text-foreground" aria-live="polite">
                  {qty}×
                </span>
                <IconBtn
                  label={sfmt(t.incAria, { name: tpl.name })}
                  onClick={() => onQty(tpl.id, qty + 1)}
                  disabled={busy || qty >= 10}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </IconBtn>
                <IconBtn
                  label={sfmt(t.delAria, { name: tpl.name })}
                  onClick={() => onQty(tpl.id, 0)}
                  disabled={busy}
                  danger
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </IconBtn>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="glass rounded-2xl p-4 ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t.subtotal}</span>
          <span className="font-mono text-sm font-bold text-foreground">
            {sfmt(t.linePrice, { value: fmtToman(total) })}
          </span>
        </div>
      </div>
      <div className="flex justify-center pt-1">
        <BackLink t={t} onClick={onBack} />
      </div>
    </section>
  );
}

function PayView({
  t,
  lines,
  total,
  methods,
  balance,
  code,
  setCode,
  busy,
  payErr,
  onBack,
  onPay,
}: {
  t: (typeof FEATURE)["en"]["miniapp"];
  lines: { tpl: Tpl; qty: number }[];
  total: number;
  methods: Record<PayMethod, boolean> | null;
  balance: number;
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  payErr: string;
  onBack: () => void;
  onPay: (m: PayMethod) => void;
}) {
  const anyMethod = methods && Object.values(methods).some(Boolean);
  return (
    <section className="space-y-3" aria-label={t.payTitle}>
      <button
        onClick={onBack}
        className="inline-flex min-h-[44px] items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-label={t.back}
      >
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t.back}
      </button>

      {/* summary */}
      <div className="pass-card rounded-2xl p-5">
        <h1 className="text-silver text-base font-bold tracking-tight">{t.payTitle}</h1>
        <ul className="mt-3 space-y-1.5">
          {lines.map(({ tpl, qty }) => (
            <li key={tpl.id} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="min-w-0 truncate text-muted-foreground">
                {tpl.name} × {qty}
              </span>
              <span className="shrink-0 font-mono text-foreground">
                {fmtToman(tpl.priceToman * qty)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t.totalLbl}</span>
          <span
            className="font-mono text-base font-bold"
            style={{ color: "var(--mi-link, var(--primary))" }}
          >
            {fmtToman(total)}
          </span>
        </div>
      </div>

      {/* discount code — validated server-side at checkout (bot parity) */}
      <div className="glass rounded-2xl p-4 ring-1 ring-white/10">
        <label htmlFor="mi-code" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t.discountPh}
        </label>
        <div className="mt-2 flex gap-2">
          <Input
            id="mi-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 64))}
            placeholder={t.discountPh}
            autoComplete="off"
            className="h-11 flex-1 border-white/10 bg-black/30 font-mono text-xs uppercase"
            aria-label={t.discountPh}
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/70">{t.discountApply} → {t.cartCheckout}</p>
      </div>

      {/* methods — only the configured ones (mirror of the bot's gating) */}
      {payErr && (
        <p className="rounded-xl bg-chart-5/10 px-4 py-3 text-[11px] text-chart-5 ring-1 ring-chart-5/30" role="alert">
          {payErr}
        </p>
      )}
      {!anyMethod && (
        <p className="rounded-xl bg-amber-400/10 px-4 py-3 text-[11px] text-amber-400 ring-1 ring-amber-400/30">
          {t.errMethod}
        </p>
      )}
      {methods?.zarinpal && (
        <MethodRow
          icon={<Landmark className="h-4 w-4" />}
          label={t.payZarin}
          hint={total > 0 ? fmtToman(total) : ""}
          disabled={busy}
          onClick={() => onPay("zarinpal")}
        />
      )}
      {methods?.card && (
        <MethodRow
          icon={<CreditCard className="h-4 w-4" />}
          label={t.payCard}
          disabled={busy}
          onClick={() => onPay("card")}
        />
      )}
      {methods?.wallet && (
        <MethodRow
          icon={<Wallet className="h-4 w-4" />}
          label={t.payWallet}
          hint={sfmt(t.walletBalance, { value: fmtToman(balance) })}
          disabled={busy || balance < total}
          onClick={() => onPay("wallet")}
          warn={balance < total ? sfmt(t.insufficient, { value: fmtToman(balance), p: fmtToman(total) }) : ""}
        />
      )}
      {methods?.crypto && (
        <MethodRow
          icon={<CircleDollarSign className="h-4 w-4" />}
          label={t.payCrypto}
          disabled={busy}
          onClick={() => onPay("crypto")}
        />
      )}
      {methods?.stars && (
        <MethodRow
          icon={<Sparkles className="h-4 w-4" />}
          label={t.payStars}
          disabled={busy}
          onClick={() => onPay("stars")}
        />
      )}
      {busy && (
        <p className="flex items-center justify-center gap-2 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t.processing}
        </p>
      )}
    </section>
  );
}

function MethodRow({
  icon,
  label,
  hint,
  warn,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  warn?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "glass hover-glow flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-4 py-3 text-start ring-1 ring-white/10 transition-all",
        disabled && "cursor-not-allowed opacity-45"
      )}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1"
        style={{
          backgroundColor: "color-mix(in srgb, var(--mi-btn, var(--primary)) 14%, transparent)",
          color: "var(--mi-link, var(--primary))",
          borderColor: "transparent",
        }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold" style={{ color: "var(--mi-text, currentColor)" }}>
          {label}
        </span>
        {hint && <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{hint}</span>}
        {warn && <span className="mt-0.5 block truncate text-[10px] text-chart-5">{warn}</span>}
      </span>
      <ChevronLeft className="h-4 w-4 shrink-0 rotate-180 text-muted-foreground/50 rtl:rotate-0" aria-hidden="true" />
    </button>
  );
}

function ResultView({
  t,
  result,
  botDeepLink,
  onOpen,
  onDone,
  onCopy,
}: {
  t: (typeof FEATURE)["en"]["miniapp"];
  result: CheckoutPayload;
  botDeepLink: string;
  onOpen: (url: string) => void;
  onDone: () => void;
  onCopy: (text: string) => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    await onCopy(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const paidIcon = (
    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-chart-3/15 ring-1 ring-chart-3/40">
      <BadgeCheck className="h-7 w-7 text-chart-3" aria-hidden="true" />
    </span>
  );
  const orderIdLine = (
    <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
      {sfmt(t.orderIdLbl, { id: result.orderId.slice(-8).toUpperCase() })}
    </p>
  );
  const manageBtn = botDeepLink && (
    <Button
      variant="outline"
      onClick={() => onOpen(botDeepLink)}
      className="h-11 w-full gap-2 border-white/10 bg-white/[0.03] text-xs text-foreground"
    >
      <Send className="h-4 w-4 text-primary" aria-hidden="true" />
      {t.manageSub}
    </Button>
  );
  const doneBtn = (
    <Button variant="ghost" onClick={onDone} className="h-11 w-full text-xs text-muted-foreground hover:text-foreground">
      {t.back}
    </Button>
  );

  if (result.status === "paid") {
    return (
      <section className="fade-up space-y-4">
        <div className="pass-card rounded-2xl p-7 text-center">
          {paidIcon}
          <h1 className="text-silver mt-4 text-lg font-bold">{t.paidTitle}</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t.paidNote}</p>
          {orderIdLine}
        </div>
        {result.subs.length > 0 && (
          <div className="glass rounded-2xl p-4 ring-1 ring-white/10">
            <ul className="space-y-2">
              {result.subs.map((s, i) => (
                <li key={`${s.subId}-${i}`} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-foreground">{s.username}</span>
                    <span className="block truncate font-mono text-[9px] text-muted-foreground/70">{s.subUrl}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpen(s.subUrl)}
                    className="h-9 shrink-0 gap-1.5 border-primary/25 bg-primary/10 text-[11px] text-primary hover:bg-primary/15 hover:text-primary"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    {t.openSub}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {manageBtn}
        {doneBtn}
      </section>
    );
  }

  if (result.status === "redirect") {
    return (
      <section className="fade-up space-y-4">
        <div className="pass-card rounded-2xl p-7 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/30">
            <Landmark className="h-7 w-7 text-primary" aria-hidden="true" />
          </span>
          <h1 className="text-silver mt-4 text-lg font-bold">{t.payNow}</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t.redirectNote}</p>
          {orderIdLine}
        </div>
        <Button
          onClick={() => onOpen(result.redirectUrl)}
          className="glow-cyan h-12 w-full bg-primary/90 text-[13px] font-semibold text-black hover:bg-primary"
          style={{ backgroundColor: "var(--mi-btn, var(--primary))", color: "var(--mi-btn-text, black)" }}
        >
          {t.payNow}
        </Button>
        {manageBtn}
        {doneBtn}
      </section>
    );
  }

  if (result.status === "handoff_bot") {
    return (
      <section className="fade-up space-y-4">
        <div className="pass-card rounded-2xl p-7 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/30">
            <Sparkles className="h-7 w-7 text-amber-400" aria-hidden="true" />
          </span>
          <h1 className="text-silver mt-4 text-lg font-bold">{t.handoffTitle}</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {sfmt(t.handoffNote, { n: result.stars })}
          </p>
          {orderIdLine}
        </div>
        {botDeepLink && (
          <Button
            onClick={() => onOpen(botDeepLink)}
            className="glow-cyan h-12 w-full gap-2 bg-primary/90 text-[13px] font-semibold text-black hover:bg-primary"
            style={{ backgroundColor: "var(--mi-btn, var(--primary))", color: "var(--mi-btn-text, black)" }}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {t.openBot}
          </Button>
        )}
        {doneBtn}
      </section>
    );
  }

  /* await_receipt — card-to-card */
  return (
    <section className="fade-up space-y-4">
      <div className="pass-card rounded-2xl p-7 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
          <CreditCard className="h-7 w-7 text-primary" aria-hidden="true" />
        </span>
        <h1 className="text-silver mt-4 text-lg font-bold">{t.receiptTitle}</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t.receiptNote}</p>
        <div className="mx-auto mt-4 max-w-xs rounded-xl bg-black/40 px-4 py-3 ring-1 ring-white/10">
          <p className="font-mono text-sm font-bold tracking-wider text-foreground" dir="ltr">
            {result.card.number}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">{result.card.holder}</p>
        </div>
        {orderIdLine}
      </div>
      <Button
        variant="outline"
        onClick={() => void copy(result.card.number)}
        className="h-11 w-full gap-2 border-primary/25 bg-primary/10 text-xs text-primary hover:bg-primary/15 hover:text-primary"
      >
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        {copied ? t.copied : t.copyCard}
      </Button>
      {manageBtn}
      {doneBtn}
    </section>
  );
}

function AccountView({
  t,
  me,
  busy,
  onBack,
  onOpen,
  statusLabel,
}: {
  t: (typeof FEATURE)["en"]["miniapp"];
  me: MePayload | null;
  busy: boolean;
  onBack: () => void;
  onOpen: (url: string) => void;
  statusLabel: (s: string) => string;
}) {
  return (
    <section className="fade-up space-y-4" aria-label={t.accountBtn}>
      <button
        onClick={onBack}
        className="inline-flex min-h-[44px] items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-label={t.back}
      >
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t.back}
      </button>

      <div className="pass-card rounded-2xl p-5">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <Wallet className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
          {t.payWallet}
        </p>
        <p className="mt-2 font-mono text-xl font-bold text-foreground">
          {sfmt(t.balance, { value: fmtToman(me?.balanceToman ?? 0) })}
        </p>
      </div>

      {/* subscriptions */}
      <div className="glass rounded-2xl p-4 ring-1 ring-white/10">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <BadgeCheck className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
          {t.subsTitle}
        </p>
        {busy && !me ? (
          <p className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          </p>
        ) : !me || me.subscriptions.length === 0 ? (
          <p className="py-4 text-[11px] text-muted-foreground">{t.subsEmpty}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {me.subscriptions.map((s) => (
              <li key={s.subId} className="glass flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ring-white/10">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] font-semibold text-foreground">
                    {s.username}
                  </span>
                  <span className="block text-[9px] text-muted-foreground/80">
                    {sfmt(t.traffic, { gb: fmtGb(s.usedTrafficGb) })}
                    {" · "}
                    {s.expiryDays === null ? t.unlimited : sfmt(t.days, { n: s.expiryDays })}
                    {!s.enabled && " · ⛔"}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpen(s.subUrl)}
                  className="h-9 shrink-0 gap-1.5 border-primary/25 bg-primary/10 text-[11px] text-primary hover:bg-primary/15 hover:text-primary"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.openSub}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* recent orders */}
      <div className="glass rounded-2xl p-4 ring-1 ring-white/10">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <ShoppingBag className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
          {t.ordersTitle}
        </p>
        {!me || me.orders.length === 0 ? (
          <p className="py-4 text-[11px] text-muted-foreground">{t.ordersEmpty}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {me.orders.map((o) => (
              <li key={o.id} className="glass flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ring-white/10">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-foreground">{o.templateName}</span>
                  <span className="block font-mono text-[9px] text-muted-foreground/80">
                    #{o.id.slice(-6)} · {o.method}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className="block font-mono text-[11px] text-foreground">{fmtToman(o.amountToman)}</span>
                  <span
                    className={cn(
                      "mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1",
                      o.status === "completed"
                        ? "bg-chart-3/10 text-chart-3 ring-chart-3/30"
                        : o.status === "rejected" || o.status === "canceled"
                          ? "bg-chart-5/10 text-chart-5 ring-chart-5/30"
                          : "bg-amber-400/10 text-amber-400 ring-amber-400/30"
                    )}
                  >
                    {statusLabel(o.status)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ---------- shared pieces (mirror the sub page's honest states) ---------- */

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-muted-foreground ring-1 ring-white/10 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
        danger && "hover:text-chart-5"
      )}
    >
      {children}
    </button>
  );
}

function BackLink({ t, onClick }: { t: (typeof FEATURE)["en"]["miniapp"]; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center gap-1.5 px-3 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      aria-label={t.back}
    >
      <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      {t.back}
    </button>
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
