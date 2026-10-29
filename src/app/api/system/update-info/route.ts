import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { appVersion } from "@/lib/settings";

/* ============================================================
   Sephiroth · v2.2 — Panel self-update (check phase)
   GET /api/system/update-info
   Compares the running version against the public repository
   (Edsel-Rahimi/Sephiroth @ main — same pattern 3x-ui uses with
   GitHub releases/latest, but version-of-truth = package.json
   on the public main branch, reachable from restricted hosts).
   ============================================================ */

const PUBLIC_REPO = "https://github.com/Edsel-Rahimi/Sephiroth";
const RAW_PKG_URL = "https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/package.json";

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => Number(x) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const current = appVersion();

  let isGit = false;
  let remoteName = "";
  try {
    const { existsSync, readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    isGit = existsSync(resolve(process.cwd(), ".git"));
    if (isGit) {
      const cfg = readFileSync(resolve(process.cwd(), ".git", "config"), "utf8");
      const names = [...cfg.matchAll(/\[remote "([^"]+)"\]/g)].map((m) => m[1]!);
      remoteName =
        names.find((n) => n === "origin") ??
        names.find((n) => n === "public") ??
        names[0] ??
        "";
    }
  } catch {
    /* keep defaults */
  }

  let latest = "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(RAW_PKG_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (res.ok) {
      const pkg = (await res.json()) as { version?: string };
      latest = typeof pkg.version === "string" ? pkg.version : "";
    }
  } catch {
    latest = "";
  }

  if (!latest) {
    return NextResponse.json(
      { error: "network", current, repoUrl: PUBLIC_REPO },
      { status: 502 }
    );
  }

  const updateAvailable = compareSemver(latest, current) > 0;
  return NextResponse.json({
    current,
    latest,
    updateAvailable,
    repoUrl: PUBLIC_REPO,
    isGit,
    remoteName,
    channel: "stable",
  });
}
