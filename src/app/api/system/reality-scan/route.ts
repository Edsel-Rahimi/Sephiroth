import { NextResponse } from "next/server";
import { requireAdmin, toDTO, type InboundDTO } from "@/lib/inbounds";
import { db } from "@/lib/db";
import tls from "node:tls";
import http2 from "node:http2";

/* ============================================================
   Sephiroth · v2.7 — REALITY Target Scanner (admin)
   POST /api/system/reality-scan  { targets?: string[], timeoutMs?,
                                    withSuggestions? }   (task 2-c)
   GET  /api/system/reality-scan?withSuggestions=1&targets=a,b

   Probes candidate camouflage destinations for Xray REALITY and
   grades them with the classic scanner heuristics:

     • TLS 1.3 handshake          (mandatory for REALITY)
     • ALPN negotiates h2         (mandatory)
     • valid public certificate   (self-signed = bad)
     • serves HTTP/2 without redirecting to HTTP
     • low round-trip latency     (nice to have)

   Returns a sorted score list the admin can pick a `dest` from.
   Additive (task 2-c): when withSuggestions is set, the response
   also carries `suggestions` — existing REALITY inbounds whose
   current dest/SNI probed degraded, each with better-scoring
   candidate targets for a one-click SNI rotation. No secrets.
   Safety rails: admin-only, ≤ 30 targets, ≤ 6s per target,
   concurrency pool of 6, no host resolves to a private range.
   ============================================================ */

interface ScanResult {
  target: string;
  /** v2.7 task 2-c — bare hostname (label without the :port suffix). */
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
  verdict: "good" | "warn" | "bad";
  reason: string;
}

/* v2.7 task 2-c — SNI rotation suggestion for an existing REALITY inbound
   whose current dest/SNI probed degraded. Carries NO secrets (never the
   inbound's privateKey/publicKey — only the two public-facing fields). */
export interface RotationSuggestion {
  inboundId: string;
  inboundTag: string;
  currentDest: string;
  currentSni: string;
  reason: "low-score" | "slow" | "redirect";
  score: number | null;
  rttMs: number | null;
  candidateTargets: string[];
}

/* Degradation thresholds (mirrors the dialog's own RTT/verdict tones).
   warn/bad verdict ⇒ score < 85; rose RTT ⇒ > 600ms. */
const SNI_LOW_SCORE = 85;
const SNI_SLOW_RTT_MS = 600;
const SNI_CANDIDATES = 3;

/** Well-known TLS 1.3 + h2 friendly destinations (classic REALITY seeds). */
const PRESET_TARGETS = [
  "www.microsoft.com",
  "www.samsung.com",
  "www.lovelive-anime.jp",
  "www.nvidia.com",
  "www.amd.com",
  "www.cisco.com",
  "www.java.com",
  "www.icloud.com",
  "www.speedtest.net",
  "cdn.jsdelivr.net",
  "www.bing.com",
  "www.mozilla.org",
];

const PER_TARGET_TIMEOUT_MS = 6_000;
const CONCURRENCY = 6;

function isPrivateHost(host: string): boolean {
  // block obvious internal ranges — the scanner is for public dests only
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$)/i.test(host)) return true;
  const m = /^172\.(\d+)\./.exec(host);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

function normalizeTarget(raw: string): { host: string; port: number } | null {
  let v = raw.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const host = v.split(":")[0]!;
  const port = Number(v.split(":")[1] ?? 443);
  if (!/^[a-z0-9.-]{4,253}$/.test(host) || !host.includes(".")) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (isPrivateHost(host)) return null;
  return { host, port };
}

interface TlsProbe {
  reachable: boolean;
  tls: string | null;
  alpn: string | null;
  rttMs: number | null;
  certOk: boolean;
  issuer: string | null;
  error?: string;
}

function probeTls(host: string, port: number, timeoutMs: number): Promise<TlsProbe> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const done = (r: TlsProbe) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      resolve(r);
    };
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        ALPNProtocols: ["h2", "http/1.1"],
        rejectUnauthorized: false, // we GRADE the cert, we don't enforce it
      },
      () => {
        const cert = socket.getPeerCertificate();
        const issuerRaw = cert?.issuer?.O ?? cert?.issuer?.CN ?? null;
        done({
          reachable: true,
          tls: socket.getProtocol(),
          alpn: socket.alpnProtocol || null,
          rttMs: Date.now() - started,
          certOk: socket.authorized === true,
          issuer: Array.isArray(issuerRaw) ? (issuerRaw[0] ?? null) : issuerRaw,
        });
      }
    );
    socket.setTimeout(timeoutMs, () => done({ reachable: false, tls: null, alpn: null, rttMs: null, certOk: false, issuer: null, error: "timeout" }));
    socket.on("error", (err) =>
      done({ reachable: false, tls: null, alpn: null, rttMs: null, certOk: false, issuer: null, error: String(err.message ?? err).slice(0, 120) })
    );
  });
}

