"use client";

/* ============================================================
   Sephiroth · Phase 28 — standalone API docs at /api-docs
   Full-window Swagger UI (self-hosted assets — air-gapped OK).
   Admin-gated client-side via /api/auth/session; the spec at
   /api/openapi.json is admin-only too, so unauthenticated
   visitors get a clean sign-in-required card instead of docs.
   ============================================================ */

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FileJson,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { BrandMark } from "@/components/sephiroth/brand";
import { SwaggerEmbed } from "@/components/sephiroth/swagger-embed";
import { Button } from "@/components/ui/button";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { useAppStore } from "@/lib/store/app-store";

type Phase = "loading" | "admin" | "denied";

export default function ApiDocsPage() {
  const lang = useAppStore((s) => s.lang);
  const t = dictionaries[lang].settings;
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { authenticated?: boolean; role?: string }) => {
        if (!cancelled) {
          setPhase(d.authenticated && d.role === "admin" ? "admin" : "denied");
        }
      })
      .catch(() => {
        if (!cancelled) setPhase("denied");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark size={30} />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">
                {t.apiDocsTitle}
              </h1>
              <p className="truncate text-[11px] text-muted-foreground">
                /api-docs · /api/v1 · OpenAPI 3.1
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a href="/api/openapi.json" target="_blank" rel="noreferrer">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full text-[11px]"
              >
                <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
                {t.apiOpenSpec}
              </Button>
            </a>
            <a href="/">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 rounded-full text-[11px]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {t.apiDocsBack}
              </Button>
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">
        {phase === "loading" && (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t.apiSwaggerLoading}
          </div>
        )}
        {phase === "denied" && (
          <div className="flex min-h-[50vh] flex-col items-center justify-center">
            <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-8 text-center">
              <ShieldAlert
                className="h-8 w-8 text-primary/80"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">{t.apiDocsNeedLogin}</p>
              <a href="/">
                <Button size="sm" className="h-9 rounded-full text-xs">
                  {t.apiDocsBack}
                </Button>
              </a>
            </div>
          </div>
        )}
        {phase === "admin" && <SwaggerEmbed />}
      </main>

      <footer className="mt-auto border-t border-border/60 py-3">
        <p className="text-center text-[11px] text-muted-foreground">
          Sephiroth · {t.apiDocsTitle} · v27.1
        </p>
      </footer>
    </div>
  );
}
