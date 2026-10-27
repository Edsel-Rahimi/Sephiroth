/**
 * Sephiroth core adapter — engine binary acquisition (server-only).
 *
 * Two engines are managed here:
 *   1. Xray core  (XTLS/Xray-core)        — ensureXrayBinary()
 *   2. Hysteria 2 sidecar (apernet/hysteria) — ensureHysteriaBinary()   [v2.5]
 *
 * Resolution order (both engines):
 *   1. admin-pinned absolute path      (settings · set_core_xray_bin /
 *                                        set_sidecar_hysteria_bin)
 *   2. `<engine>` on PATH              (which / where)
 *   3. auto-install into <dbDir>/bin/<engine>/
 *        → GitHub releases, settings-pinned tag or latest
 *        → per-OS/arch asset
 *             Xray:     zip archives → extraction fallback chain
 *                       unzip → 7z → python3 -m zipfile -e
 *             Hysteria: flat static binaries (no archive) — direct download
 *        → chmod +x, `.version` marker, verified via `<engine> version`
 *
 * Idempotent: an installed version that already matches the pin is reused;
 * if the GitHub API is unreachable but a working binary exists, it is kept
 * (offline-safe).
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const UA = "Sephiroth-Panel";
const DOWNLOAD_TIMEOUT_MS = 180_000;
const API_TIMEOUT_MS = 15_000;

/* Xray (zip assets) */
const XRAY_REPO_API = "https://api.github.com/repos/XTLS/Xray-core/releases";
const XRAY_REPO_WEB = "https://github.com/XTLS/Xray-core";

/* Hysteria 2 sidecar (flat binary assets; apernet/hysteria 301s to HyNetworks) */
const HY2_REPO_API = "https://api.github.com/repos/apernet/hysteria/releases";
const HY2_REPO_WEB = "https://github.com/apernet/hysteria";

export interface XrayBinaryInfo {
  path: string;
  version: string;
  /** how the binary was resolved */
  source: "user" | "path" | "auto";
}

function execFile(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        resolve({ code: -1, stdout, stderr: stderr + "\ntimeout" });
      }
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: String(err) });
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      }
    });
  });
}

/** Run the binary's `version` command and extract "Xray <semver>". */
export async function probeXrayVersion(binPath: string): Promise<string> {
  const r = await execFile(binPath, ["version"], 10_000);
  if (r.code !== 0) return "";
  const m = r.stdout.match(/Xray\s+(v?\d+\.\d+\.\d+)/i);
  return m ? m[1]!.replace(/^v/, "") : "";
}

async function toolExists(tool: string): Promise<boolean> {
  if (process.platform === "win32") {
    return (await execFile("where", [tool], 5000)).code === 0;
  }
  return (await execFile("which", [tool], 5000)).code === 0;
}

