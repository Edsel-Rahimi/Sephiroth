import { useEffect, useState } from "react";
import Home from "@/app/page";
import SubscriptionPortalPage from "@/app/sub/[token]/page";
import { Toaster } from "@/components/ui/toaster";

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

  return (
    <>
      {isSubRoute ? <SubscriptionPortalPage /> : <Home />}
      <Toaster />
    </>
  );
}
