import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import {
  getSslCertsJson,
  getSslSettings,
  saveSslCertsJson,
} from "@/lib/settings";

/* ============================================================
   Sephiroth · v2.5 (Task 23-f) — ACME via acme.sh orchestration
   Mirrors the 3x-ui approach: drive ~/.acme.sh/acme.sh (zero new
   deps) with `--issue … --install-cert …` so acme.sh itself keeps
   the renewal schedule and copies the issued material into
   db/certs/<domain>.crt/.key where Xray TLS inbounds consume it.
   Phase 1 ships standalone + webroot issuance (--dns providers
   build the same argv, exposed as a pass-through later).
   Logs stream into db/acme.log + an in-memory ring buffer.
   Tracked certs live in settings key set_ssl_certs (JSON array).
   ============================================================ */

export type AcmeMode = "standalone" | "webroot" | "dns";

export interface ManagedCert {
  domain: string;
  email: string;
  mode: AcmeMode;
  webroot?: string;
  issuedAt: string; // ISO
  /** Estimated next renewal (notAfter − 30d), best-effort. */
  renewAt?: string;
  paths: { crt: string; key: string };
  /** Issued against the Let's Encrypt STAGING endpoint. */
  test: boolean;
}

export interface SslCertView {
  domain: string;
  paths: { crt: string; key: string };
  issuedAt: string | null;
  notAfter: string | null;
  daysLeft: number | null;
  test: boolean;
  /** Found in set_ssl_certs tracking. */
  tracked: boolean;
  /** Tracked but the files are gone from db/certs. */
  missing?: boolean;
}

export type IssueResult =
  | { ok: true; cert: ManagedCert }
  | { ok: false; error: string; logTail: string[] };

/* ---------- paths ---------- */

/** ACME.sh home ($ACME_HOME wins, else ~/.acme.sh — like 3x-ui). */
export function acmeHome(): string {
  const env = process.env.ACME_HOME?.trim();
  if (env) return path.resolve(env);
  return path.join(os.homedir(), ".acme.sh");
}

export function acmeBin(): string {
  return path.join(acmeHome(), "acme.sh");
}

export function acmeAvailable(): boolean {
  try {
    return existsSync(acmeBin()) && statSync(acmeBin()).isFile();
  } catch {
    return false;
  }
}

const DB_DIR = path.resolve(process.cwd(), "db");
export const ACME_LOG_FILE = path.join(DB_DIR, "acme.log");

export function certsDir(): string {
  return path.join(DB_DIR, "certs");
}

function ensureDirs(): void {
  mkdirSync(certsDir(), { recursive: true });
}

/* ---------- log ring + file ---------- */

const RING_MAX = 400;
const logRing: string[] = [];

function logLine(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  logRing.push(stamped);
  if (logRing.length > RING_MAX) logRing.splice(0, logRing.length - RING_MAX);
  try {
    appendFileSync(ACME_LOG_FILE, stamped + "\n", "utf8");
  } catch {
    /* best effort */
  }
}

/** Last n lines of the acme log — ring first, falling back to the file. */
export function tailAcmeLog(n = 30): string[] {
  if (logRing.length > 0) return logRing.slice(-n);
  try {
    if (!existsSync(ACME_LOG_FILE)) return [];
    const size = statSync(ACME_LOG_FILE).size;
    const read = Math.min(size, 16 * 1024);
    const fd = openSync(ACME_LOG_FILE, "r");
    const buf = Buffer.alloc(read);
    readSync(fd, buf, 0, read, size - read);
    closeSync(fd);
    return buf
      .toString("utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .slice(-n);
  } catch {
    return [];
  }
}

/* ---------- process runner (streams into the log) ---------- */

interface RunResult {
  code: number;
  timedOut: boolean;
  tail: string[];
}

function runStreamed(
  cmd: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<RunResult> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, {
        env: env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logLine(`[spawn-failed] ${cmd}: ${msg}`);
      resolve({ code: -1, timedOut: false, tail: [`spawn failed: ${msg}`] });
      return;
    }
    const push = (chunk: Buffer | string): void => {
      for (const raw of String(chunk).split(/\r?\n/)) {
        const line = raw.trimEnd();
        if (!line) continue;
        lines.push(line);
        if (lines.length > 600) lines.splice(0, lines.length - 600);
        logLine(line);
      }
    };
    child.stdout?.on("data", push);
    child.stderr?.on("data", push);
    const killer = setTimeout(() => {
      timedOut = true;
      logLine(`[timeout] ${cmd} exceeded ${Math.round(timeoutMs / 1000)}s — killing`);
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(killer);
      const msg = err instanceof Error ? err.message : String(err);
      logLine(`[error] ${msg}`);
      resolve({ code: -1, timedOut, tail: lines.slice(-30).concat(msg) });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code: code ?? -1, timedOut, tail: lines.slice(-60) });
    });
  });
}

