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
  Palette,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BrandMark, BrandWord } from "@/components/sephiroth/brand";
import { DonateDialog } from "@/components/sephiroth/donate-dialog";
import { useAppStore, type ThemePreset } from "@/lib/store/app-store";
import {
  dictionaries,
  LANGS,
  LANG_META,
  type Lang,
  type ViewId,
} from "@/lib/i18n/dictionaries";
import { useToast } from "@/hooks/use-toast";
import { useIdentity } from "@/components/sephiroth/dashboard/parts";
import { cn } from "@/lib/utils";

const THEME_PRESETS: Array<{ id: ThemePreset; label: string; color: string; sub: string }> = [
  { id: "sephiroth", label: "Sephiroth Cosmic", color: "#22d3ee", sub: "3x-ui + PasarGuard" },
  { id: "jenova", label: "Jenova Violet", color: "#a855f7", sub: "SuperJinX Inspired" },
  { id: "masamune", label: "Masamune Crimson", color: "#f43f5e", sub: "JinX-X4G Blade" },
  { id: "terminal", label: "Matrix Terminal", color: "#10b981", sub: "vodiwalker_kata CLI" },
  { id: "oled", label: "OLED Void Gold", color: "#fbbf24", sub: "NewYork Minimal" },
  { id: "one-winged", label: "One-Winged Angel", color: "#fb923c", sub: "Solar Flare" },
];

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

/* module-level palette openers — lets dashboard quick-actions (mid-row)
   open the ⌘K command palette without adding a global store flag */
const paletteOpeners = new Set<() => void>();
export function openCommandPalette() {
  for (const open of paletteOpeners) open();
}

export function TopNav() {
  const lang = useAppStore((s) => s.lang);
  const view = useAppStore((s) => s.view);
  const role = useAppStore((s) => s.role);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const modules = useAppStore((s) => s.modules);
  const setModules = useAppStore((s) => s.setModules);
  const setLang = useAppStore((s) => s.setLang);
  const setView = useAppStore((s) => s.setView);
  const { toast } = useToast();

  /* donate dialog (top-bar heart) & quick command search */
  const [donateOpen, setDonateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const t = useMemo(() => dictionaries[lang], [lang]);

  /* real signed-in identity (GET /api/profile, shared cache in dashboard/parts)
     — falls back to the translated "Commander" badge while loading / on failure */
  const identity = useIdentity();
  const who = identity ? identity.displayName.trim() || identity.username : t.profile.badge;
  const roleLabel =
    identity?.role === "reseller" ? t.profile.roleReseller : t.profile.roleAdmin;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* register as an opener for the dashboard quick-action button */
  useEffect(() => {
    const open = () => setSearchOpen(true);
    paletteOpeners.add(open);
    return () => {
      paletteOpeners.delete(open);
    };
  }, []);

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

          {/* search (command palette) */}
          <button
            onClick={() => setSearchOpen(true)}
            className="glass hidden h-9 items-center gap-2.5 rounded-full px-3.5 text-sm text-muted-foreground transition-colors hover:text-foreground xl:flex"
            aria-label={t.topbar.search}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">{t.topbar.search}</span>
            <span className="kbd me-1 hidden 2xl:inline-flex">⌘K</span>
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

          {/* 6-theme switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Theme Engine"
              className="glass flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Palette className="h-3.5 w-3.5 text-primary" />
              <span className="hidden sm:inline capitalize">{theme}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass-strong min-w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Theme Engine (6 Presets)
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {THEME_PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onClick={() => setTheme(preset.id)}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className="h-3 w-3 rounded-full ring-1 ring-white/20"
                      style={{ backgroundColor: preset.color }}
                    />
                    <span className="flex flex-col">
                      <span className="text-xs font-medium">{preset.label}</span>
                      <span className="text-[10px] text-muted-foreground">{preset.sub}</span>
                    </span>
                  </span>
                  {theme === preset.id && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

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
              <span className="absolute end-2 top-2 h-1.5 w-1.5 rounded-full bg-primary glow-cyan" />
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
                  {who.charAt(0).toUpperCase()}
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-semibold">{who}</span>
                  <span className="block text-[11px] text-muted-foreground">{roleLabel}</span>
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
                <CircleUser className="ms-2 h-4 w-4" /> {t.topbar.profile}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setView("settings")}>
                <Settings className="ms-2 h-4 w-4" /> {t.topbar.accountSettings}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-destructive">
                <LogOut className="ms-2 h-4 w-4" /> {t.topbar.signOut}
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

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="glass-strong max-w-md border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Search className="h-4 w-4 text-primary" />
              {t.topbar.search}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Jump to workspace, theme, or module…"
              className="glass border-white/10"
              aria-label={t.topbar.search}
            />
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {navIds
                .filter((id) => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase();
                  return id.includes(q) || (t.nav[id] ?? id).toLowerCase().includes(q);
                })
                .map((id) => {
                  const Icon = NAV_ICONS[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setView(id);
                        setSearchOpen(false);
                        setSearchQuery("");
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-xs transition-colors hover:bg-primary/15"
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="font-medium">{t.nav[id]}</span>
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        /{id}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