/** Extract zip with the first available tool: unzip → 7z → python3 zipfile. */
async function extractZip(zipPath: string, destDir: string): Promise<string> {
  const chain: Array<{ tool: string; args: string[] }> = [
    { tool: "unzip", args: ["-o", zipPath, "-d", destDir] },
    { tool: "7z", args: ["x", "-y", `-o${destDir}`, zipPath] },
    { tool: "python3", args: ["-m", "zipfile", "-e", zipPath, destDir] },
    { tool: "python", args: ["-m", "zipfile", "-e", zipPath, destDir] },
  ];
  const tried: string[] = [];
  for (const step of chain) {
    if (!(await toolExists(step.tool))) {
      tried.push(`${step.tool}:missing`);
      continue;
    }
    const r = await execFile(step.tool, step.args, 60_000);
    if (r.code === 0) {
      const marker = path.join(destDir, "xray");
      if (process.platform !== "win32" ? existsSync(marker) : existsSync(path.join(destDir, "xray.exe"))) {
        return step.tool;
      }
      // tool exited 0 but no binary → keep walking the chain
      tried.push(`${step.tool}:no-binary`);
      continue;
    }
    tried.push(`${step.tool}:exit${r.code}`);
  }
  throw new Error(`no zip extractor available (${tried.join(", ")})`);
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

function assetNameFor(platform: string, arch: string): string {
  if (platform === "linux") {
    if (arch === "arm64" || arch === "aarch64") return "Xray-linux-arm64-v8a.zip";
    if (arch === "arm" || arch === "armv7l") return "Xray-linux-arm32-v7a.zip";
    return "Xray-linux-64.zip";
  }
  if (platform === "darwin") {
    if (arch === "arm64") return "Xray-macos-arm64-v8a.zip";
    return "Xray-macos-64.zip";
  }
  if (platform === "win32") return "Xray-windows-64.zip";
  return "";
}

interface ReleaseInfo {
  tag: string;
  assetUrl: string;
}

/**
 * Resolve the tag for "latest" without the REST API (which is rate-limited
 * much harder than the website): releases/latest 302s to /releases/tag/<tag>.
 */
async function latestTagFromRedirect(): Promise<string> {
  const res = await fetch("https://github.com/XTLS/Xray-core/releases/latest", {
    headers: { "User-Agent": UA },
    redirect: "manual",
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const location = res.headers.get("location") ?? "";
  const m = location.match(/\/releases\/tag\/(v?\d+\.\d+\.\d+)/);
  if (!m) throw new Error("could not resolve latest release tag");
  return m[1]!;
}

async function fetchRelease(versionPin: string): Promise<ReleaseInfo> {
  const assetName = assetNameFor(process.platform, process.arch);
  if (!assetName) throw new Error(`unsupported platform ${process.platform}/${process.arch}`);

  // primary: GitHub REST API (exact asset metadata)
  try {
    const url = versionPin
      ? `${XRAY_REPO_API}/tags/${encodeURIComponent(versionPin)}`
      : `${XRAY_REPO_API}/latest`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.ok) {
      const release = (await res.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
      const asset = (release.assets ?? []).find((a) => a.name === assetName);
      if (release.tag_name && asset) {
        return { tag: release.tag_name, assetUrl: asset.browser_download_url };
      }
    }
  } catch {
    /* fall through to the redirect strategy */
  }

  // fallback: website redirect for the tag + constructed asset URL
  const tag = versionPin || (await latestTagFromRedirect());
  return {
    tag,
    assetUrl: `https://github.com/XTLS/Xray-core/releases/download/${tag}/${assetName}`,
  };
}

function normalizeTag(pin: string): string {
  const t = pin.trim();
  if (!t) return "";
  return t.startsWith("v") ? t : `v${t}`;
}

/**
 * Resolve the xray binary. Never throws when a usable binary already exists
 * (user path / PATH / previously auto-installed); throws only when a fresh
 * install is required and fails.
 */
export async function ensureXrayBinary(opts: {
  binPath?: string;
  versionPin?: string;
  installDir?: string;
  log?: (msg: string) => void;
}): Promise<XrayBinaryInfo> {
  const log = opts.log ?? (() => {});
  const pin = normalizeTag(opts.versionPin ?? "");

  // 1) admin-pinned absolute path
  const userPath = (opts.binPath ?? "").trim();
  if (userPath) {
    if (!existsSync(userPath)) {
      throw new Error(`set_core_xray_bin points to a missing file: ${userPath}`);
    }
    const version = await probeXrayVersion(userPath);
    if (!version) throw new Error(`${userPath} is not a runnable xray binary`);
    return { path: userPath, version, source: "user" };
  }

  // 2) PATH lookup
  if (process.platform !== "win32") {
    const which = await execFile("which", ["xray"], 5000);
    if (which.code === 0) {
      const found = which.stdout.trim().split("\n")[0] ?? "";
      if (found && existsSync(found)) {
        const version = await probeXrayVersion(found);
        if (version) return { path: found, version, source: "path" };
      }
    }
  }

  // 3) auto-install into <dbDir>/bin/xray
  const installDir = opts.installDir ?? path.resolve(process.cwd(), "db", "bin", "xray");
  const exeName = process.platform === "win32" ? "xray.exe" : "xray";
  const exePath = path.join(installDir, exeName);
  const markerPath = path.join(installDir, ".version");

  const existingVersion = existsSync(exePath) ? await probeXrayVersion(exePath) : "";
  if (existingVersion) {
    // pinned & already satisfied → done
    if (pin && existingVersion === pin.replace(/^v/, "")) {
      return { path: exePath, version: existingVersion, source: "auto" };
    }
    if (!pin) {
      // latest requested but API may be down — a working install is kept
      return { path: exePath, version: existingVersion, source: "auto" };
    }
  }

  log(`resolving Xray release (${pin || "latest"})…`);
  const release = await fetchRelease(pin);

  // marker + binary already match the resolved release → reuse
  if (
    existingVersion &&
    existsSync(markerPath) &&
    readFileSync(markerPath, "utf8").trim() === release.tag &&
    existingVersion === release.tag.replace(/^v/, "")
  ) {
    return { path: exePath, version: existingVersion, source: "auto" };
  }

  log(`downloading ${release.assetUrl}…`);
  mkdirSync(installDir, { recursive: true });
  const res = await fetch(release.assetUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error("downloaded archive is too small");

  const tmpDir = `${installDir}.dl-${Date.now()}`;
  const zipPath = path.join(tmpDir, "xray.zip");
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(zipPath, buf);
    const extractor = await extractZip(zipPath, tmpDir);
    log(`extractor used: ${extractor}`);
    const extracted = path.join(tmpDir, exeName);
    if (!existsSync(extracted)) throw new Error("archive did not contain the xray binary");
    rmSync(exePath, { force: true });
    // move into place (same filesystem); fall back to copy + drop
    try {
      renameSync(extracted, exePath);
    } catch {
      copyFileSync(extracted, exePath);
      rmSync(extracted, { force: true });
    }
    if (process.platform !== "win32") chmodSync(exePath, 0o755);
    writeFileSync(markerPath, release.tag, { mode: 0o644 });

    const version = await probeXrayVersion(exePath);
    if (!version) throw new Error("installed binary failed to run");
    log(`Xray ${version} installed at ${exePath}`);
    return { path: exePath, version, source: "auto" };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Public wrapper used by the core-install API route (download / update only). */
export async function installOrUpdateXray(opts: {
  binPath?: string;
  versionPin?: string;
  installDir?: string;
  log?: (msg: string) => void;
}): Promise<XrayBinaryInfo> {
  return ensureXrayBinary(opts);
}

/* ============================================================
   Hysteria 2 sidecar binary (v2.5 — protocol gap analysis §3)
   ============================================================ */

/**
 * Hysteria releases ship FLAT static binaries (no zip) — a direct download
 * is all that is needed. Tags carry an `app/` prefix (`app/v2.13.0`) and
 * apernet/hysteria 301-redirects to HyNetworks/hysteria, so the REST API is
 * only the secondary path (it is rate-limited much harder than the website).
 */
function hysteriaAssetName(platform: string, arch: string): string {
  if (platform === "linux") {
    if (arch === "arm64" || arch === "aarch64") return "hysteria-linux-arm64";
    if (arch === "arm" || arch === "armv7l") return "hysteria-linux-armv5";
    if (arch === "ia32") return "hysteria-linux-386";
    return "hysteria-linux-amd64";
  }
  if (platform === "darwin") {
    if (arch === "arm64") return "hysteria-darwin-arm64";
    return "hysteria-darwin-amd64";
  }
  if (platform === "freebsd") {
    if (arch === "arm64" || arch === "aarch64") return "hysteria-freebsd-arm64";
    return "hysteria-freebsd-amd64";
  }
  if (platform === "win32") return "hysteria-windows-amd64.exe";
  return "";
}

/** Run the binary's `version` command and extract "v2.13.0"-style semver. */
export async function probeHysteriaVersion(binPath: string): Promise<string> {
  const r = await execFile(binPath, ["version"], 10_000);
  if (r.code !== 0) return "";
  const m = r.stdout.match(/v?(\d+\.\d+\.\d+)/);
  return m ? m[1]! : "";
}

async function fetchHysteriaRelease(versionPin: string): Promise<ReleaseInfo> {
  const assetName = hysteriaAssetName(process.platform, process.arch);
  if (!assetName) throw new Error(`unsupported platform ${process.platform}/${process.arch}`);

  // secondary: GitHub REST API (rate-limited much harder than the website)
  try {
    const url = versionPin
      ? `${HY2_REPO_API}/tags/${encodeURIComponent(versionPin)}`
      : `${HY2_REPO_API}/latest`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.ok) {
      const release = (await res.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
      const asset = (release.assets ?? []).find((a) => a.name === assetName);
      if (release.tag_name && asset) {
        return { tag: release.tag_name, assetUrl: asset.browser_download_url };
      }
    }
  } catch {
    /* fall through to the redirect strategy */
  }

  // primary: releases/latest redirect → tag → constructed asset URL.
  // Hysteria tags look like `app/v2.13.0` (the redirect Location carries the
  // full tag; apernet→HyNetworks repo rename is followed automatically).
  let tag = versionPin;
  if (!tag) {
    // follow up to 3 hops: apernet→HyNetworks repo rename redirects land on
    // /releases/latest first (no tag); the tag URL only appears on the NEXT hop
    let tagUrl = "https://github.com/apernet/hysteria/releases/latest";
    for (let hop = 0; hop < 3 && !tag; hop++) {
      const res = await fetch(tagUrl, {
        headers: { "User-Agent": UA },
        redirect: "manual",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      const location = res.headers.get("location") ?? "";
      const m = location.match(/\/releases\/tag\/(.+?)\/?$/);
      if (m) {
        tag = decodeURIComponent(m[1]!);
        break;
      }
      if (!location) throw new Error("could not resolve latest hysteria release tag");
      tagUrl = location;
    }
    if (!tag) throw new Error("could not resolve latest hysteria release tag");
  }
  return {
    tag,
    assetUrl: `https://github.com/apernet/hysteria/releases/download/${tag}/${assetName}`,
  };
}

/**
 * Resolve the hysteria sidecar binary. Same contract as ensureXrayBinary:
 * never throws when a usable binary already exists (user path / PATH /
 * previously auto-installed); throws only when a fresh install is required
 * and fails.
 */
export async function ensureHysteriaBinary(opts: {
  binPath?: string;
  versionPin?: string;
  installDir?: string;
  log?: (msg: string) => void;
}): Promise<XrayBinaryInfo> {
  const log = opts.log ?? (() => {});
  const pin = normalizeTag(opts.versionPin ?? ""); // "2.13.0" → "v2.13.0"

  // 1) admin-pinned absolute path (set_sidecar_hysteria_bin)
  const userPath = (opts.binPath ?? "").trim();
  if (userPath) {
    if (!existsSync(userPath)) {
      throw new Error(`hysteria binary path points to a missing file: ${userPath}`);
    }
    const version = await probeHysteriaVersion(userPath);
    if (!version) throw new Error(`${userPath} is not a runnable hysteria binary`);
    return { path: userPath, version, source: "user" };
  }

  // 2) PATH lookup
  if (process.platform !== "win32") {
    const which = await execFile("which", ["hysteria"], 5000);
    if (which.code === 0) {
      const found = which.stdout.trim().split("\n")[0] ?? "";
      if (found && existsSync(found)) {
        const version = await probeHysteriaVersion(found);
        if (version) return { path: found, version, source: "path" };
      }
    }
  }

  // 3) auto-install into <dbDir>/bin/hysteria
  const installDir = opts.installDir ?? path.resolve(process.cwd(), "db", "bin", "hysteria");
  const exeName = process.platform === "win32" ? "hysteria.exe" : "hysteria";
  const exePath = path.join(installDir, exeName);
  const markerPath = path.join(installDir, ".version");

  const existingVersion = existsSync(exePath) ? await probeHysteriaVersion(exePath) : "";
  if (existingVersion) {
    if (pin && existingVersion === pin.replace(/^v/, "")) {
      return { path: exePath, version: existingVersion, source: "auto" };
    }
    if (!pin) {
      // latest requested but the release may be unreachable — keep working install
      return { path: exePath, version: existingVersion, source: "auto" };
    }
  }

  log(`resolving Hysteria release (${pin || "latest"})…`);
  const release = await fetchHysteriaRelease(pin);

  // marker + binary already match the resolved release → reuse
  if (
    existingVersion &&
    existsSync(markerPath) &&
    readFileSync(markerPath, "utf8").trim() === release.tag &&
    existingVersion === release.tag.replace(/^v/, "").replace(/^app\//, "")
  ) {
    return { path: exePath, version: existingVersion, source: "auto" };
  }

  log(`downloading ${release.assetUrl}…`);
  mkdirSync(installDir, { recursive: true });
  const res = await fetch(release.assetUrl, {
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error("downloaded binary is too small");

  const tmpPath = `${exePath}.dl-${Date.now()}`;
  try {
    writeFileSync(tmpPath, buf, { mode: 0o755 });
    rmSync(exePath, { force: true });
    try {
      renameSync(tmpPath, exePath);
    } catch {
      copyFileSync(tmpPath, exePath);
      rmSync(tmpPath, { force: true });
    }
    if (process.platform !== "win32") chmodSync(exePath, 0o755);
    writeFileSync(markerPath, release.tag, { mode: 0o644 });

    const version = await probeHysteriaVersion(exePath);
    if (!version) throw new Error("installed binary failed to run");
    log(`Hysteria ${version} installed at ${exePath}`);
    return { path: exePath, version, source: "auto" };
  } finally {
    rmSync(tmpPath, { force: true });
  }
}

/** Public wrapper for a sidecar-install API action (download / update only). */
export async function installOrUpdateHysteria(opts: {
  binPath?: string;
  versionPin?: string;
  installDir?: string;
  log?: (msg: string) => void;
}): Promise<XrayBinaryInfo> {
  return ensureHysteriaBinary(opts);
}