/* ---------- acme.sh detection / install ---------- */

export async function acmeVersion(): Promise<string | null> {
  if (!acmeAvailable()) return null;
  const r = await runStreamed(acmeBin(), ["--version"], 20_000);
  // output like: "https://github.com/acmesh-official/acme.sh  v3.1.1"
  const m = /v\d+\.\d+\.\d+/.exec(r.tail.join("\n"));
  return m ? m[0] : null;
}

/**
 * Install acme.sh via the official one-liner (curl get.acme.sh | sh).
 * Registers the given account email. Requires outbound internet.
 */
export async function installAcme(
  email: string
): Promise<{ ok: boolean; error?: string; logTail: string[] }> {
  const mail = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
    return { ok: false, error: "invalid_email", logTail: tailAcmeLog(10) };
  }
  logLine(`[install] installing acme.sh (email: ${mail}) …`);
  let r = await runStreamed(
    "bash",
    ["-c", `curl -s https://get.acme.sh | sh -s email=${mail}`],
    120_000
  );
  // crontab-less hosts (containers/sandboxes) abort the pre-check —
  // Sephiroth drives renewals itself, so --force is the honest fallback
  if (r.code !== 0 && /Pre-check failed|--force/.test(r.tail.join("\n"))) {
    logLine("[install] retrying with --force (no crontab — panel runs the renewal watcher instead)");
    r = await runStreamed(
      "bash",
      ["-c", `curl -s https://get.acme.sh | sh -s email=${mail} --force`],
      120_000
    );
  }
  if (r.timedOut) {
    return { ok: false, error: "install_timeout", logTail: r.tail.slice(-30) };
  }
  if (r.code !== 0 || !acmeAvailable()) {
    return {
      ok: false,
      error: "install_failed",
      logTail: r.tail.slice(-30),
    };
  }
  const ver = await acmeVersion();
  logLine(`[install] acme.sh ready (${ver ?? "unknown version"})`);
  return { ok: true, logTail: r.tail.slice(-30) };
}

/* ---------- port guard ---------- */

/**
 * Verify the panel can actually bind the HTTP-01 challenge port.
 * Sandboxes run the panel unprivileged — a plain "bind failed" is
 * not actionable, so classify EACCES vs EADDRINUSE explicitly.
 */
