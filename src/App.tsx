import { useEffect, useState } from "react";
import { DirectionProvider } from "@radix-ui/react-direction";
import Home from "@/app/page";
import SubscriptionPortalPage from "@/app/sub/[token]/page";
import ApiDocsPage from "@/app/api-docs/page"; // Phase 28 — standalone Swagger UI
import MiniAppPage from "@/app/miniapp/page"; // task 3-2 — Telegram Mini App storefront
import { Toaster } from "@/components/ui/toaster";
import { useAppStore } from "@/lib/store/app-store";
import { RTL_LANGS } from "@/lib/i18n/dictionaries";

export default function App() {
  const [pathname, setPathname] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : "/"
  );

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const isSubRoute = pathname.startsWith("/sub/");
  const isApiDocs = pathname === "/api-docs" || pathname.startsWith("/api-docs/");
  const isMiniApp = pathname === "/miniapp" || pathname.startsWith("/miniapp/"); // task 3-2

  /* Radix direction follows the same source of truth as <html dir>
     (RTL_LANGS ∋ lang in src/app/page.tsx) so every popper-based
     primitive — dropdown/select/popover/sheet/toast — mirrors in RTL. */
  const lang = useAppStore((s) => s.lang);
  const dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";

  return (
    <DirectionProvider dir={dir}>
      {isSubRoute ? (
        <SubscriptionPortalPage />
      ) : isMiniApp ? ( // task 3-2
        <MiniAppPage />
      ) : isApiDocs ? (
        <ApiDocsPage />
      ) : (
        <Home />
      )}
      <Toaster />
    </DirectionProvider>
  );
}
