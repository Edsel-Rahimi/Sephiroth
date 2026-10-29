import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Info, Loader2, Radar, RotateCcw, Rocket, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · v2.7 — REALITY Target Scanner dialog (task 2-c)

   POST /api/system/reality-scan { targets: string[], withSuggestions: true }
     → { ok, scanned, preset, results: [{ target, host, reachable, tls,
         alpn, rttMs, certOk, issuer, http2, httpStatus,
         redirectedToHttp, score, verdict, reason }],
         suggestions?: [{ inboundId, inboundTag, currentDest, currentSni,
           reason, score, rttMs, candidateTargets }],
         realityInbounds?: number }

   Empty textarea = server-side preset list. Results come back
   pre-sorted by score desc (server-side); order is kept here.

   task 2-c additions:
   • per-row “Use as REALITY dest” → onPickDest({ dest, serverNames,
     port }) — the parent closes this dialog and opens the New-Inbound
     forge with the REALITY fields prefilled.
   • SNI rotation suggestions for existing REALITY inbounds whose
     dest/SNI probed degraded — one-click Rotate PATCHes the inbound
     via /api/inbounds/:id (same endpoint the edit flow uses).
   ============================================================ */

type ScanVerdict = "good" | "warn" | "bad";
type ToneKey = "good" | "warn" | "bad";

type RotReason = "low-score" | "slow" | "redirect";

/** What the parent forges from a picked scan row (port "" = no hint). */
export interface RealityDestPick {
  dest: string;
  serverNames: string;
  port: string;
}

interface RotationSuggestion {
  inboundId: string;
  inboundTag: string;
  currentDest: string;
  currentSni: string;
  reason: RotReason;
  score: number | null;
  rttMs: number | null;
  candidateTargets: string[];
}

interface RealityScanResult {
  target: string;
  host: string;
  reachable: boolean;
  tls: string | null;
  alpn: string | null;
  rttMs: number | null;
  certOk: boolean;
  issuer: string | null;
  http2: boolean;
  httpStatus: number | null;
  redirectedToHttp: boolean;
  score: number;
  verdict: ScanVerdict;
  reason: string;
}

interface RealityScanResponse {
  ok: boolean;
  scanned: number;
  preset: boolean;
  results: RealityScanResult[];
  suggestions?: RotationSuggestion[];
  realityInbounds?: number;
}

/* Shared chip tones (same palette the panel uses elsewhere). */
const TONE_CHIP: Record<ToneKey, string> = {
  good: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30",
  warn: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30",
  bad: "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30",
};

/* "{ms}ms"-style placeholder interpolation (local, no deps). */
const fmt = (s: string, vars: Record<string, string | number> = {}): string =>
  s.replace(/\{(\w+)\}/g, (_: string, k: string) => String(vars[k] ?? ""));

/* Split the textarea by newlines / commas / semicolons (mirrors the API). */
const parseTargets = (raw: string): string[] =>
  raw
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

const rttToneClass = (ms: number): string =>
  ms <= 200 ? "text-emerald-400" : ms <= 600 ? "text-amber-400" : "text-rose-400";

function Chip({ tone, title, children }: { tone: ToneKey; title?: string; children: ReactNode }) {
  return (
    <Badge
      title={title}
      className={cn(
        "rounded-full border-transparent px-2 py-0.5 font-mono text-[10px] font-semibold",
        TONE_CHIP[tone]
      )}
    >
      {children}
    </Badge>
  );
}

