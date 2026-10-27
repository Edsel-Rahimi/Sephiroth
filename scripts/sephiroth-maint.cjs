#!/usr/bin/env node
/* =============================================================================
 *  Sephiroth — maintenance helper (CommonJS, runs with plain node)
 *
 *  Commands:
 *    node sephiroth-maint.cjs set-password <newpass>   rewrite the admin password hash in the store
 *    node sephiroth-maint.cjs set-port <port>          rewrite PORT in /etc/sephiroth/sephiroth.env
 *    node sephiroth-maint.cjs backup [dir]             timestamped backup of db/ + env files (keep last 10)
 *    node sephiroth-maint.cjs restore <file>           validate + restore a backup (current db is kept as .bak)
 *    node sephiroth-maint.cjs version                  print package.json version + db presence
 *
 *  Env overrides (for tests / custom installs):
 *    SEPH_DB_PATH     path to the store file        (default <repo>/db/sephiroth-store.json)
 *    SEPH_ENV_FILE    path to the panel env file    (default /etc/sephiroth/sephiroth.env)
 *    SEPH_BACKUP_DIR  backup output directory       (default <repo>/backups)
 *
 *  The password hash format replicates src/lib/auth.ts hashPassword() EXACTLY:
 *    `${16-byte-hex-salt}:${scryptSync(password, salt, 64).toString("hex")}`
 *  which is the same format verifyPassword() consumes.
 *  Stop the panel (sephiroth stop) before editing the store — this script does
 *  not coordinate the service; the CLI orchestrates stop/start around it.
 * ============================================================================= */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { randomBytes, scryptSync } = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.SEPH_DB_PATH || path.join(REPO_ROOT, "db", "sephiroth-store.json");
const ENV_FILE = process.env.SEPH_ENV_FILE || "/etc/sephiroth/sephiroth.env";
const BACKUP_DIR = process.env.SEPH_BACKUP_DIR || path.join(REPO_ROOT, "backups");
const KEEP_BACKUPS = 10;

/* ---------- password hashing — mirrors src/lib/auth.ts exactly ---------- */

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/* ---------- atomic store edit (tmp → rename, previous file kept as .bak) ---------- */