/** Optional HTTP/2 probe — confirms the dest really answers on h2. */
function probeHttp2(host: string, timeoutMs: number): Promise<{ http2: boolean; status: number | null; redirectedToHttp: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { http2: boolean; status: number | null; redirectedToHttp: boolean }) => {
      if (settled) return;
      settled = true;
      try {
        session?.destroy();
      } catch {
        /* noop */
      }
      resolve(r);
    };
    let session: http2.ClientHttp2Session | null = null;
    try {
      session = http2.connect(`https://${host}`, { settings: { enablePush: false } });
      session.setTimeout(timeoutMs, () => done({ http2: false, status: null, redirectedToHttp: false }));
      session.on("error", () => done({ http2: false, status: null, redirectedToHttp: false }));
      const req = session.request({ ":method": "HEAD", ":path": "/", ":authority": host });
      req.setTimeout(timeoutMs, () => done({ http2: false, status: null, redirectedToHttp: false }));
      req.on("response", (headers) => {
        const status = Number(headers[":status"] ?? 0);
        const location = String(headers.location ?? "");
        done({
          http2: true,
          status,
          redirectedToHttp: /^http:\/\//i.test(location),
        });
      });
      req.on("error", () => done({ http2: false, status: null, redirectedToHttp: false }));
      req.end();
    } catch {
      done({ http2: false, status: null, redirectedToHttp: false });
    }
  });
}

async function scanOne(target: string, timeoutMs: number): Promise<ScanResult> {
  const parsed = normalizeTarget(target);
  const label = parsed ? `${parsed.host}${parsed.port !== 443 ? `:${parsed.port}` : ""}` : target.trim();
  const base: ScanResult = {
    target: label,
    host: parsed?.host ?? "",
    reachable: false,
    tls: null,
    alpn: null,
    rttMs: null,
    certOk: false,
    issuer: null,
    http2: false,
    httpStatus: null,
    redirectedToHttp: false,
    score: 0,
    verdict: "bad",
    reason: "invalid",
  };
  if (!parsed) return { ...base, reason: "invalid_target" };

  const tlsRes = await probeTls(parsed.host, parsed.port, timeoutMs);
  if (!tlsRes.reachable) {
    return { ...base, reason: tlsRes.error ?? "unreachable" };
  }

  const h2Res = await probeHttp2(parsed.host, Math.min(timeoutMs, 4_000));
  const tls13 = tlsRes.tls === "TLSv1.3";
  const h2 = tlsRes.alpn === "h2" && h2Res.http2;
  const fast = (tlsRes.rttMs ?? 9999) <= 400;

  let score = 0;
  const reasons: string[] = [];
  if (tls13) score += 40;
  else reasons.push("no_tls13");
  if (h2) score += 25;
  else reasons.push("no_h2");
  if (tlsRes.certOk) score += 20;
  else reasons.push("cert_not_verified");
  if (fast) score += 10;
  else reasons.push("slow_rtt");
  if (h2Res.redirectedToHttp) {
    score -= 15;
    reasons.push("redirects_to_http");
  }

  const verdict: ScanResult["verdict"] = score >= 85 ? "good" : score >= 55 ? "warn" : "bad";
  return {
    target: label,
    host: parsed.host,
    reachable: true,
    tls: tlsRes.tls,
    alpn: tlsRes.alpn,
    rttMs: tlsRes.rttMs,
    certOk: tlsRes.certOk,
    issuer: tlsRes.issuer,
    http2: h2Res.http2,
    httpStatus: h2Res.status,
    redirectedToHttp: h2Res.redirectedToHttp,
    score,
    verdict,
    reason: reasons.join(",") || "ok",
  };
}

/* ---------- v2.7 task 2-c — SNI rotation suggestions ---------- */

/** Matches panel REALITY inbounds against live scan results. Read-only:
 *  degrades to [] if the inbound store can't be read (scan still works). */