export function RealityScannerDialog({
  open,
  onOpenChange,
  onPickDest,
  onInboundsChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** task 2-c — when provided, each row gets a “Use as REALITY dest” action. */
  onPickDest?: (pick: RealityDestPick) => void;
  /** task 2-c — called after a successful SNI rotation so the parent refetches inbounds. */
  onInboundsChanged?: () => void;
}) {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].scanner;
  const { toast } = useToast();

  const [targets, setTargets] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RealityScanResult[] | null>(null);
  const [scannedCount, setScannedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);
  /* task 2-c — SNI rotation */
  const [suggestions, setSuggestions] = useState<RotationSuggestion[]>([]);
  const [realityInbounds, setRealityInbounds] = useState<number | null>(null);
  const [rotPick, setRotPick] = useState<Record<string, string>>({});
  const [rotConfirmFor, setRotConfirmFor] = useState<RotationSuggestion | null>(null);
  const [rotBusy, setRotBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsedTargets = parseTargets(targets);
  const isPreset = parsedTargets.length === 0;

  /* Fresh state on (re)open; abort an in-flight scan when it closes. */
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setRunning(false);
      return;
    }
    setTargets("");
    setRunning(false);
    setResults(null);
    setScannedCount(0);
    setError(null);
    setCopiedTarget(null);
    setSuggestions([]);
    setRealityInbounds(null);
    setRotPick({});
    setRotConfirmFor(null);
    setRotBusy(false);
  }, [open]);

  /* Cleanup timers + in-flight request on unmount. */
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const runScan = async () => {
    if (running) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/system/reality-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targets: parsedTargets, withSuggestions: true }),
        signal: ac.signal,
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: unknown };
          if (typeof j?.error === "string" && j.error) detail = j.error;
        } catch {
          /* non-JSON error body — keep the HTTP status */
        }
        throw new Error(detail);
      }
      const data = (await res.json()) as RealityScanResponse;
      if (ac.signal.aborted) return;
      const rows = Array.isArray(data.results) ? data.results : [];
      setResults(rows);
      setScannedCount(typeof data.scanned === "number" ? data.scanned : rows.length);
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      setRealityInbounds(typeof data.realityInbounds === "number" ? data.realityInbounds : null);
    } catch (err) {
      if (ac.signal.aborted) return;
      setResults(null);
      setScannedCount(0);
      setSuggestions([]);
      setRealityInbounds(null);
      setError(err instanceof Error && err.message ? err.message : String(err));
    } finally {
      if (!ac.signal.aborted) setRunning(false);
    }
  };

  const copyTarget = async (target: string) => {
    try {
      await navigator.clipboard.writeText(target);
      setCopiedTarget(target);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedTarget(null), 1500);
    } catch {
      /* clipboard unavailable (permissions / insecure context) — silent no-op */
    }
  };

  /* ── task 2-c — pick a scanned row as the forge's REALITY dest ── */
  const pickDest = (r: RealityScanResult) => {
    if (!onPickDest) return;
    const host = (r.host || r.target.split(":")[0] || r.target).trim();
    const portSuffix = r.target.includes(":") ? r.target.slice(r.target.indexOf(":") + 1) : "";
    onPickDest({
      dest: r.reachable && portSuffix && portSuffix !== "443" ? `${host}:${portSuffix}` : host,
      serverNames: host,
      port: r.reachable ? "443" : "", // hint only — parent falls back to a free port
    });
    onOpenChange(false);
  };

  /* ── task 2-c — SNI rotation: PATCH stream.dest/serverNames via the
     same /api/inbounds/:id endpoint the edit flow uses. The full stream
     object travels along (patch mode replaces streamJson wholesale). ── */
  const rotateSni = async () => {
    const sug = rotConfirmFor;
    if (!sug || rotBusy) return;
    const candidate = rotPick[sug.inboundId] ?? sug.candidateTargets[0] ?? "";
    if (!candidate) {
      toast({ title: fmt(fx.rotFail, { detail: "no_candidate" }), variant: "destructive" });
      return;
    }
    setRotBusy(true);
    try {
      const listRes = await fetch("/api/inbounds", { cache: "no-store" });
      if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
      const list = (await listRes.json()) as {
        inbounds?: Array<{ id: string; stream: Record<string, string | number | boolean> }>;
      };
      const inbound = (list.inbounds ?? []).find((x) => x.id === sug.inboundId);
      if (!inbound) throw new Error("inbound_not_found");

      const host = candidate.includes(":") ? candidate.slice(0, candidate.indexOf(":")) : candidate;
      const res = await fetch(`/api/inbounds/${sug.inboundId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: { ...inbound.stream, dest: candidate, serverNames: host },
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof j.error === "string" && j.error ? j.error : `HTTP ${res.status}`);
      }
      toast({ title: fmt(fx.rotOk, { tag: sug.inboundTag, dest: candidate }) });
      setSuggestions((prev) => prev.filter((s) => s.inboundId !== sug.inboundId));
      setRotConfirmFor(null);
      onInboundsChanged?.();
    } catch (err) {
      toast({
        title: fmt(fx.rotFail, {
          detail: err instanceof Error && err.message ? err.message : String(err),
        }),
        variant: "destructive",
      });
    } finally {
      setRotBusy(false);
    }
  };

  const rotReasonLabel = (reason: RotReason): string =>
    reason === "low-score" ? fx.rotReasonLowScore : reason === "slow" ? fx.rotReasonSlow : fx.rotReasonRedirect;
  const rotReasonTone = (reason: RotReason): ToneKey => (reason === "redirect" ? "bad" : "warn");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-h-[92dvh] overflow-y-auto border-white/10 p-0 sm:max-w-3xl">
        {/* ── header ── */}
        <DialogHeader className="border-b border-white/5 px-5 py-4 text-start">
          <DialogTitle className="flex items-center gap-3 text-silver">
            <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <Radar className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-base">{fx.title}</span>
              <DialogDescription className="mt-0.5 block text-[11px] font-normal leading-relaxed text-muted-foreground">
                {fx.desc}
              </DialogDescription>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 pb-5">
          {/* ── targets input ── */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="reality-scan-targets"
                className="text-xs font-bold text-muted-foreground"
              >
                {fx.targets}
              </label>
              <Badge
                className={cn(
                  "rounded-full border-transparent px-2 py-0.5 text-[10px] font-semibold",
                  isPreset
                    ? "bg-white/5 text-muted-foreground ring-1 ring-white/10"
                    : "bg-primary/10 text-primary ring-1 ring-primary/30"
                )}
              >
                {isPreset ? fx.presetBadge : fx.customBadge}
              </Badge>
            </div>
            <Textarea
              id="reality-scan-targets"
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              placeholder={fx.targetsPh}
              rows={4}
              dir="ltr"
              spellCheck={false}
              disabled={running}
              className="min-h-[104px] font-mono text-xs leading-relaxed"
            />
          </div>

          {/* ── actions ── */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void runScan()}
              disabled={running}
              className="min-w-32 gap-2 rounded-full text-xs font-bold"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Radar className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {running ? fx.running : fx.run}
            </Button>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="rounded-full text-xs text-muted-foreground"
            >
              {fx.close}
            </Button>
          </div>

          {/* ── error ── */}
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-300 ring-1 ring-rose-500/25"
            >
              {fmt(fx.errorRun, { detail: error })}
            </p>
          )}

          {/* ── results ── */}
          {running ? (
            /* Honest loading state — pulsing placeholders, no fake data. */
            <div
              className="max-h-[50vh] space-y-2.5 overflow-y-auto rounded-xl bg-black/30 p-3.5 ring-1 ring-white/10"
              role="status"
              aria-label={fx.running}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-3 w-40 shrink-0" />
                  <Skeleton className="h-3 w-12 shrink-0" />
                  <Skeleton className="h-3 w-12 shrink-0" />
                  <Skeleton className="h-3 w-14 shrink-0" />
                  <Skeleton className="h-3 w-14 shrink-0" />
                  <Skeleton className="h-3 w-10 shrink-0" />
                  <Skeleton className="ms-auto h-3 w-14 shrink-0" />
                </div>
              ))}
            </div>
          ) : results && results.length > 0 ? (
            <>
              <p role="status" className="text-xs font-semibold text-foreground">
                {fmt(fx.scanned, { n: scannedCount })}
              </p>
              <div className="max-h-[50vh] overflow-y-auto rounded-xl bg-black/30 ring-1 ring-white/10">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="h-8 px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {fx.colTarget}
                      </TableHead>
                      <TableHead className="h-8 px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {fx.colTls}
                      </TableHead>
                      <TableHead className="h-8 px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {fx.colAlpn}
                      </TableHead>
                      <TableHead className="h-8 px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {fx.colRtt}
                      </TableHead>
                      <TableHead className="h-8 px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {fx.colCert}
                      </TableHead>
                      <TableHead className="h-8 px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {fx.colScore}
                      </TableHead>
                      <TableHead className="h-8 px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {fx.colVerdict}
                      </TableHead>
                      {onPickDest && (
                        <TableHead className="h-8 px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <span className="sr-only">{fx.useAsDest}</span>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, i) => (
                      <TableRow key={`${i}:${r.target}`} className="border-white/5">
                        <TableCell className="px-2.5 py-2">
                          <span className="flex max-w-[260px] items-center gap-1.5">
                            <span
                              dir="ltr"
                              title={r.target}
                              className="truncate font-mono text-[11px] text-foreground/90"
                            >
                              {r.target}
                            </span>
                            <button
                              type="button"
                              onClick={() => void copyTarget(r.target)}
                              aria-label={r.target}
                              title={r.target}
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                              {copiedTarget === r.target ? (
                                <Check
                                  className="h-3 w-3 text-emerald-400"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Copy className="h-3 w-3" aria-hidden="true" />
                              )}
                            </button>
                          </span>
                        </TableCell>
                        <TableCell className="px-2.5 py-2">
                          {r.tls ? (
                            <Chip tone={r.tls === "TLSv1.3" ? "good" : "warn"}>{r.tls}</Chip>
                          ) : (
                            <Chip tone="bad">—</Chip>
                          )}
                        </TableCell>
                        <TableCell className="px-2.5 py-2">
                          {r.alpn ? (
                            <Chip tone={r.alpn === "h2" ? "good" : "warn"}>{r.alpn}</Chip>
                          ) : (
                            <Chip tone="bad">—</Chip>
                          )}
                        </TableCell>
                        <TableCell className="px-2.5 py-2">
                          {r.rttMs === null ? (
                            <span className="font-mono text-[11px] text-muted-foreground">—</span>
                          ) : (
                            <span
                              dir="ltr"
                              className={cn(
                                "font-mono text-[11px] font-semibold",
                                rttToneClass(r.rttMs)
                              )}
                            >
                              {fmt(fx.rttUnit, { ms: r.rttMs })}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-2.5 py-2">
                          <Chip tone={r.certOk ? "good" : "bad"}>
                            {r.certOk ? fx.certOk : fx.certBad}
                          </Chip>
                        </TableCell>
                        <TableCell className="px-2.5 py-2">
                          <span
                            dir="ltr"
                            className="font-mono text-[11px] font-semibold text-foreground"
                          >
                            {r.score}
                            <span className="text-[9px] font-normal text-muted-foreground">
                              /100
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="px-2.5 py-2">
                          <Chip tone={r.verdict} title={r.reason}>
                            {r.verdict === "good"
                              ? fx.verdictGood
                              : r.verdict === "warn"
                                ? fx.verdictWarn
                                : fx.verdictBad}
                          </Chip>
                        </TableCell>
                        {onPickDest && (
                          <TableCell className="px-2.5 py-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => pickDest(r)}
                              disabled={running}
                              aria-label={fx.useAsDest}
                              title={fx.useAsDest}
                              className="h-7 w-7 gap-1 rounded-full border-emerald-400/30 bg-emerald-400/[0.08] p-0 text-emerald-300 hover:bg-emerald-400/[0.16]"
                            >
                              <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="rounded-xl bg-black/20 px-3 py-6 text-center text-xs text-muted-foreground ring-1 ring-white/5">
              {fx.empty}
            </p>
          )}

          {/* ── task 2-c — SNI rotation suggestions ── */}
          {!running && suggestions.length > 0 && (
            <section
              aria-label={fx.rotTitle}
              className="glass space-y-3 rounded-2xl p-3.5 ring-1 ring-amber-500/20"
            >
              <p className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {fx.rotTitle}
              </p>
              {suggestions.map((s) => {
                const selected = rotPick[s.inboundId] ?? s.candidateTargets[0] ?? "";
                return (
                  <div
                    key={s.inboundId}
                    className="space-y-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        dir="ltr"
                        className="min-w-0 truncate font-mono text-[12px] font-bold text-foreground"
                        title={s.inboundTag}
                      >
                        {s.inboundTag}
                      </span>
                      <Chip tone={rotReasonTone(s.reason)}>{rotReasonLabel(s.reason)}</Chip>
                      {s.score !== null && (
                        <span
                          dir="ltr"
                          className="font-mono text-[10px] font-semibold text-muted-foreground"
                        >
                          {s.score}/100
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRotConfirmFor(s)}
                        disabled={rotBusy || !selected}
                        className="ms-auto h-8 gap-1.5 rounded-full border-amber-500/40 bg-amber-500/10 px-3 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        {fx.rotRotate}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-semibold text-foreground/80">
                        {fmt(fx.rotCurrent, { sni: s.currentSni })}
                      </span>
                      {s.currentDest && (
                        <span dir="ltr" className="ms-1.5 font-mono text-[10px] text-muted-foreground/80">
                          ({s.currentDest})
                        </span>
                      )}
                    </p>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {fx.rotCandidate}
                      </p>
                      <div
                        className="flex flex-wrap gap-1.5"
                        role="group"
                        aria-label={fx.rotCandidate}
                      >
                        {s.candidateTargets.map((c) => {
                          const active = selected === c;
                          return (
                            <button
                              key={c}
                              type="button"
                              dir="ltr"
                              aria-pressed={active}
                              title={c}
                              onClick={() => setRotPick((prev) => ({ ...prev, [s.inboundId]: c }))}
                              className={cn(
                                "max-w-[220px] truncate rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold transition-colors",
                                active
                                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                                  : "bg-white/5 text-muted-foreground ring-1 ring-white/10 hover:bg-white/10 hover:text-foreground"
                              )}
                            >
                              {c}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* healthy REALITY fleet → quiet all-clear line (no noise when none exist) */}
          {!running &&
            suggestions.length === 0 &&
            results !== null &&
            realityInbounds !== null &&
            realityInbounds > 0 && (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-500/[0.06] px-3 py-2 text-[11px] text-emerald-300/90 ring-1 ring-emerald-500/20">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {fx.rotNone}
              </p>
            )}
        </div>

        {/* ── footer tip ── */}
        <p className="flex items-start gap-2 border-t border-white/5 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
          <span>{fx.tip}</span>
        </p>

        {/* ── task 2-c — rotate confirmation (before → after) ── */}
        <AlertDialog
          open={rotConfirmFor !== null}
          onOpenChange={(v) => {
            if (!v && !rotBusy) setRotConfirmFor(null);
          }}
        >
          <AlertDialogContent className="glass-strong max-w-md border-white/10">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-start text-silver">
                {rotConfirmFor ? fmt(fx.rotConfirm, { tag: rotConfirmFor.inboundTag }) : ""}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-start">
                  {rotConfirmFor && (
                    <>
                      <div className="rounded-xl bg-rose-500/[0.07] px-3 py-2 ring-1 ring-rose-500/20">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300/80">
                          {fx.rotBefore}
                        </p>
                        <p dir="ltr" className="mt-0.5 truncate font-mono text-[11px] text-foreground/90">
                          {rotConfirmFor.currentDest || rotConfirmFor.currentSni}
                        </p>
                        <p dir="ltr" className="truncate font-mono text-[10px] text-muted-foreground">
                          {rotConfirmFor.currentSni}
                        </p>
                      </div>
                      <div className="rounded-xl bg-emerald-500/[0.07] px-3 py-2 ring-1 ring-emerald-500/20">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
                          {fx.rotAfter}
                        </p>
                        <p dir="ltr" className="mt-0.5 truncate font-mono text-[11px] text-foreground/90">
                          {rotPick[rotConfirmFor.inboundId] ?? rotConfirmFor.candidateTargets[0] ?? "—"}
                        </p>
                        <p dir="ltr" className="truncate font-mono text-[10px] text-muted-foreground">
                          {(rotPick[rotConfirmFor.inboundId] ?? rotConfirmFor.candidateTargets[0] ?? "").split(":")[0]}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={rotBusy}
                className="rounded-full border-white/10 bg-white/[0.03]"
              >
                {fx.close}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={rotBusy}
                onClick={(e) => {
                  e.preventDefault(); // keep the dialog open while PATCH runs
                  void rotateSni();
                }}
                className="rounded-full bg-amber-500/90 font-bold text-black hover:bg-amber-400"
              >
                {rotBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {rotBusy ? fx.rotRotating : fx.rotRotate}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
