"use client";

/* ============================================================
   Sephiroth · Phase 27 — self-hosted Swagger UI embed
   Loads /swagger/swagger-ui-bundle.js + .css (served from
   public/swagger — no CDN dependency, works air-gapped) and
   renders the panel's OpenAPI spec (/api/openapi.json). Falls
   back to a plain link card when the assets cannot load.
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";

declare global {
  interface Window {
    SwaggerUIBundle?: (opts: Record<string, unknown>) => void;
  }
}

const CSS_HREF = "/swagger/swagger-ui.css";
const JS_SRC = "/swagger/swagger-ui-bundle.js";

function loadCss(): void {
  if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_HREF;
  document.head.appendChild(link);
}

function loadScript(): Promise<void> {
  if (window.SwaggerUIBundle) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${JS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("swagger bundle failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = JS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("swagger bundle failed"));
    document.head.appendChild(s);
  });
}

export function SwaggerEmbed() {
  const lang = useAppStore((s) => s.lang);
  const t = dictionaries[lang].settings;
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    let cancelled = false;
    loadCss();
    loadScript()
      .then(() => {
        if (cancelled || !hostRef.current || !window.SwaggerUIBundle) {
          if (!cancelled && !window.SwaggerUIBundle) setState("fallback");
          return;
        }
        window.SwaggerUIBundle({
          url: "/api/openapi.json",
          dom_id: "#seph-swagger-root",
          docExpansion: "list",
          defaultModelsExpandDepth: -1,
          tryItOutEnabled: true,
          persistAuthorization: true,
          onComplete: () => {
            if (!cancelled) setState("ready");
          },
          onFailure: () => {
            if (!cancelled) setState("fallback");
          },
        });
        // bundle mounts synchronously; give it a tick then confirm
        setTimeout(() => {
          if (!cancelled) {
            setState((prev) => (prev === "loading" ? "ready" : prev));
          }
        }, 800);
      })
      .catch(() => {
        if (!cancelled) setState("fallback");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border/60">
      <style
        dangerouslySetInnerHTML={{
          __html:
            "#seph-swagger-root .scheme-container{background:transparent!important;box-shadow:none!important}" +
            "#seph-swagger-root .information-containerwrapper,#seph-swagger-root .opblock-tag-section{background:transparent}",
        }}
      />
      {state === "fallback" ? (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-xs text-muted-foreground">{t.apiSwaggerFallback}</p>
          <div className="flex gap-2">
            <a href="/api/openapi.json" target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full text-[11px]">
                {t.apiOpenSpec}
              </Button>
            </a>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-full text-[11px]"
              onClick={() => {
                setState("loading");
                window.location.reload();
              }}
            >
              <RefreshCcw className="h-3 w-3" />
              {t.apiRetry}
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative min-h-[420px] bg-background/40">
          {state === "loading" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground">
              <RefreshCcw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {t.apiSwaggerLoading}
            </div>
          )}
          <div id="seph-swagger-root" ref={hostRef} className="swagger-host min-h-[420px] w-full" />
        </div>
      )}
    </div>
  );
}
