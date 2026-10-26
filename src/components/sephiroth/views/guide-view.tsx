"use client";

import { useMemo } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  BookOpen,
  Boxes,
  Braces,
  ChevronLeft,
  ChevronRight,
  CircleUser,
  Compass,
  FlaskConical,
  LayoutDashboard,
  Lightbulb,
  Network,
  RadioTower,
  Route,
  Server,
  Settings,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries, type Dict, type ViewId } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 8 — Guide (field manual)
   A friendly, jargon-free walkthrough of every orbit tab:
   hero → golden-path stepper → per-view decoder cards → glossary.
   Pure i18n (t.guide.*), RTL-aware, zero API surface.
============================================================ */

type GuideKey = keyof Dict["guide"];

/* ---------- golden path: 5 numbered steps, each jumps to its view ---------- */

interface StepEntry {
  textKey: GuideKey;
  view: ViewId;
}

const STEPS: readonly StepEntry[] = [
  { textKey: "step1", view: "inbounds" },
  { textKey: "step2", view: "users" },
  { textKey: "step3", view: "subgroups" },
  { textKey: "step4", view: "hosts" },
  { textKey: "step5", view: "activity" },
];

/* ---------- 13 view decoder cards, in narrative order ---------- */

interface ViewEntry {
  id: ViewId;
  icon: LucideIcon;
  titleKey: GuideKey;
  whatKey: GuideKey;
  doKey: GuideKey;
  fieldsKey?: GuideKey;
}

const VIEW_ORDER: readonly ViewEntry[] = [
  {
    id: "dashboard",
    icon: LayoutDashboard,
    titleKey: "vDashboard",
    whatKey: "vDashboardWhat",
    doKey: "vDashboardDo",
  },
  {
    id: "inbounds",
    icon: RadioTower,
    titleKey: "vInbounds",
    whatKey: "vInboundsWhat",
    doKey: "vInboundsDo",
    fieldsKey: "vInboundsFields",
  },
  {
    id: "users",
    icon: Users,
    titleKey: "vUsers",
    whatKey: "vUsersWhat",
    doKey: "vUsersDo",
    fieldsKey: "vUsersFields",
  },
  {
    id: "subgroups",
    icon: Boxes,
    titleKey: "vSubgroups",
    whatKey: "vSubgroupsWhat",
    doKey: "vSubgroupsDo",
  },
  {
    id: "resellers",
    icon: Store,
    titleKey: "vResellers",
    whatKey: "vResellersWhat",
    doKey: "vResellersDo",
  },
  {
    id: "hosts",
    icon: Network,
    titleKey: "vHosts",
    whatKey: "vHostsWhat",
    doKey: "vHostsDo",
    fieldsKey: "vHostsFields",
  },
  {
    id: "nodes",
    icon: Server,
    titleKey: "vNodes",
    whatKey: "vNodesWhat",
    doKey: "vNodesDo",
  },
  {
    id: "outbounds",
    icon: ArrowRightLeft,
    titleKey: "vOutbounds",
    whatKey: "vOutboundsWhat",
    doKey: "vOutboundsDo",
  },
  {
    id: "routing",
    icon: Route,
    titleKey: "vRouting",
    whatKey: "vRoutingWhat",
    doKey: "vRoutingDo",
  },
  {
    id: "activity",
    icon: Activity,
    titleKey: "vActivity",
    whatKey: "vActivityWhat",
    doKey: "vActivityDo",
  },
  {
    id: "settings",
    icon: Settings,
    titleKey: "vSettings",
    whatKey: "vSettingsWhat",
    doKey: "vSettingsDo",
  },
  {
    id: "profile",
    icon: CircleUser,
    titleKey: "vProfile",
    whatKey: "vProfileWhat",
    doKey: "vProfileDo",
  },
  {
    id: "panels",
    icon: FlaskConical,
    titleKey: "vPanels",
    whatKey: "vPanelsWhat",
    doKey: "vPanelsDo",
  },
];

/* ---------- plain-language glossary ---------- */

const GLOSSARY: readonly { termKey: GuideKey; descKey: GuideKey }[] = [
  { termKey: "tVpn", descKey: "tVpnD" },
  { termKey: "tXray", descKey: "tXrayD" },
  { termKey: "tInbound", descKey: "tInboundD" },
  { termKey: "tOutbound", descKey: "tOutboundD" },
  { termKey: "tRouting", descKey: "tRoutingD" },
  { termKey: "tHost", descKey: "tHostD" },
  { termKey: "tNode", descKey: "tNodeD" },
  { termKey: "tSni", descKey: "tSniD" },
  { termKey: "tTls", descKey: "tTlsD" },
  { termKey: "tReality", descKey: "tRealityD" },
  { termKey: "tTransport", descKey: "tTransportD" },
  { termKey: "tSub", descKey: "tSubD" },
  { termKey: "tFlow", descKey: "tFlowD" },
  { termKey: "tGeo", descKey: "tGeoD" },
];

