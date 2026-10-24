"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { TopNav } from "@/components/sephiroth/top-nav";
import { Footer } from "@/components/sephiroth/footer";
import { Splash } from "@/components/sephiroth/splash";
import { Starfield } from "@/components/sephiroth/starfield";
import { LoginScene } from "@/components/sephiroth/login-scene";
import { CoreConnector } from "@/components/sephiroth/realtime/core-connector";
import { DashboardView } from "@/components/sephiroth/views/dashboard-view";
import { InboundsView } from "@/components/sephiroth/views/inbounds-view";
import { PlaceholderView } from "@/components/sephiroth/views/placeholder-view";
import { useAppStore } from "@/lib/store/app-store";
import { RTL_LANGS, type ViewId } from "@/lib/i18n/dictionaries";

const emptySubscribe = () => () => {};

export default function Home() {
  /* rehydrate gate — avoids SSR/localStorage mismatch */
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const lang = useAppStore((s) => s.lang);
  const view = useAppStore((s) => s.view);

  /* phase 1 — server-backed session gate (null = checking) */
  const [authed, setAuthed] = useState<boolean | null>(null);

  /* apply language + direction to <html> */
  useEffect(() => {
    if (!mounted) return;
    const dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }, [mounted, lang]);

  /* verify session cookie against the API once mounted */
  useEffect(() => {
    if (!mounted) return;
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d: { authenticated?: boolean }) => {
        if (alive) setAuthed(Boolean(d.authenticated));
      })
      .catch(() => {
        if (alive) setAuthed(false);
      });
    return () => {
      alive = false;
    };
  }, [mounted]);

  if (!mounted || authed === null) return <Splash />;

  /* not signed in → cosmic login terminal */
  if (!authed) {
    return (
      <LoginScene
        onSuccess={() => {
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <div className="bg-cosmic flex min-h-screen flex-col">
      <Starfield />
      <CoreConnector />
      <TopNav />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-12 pt-4 md:px-6 md:pt-6">
        {view === "dashboard" ? (
          <DashboardView />
        ) : view === "inbounds" ? (
          <InboundsView />
        ) : (
          <PlaceholderView view={view as Exclude<ViewId, "dashboard" | "inbounds">} />
        )}
      </main>

      <Footer />
    </div>
  );
}
