"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Heart,
  Sparkles,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { BrandMark } from "@/components/sephiroth/brand";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { useToast } from "@/hooks/use-toast";

/* ============================================================
   Sephiroth · Donate — hand-crafted support dialog
   Donation channels live in the memento repo README:
     · USDT (TRC20) wallet
     · Reymit (Iranian support platform)
     · GitHub stars for Edsel-Rahimi/Sephiroth
   ============================================================ */

const USDT_TRC20 = "TWdqYu5H6emRHd6jFfkHjfG8Yg2285DFmT";
const REYMIT_URL = "https://reymit.ir/edsel-rahimi";
const GITHUB_REPO_URL = "https://github.com/Edsel-Rahimi/Sephiroth";
const GITHUB_API_URL = "https://api.github.com/repos/Edsel-Rahimi/Sephiroth";
const STARS_TIMEOUT_MS = 8000;

export function DonateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const lang = useAppStore((s) => s.lang);
  const t = dictionaries[lang].donate;
  const { toast } = useToast();

  const [copied, setCopied] = useState(false);
  const [stars, setStars] = useState<number | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* live ★ count — fetched on first open, cached, silently optional:
   * on ANY failure (offline, rate-limit, timeout) the chip stays hidden */
  useEffect(() => {
    if (!open || stars !== null) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), STARS_TIMEOUT_MS);
    fetch(GITHUB_API_URL, {
      signal: ctrl.signal,
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { stargazers_count?: unknown }) => {
        if (typeof d?.stargazers_count === "number") setStars(d.stargazers_count);
      })
      .catch(() => {
        /* chip simply omitted */
      });
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, stars]);

  /* reset the copied flash + timer when the dialog closes */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCopied(false);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    }
    onOpenChange(next);
  };

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(USDT_TRC20);
      setCopied(true);
      toast({ description: t.copied });
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard unavailable — the address stays selectable */
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="glass-strong w-[min(94vw,440px)] gap-0 overflow-hidden rounded-3xl border-white/10 p-0 sm:max-w-[440px]"
      >
        {/* soft radial halo behind the brand mark */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-20 mx-auto h-44 w-44 rounded-full bg-primary/20 blur-[70px]"
        />

        <div className="relative px-6 pb-6 pt-8 text-center sm:px-7">
          {/* brand */}
          <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-primary/25 blur-2xl"
            />
            <BrandMark size={56} className="relative" />
          </div>

          <DialogTitle className="mt-4 text-lg font-bold tracking-tight text-foreground">
            {t.title}
          </DialogTitle>
          <DialogDescription className="mx-auto mt-2 max-w-[38ch] text-[12.5px] leading-relaxed text-muted-foreground">
            {t.subtitle}
          </DialogDescription>

          {/* crypto wallet */}
          <div className="mt-6 rounded-2xl border border-primary/25 bg-primary/[.06] p-4 text-start">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              {t.crypto}
            </span>
            <div className="mt-3 flex items-stretch gap-2">
              <button
                type="button"
                onClick={copyAddress}
                dir="ltr"
                title={t.cryptoHint}
                className="hover-glow min-w-0 flex-1 truncate rounded-xl border border-border/60 bg-black/35 px-3 py-2.5 text-start font-mono text-[12px] tracking-wide text-foreground/95 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {USDT_TRC20}
              </button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copyAddress}
                aria-label={t.crypto}
                className="h-auto w-10 shrink-0 rounded-xl border-border/60 bg-transparent"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            <p className="mt-2.5 text-[11px] text-muted-foreground/80">
              {t.cryptoHint}
            </p>
          </div>

          {/* action rows */}
          <div className="mt-3 space-y-2.5 text-start">
            {/* Reymit — Iranian supporters */}
            <a
              href={REYMIT_URL}
              target="_blank"
              rel="noreferrer"
              className="hover-glow group flex items-center gap-3 rounded-2xl border border-border/60 bg-white/[.03] p-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-400/10 text-rose-400 ring-1 ring-rose-400/25">
                <Heart className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {t.reymit}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {t.reymitDesc}
                </span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:-scale-x-100" />
            </a>

            {/* GitHub stars */}
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="hover-glow group flex items-center gap-3 rounded-2xl border border-border/60 bg-white/[.03] p-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-300/10 text-amber-300 ring-1 ring-amber-300/25">
                <Star className="h-4 w-4 fill-amber-300/80" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {t.stars}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {t.starsDesc}
                </span>
              </span>
              {stars !== null && (
                <span
                  dir="ltr"
                  className="glass shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] tabular-nums text-amber-200"
                >
                  ★ {stars.toLocaleString()}
                </span>
              )}
            </a>
          </div>

          {/* creator signature */}
          <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] font-medium text-primary/90">
            <Sparkles className="h-3 w-3 text-primary" />
            <span>{t.creator}</span>
          </div>

          <DialogClose asChild>
            <Button
              variant="outline"
              className="hover-glow mt-5 h-10 w-full rounded-xl border-border/60 bg-transparent text-sm font-medium"
            >
              {t.close}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
