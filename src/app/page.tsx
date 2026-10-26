"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { TopNav } from "@/components/sephiroth/top-nav";
import { Footer } from "@/components/sephiroth/footer";
import { Splash } from "@/components/sephiroth/splash";
import { Starfield } from "@/components/sephiroth/starfield";
import { LoginScene } from "@/components/sephiroth/login-scene";
import { CoreConnector } from "@/components/sephiroth/realtime/core-connector";
import { DashboardView } from "@/components/sephiroth/views/dashboard-view";
import { InboundsView } from "@/components/sephiroth/views/inbounds-view";
import { HostsView } from "@/components/sephiroth/views/hosts-view";
import { NodesView } from "@/components/sephiroth/views/nodes-view";
import { OutboundsView } from "@/components/sephiroth/views/outbounds-view";
import { RoutingView } from "@/components/sephiroth/views/routing-view";
import { UsersView } from "@/components/sephiroth/views/users-view";
import { SubGroupsView } from "@/components/sephiroth/views/subgroups-view";
import { ResellersView } from "@/components/sephiroth/views/resellers-view";
import { ActivityView } from "@/components/sephiroth/views/activity-view";
import { GuideView } from "@/components/sephiroth/views/guide-view";
import { SettingsView } from "@/components/sephiroth/views/settings-view";
import { ProfileView } from "@/components/sephiroth/views/profile-view";
import { PanelsView } from "@/components/sephiroth/views/panels-view";
import { PlaceholderView } from "@/components/sephiroth/views/placeholder-view";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils";
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
  const role = useAppStore((s) => s.role);
  const setRole = useAppStore((s) => s.setRole);
  const starfield = useAppStore((s) => s.starfield);
  const glow = useAppStore((s) => s.glow);
  const reduceMotion = useAppStore((s) => s.reduceMotion);

  /* phase 1 — server-backed session gate (null = checking) */
  const [authed, setAuthed] = useState<boolean | null>(null);

  /* apply language + direction to <html> */
  useEffect(() => {
    if (!mounted) return;
    const dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }, [mounted, lang]);

  /* verify session cookie against the API — sets authed + role.
     Runs on mount and after every successful login. */
  const refreshSession = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/session", { cache: "no-store" });
      const d = (await r.json()) as { authenticated?: boolean; role?: string };
      const ok = Boolean(d.authenticated);
      setAuthed(ok);
      const nextRole = ok && d.role === "reseller" ? "reseller" : "admin";
      setRole(nextRole);
      /* resellers land on their only workspace */
      if (ok && nextRole === "reseller" && useAppStore.getState().view !== "users") {
        useAppStore.getState().setView("users");
      }
    } catch {
      setAuthed(false);
    }
  }, [setRole]);

  useEffect(() => {
    if (!mounted) return;
    let alive = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { authenticated?: boolean; role?: string }) => {
        if (!alive) return;
        const ok = Boolean(d.authenticated);
        setAuthed(ok);
        const nextRole = ok && d.role === "reseller" ? "reseller" : "admin";
        setRole(nextRole);
        if (ok && nextRole === "reseller" && useAppStore.getState().view !== "users") {
          useAppStore.getState().setView("users");
        }
      })
      .catch(() => {
        if (alive) setAuthed(false);
      });
    return () => {
      alive = false;
    };
  }, [mounted, setRole]);

  if (!mounted || authed === null) return <Splash />;

  /* not signed in → cosmic login terminal */
  if (!authed) {
    return (
      <LoginScene
        onSuccess={() => {
          void refreshSession();
        }}
      />
    );
  }

  /* render-level role guard — resellers only ever see their users */
  const effectiveView: ViewId = role === "reseller" && view !== "users" ? "users" : view;

  return (
    <div
      className={cn(
        "bg-cosmic flex min-h-screen flex-col",
        glow === "soft" && "glow-soft",
        glow === "off" && "glow-off",
        reduceMotion && "reduce-motion"
      )}
    >
      {starfield && <Starfield />}
      <CoreConnector />
      <TopNav />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-12 pt-4 md:px-6 md:pt-6">
        {role === "reseller" ? (
          <UsersView />
        ) : effectiveView === "dashboard" ? (
          <DashboardView />
        ) : effectiveView === "inbounds" ? (
          <InboundsView />
        ) : effectiveView === "hosts" ? (
          <HostsView />
        ) : effectiveView === "nodes" ? (
          <NodesView />
        ) : effectiveView === "outbounds" ? (
          <OutboundsView />
        ) : effectiveView === "routing" ? (
          <RoutingView />
        ) : effectiveView === "users" ? (
          <UsersView />
        ) : effectiveView === "subgroups" ? (
          <SubGroupsView />
        ) : effectiveView === "resellers" ? (
          <ResellersView />
        ) : effectiveView === "activity" ? (
          <ActivityView />
        ) : effectiveView === "guide" ? (
          <GuideView />
        ) : effectiveView === "settings" ? (
          <SettingsView />
        ) : effectiveView === "profile" ? (
          <ProfileView />
        ) : effectiveView === "panels" ? (
          <PanelsView />
        ) : (
          <PlaceholderView
            view={effectiveView as Exclude<
              ViewId,
              | "dashboard"
              | "inbounds"
              | "hosts"
              | "nodes"
              | "outbounds"
              | "routing"
              | "users"
              | "subgroups"
              | "resellers"
              | "activity"
              | "guide"
              | "settings"
              | "profile"
              | "panels"
            >}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}
