"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRightLeft,
  Bell,
  Check,
  CircleUser,
  FlaskConical,
  GraduationCap,
  Globe,
  Heart,
  LayoutDashboard,
  LogOut,
  Network,
  RadioTower,
  Route,
  Search,
  Server,
  Settings,
  Store,
  Users,
  Boxes,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark, BrandWord } from "@/components/sephiroth/brand";
import { DonateDialog } from "@/components/sephiroth/donate-dialog";
import { useAppStore } from "@/lib/store/app-store";
import {
  dictionaries,
  LANGS,
  LANG_META,
  type Lang,
  type ViewId,
} from "@/lib/i18n/dictionaries";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<ViewId, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  inbounds: RadioTower,
  hosts: Network,
  nodes: Server,
  outbounds: ArrowRightLeft,
  routing: Route,
  users: Users,
  subgroups: Boxes,
  resellers: Store,
  activity: Activity,
  guide: GraduationCap,
  settings: Settings,
  panels: FlaskConical,
  profile: CircleUser,
};

const NAV_ORDER: ViewId[] = [
  "dashboard",
  "inbounds",
  "hosts",
  "nodes",
  "outbounds",
  "routing",
  "users",
  "subgroups",
  "resellers",
  "activity",
  "guide",
  "settings",
  "panels",
];

/* sections governed by Settings → Top-Bar Modules */
const MODULE_VIEWS = new Set<ViewId>(["hosts", "nodes", "outbounds", "routing"]);

export function TopNav() {
  const lang = useAppStore((s) => s.lang);
  const view = useAppStore((s) => s.view);
  const role = useAppStore((s) => s.role);
  const modules = useAppStore((s) => s.modules);
  const setModules = useAppStore((s) => s.setModules);
  const setLang = useAppStore((s) => s.setLang);
  const setView = useAppStore((s) => s.setView);
  const { toast } = useToast();

  /* donate dialog (top-bar heart) */
  const [donateOpen, setDonateOpen] = useState(false);

  const t = useMemo(() => dictionaries[lang], [lang]);

  /* Phase 8 — pull module visibility from the server (admin only) */
  useEffect(() => {
    if (role !== "admin") return;
    let alive = true;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { nav?: typeof modules } | null) => {
        if (alive && d?.nav) setModules(d.nav);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [role, setModules]);

  /* Phase 6 — resellers only get their users workspace */
  const navIds = useMemo<ViewId[]>(() => {
    if (role === "reseller") return ["users"];
    return NAV_ORDER.filter((id) => !MODULE_VIEWS.has(id) || modules[id as keyof typeof modules]);
  }, [role, modules]);

  const soon = () =>
    toast({
      title: t.common.soon,
      description: t.common.soonDesc,
    });

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* cookie cleared server-side even on network hiccup */
    }
    toast({ title: t.auth.loggedOutToast });
    setTimeout(() => window.location.reload(), 350);
  };

  return (
    <header className="sticky top-0 z-40">
      <div className="glass-strong border-x-0 border-t-0">
        {/* ── row 1 : brand · actions ─────────────────────────── */}
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-2 px-4 md:gap-3 md:px-6">
          {/* brand */}
          <button
            onClick={() => setView(role === "reseller" ? "users" : "dashboard")}
            className="flex items-center gap-3 rounded-xl px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Sephiroth home"
          >
            <BrandMark size={38} />
            <BrandWord tagline={t.brand.tagline} className="hidden sm:block" />
            {role === "reseller" && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary ring-1 ring-primary/30">
                {t.resellers.modeBadge}
              </span>
            )}
          </button>

          <div className="flex-1" />

          {/* live status chip */}
          <div
            className="glass hidden h-9 items-center gap-2 rounded-full px-3 text-xs text-muted-foreground lg:flex"
            title={t.status.online}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="font-mono tracking-wide">{t.status.simulator}</span>
            <span className="text-emerald-400">· {t.status.online}</span>
          </div>

          {/* search (visual) */}
          <button
            onClick={soon}
            className="glass hidden h-9 items-center gap-2.5 rounded-full px-3.5 text-sm text-muted-foreground transition-colors hover:text-foreground xl:flex"
            aria-label={t.topbar.search}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">{t.topbar.search}</span>
            <span className="kbd ml-1 hidden 2xl:inline-flex">⌘K</span>
          </button>

          {/* donate */}
          <button
            type="button"
            onClick={() => setDonateOpen(true)}
            aria-label={t.donate.title}
            title={t.donate.title}
            className="glass relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-all hover:text-rose-400 hover:shadow-[0_0_18px_-4px_rgba(251,113,133,0.55)] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Heart className="h-4 w-4" />
            <span
              aria-hidden="true"
              className="absolute end-2 top-2 h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400"
            />
          </button>

          {/* language */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t.common.language}
              className="glass flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Globe className="h-3.5 w-3.5" />
              {LANG_META[lang].code}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass-strong min-w-44">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t.common.language}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {LANGS.map((l: Lang) => (
                <DropdownMenuItem
                  key={l}
                  onClick={() => setLang(l)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[10px] text-muted-foreground">
                      {LANG_META[l].code}
                    </span>
                    <span>{LANG_META[l].native}</span>
                  </span>
                  {l === lang && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t.topbar.notifications}
              className="glass relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary glow-cyan" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass-strong w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t.topbar.notifications}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t.topbar.caughtUp}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* account */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t.topbar.profile}
              className="outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
            >
              <span className="glass flex h-9 w-9 items-center justify-center rounded-full text-primary transition-shadow hover:glow-cyan">
                <CircleUser className="h-4.5 w-4.5" />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass-strong w-52">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-chart-2/10 font-mono text-sm font-bold text-primary ring-1 ring-primary/30">
                  S
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-semibold">Commander</span>
                  <span className="block text-[11px] text-muted-foreground">admin@sephiroth</span>
                </span>
              </div>
              {role === "reseller" && (
                <div className="px-3 pb-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary ring-1 ring-primary/30">
                    <Store className="h-3 w-3" /> {t.resellers.modeBadge}
                  </span>
                </div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setView("profile")}>
                <CircleUser className="mr-2 h-4 w-4" /> {t.topbar.profile}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setView("settings")}>
                <Settings className="mr-2 h-4 w-4" /> {t.topbar.accountSettings}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> {t.topbar.signOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── row 2 : orbital navigation ──────────────────────── */}
        <nav
          aria-label="Primary"
          className="mx-auto max-w-[1440px] px-4 pb-2.5 md:px-6"
        >
          <ul
            className={cn(
              "orbit-pill glass no-scrollbar flex list-none items-center gap-1 overflow-x-auto rounded-full p-1.5",
              "lg:mx-auto lg:w-fit"
            )}
          >
            {navIds.map((id) => {
              const Icon = NAV_ICONS[id];
              const active = view === id;
              return (
                <li key={id} className="relative shrink-0">
                  <button
                    onClick={() => setView(id)}
                    aria-current={active ? "page" : undefined}
                    title={t.nav[id]}
                    className={cn(
                      "flex h-9 min-w-9 items-center justify-center gap-2 rounded-full px-3 text-[13px] font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring md:px-4",
                      active
                        ? "bg-gradient-to-br from-primary/20 to-primary/5 text-foreground glow-cyan"
                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    )}
                  >
                    <Icon
                      className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "opacity-70")}
                    />
                    <span className="hidden whitespace-nowrap xl:inline">{t.nav[id]}</span>
                  </button>
                  {active && <span className="orbit-dot" aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* orbital hairline under header */}
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />

      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
    </header>
  );
}
