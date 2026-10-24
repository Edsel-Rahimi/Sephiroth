"use client";

import { useEffect, useSyncExternalStore } from "react";
import { TopNav } from "@/components/sephiroth/top-nav";
import { Footer } from "@/components/sephiroth/footer";
import { Splash } from "@/components/sephiroth/splash";
import { Starfield } from "@/components/sephiroth/starfield";
import { DashboardView } from "@/components/sephiroth/views/dashboard-view";
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

  /* apply language + direction to <html> */
  useEffect(() => {
    if (!mounted) return;
    const dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }, [mounted, lang]);

  if (!mounted) return <Splash />;

  return (
    <div className="bg-cosmic flex min-h-screen flex-col">
      <Starfield />
      <TopNav />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-12 pt-4 md:px-6 md:pt-6">
        {view === "dashboard" ? (
          <DashboardView />
        ) : (
          <PlaceholderView view={view as Exclude<ViewId, "dashboard">} />
        )}
      </main>

      <Footer />
    </div>
  );
}
