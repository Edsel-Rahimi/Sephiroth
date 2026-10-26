"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FlaskConical,
  Github,
  Play,
  Sparkles,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { REF_PANELS } from "@/lib/reference-panels";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Panel Lab — the six reference panels from the
   original research, "virtually" on display: verified GitHub
   repos, hotlinked hero screenshots (where the projects ship
   them) and stylized mini-mock visuals where they don't.
   Switch between them with the filter chips; open the detail
   viewer for the big picture. Recreations for research only.
   ============================================================ */

type PanelId = "3x" | "pg" | "sj" | "ny" | "jx" | "vw";

interface PanelMeta {
  id: PanelId;
  /** id of the deployed instance in reference-panels.ts */
  liveId: string;
  name: string;
  tagline: Record<string, string>;
  repo: string;
  stars: string;
  stack: string;
  accent: string; // tailwind text color class for name
  ring: string; // tailwind ring class
  glow: string; // tailwind shadow class for hover
  images: string[];
  mock: "ny" | "vw" | null;
  bullets: [string, string, string];
}

const IMG = {
  overview: "https://raw.githubusercontent.com/MHSanaei/3x-ui/main/media/01-overview-light.png",
  addInbound: "https://raw.githubusercontent.com/MHSanaei/3x-ui/main/media/02-add-inbound-light.png",
  dark3x: "https://raw.githubusercontent.com/MHSanaei/3x-ui/main/media/3x-ui-dark.png",
  pgShot: "https://raw.githubusercontent.com/PasarGuard/PasarGuard.github.io/main/public/logos/screenshot.png",
  pgBlack: "https://raw.githubusercontent.com/PasarGuard/PasarGuard.github.io/main/public/logos/PasarGuard-black-logo.png",
  pgWhite: "https://raw.githubusercontent.com/PasarGuard/PasarGuard.github.io/main/public/logos/PasarGuard-white-logo.png",
  sjPass: "https://raw.githubusercontent.com/x4gpanell/SuperJinX/main/preview.png",
  jxSub: "https://raw.githubusercontent.com/x4gpanell/JinX-X4G/main/preview-sub.png",
};

const PANELS: PanelMeta[] = [
  {
    id: "3x",
    liveId: "3xui",
    name: "3x-ui",
    tagline: { en: "The mature backbone", fa: "ستون فقرات بالغ", ar: "العمود الفقري الناضج", zh: "成熟的主干", tr: "Olgun omurga", ru: "Зрелый фундамент" },
    repo: "https://github.com/MHSanaei/3x-ui",
    stars: "48.5k",
    stack: "Go · Vue",
    accent: "text-chart-2",
    ring: "ring-chart-2/30",
    glow: "hover:shadow-chart-2/20",
    images: [IMG.overview, IMG.addInbound, IMG.dark3x],
    mock: null,
    bullets: ["i3x1", "i3x2", "i3x3"],
  },
  {
    id: "pg",
    liveId: "pasarguard",
    name: "PasarGuard",
    tagline: { en: "The engine", fa: "موتور", ar: "المحرك", zh: "引擎", tr: "Motor", ru: "Двигатель" },
    repo: "https://github.com/PasarGuard/panel",
    stars: "2.8k",
    stack: "Python · React",
    accent: "text-chart-3",
    ring: "ring-chart-3/30",
    glow: "hover:shadow-chart-3/20",
    images: [IMG.pgShot, IMG.pgBlack, IMG.pgWhite],
    mock: null,
    bullets: ["iPg1", "iPg2", "iPg3"],
  },
  {
    id: "sj",
    liveId: "superjinx",
    name: "SuperJinX",
    tagline: { en: "Reseller & pass-card UX", fa: "تجربه ریسلر و پاس کارت", ar: "تجربة الموزع وبطاقة التمرير", zh: "分销与通行卡体验", tr: "Bayi & kart deneyimi", ru: "UX реселлеров и карт" },
    repo: "https://github.com/x4gpanell/SuperJinX",
    stars: "467",
    stack: "PasarGuard · Railway",
    accent: "text-chart-4",
    ring: "ring-chart-4/30",
    glow: "hover:shadow-chart-4/20",
    images: [IMG.sjPass],
    mock: null,
    bullets: ["iSj1", "iSj2", "iSj3"],
  },
  {
    id: "ny",
    liveId: "newyork",
    name: "NewYork · Gateway",
    tagline: { en: "Live limits & sub groups", fa: "محدودیت زنده و گروه‌ها", ar: "حدود حية ومجموعات", zh: "实时限制与分组", tr: "Canlı limitler & gruplar", ru: "Живые лимиты и группы" },
    repo: "https://github.com/x4gpanell/NewYork",
    stars: "1.2k",
    stack: "Python · Railway",
    accent: "text-primary",
    ring: "ring-primary/30",
    glow: "hover:shadow-primary/20",
    images: [],
    mock: "ny",
    bullets: ["iNy1", "iNy2", "iNy3"],
  },
  {
    id: "jx",
    liveId: "jinx-x4g",
    name: "JinX-X4G",
    tagline: { en: "Subscription page delight", fa: "صفحه اشتراک دلپذیر", ar: "بهجة صفحة الاشتراك", zh: "订阅页的愉悦", tr: "Abonelik sayfası zarafeti", ru: "Восторг страницы подписки" },
    repo: "https://github.com/x4gpanell/JinX-X4G",
    stars: "379",
    stack: "3x-ui fork · Railway",
    accent: "text-chart-5",
    ring: "ring-chart-5/30",
    glow: "hover:shadow-chart-5/20",
    images: [IMG.jxSub],
    mock: null,
    bullets: ["iJx1", "iJx2", "iJx3"],
  },
  {
    id: "vw",
    liveId: "vodiwalker",
    name: "VodiWalker Kata",
    tagline: { en: "Sales & bots", fa: "فروش و ربات‌ها", ar: "المبيعات والبوتات", zh: "销售与机器人", tr: "Satış & botlar", ru: "Продажи и боты" },
    repo: "https://github.com/Vodiwalker/vodiwalker_kata",
    stars: "97",
    stack: "FastAPI",
    accent: "text-silver",
    ring: "ring-white/20",
    glow: "hover:shadow-white/10",
    images: [],
    mock: "vw",
    bullets: ["iVw1", "iVw2", "iVw3"],
  },
];

