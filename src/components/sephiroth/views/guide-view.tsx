"use client";

import { useMemo, useRef, useState } from "react";
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
  Clock,
  Compass,
  CornerDownLeft,
  CornerDownRight,
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
import { Separator } from "@/components/ui/separator";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries, type Dict, type ViewId } from "@/lib/i18n/dictionaries";
import { guideLessons, type LessonViewId } from "@/lib/i18n/guide-detail";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 8 — Guide (chapter field manual, Task 14-b)
   hero → golden-path stepper → chapter navigator (rail / chips)
   with complete per-view lessons (headline · what · when · every
   field · steps · pro tips) → glossary.
   Lesson copy lives in lib/i18n/guide-detail.ts (13 × 6 langs);
   UI labels come from t.guideLesson.*. RTL-aware, zero API.
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

/* ---------- 13 chapters, in narrative order ---------- */

interface ChapterEntry {
  id: LessonViewId;
  icon: LucideIcon;
  titleKey: GuideKey;
}

const CHAPTERS: readonly ChapterEntry[] = [
  { id: "dashboard", icon: LayoutDashboard, titleKey: "vDashboard" },
  { id: "inbounds", icon: RadioTower, titleKey: "vInbounds" },
  { id: "users", icon: Users, titleKey: "vUsers" },
  { id: "subgroups", icon: Boxes, titleKey: "vSubgroups" },
  { id: "resellers", icon: Store, titleKey: "vResellers" },
  { id: "hosts", icon: Network, titleKey: "vHosts" },
  { id: "nodes", icon: Server, titleKey: "vNodes" },
  { id: "outbounds", icon: ArrowRightLeft, titleKey: "vOutbounds" },
  { id: "routing", icon: Route, titleKey: "vRouting" },
  { id: "activity", icon: Activity, titleKey: "vActivity" },
  { id: "settings", icon: Settings, titleKey: "vSettings" },
  { id: "profile", icon: CircleUser, titleKey: "vProfile" },
  { id: "panels", icon: FlaskConical, titleKey: "vPanels" },
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

/* ---------- technical-token renderer: mono cyan chips for 443, geosite:… ---------- */

const TECH_STOP = new Set(["e.g", "i.e", "etc", "vs", "am", "pm"]);

function looksTech(token: string): boolean {
  const bare = token.replace(/[.,،؛;:!?]+$/u, "").toLowerCase();
  if (TECH_STOP.has(bare)) return false;
  if (/^\d+([.,]\d+)?$/u.test(bare)) return true;
  if (bare.length < 2) return false;
  /* latin-ish token carrying a technical clue: digit, dot, colon, slash, underscore, @ or hyphen */
  return (
    /^[a-z0-9._:/@,-]+$/iu.test(bare) && /[\d.:/_@-]/u.test(bare)
  );
}

function TechText({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) => {
        if (part.trim() === "") return <span key={i}>{part}</span>;
        /* keep trailing punctuation outside the mono chip */
        const m = part.match(/^(.*?)([.,\u060C\u061B;:!?]+)$/u);
        const core = m && m[1] ? m[1] : part;
        const tail = m && m[1] && m[2] ? m[2] : "";
        if (looksTech(core)) {
          return (
            <span key={i} className="whitespace-nowrap">
              <code
                dir="ltr"
                className="mx-0.5 inline-block max-w-full truncate rounded-md bg-primary/10 px-1.5 py-0.5 align-baseline font-mono text-[11px] text-primary"
              >
                {core}
              </code>
              {tail ? <span>{tail}</span> : null}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/* ---------- small labelled heading for lesson subsections ---------- */

function SectionHead({
  id,
  icon: HeadIcon,
  label,
  count,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  count?: number;
}) {
  return (
    <h3
      id={id}
      className="flex items-center gap-2 text-sm font-bold tracking-tight text-foreground md:text-base"
    >
      <span className="glass flex h-7 w-7 items-center justify-center rounded-lg">
        <HeadIcon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
      </span>
      {label}
      {typeof count === "number" ? (
        <Badge
          variant="outline"
          className="ms-1 rounded-full border-white/10 bg-white/[0.04] px-2 py-0 font-mono text-[10px] font-medium text-muted-foreground"
        >
          {count}
        </Badge>
      ) : null}
    </h3>
  );
}

export function GuideView() {
  const lang = useAppStore((s) => s.lang);
  const setView = useAppStore((s) => s.setView);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const gl = t.guideLesson;

  const [activeId, setActiveId] = useState<LessonViewId>("dashboard");
  const lessonRef = useRef<HTMLDivElement | null>(null);

  /* RTL: flip direction arrows for fa / ar */
  const isRtl = lang === "fa" || lang === "ar";
  const OpenIcon = isRtl ? ArrowLeft : ArrowRight;
  const StepChevron = isRtl ? ChevronLeft : ChevronRight;
  const FillArrow = isRtl ? CornerDownLeft : CornerDownRight;
  const PrevChevron = isRtl ? ChevronRight : ChevronLeft;
  const NextChevron = isRtl ? ChevronLeft : ChevronRight;

  const activeIdx = CHAPTERS.findIndex((c) => c.id === activeId);
  const chapter = CHAPTERS[activeIdx] ?? CHAPTERS[0];
  const lesson = guideLessons[lang][activeId];
  const ChapterIcon = chapter.icon;
  const chapterTitle = t.guide[chapter.titleKey];
  const prevChapter = activeIdx > 0 ? CHAPTERS[activeIdx - 1] : undefined;
  const nextChapter =
    activeIdx < CHAPTERS.length - 1 ? CHAPTERS[activeIdx + 1] : undefined;

  const switchChapter = (id: LessonViewId) => {
    setActiveId(id);
    /* on mobile the chips sit above the lesson pane — glide down to it */
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      requestAnimationFrame(() => {
        lessonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

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

      {/* ════════════════ chapter field manual ════════════════ */}
      <section aria-label={gl.chapters} className="space-y-4">
        {/* mobile: horizontal chapter chips */}
        <nav
          aria-label={gl.chapters}
          className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden"
        >
          {CHAPTERS.map((c) => {
            const ChipIcon = c.icon;
            const on = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => switchChapter(c.id)}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "hover-glow flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                  on
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground",
                )}
              >
                <ChipIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {t.guide[c.titleKey]}
              </button>
            );
          })}
        </nav>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-7">
          {/* desktop: sticky chapter rail */}
          <nav
            aria-label={gl.chapters}
            className="glass no-scrollbar hidden flex-col gap-1 self-start overflow-y-auto rounded-2xl p-2.5 lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100vh-6rem)]"
          >
            <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              {gl.chapters}
            </p>
            {CHAPTERS.map((c, i) => {
              const RailIcon = c.icon;
              const on = c.id === activeId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => switchChapter(c.id)}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-start outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                    on
                      ? "glow-cyan border border-primary/30 bg-primary/10"
                      : "border border-transparent hover:bg-white/[0.04]",
                  )}
                >
                  <span className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                    <RailIcon
                      className={cn(
                        "h-4 w-4 transition-colors",
                        on
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                      aria-hidden="true"
                    />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13px] font-semibold transition-colors",
                      on
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    {t.guide[c.titleKey]}
                  </span>
                  <span className="pe-1 font-mono text-[10px] text-muted-foreground/50">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* active lesson pane — key re-triggers the fade-up on switch */}
          <div
            ref={lessonRef}
            aria-labelledby="lesson-chapter-title"
            className="min-w-0 scroll-mt-24"
          >
            <div key={activeId} className="fade-up space-y-5">
              {/* headline banner */}
              <header className="glass-strong glow-cyan rounded-2xl p-5 md:p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="glass flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
                    <ChapterIcon className="h-6 w-6 text-primary" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-primary/80">
                      {gl.chapters} ·{" "}
                      {String(activeIdx + 1).padStart(2, "0")}/
                      {String(CHAPTERS.length).padStart(2, "0")}
                    </p>
                    <h2
                      id="lesson-chapter-title"
                      className="text-silver truncate text-xl font-bold tracking-tight md:text-2xl"
                    >
                      {chapterTitle}
                    </h2>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setView(chapter.id)}
                    aria-label={`${t.guide.openView}: ${chapterTitle}`}
                    className="gap-1.5 rounded-full border-white/10 bg-white/[0.03] px-4 text-xs hover:bg-primary/10 hover:text-primary"
                  >
                    {t.guide.openView}
                    <OpenIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <p className="mt-4 border-s-2 border-primary/40 ps-3.5 text-sm leading-relaxed text-foreground/85 md:text-[15px]">
                  {lesson.headline}
                </p>
              </header>

              {/* what is it / when do I use it */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <article
                  aria-labelledby="lesson-what"
                  className="glass rounded-2xl p-4 md:p-5"
                >
                  <SectionHead
                    id="lesson-what"
                    icon={BookOpen}
                    label={gl.lessonWhat}
                  />
                  <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                    {lesson.what}
                  </p>
                </article>
                <article
                  aria-labelledby="lesson-when"
                  className="glass rounded-2xl p-4 md:p-5"
                >
                  <SectionHead
                    id="lesson-when"
                    icon={Clock}
                    label={gl.lessonWhen}
                  />
                  <p className="mt-3 rounded-xl bg-primary/[0.05] p-3 text-[13.5px] leading-relaxed text-foreground/85 ring-1 ring-primary/15">
                    {lesson.when}
                  </p>
                </article>
              </div>

              {/* every field explained */}
              <section aria-labelledby="lesson-fields" className="space-y-3">
                <SectionHead
                  id="lesson-fields"
                  icon={Braces}
                  label={gl.lessonFields}
                  count={lesson.fields.length}
                />

                {/* md+: semantic table */}
                <div className="glass hidden overflow-hidden rounded-2xl ring-1 ring-white/[0.07] md:block">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-white/[0.04]">
                        <th
                          scope="col"
                          className="w-[24%] px-4 py-3 text-start text-[10px] font-semibold uppercase tracking-widest text-primary/80"
                        >
                          {gl.fieldName}
                        </th>
                        <th
                          scope="col"
                          className="w-[38%] px-4 py-3 text-start text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70"
                        >
                          {gl.fieldWhat}
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-start text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70"
                        >
                          {gl.fieldFill}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lesson.fields.map((f, i) => (
                        <tr
                          key={f.name}
                          className={cn(
                            "border-t border-white/[0.06] transition-colors hover:bg-white/[0.03]",
                            i % 2 === 1 && "bg-white/[0.015]",
                          )}
                        >
                          <th
                            scope="row"
                            className="px-4 py-3.5 align-top text-start text-[13px] font-bold text-foreground"
                          >
                            {f.name}
                          </th>
                          <td className="px-4 py-3.5 align-top text-[12.5px] leading-relaxed text-muted-foreground">
                            {f.what}
                          </td>
                          <td className="px-4 py-3.5 align-top text-[12.5px] leading-relaxed text-foreground/85">
                            <TechText text={f.fill} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* mobile: stacked mini-cards */}
                <ul className="space-y-2.5 md:hidden">
                  {lesson.fields.map((f) => (
                    <li key={f.name} className="glass rounded-xl p-3.5">
                      <p className="text-[13px] font-bold text-foreground">
                        {f.name}
                      </p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                        {f.what}
                      </p>
                      <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-foreground/85">
                        <FillArrow
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70"
                          aria-hidden="true"
                        />
                        <span>
                          <TechText text={f.fill} />
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              {/* step by step */}
              <section aria-labelledby="lesson-steps" className="space-y-3">
                <SectionHead
                  id="lesson-steps"
                  icon={Route}
                  label={gl.lessonSteps}
                  count={lesson.steps.length}
                />
                <ol className="space-y-2.5">
                  {lesson.steps.map((step, i) => (
                    <li
                      key={`${activeId}-step-${i}`}
                      className="glass flex items-start gap-3 rounded-xl p-3.5"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/50 bg-primary/10 text-[11px] font-bold text-primary shadow-[0_0_10px_-3px_rgba(34,216,238,0.55)]">
                        {i + 1}
                      </span>
                      <span className="pt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              {/* pro tips */}
              <section aria-labelledby="lesson-tips" className="space-y-3">
                <SectionHead
                  id="lesson-tips"
                  icon={Lightbulb}
                  label={gl.lessonTips}
                  count={lesson.tips.length}
                />
                <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {lesson.tips.map((tip, i) => (
                    <li
                      key={`${activeId}-tip-${i}`}
                      className="flex items-start gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3.5"
                    >
                      <Lightbulb
                        className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
                        aria-hidden="true"
                      />
                      <span className="text-[12.5px] leading-relaxed text-foreground/85">
                        {tip}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* prev / next chapter */}
              <nav
                aria-label={gl.chapters}
                className="grid grid-cols-2 gap-3 pt-1"
              >
                <button
                  type="button"
                  disabled={!prevChapter}
                  onClick={() => prevChapter && switchChapter(prevChapter.id)}
                  className={cn(
                    "glass hover-glow flex min-w-0 flex-col items-start gap-0.5 rounded-xl border border-white/[0.06] p-3.5 text-start outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                    !prevChapter && "pointer-events-none opacity-40",
                  )}
                >
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                    <PrevChevron className="h-3.5 w-3.5" aria-hidden="true" />
                    {gl.prevCh}
                  </span>
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {prevChapter ? t.guide[prevChapter.titleKey] : "—"}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!nextChapter}
                  onClick={() => nextChapter && switchChapter(nextChapter.id)}
                  className={cn(
                    "glass hover-glow flex min-w-0 flex-col items-end gap-0.5 rounded-xl border border-white/[0.06] p-3.5 text-end outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                    !nextChapter && "pointer-events-none opacity-40",
                  )}
                >
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                    {gl.nextCh}
                    <NextChevron className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {nextChapter ? t.guide[nextChapter.titleKey] : "—"}
                  </span>
                </button>
              </nav>
            </div>
          </div>
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