function checkBindable(port: number): Promise<true | string> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EACCES") {
        resolve(
          `port ${port} cannot be bound: permission denied (the panel runs unprivileged — ports below 1024 need root or CAP_NET_BIND_SERVICE; use --httpport >1024 or webroot/dns mode)`
        );
      } else if (err.code === "EADDRINUSE") {
        resolve(`port ${port} is already in use by another process`);
      } else {
        resolve(`port ${port} cannot be bound: ${err.code ?? err.message}`);
      }
    });
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    try {
      srv.listen(port, "0.0.0.0");
    } catch (err) {
      resolve(
        `port ${port} cannot be bound: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}

/* ---------- cert material helpers ---------- */

/** acme.sh writes renewal confs as <base>_ecc/<base>_ecc.conf for ec-256. */
function fileBase(domain: string): string {
  return domain.replace(/\*/g, "_");
}

function crtPath(domain: string): string {
  return path.join(certsDir(), `${fileBase(domain)}.crt`);
}

function keyPath(domain: string): string {
  return path.join(certsDir(), `${fileBase(domain)}.key`);
}

/** Parse notAfter via openssl (ISO-8601 first, classic format fallback). */
function certNotAfter(crt: string): string | null {
  const parse = (out: string): string | null => {
    const m = /notAfter=(.+)/.exec(out);
    if (!m) return null;
    const d = new Date(m[1]!.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  try {
    const iso = spawnSync(
      "openssl",
      ["x509", "-noout", "-enddate", "-dateopt", "iso_8601", "-in", crt],
      { timeout: 8000, encoding: "utf8" }
    );
    const fromIso = parse(iso.stdout ?? "");
    if (fromIso) return fromIso;
    const classic = spawnSync("openssl", ["x509", "-noout", "-enddate", "-in", crt], {
      timeout: 8000,
      encoding: "utf8",
    });
    return parse(classic.stdout ?? "");
  } catch {
    return null;
  }
}

const DOMAIN_RE = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

export function validDomain(domain: string): boolean {
  return domain.length <= 253 && DOMAIN_RE.test(domain);
}

async function readTracked(): Promise<ManagedCert[]> {
  const raw = await getSslCertsJson();
  return raw.filter(
    (c): c is ManagedCert =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as ManagedCert).domain === "string" &&
      typeof (c as ManagedCert).paths?.crt === "string"
  );
}

async function writeTracked(certs: ManagedCert[]): Promise<void> {
  await saveSslCertsJson(certs);
}

/* ---------- issue ---------- */

export interface IssueOptions {
  domain: string;
  email?: string;
  mode: AcmeMode;
  webroot?: string;
  /** Override the standalone HTTP-01 port (acme.sh --httpport). */
  httpPort?: number;
  /** Let's Encrypt staging endpoint (ignored when `server` is set). */
  test?: boolean;
  /** Custom ACME directory URL (pass-through of --server). */
  server?: string;
  /** dns-01 provider token name, e.g. "dns_cf" (pass-through). */
  dnsProvider?: string;
}

/**
 * Issue (or renew) a cert for `domain` with acme.sh and register the
 * --install-cert hook so acme.sh keeps copying renewed material into
 * db/certs. One synchronous call, capped at 300 s, log-streamed.
 */
export async function issueCert(opts: IssueOptions): Promise<IssueResult> {
  const domain = String(opts.domain ?? "").trim().toLowerCase();
  if (!validDomain(domain)) {
    return { ok: false, error: "invalid_domain", logTail: tailAcmeLog(10) };
  }
  if (!acmeAvailable()) {
    return { ok: false, error: "acme_not_installed", logTail: tailAcmeLog(10) };
  }
  if (opts.mode !== "standalone" && opts.mode !== "webroot" && opts.mode !== "dns") {
    return { ok: false, error: "invalid_mode", logTail: tailAcmeLog(10) };
  }
  if (opts.mode === "webroot") {
    const wr = String(opts.webroot ?? "").trim();
    if (!wr || !existsSync(wr) || !statSync(wr).isDirectory()) {
      return { ok: false, error: "webroot_missing", logTail: tailAcmeLog(10) };
    }
  }
  if (opts.mode === "dns" && !/^[a-z0-9_]+$/i.test(String(opts.dnsProvider ?? ""))) {
    return { ok: false, error: "dns_provider_required", logTail: tailAcmeLog(10) };
  }

  const tracked = await readTracked();
  if (tracked.some((t) => t.domain === domain)) {
    return {
      ok: false,
      error: "already_tracked",
      logTail: tailAcmeLog(10),
    };
  }

  ensureDirs();

  /* ---- port guard: never touch 80 blind ---- */
  if (opts.mode === "standalone") {
    const port = Number(opts.httpPort) > 0 ? Number(opts.httpPort) : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: "invalid_http_port", logTail: tailAcmeLog(10) };
    }
    const bindable = await checkBindable(port);
    if (bindable !== true) {
      return { ok: false, error: bindable, logTail: tailAcmeLog(10) };
    }
  }

  /* ---- argv (3x-ui style) ---- */
  const server = opts.server?.trim() || process.env.SEPH_ACME_SERVER?.trim() || "letsencrypt";
  const test = Boolean(opts.test) && server === "letsencrypt";
  const crt = crtPath(domain);
  const key = keyPath(domain);

  const argv: string[] = [
    "--issue",
    "-d",
    domain,
    "--keylength",
    "ec-256",
    "--server",
    server,
  ];
  if (test) argv.push("--test");
  if (opts.mode === "standalone") {
    argv.push("--standalone");
    if (Number(opts.httpPort) > 0) argv.push("--httpport", String(Number(opts.httpPort)));
  } else if (opts.mode === "webroot") {
    argv.push("--webroot", String(opts.webroot).trim());
  } else {
    argv.push("--dns", String(opts.dnsProvider));
  }

  const caBundle = process.env.SEPH_ACME_CA_BUNDLE?.trim();
  if (caBundle) argv.push("--ca-bundle", caBundle);
  if (process.env.SEPH_ACME_INSECURE === "1") argv.push("--insecure");

  // register the install hook in the same invocation — acme.sh then
  // re-copies material into db/certs on every scheduled renewal
  argv.push(
    "--install-cert",
    "-d",
    domain,
    "--fullchain-file",
    crt,
    "--key-file",
    key,
    "--reloadcmd",
    "true"
  );

  const email = opts.email?.trim() || (await getSslSettings()).adminEmail;
  logLine(
    `[issue] ${domain} mode=${opts.mode}${opts.httpPort ? ` httpPort=${opts.httpPort}` : ""}${test ? " (staging)" : ""} server=${server}`
  );

  const r = await runStreamed(acmeBin(), argv, 300_000);
  if (r.timedOut) {
    return {
      ok: false,
      error: "issue_timeout",
      logTail: r.tail.slice(-30),
    };
  }
  if (r.code !== 0 || !existsSync(crt) || !existsSync(key)) {
    const blob = r.tail.join("\n");
    let error = "issue_failed";
    if (/EACCES|permission denied|Permission denied/i.test(blob)) {
      error = "bind_permission";
    } else if (/Verify error|Invalid response|dns/i.test(blob) && opts.mode !== "standalone") {
      error = "challenge_failed";
    } else if (/Verify error/i.test(blob)) {
      error = "challenge_failed";
    } else if (/Rate limit|too many/i.test(blob)) {
      error = "rate_limited";
    } else if (/EADDRINUSE|Address already in use/i.test(blob)) {
      error = "port_in_use";
    }
    return { ok: false, error, logTail: r.tail.slice(-30) };
  }

  const notAfter = certNotAfter(crt);
  const issuedAt = new Date().toISOString();
  let renewAt: string | undefined;
  if (notAfter) {
    renewAt = new Date(Date.parse(notAfter) - 30 * 86_400_000).toISOString();
  }
  const cert: ManagedCert = {
    domain,
    email,
    mode: opts.mode,
    ...(opts.mode === "webroot" ? { webroot: String(opts.webroot).trim() } : {}),
    issuedAt,
    ...(renewAt ? { renewAt } : {}),
    paths: { crt, key },
    test,
  };
  const next = tracked.filter((t) => t.domain !== domain).concat(cert);
  await writeTracked(next);
  logLine(`[issue] OK ${domain} → ${crt}`);
  return { ok: true, cert };
}

/* ---------- listing / removal ---------- */

/** Merge tracked certs with what actually sits in db/certs. */
export async function listManagedCerts(): Promise<SslCertView[]> {
  const tracked = await readTracked();
  const views = new Map<string, SslCertView>();
  const now = Date.now();

  for (const t of tracked) {
    views.set(t.domain, {
      domain: t.domain,
      paths: t.paths,
      issuedAt: t.issuedAt ?? null,
      notAfter: null,
      daysLeft: null,
      test: Boolean(t.test),
      tracked: true,
    });
  }

  let disk: string[] = [];
  try {
    ensureDirs();
    disk = readdirSync(certsDir()).filter((f) => f.endsWith(".crt"));
  } catch {
    disk = [];
  }

  for (const f of disk) {
    const crt = path.join(certsDir(), f);
    const key = crt.replace(/\.crt$/, ".key");
    const base = f.slice(0, -4);
    // tracked entries carry their full metadata; untracked files surface raw
    const t = tracked.find((x) => path.basename(x.paths.crt) === f);
    const domain = t?.domain ?? base;
    const notAfter = certNotAfter(crt);
    const daysLeft = notAfter
      ? Math.floor((Date.parse(notAfter) - now) / 86_400_000)
      : null;
    views.set(domain, {
      domain,
      paths: { crt, key },
      issuedAt: t?.issuedAt ?? null,
      notAfter,
      daysLeft,
      test: Boolean(t?.test),
      tracked: Boolean(t),
    });
  }

  // a tracked cert whose files vanished stays visible with missing=true
  for (const v of views.values()) {
    if (v.tracked && !existsSync(v.paths.crt)) v.missing = true;
  }

  return [...views.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * Stop tracking `domain` and delete db/certs/<domain>.{crt,key}.
 * The acme.sh renewal conf (~/.acme.sh/<domain>_ecc) is deliberately
 * KEPT — run `acme.sh --remove -d <domain>` to purge it completely.
 */
export async function removeManagedCert(
  domain: string
): Promise<{ ok: boolean; error?: string; renewalConfKept: boolean }> {
  const d = String(domain ?? "").trim().toLowerCase();
  if (!validDomain(d)) {
    return { ok: false, error: "invalid_domain", renewalConfKept: false };
  }
  const tracked = await readTracked();
  const entry = tracked.find((t) => t.domain === d);
  await writeTracked(tracked.filter((t) => t.domain !== d));

  for (const p of [crtPath(d), keyPath(d)]) {
    try {
      if (path.dirname(p) === certsDir() && existsSync(p)) unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
  if (entry) logLine(`[remove] ${d} untracked; files deleted (acme.sh renewal conf kept)`);

  let renewalConfKept = false;
  try {
    const base = fileBase(d);
    for (const f of readdirSync(acmeHome())) {
      if (f.startsWith(`${base}_`) && statSync(path.join(acmeHome(), f)).isDirectory()) {
        renewalConfKept = true;
        break;
      }
    }
  } catch {
    /* acme.sh not installed */
  }
  return { ok: true, renewalConfKept };
}

/* ---------- daily renewal watcher ---------- */

let lastRenewDay = "";

/**
 * Hooked into the 60 s maintenance interval (server.ts). Fires at most
 * once per calendar day: when acme.sh exists, renew-check is enabled and
 * any managed cert expires within 30 days → quiet `acme.sh --renew-all`.
 * Log-only (console + db/acme.log); never throws.
 */
export async function runSslRenewalTick(): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (lastRenewDay === today) return;
    if (!acmeAvailable()) return;
    const ssl = await getSslSettings();
    if (!ssl.renewCheck) return;

    const certs = await listManagedCerts();
    const due = certs.filter((c) => c.daysLeft !== null && c.daysLeft <= 30);
    if (due.length === 0) return;

    lastRenewDay = today;
    logLine(
      `[renew] ${today}: ${due.length} cert(s) within 30 days (${due
        .map((c) => `${c.domain}: ${c.daysLeft}d`)
        .join(", ")}) — running acme.sh --renew-all`
    );
    const r = await runStreamed(acmeBin(), ["--renew-all"], 600_000);
    logLine(`[renew] --renew-all finished with exit ${r.code}${r.timedOut ? " (timed out)" : ""}`);
  } catch (err) {
    console.error("[acme] renewal tick failed:", err);
  }
}