/* ---------- stylized mini-mock visuals (for repos without screenshots) ---------- */

function NewYorkMock() {
  return (
    <div className="flex h-full w-full items-center justify-center gap-6 bg-gradient-to-br from-white/[0.06] to-transparent px-8" aria-hidden="true">
      <div className="flex flex-col gap-2">
        {["bg-chart-3", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-3", "bg-chart-2"].map(
          (c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full", c)} />
              <span
                className="h-1 rounded-full bg-white/15"
                style={{ width: `${28 + ((i * 13) % 22)}px` }}
              />
            </div>
          )
        )}
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="relative flex h-24 w-24 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-primary/15" />
          <span className="orbit-spin absolute inset-0 rounded-full border-t border-primary/50" />
          <span className="font-mono text-2xl font-bold text-primary">NY</span>
        </div>
        <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[9px] text-muted-foreground ring-1 ring-white/10">
          gateway
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {[64, 44, 52, 36].map((h, i) => (
          <span
            key={i}
            className="w-3 rounded-sm bg-primary/40"
            style={{ height: `${h / 4}px` }}
          />
        ))}
      </div>
    </div>
  );
}

function VodiWalkerMock() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-white/[0.06] to-transparent px-8" aria-hidden="true">
      <div className="flex items-center gap-2">
        {["1 Mo", "3 Mo", "12 Mo"].map((p) => (
          <span
            key={p}
            className="rounded-lg bg-white/[0.05] px-3 py-2 text-center ring-1 ring-white/10"
          >
            <span className="block font-mono text-[10px] font-bold text-silver">{p}</span>
            <span className="mt-1 block h-1 w-10 rounded-full bg-primary/30" />
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-chart-3" />
        <span className="font-mono text-[9px] tracking-widest text-muted-foreground">TELEGRAM · BOT</span>
      </div>
      <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[9px] text-muted-foreground ring-1 ring-white/10">
        kata
      </span>
    </div>
  );
}

function PanelVisual({ panel, large = false }: { panel: PanelMeta; large?: boolean }) {
  const deployed = REF_PANELS.find((p) => p.id === panel.liveId);
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden border-b border-white/5 bg-black/40",
        large ? "h-64 md:h-80" : "h-44"
      )}
    >
      {deployed?.status === "running" && (
        <span className="absolute start-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-chart-3/30 bg-black/60 px-2.5 py-1 font-mono text-[9px] font-bold tracking-[0.14em] text-chart-3 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-chart-3" />
          LIVE
        </span>
      )}
      {panel.images.length > 0 ? (
        <div className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto">
          {panel.images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`${panel.name} screenshot ${i + 1}`}
              loading="lazy"
              className="h-full w-full shrink-0 snap-center object-cover object-top"
            />
          ))}
        </div>
      ) : panel.mock === "ny" ? (
        <NewYorkMock />
      ) : (
        <VodiWalkerMock />
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background/80 to-transparent"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />
    </div>
  );
}

