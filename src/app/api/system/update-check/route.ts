import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { appVersion, getUpdateSettings } from "@/lib/settings";

/* ============================================================
   Sephiroth · Task 3-c (item 3.6) — release channel check
   GET /api/system/update-check

   Compares the running panel version against the public GitHub
   releases of the repository the installer/Dockerfile reference
   (Edsel-Rahimi/sephiroth — see install.sh REPO_URL and the OCI
   labels in the Dockerfile).

   Channel semantics (settings section `updates`):
   - stable → newest release that is NOT a prerelease;
   - beta   → newest release overall, prereleases included.
   Drafts are never offered on either channel.

   Honest failure mode: a network / GitHub error NEVER throws —
   the response carries `error` alongside the current version so
   the UI can show an offline state. Successful checks are cached
   in memory for 5 minutes (per channel).
   ============================================================ */

const REPO_OWNER = "Edsel-Rahimi";
const REPO_NAME = "Sephiroth";
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=30`;
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60_000;

interface GhRelease {
  tag_name?: unknown;
  name?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  html_url?: unknown;
  published_at?: unknown;
}

export interface UpdateCheckResult {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  channel: "stable" | "beta";
  releaseUrl: string;
  publishedAt: string | null;
  checkedAt: string;
  error?: string;
}

/** 5-minute in-memory cache, keyed by channel (a channel switch
 *  must never be served the other channel's stale answer). */
const gCache = globalThis as unknown as {
  __sephUpdateCheckCache?: Map<string, { at: number; data: UpdateCheckResult }>;
};
const cache: Map<string, { at: number; data: UpdateCheckResult }> =
  gCache.__sephUpdateCheckCache ?? new Map();
gCache.__sephUpdateCheckCache = cache;

/** Same tolerant comparison the /api/system/update-info route uses. */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => Number(x) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

function isErr(e: unknown): e is Error {
  return e instanceof Error;
}

async function fetchLatestRelease(channel: "stable" | "beta", current: string): Promise<UpdateCheckResult> {
  const checkedAt = new Date().toISOString();
  const errShape = (error: string): UpdateCheckResult => ({
    current,
    latest: null,
    updateAvailable: false,
    channel,
    releaseUrl: REPO_URL,
    publishedAt: null,
    checkedAt,
    error,
  });

  let res: Response;
  try {
    res = await fetch(RELEASES_API, {
      headers: {
        "User-Agent": `Sephiroth-Panel/${current} (+${REPO_URL})`, // GitHub requires a UA
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return errShape(isErr(e) && e.name === "TimeoutError" ? "timeout" : "network");
  }

  if (!res.ok) {
    return errShape(`http_${res.status}`);
  }

  let releases: GhRelease[];
  try {
    const raw = await res.json();
    if (!Array.isArray(raw)) return errShape("bad_payload");
    releases = raw as GhRelease[];
  } catch {
    return errShape("bad_payload");
  }

  // GitHub returns newest-first; pick per channel (drafts never offered).
  const candidates = releases.filter((r) => r.draft !== true);
  const chosen =
    channel === "beta"
      ? candidates[0]
      : candidates.find((r) => r.prerelease !== true);

  const tag = typeof chosen?.tag_name === "string" ? normalizeTag(chosen.tag_name) : "";
  if (!tag) {
    return errShape("no_release");
  }

  const latest = tag;
  return {
    current,
    latest,
    updateAvailable: compareSemver(latest, current) > 0,
    channel,
    releaseUrl:
      typeof chosen?.html_url === "string" && chosen.html_url
        ? chosen.html_url
        : `${REPO_URL}/releases`,
    publishedAt:
      typeof chosen?.published_at === "string" && chosen.published_at
        ? chosen.published_at
        : null,
    checkedAt,
  };
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const current = appVersion();
  let channel: "stable" | "beta" = "stable";
  try {
    channel = (await getUpdateSettings()).channel;
  } catch {
    /* keep the stable default */
  }

  const cached = cache.get(channel);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, { headers: { "cache-control": "no-store" } });
  }

  const result = await fetchLatestRelease(channel, current);
  cache.set(channel, { at: Date.now(), data: result });
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