export function GuideView() {
  const lang = useAppStore((s) => s.lang);
  const setView = useAppStore((s) => s.setView);
  const t = useMemo(() => dictionaries[lang], [lang]);

  /* RTL: flip direction arrows for fa / ar */
  const isRtl = lang === "fa" || lang === "ar";
  const OpenIcon = isRtl ? ArrowLeft : ArrowRight;
  const StepChevron = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="fade-up space-y-10 md:space-y-14">
      {/* ════════════════ hero ════════════════ */}
      <header className="flex flex-col items-center gap-4 py-8 text-center md:py-14">
        <Badge
          variant="outline"
          className="glass rounded-full border-primary/30 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-primary"
        >
          {t.guide.badge}
        </Badge>
        <h1 className="text-silver max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">
          {t.guide.title}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
          {t.guide.subtitle}
        </p>
        <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
          {t.guide.readTime}
        </span>
      </header>

      {/* ════════════════ golden path ════════════════ */}
      <section
        aria-labelledby="guide-golden-path"
        className="glass-strong glow-cyan rounded-2xl p-5 md:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <Compass className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="guide-golden-path"
              className="text-base font-bold text-foreground md:text-lg"
            >
              {t.guide.startHere}
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground md:text-sm">
              {t.guide.startDesc}
            </p>
          </div>
        </div>

        <Separator className="my-5 bg-white/[0.06]" />

        <ol className="grid list-none grid-cols-1 gap-3 md:grid-cols-5 md:gap-2">
          {STEPS.map((step, i) => {
            const stepText = t.guide[step.textKey];
            const last = i === STEPS.length - 1;
            /* mobile: vertical connecting line between numbered circles */
            const connector = last
              ? undefined
              : "before:absolute before:start-[26px] before:top-11 before:bottom-[-14px] before:w-px before:bg-gradient-to-b before:from-primary/40 before:to-primary/0 md:before:hidden";
            return (
              <li key={step.textKey} className={cn("relative", connector)}>
                <button
                  type="button"
                  onClick={() => setView(step.view)}
                  aria-label={`${t.guide.startHere}: ${stepText}`}
                  className="hover-glow group h-full w-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-start outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring md:p-3.5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/50 bg-primary/10 text-[11px] font-bold text-primary shadow-[0_0_10px_-3px_rgba(34,216,238,0.55)]">
                    {i + 1}
                  </span>
                  <span className="mt-2.5 block text-[12.5px] leading-relaxed text-muted-foreground transition-colors group-hover:text-foreground">
                    {stepText}
                  </span>
                </button>
                {/* desktop: chevron pointing to the next step */}
                {!last && (
                  <StepChevron
                    aria-hidden="true"
                    className="pointer-events-none absolute -end-2.5 top-5 z-10 hidden h-4 w-4 text-primary/60 md:block"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* ════════════════ view decoder cards ════════════════ */}
      <section aria-label={t.guide.title}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
          {VIEW_ORDER.map((v) => {
            const Icon = v.icon;
            return (
              <Card
                key={v.id}
                className="glass hover-glow group gap-4 rounded-2xl border-white/10 p-5 shadow-none md:p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="glass glow-cyan flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                    <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <h3 className="text-silver text-base font-bold tracking-tight md:text-lg">
                    {t.guide[v.titleKey]}
                  </h3>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                    {t.guide.whatLabel}
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t.guide[v.whatKey]}
                  </p>
                </div>

                <div className="space-y-2 rounded-e-xl border-s-2 border-primary/40 bg-primary/[0.05] py-2.5 pe-3 ps-3.5">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-primary/80">
                    <Lightbulb className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {t.guide.doLabel}
                  </p>
                  <p className="text-[13px] leading-relaxed text-foreground/85">
                    {t.guide[v.doKey]}
                  </p>
                </div>

                {v.fieldsKey ? (
                  <div className="space-y-2 rounded-xl bg-black/25 p-3.5 ring-1 ring-white/[0.07]">
                    <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-primary/70">
                      <Braces className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {t.guide.fieldsLabel}
                    </p>
                    <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {t.guide[v.fieldsKey]}
                    </p>
                  </div>
                ) : null}

                <div className="mt-auto flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setView(v.id)}
                    aria-label={`${t.guide.openView}: ${t.guide[v.titleKey]}`}
                    className="gap-1.5 rounded-full border-white/10 bg-white/[0.03] px-4 text-xs hover:bg-primary/10 hover:text-primary"
                  >
                    {t.guide.openView}
                    <OpenIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ════════════════ glossary ════════════════ */}
      <section aria-labelledby="guide-glossary" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="guide-glossary"
            className="text-silver text-xl font-bold tracking-tight md:text-2xl"
          >
            {t.guide.glossaryTitle}
          </h2>
          <p className="text-sm text-muted-foreground">{t.guide.glossaryDesc}</p>
        </div>

        <div className="glass rounded-2xl p-4 md:p-6">
          <Accordion type="single" collapsible className="w-full">
            {GLOSSARY.map((g) => {
              const term = t.guide[g.termKey];
              /* canonical English keyword as a mono chip — searchable in any UI language */
              const enTerm = dictionaries.en.guide[g.termKey];
              return (
                <AccordionItem
                  key={g.termKey}
                  value={`term-${g.termKey}`}
                  className="border-white/[0.07]"
                >
                  <AccordionTrigger className="gap-3 py-4 hover:no-underline [&>svg]:text-primary/60">
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-start">
                      <span className="text-sm font-bold text-foreground">{term}</span>
                      <Badge
                        variant="outline"
                        className="rounded-md border-white/10 bg-white/[0.04] px-2 py-0 font-mono text-[10px] font-medium text-muted-foreground"
                      >
                        {enTerm}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                      {t.guide[g.descKey]}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      </section>
    </div>
  );
}