function atomicWriteJson(file, data) {
  const tmp = file + ".tmp";
  const bak = file + ".bak";
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, bak);
    } catch (err) {
      console.error(`[maint] warning: could not stage .bak (continuing): ${err.message}`);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function loadStore() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[maint] store file not found: ${DB_PATH}`);
    console.error(`[maint] refusing to act — install the panel first or set SEPH_DB_PATH`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (err) {
    console.error(`[maint] store file is not valid JSON: ${DB_PATH} (${err.message})`);
    process.exit(1);
  }
}

/* ---------- commands ---------- */

function cmdSetPassword(newPass) {
  if (!newPass || newPass.startsWith("-")) {
    console.error("usage: sephiroth-maint.cjs set-password <newpass>");
    process.exit(1);
  }
  if (String(newPass).length < 6) {
    console.error("[maint] password too short (min 6 chars)");
    process.exit(1);
  }
  const store = loadStore();
  if (!Array.isArray(store.adminUser) || store.adminUser.length === 0) {
    console.error("[maint] no adminUser rows in the store — has the panel ever booted?");
    process.exit(1);
  }
  const passwordHash = hashPassword(newPass);
  // edit ALL admin rows so no stale account survives (panel seeds exactly one)
  for (const admin of store.adminUser) {
    admin.passwordHash = passwordHash;
    if ("updatedAt" in admin) admin.updatedAt = new Date().toISOString();
  }
  atomicWriteJson(DB_PATH, store);
  console.log(`[maint] admin password updated in ${DB_PATH}`);
}

function cmdSetPort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`[maint] invalid port: ${port}`);
    process.exit(1);
  }
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`[maint] env file not found: ${ENV_FILE} — nothing to rewrite`);
    process.exit(1);
  }
  const raw = fs.readFileSync(ENV_FILE, "utf8");
  let updated;
  if (/^PORT=.*$/m.test(raw)) {
    updated = raw.replace(/^PORT=.*$/m, `PORT=${n}`);
  } else {
    updated = raw.replace(/\s*$/, `\nPORT=${n}\n`);
  }
  const tmp = ENV_FILE + ".tmp";
  fs.writeFileSync(tmp, updated, "utf8");
  fs.renameSync(tmp, ENV_FILE);
  try {
    fs.chmodSync(ENV_FILE, 0o600);
  } catch {
    /* best effort */
  }
  console.log(`[maint] PORT=${n} written to ${ENV_FILE}`);
}

function cmdBackup(outDir) {
  const dir = outDir || BACKUP_DIR;
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[maint] store file not found: ${DB_PATH} — nothing to back up`);
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const outFile = path.join(dir, `sephiroth-backup-${stamp}.tar.gz`);

  // stage a canonical layout so restore() always finds db/sephiroth-store.json:
  //   db/sephiroth-store.json[.bak] · package.json · etc/<env-dir>/<env file>
  const os = require("node:os");
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "seph-backup-"));
  try {
    fs.mkdirSync(path.join(stage, "db"), { recursive: true });
    fs.copyFileSync(DB_PATH, path.join(stage, "db", "sephiroth-store.json"));
    if (fs.existsSync(DB_PATH + ".bak")) {
      fs.copyFileSync(DB_PATH + ".bak", path.join(stage, "db", "sephiroth-store.json.bak"));
    }
    try {
      fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(stage, "package.json"));
    } catch {
      /* version file is optional in the archive */
    }
    const members = ["db", "package.json"];
    if (fs.existsSync(ENV_FILE)) {
      const envDirName = `etc-${path.basename(path.dirname(ENV_FILE))}`;
      fs.mkdirSync(path.join(stage, envDirName), { recursive: true });
      fs.copyFileSync(ENV_FILE, path.join(stage, envDirName, path.basename(ENV_FILE)));
      members.push(envDirName);
    }
    fs.writeFileSync(path.join(stage, "BACKUP-MANIFEST.txt"),
      `sephiroth backup ${new Date().toISOString()}\nstore: ${DB_PATH}\nenv: ${ENV_FILE}\n`);
    members.push("BACKUP-MANIFEST.txt");

    let usedTar = true;
    try {
      execFileSync("tar", ["-czf", outFile, "-C", stage, ...members], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      usedTar = false;
      console.error(`[maint] tar unavailable or failed (${(err.stderr || err.message || "").toString().trim().slice(0, 200)}) — writing raw JSON fallback`);
    }

    if (!usedTar) {
      const fallback = path.join(dir, `sephiroth-store-${stamp}.json`);
      fs.copyFileSync(DB_PATH, fallback);
      if (fs.existsSync(ENV_FILE)) {
        fs.copyFileSync(ENV_FILE, fallback.replace(/\.json$/, ".env"));
      }
      console.log(fallback);
      pruneBackups(dir, ["sephiroth-store-*.json", "sephiroth-store-*.env"]);
      return;
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  console.log(outFile);
  pruneBackups(dir, ["sephiroth-backup-*.tar.gz"]);
}

function pruneBackups(dir, patterns) {
  const files = [];
  for (const pattern of patterns) {
    const rx = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
    for (const f of fs.readdirSync(dir)) {
      if (rx.test(f)) {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        files.push({ full, mtime: st.mtimeMs });
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(KEEP_BACKUPS)) {
    try {
      fs.unlinkSync(f.full);
    } catch {
      /* best effort */
    }
  }
}

function cmdRestore(file) {
  const src = file;
  if (!src || !fs.existsSync(src)) {
    console.error(`[maint] backup file not found: ${src || "(none given)"}`);
    console.error("usage: sephiroth-maint.cjs restore <file.tar.gz | file.json>");
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[maint] store file not found: ${DB_PATH} — refusing (install the panel first)`);
    process.exit(1);
  }

  let candidate = null; // absolute path to a validated store JSON

  if (/\.tar\.gz$|\.tgz$/.test(src)) {
    const extractDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "seph-restore-"));
    try {
      execFileSync("tar", ["-xzf", src, "-C", extractDir], { stdio: ["ignore", "ignore", "pipe"] });
      // canonical layout: db/sephiroth-store.json; tolerate flat variants
      const candidates = [
        path.join(extractDir, "db", "sephiroth-store.json"),
        path.join(extractDir, "sephiroth-store.json"),
        path.join(extractDir, "db.json"),
      ];
      candidate = candidates.find((c) => fs.existsSync(c)) || null;
    } catch (err) {
      console.error(`[maint] failed to extract ${src}: ${(err.stderr || err.message || "").toString().trim().slice(0, 200)}`);
      process.exit(1);
    }
  } else if (/\.json$/.test(src)) {
    candidate = src;
  } else {
    console.error("[maint] unsupported backup format (expected .tar.gz or .json)");
    process.exit(1);
  }

  if (!candidate) {
    console.error(`[maint] no db/sephiroth-store.json inside ${src}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
  } catch (err) {
    console.error(`[maint] backup contains invalid JSON: ${err.message}`);
    process.exit(1);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.adminUser)) {
    console.error("[maint] backup does not look like a Sephiroth store (missing adminUser array)");
    process.exit(1);
  }

  atomicWriteJson(DB_PATH, parsed);
  console.log(`[maint] store restored from ${src} → ${DB_PATH} (previous file kept as ${DB_PATH}.bak)`);
}

function cmdVersion() {
  let version = "unknown";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    version = pkg.version || "unknown";
  } catch {
    /* keep unknown */
  }
  const dbExists = fs.existsSync(DB_PATH);
  console.log(JSON.stringify({ version, dbExists, dbPath: DB_PATH }, null, 2));
}

/* ---------- dispatch ---------- */

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "set-password": cmdSetPassword(rest[0]); break;
  case "set-port": cmdSetPort(rest[0]); break;
  case "backup": cmdBackup(rest[0]); break;
  case "restore": cmdRestore(rest[0]); break;
  case "version": cmdVersion(); break;
  default:
    console.error("usage: sephiroth-maint.cjs <set-password|set-port|backup|restore|version> [arg]");
    process.exit(1);
}