async function computeSuggestions(results: ScanResult[]): Promise<{
  suggestions: RotationSuggestion[];
  realityInbounds: number;
}> {
  let reality: InboundDTO[];
  try {
    const rows = await db.inbound.findMany();
    reality = rows.map(toDTO).filter((d) => d.security === "reality");
  } catch (err) {
    console.error("[system:reality-scan] suggestions: inbound read failed", err);
    return { suggestions: [], realityInbounds: 0 };
  }
  if (reality.length === 0) return { suggestions: [], realityInbounds: 0 };

  /* results arrive sorted by score desc → first hit per host is the best */
  const byHost = new Map<string, ScanResult>();
  for (const r of results) {
    if (r.reachable && r.host && !byHost.has(r.host)) byHost.set(r.host, r);
  }

  const suggestions: RotationSuggestion[] = [];
  for (const dto of reality) {
    const dest = typeof dto.stream.dest === "string" ? dto.stream.dest : "";
    const sniRaw = typeof dto.stream.serverNames === "string" ? dto.stream.serverNames : "";
    const snis = sniRaw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const destHost = (dest.split(":")[0] ?? "").trim().toLowerCase();
    const matched = [destHost, ...snis]
      .filter(Boolean)
      .map((h) => byHost.get(h))
      .find((r) => r !== undefined);
    if (!matched) continue; // not scanned → no data, no fabricated advice

    const reason: RotationSuggestion["reason"] | null = matched.redirectedToHttp
      ? "redirect"
      : matched.score < SNI_LOW_SCORE
        ? "low-score"
        : (matched.rttMs ?? 0) > SNI_SLOW_RTT_MS
          ? "slow"
          : null;
    if (!reason) continue;

    /* strictly better-scoring reachable targets, best first */
    const candidateTargets = results
      .filter((r) => r.reachable && r.host && r.host !== destHost && !snis.includes(r.host) && r.score > matched.score)
      .slice(0, SNI_CANDIDATES)
      .map((r) => r.target);
    if (candidateTargets.length === 0) continue;

    suggestions.push({
      inboundId: dto.id,
      inboundTag: dto.tag,
      currentDest: dest,
      currentSni: snis[0] ?? destHost,
      reason,
      score: matched.score,
      rttMs: matched.rttMs,
      candidateTargets,
    });
  }
  return { suggestions, realityInbounds: reality.length };
}

/* ---------- shared scan core (POST + GET) ---------- */

interface ScanOutput {
  ok: true;
  scanned: number;
  preset: boolean;
  results: ScanResult[];
  /* task 2-c — present only when the request asks for them */
  suggestions?: RotationSuggestion[];
  realityInbounds?: number;
}

async function runScan(opts: {
  targets: string[];
  timeoutMs: number;
  withSuggestions: boolean;
}): Promise<ScanOutput> {
  const { timeoutMs, withSuggestions } = opts;
  const cleaned = opts.targets.map((t) => t.trim()).filter(Boolean).slice(0, 30);
  const targets = cleaned.length > 0 ? cleaned : PRESET_TARGETS;

  const results: ScanResult[] = [];
  let idx = 0;
  const worker = async () => {
    while (idx < targets.length) {
      const i = idx++;
      results.push(await scanOne(targets[i]!, timeoutMs));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  results.sort((a, x) => x.score - a.score || (a.rttMs ?? 9e9) - (x.rttMs ?? 9e9));

  const out: ScanOutput = {
    ok: true,
    scanned: results.length,
    preset: cleaned.length === 0,
    results,
  };
  if (withSuggestions) {
    const { suggestions, realityInbounds } = await computeSuggestions(results);
    out.suggestions = suggestions;
    out.realityInbounds = realityInbounds;
  }
  return out;
}

function parseTargetsInput(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return String(raw).split(/[\n,;]+/);
  return [];
}

const truthy = (v: unknown): boolean => v === true || v === "true" || v === "1" || v === 1;

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      /* empty body → preset list */
    }
    const b = (body ?? {}) as Record<string, unknown>;

    const out = await runScan({
      targets: parseTargetsInput(b.targets),
      timeoutMs: Math.min(Math.max(Number(b.timeoutMs) || PER_TARGET_TIMEOUT_MS, 2_000), 8_000),
      withSuggestions: truthy(b.withSuggestions),
    });
    return NextResponse.json(out);
  } catch (err) {
    console.error("[system:reality-scan]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/* GET variant (task 2-c) — same core, query-string driven:
   /api/system/reality-scan?withSuggestions=1&targets=a.com,b.com&timeoutMs=4000 */
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const q = new URL(req.url).searchParams;
    const out = await runScan({
      targets: parseTargetsInput(q.get("targets") ?? ""),
      timeoutMs: Math.min(Math.max(Number(q.get("timeoutMs")) || PER_TARGET_TIMEOUT_MS, 2_000), 8_000),
      withSuggestions: truthy(q.get("withSuggestions")),
    });
    return NextResponse.json(out);
  } catch (err) {
    console.error("[system:reality-scan]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