/* ============================================================ */

export function PanelsView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const [filter, setFilter] = useState<"all" | PanelId>("all");
  const [detail, setDetail] = useState<PanelMeta | null>(null);
  const [live, setLive] = useState<PanelMeta | null>(null);

  const liveOf = (panel: PanelMeta) => REF_PANELS.find((p) => p.id === panel.liveId);

  /* ESC closes the live viewer */
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live]);

  const visible = useMemo(
    () => (filter === "all" ? PANELS : PANELS.filter((p) => p.id === filter)),
    [filter]
  );

  const stealText = (key: string): string =>
    (t.panelLab as unknown as Record<string, string>)[key] ?? key;

  return (
    <div className="space-y-6">
      {/* ── header ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 end-0 h-72 w-72 rounded-full bg-primary/10 blur-[100px]"
        />
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-primary">
          <FlaskConical className="h-3 w-3" />
          {t.panelLab.badge}
        </span>
        <h1 className="text-silver mt-3 text-2xl font-bold md:text-3xl">{t.panelLab.title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t.panelLab.subtitle}
        </p>
        <p className="glass mt-3 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          {t.panelLab.hint}
        </p>
        <p className="glass mt-3 ms-2 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] text-chart-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-chart-3" />
          {t.panelLab.plLiveHint}
        </p>
      </div>

      {/* ── switcher chips ─────────────────────────────────── */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t.panelLab.title}>
        <button
          onClick={() => setFilter("all")}
          aria-pressed={filter === "all"}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[12px] font-medium transition-all",
            filter === "all"
              ? "border-primary/40 bg-primary/12 text-primary"
              : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/20 hover:text-foreground"
          )}
        >
          {t.panelLab.all}
          <span className="font-mono text-[10px] opacity-70">{PANELS.length}</span>
        </button>
        {PANELS.map((p) => (
          <button
            key={p.id}
            onClick={() => setFilter(p.id)}
            aria-pressed={filter === p.id}
            className={cn(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[12px] font-medium transition-all",
              filter === p.id
                ? "border-primary/40 bg-primary/12 text-primary"
                : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/20 hover:text-foreground"
            )}
          >
            {p.name}
            <span className="font-mono text-[10px] opacity-70">{p.stars}</span>
          </button>
        ))}
      </div>

      {/* ── gallery ────────────────────────────────────────── */}
      <div className={cn("grid gap-5", filter === "all" ? "md:grid-cols-2 xl:grid-cols-3" : "max-w-3xl")}>
        {visible.map((panel) => (
          <article
            key={panel.id}
            className={cn(
              "glass fade-up group flex flex-col overflow-hidden rounded-2xl transition-shadow hover:shadow-xl",
              panel.glow
            )}
          >
            <PanelVisual panel={panel} />

            <div className="flex flex-1 flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className={cn("truncate text-sm font-bold", panel.accent)}>{panel.name}</h3>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {panel.tagline[lang] ?? panel.tagline.en}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    <Star className="h-3 w-3 fill-current text-primary/80" />
                    {panel.stars}
                  </span>
                  <span className="font-mono text-[9px] tracking-wider text-muted-foreground/70">
                    {panel.stack}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 border-t border-white/5 pt-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {t.panelLab.stealTitle}
                </p>
                {panel.bullets.map((key) => (
                  <p key={key} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
                    {stealText(key)}
                  </p>
                ))}
              </div>

              <div className="mt-auto flex items-center gap-2 pt-2">
                {liveOf(panel)?.status === "running" && (
                  <Button
                    size="sm"
                    onClick={() => setLive(panel)}
                    className="glow-cyan h-8 flex-1 gap-1.5 rounded-full px-3 text-[11px] font-semibold"
                  >
                    <Play className="h-3 w-3" />
                    {t.panelLab.plOpenLive}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDetail(panel)}
                  className={cn(
                    "h-8 gap-1.5 rounded-full border-white/10 bg-white/[0.03] text-[11px] hover:bg-white/[0.06]",
                    liveOf(panel)?.status === "running" ? "shrink-0" : "flex-1"
                  )}
                >
                  <ExternalLink className="h-3 w-3" />
                  {t.panelLab.inspect}
                </Button>
                <a
                  href={panel.repo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "glass flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] text-muted-foreground transition-colors hover:text-foreground",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  )}
                  aria-label={`${panel.name} GitHub`}
                >
                  <Github className="h-3 w-3" />
                  {t.panelLab.openRepo}
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>

      <p className="text-center text-[11px] text-muted-foreground/70">{t.panelLab.disclaimer}</p>

      {/* ── detail viewer ──────────────────────────────────── */}
      <Dialog open={detail !== null} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="glass-strong max-h-[88vh] overflow-y-auto border-white/10 p-0 sm:max-w-2xl">
          {detail && (
            <>
              <PanelVisual panel={detail} large />
              <DialogHeader className="px-6 pt-4 text-start">
                <DialogTitle className={cn("text-lg font-bold", detail.accent)}>
                  {detail.name}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {detail.tagline[lang] ?? detail.tagline.en} · {detail.stack} ·{" "}
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Star className="h-3 w-3 fill-current text-primary/80" />
                    {detail.stars}
                  </span>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 px-6 pb-6">
                <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    {t.panelLab.stealTitle}
                  </p>
                  {detail.bullets.map((key) => (
                    <p key={key} className="flex items-start gap-2 text-xs leading-relaxed">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                      <span className="text-foreground/90">{stealText(key)}</span>
                    </p>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {liveOf(detail)?.status === "running" && (
                    <Button
                      onClick={() => {
                        setDetail(null);
                        setLive(detail);
                      }}
                      className="glow-cyan h-9 gap-2 rounded-full px-4 text-xs font-semibold"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {t.panelLab.plOpenLive}
                    </Button>
                  )}
                  <a
                    href={detail.repo}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-primary/15 text-xs font-semibold text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/25"
                  >
                    <Github className="h-3.5 w-3.5" />
                    {detail.repo.replace("https://github.com/", "")}
                  </a>
                  <Button
                    variant="outline"
                    onClick={() => setDetail(null)}
                    className="h-9 rounded-full border-white/10 bg-white/[0.03] text-xs hover:bg-white/[0.06]"
                  >
                    {t.inbounds.cancel}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/60">{t.panelLab.disclaimer}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── live viewer: the REAL deployed panel, embedded ── */}
      {live &&
        (() => {
          const info = liveOf(live);
          if (!info) return null;
          const statusCls =
            info.status === "running"
              ? "border-chart-3/30 bg-chart-3/10 text-chart-3"
              : info.status === "partial"
                ? "border-chart-4/30 bg-chart-4/10 text-chart-4"
                : "border-chart-5/30 bg-chart-5/10 text-chart-5";
          return (
            <div className="fixed inset-0 z-[90] flex flex-col bg-background">
              <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/50 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
                <span className={cn("text-sm font-bold", live.accent)}>{live.name}</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider",
                    statusCls
                  )}
                >
                  {info.status === "running" ? "LIVE" : info.status.toUpperCase()}
                </span>
                <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-muted-foreground sm:inline">
                  {t.panelLab.plCreds}: {info.creds}
                </span>
                <span className="hidden font-mono text-[10px] text-muted-foreground/60 md:inline">
                  {info.version} · :{info.port}
                </span>
                <div className="ms-auto flex items-center gap-2">
                  <a
                    href={info.entry}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t.panelLab.plNewTab}
                  </a>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLive(null)}
                    className="h-8 gap-1.5 rounded-full border-white/10 bg-white/[0.03] text-[11px] hover:bg-white/[0.06]"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t.panelLab.plBack}
                  </Button>
                </div>
              </header>
              <iframe
                src={info.entry}
                title={`${live.name} — live panel`}
                className="min-h-0 w-full flex-1 border-0 bg-[#0a0e13]"
                allow="clipboard-write"
              />
            </div>
          );
        })()}
    </div>
  );
}
