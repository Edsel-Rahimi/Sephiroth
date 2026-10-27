"use client";

import { useMemo } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Boxes,
  CircleUser,
  FlaskConical,
  GraduationCap,
  Network,
  RadioTower,
  Route,
  Server,
  Settings,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries, type ViewId } from "@/lib/i18n/dictionaries";

const PHASE_MAP: Record<Exclude<ViewId, "dashboard">, { phase: number; icon: LucideIcon }> = {
  inbounds: { phase: 3, icon: RadioTower },
  hosts: { phase: 8, icon: Network },
  nodes: { phase: 8, icon: Server },
  outbounds: { phase: 8, icon: ArrowRightLeft },
  routing: { phase: 8, icon: Route },
  users: { phase: 4, icon: Users },
  subgroups: { phase: 5, icon: Boxes },
  resellers: { phase: 6, icon: Store },
  activity: { phase: 8, icon: Activity },
  guide: { phase: 8, icon: GraduationCap },
  settings: { phase: 7, icon: Settings },
  panels: { phase: 9, icon: FlaskConical },
  profile: { phase: 8, icon: CircleUser },
};

export function PlaceholderView({ view }: { view: Exclude<ViewId, "dashboard"> }) {
  const lang = useAppStore((s) => s.lang);
  const setView = useAppStore((s) => s.setView);
  const dict = useMemo(() => dictionaries[lang], [lang]);
  const { phase, icon: Icon } = PHASE_MAP[view];
  const isRtl = lang === "fa" || lang === "ar";
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div className="relative flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      {/* orbital decoration */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[380px] w-[380px] rounded-full border border-primary/8" />
        <div className="absolute h-[260px] w-[260px] rounded-full border border-primary/12" />
        <div className="absolute h-[260px] w-[260px] orbit-spin rounded-full border-t border-primary/40" />
      </div>

      <div className="glass hover-glow relative z-10 flex max-w-lg flex-col items-center rounded-3xl px-8 py-10 md:px-12">
        <span className="glass glow-cyan mb-6 flex h-16 w-16 items-center justify-center rounded-2xl">
          <Icon className="h-7 w-7 text-primary" />
        </span>

        <span className="mb-3 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-primary">
          {dict.placeholder.coming.replace("{phase}", String(phase))}
        </span>

        <h2 className="text-silver text-xl font-bold md:text-2xl">{dict.nav[view]}</h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {dict.placeholder.bodies[view]}
        </p>

        <Button
          variant="outline"
          onClick={() => setView("dashboard")}
          className="mt-8 gap-2 rounded-full border-border bg-white/4 hover:bg-white/8"
        >
          <BackIcon className="h-4 w-4" />
          {dict.common.backToDash}
        </Button>
      </div>
    </div>
  );
}
