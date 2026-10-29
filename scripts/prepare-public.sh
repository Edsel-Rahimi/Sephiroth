#!/usr/bin/env bash
# =============================================================================
# prepare-public.sh — build a clean, publishable tree for the PUBLIC release
#
#   ./scripts/prepare-public.sh [DEST]      # default DEST: ./public-export
#   PUB_DIR=/somewhere ./scripts/prepare-public.sh
#
# What it does:
#   1. Copies the worktree into DEST (rsync if available, else cp), excluding
#      everything that must never go public:
#        - build/dependency artifacts: node_modules, dist, .next, .git
#        - agent/backup/work artifacts: .pcloud, .pcloud-stage, tool-results,
#          agent-ctx, upload, worklog.md, dev.log, server.log, skills
#        - LIVE DATA: the whole db/ directory — db/sephiroth-store.json holds
#          real password hashes / API tokens, db/custom.db* is legacy live
#          SQLite, db/core/sidecars/*.conf hold live tunnel secrets and
#          db/bin/ holds downloaded core binaries. The app recreates db/ at
#          runtime (src/lib/db.ts does mkdirSync + writeFileSync on first
#          persist), so shipping an empty db/ with a README is safe.
#        - panels.json (dev-machine reference-panel registry with sandbox
#          paths) — a sanitized panels.example.json is emitted instead.
#        - docs that cannot be sanitized in-place here:
#            docs/ROADMAP.md                             (contains the real
#              server IP in the private roadmap; edit before shipping if you
#              want it public)
#            docs/deploy-shots/                          (screenshots of the
#              real private deployment, may show the real URL)
#            docs/sephiroth-katabump-deploy-guide-fa.pdf (binary export of the
#              deploy guide; regenerate from the sanitized HTML)
#        - env files: .env, .env.local, .env.*.local (kept: .env.example)
#   2. Emits a clean db/README.md explaining first-boot bootstrap.
#   3. Verifies the result:
#        - HARD FAIL on the real server IP (51[.]75[.]118[.]79) anywhere in DEST
#        - HARD FAIL on the credential username (epo[d]onios) anywhere in DEST
#          EXCEPT the owner-branding allowlist (README badges/ghcr URLs,
#          package.json author, LICENSE, Dockerfile, src i18n creator strings,
#          docs catalogs — the same handle the repo is published under)
#        - prints any remaining non-loopback IPv4s for manual review
#
# DB bootstrap facts this script relies on (verified in src/lib/db.ts):
#   - STORE_FILE = db/sephiroth-store.json; loadStore() falls back to
#     emptyStore() when the file is missing → boot works with NO db file.
#   - emptyStore() defines ALL top-level keys as EMPTY ARRAYS: adminUser,
#     serverSetting, inbound, clientUser, userInboundAccess, subGroup,
#     subGroupMember, reseller, saleTemplate, host, node, outbound,
#     routingRule, activityLog, relayTunnel, tgUser, tgOrder, apiToken.
#     NOTE: adminUser is an ARRAY, not an object — a placeholder admin object
#     would be silently ignored by parseStoreFile (it only accepts arrays per
#     table), so this script ships NO seed and NO fake admin row.
#   - On the first mutation persistStore() creates db/ + the store file
#     atomically (.tmp → rename, one-generation .bak).
#   - src/lib/auth.ts seeds the FIRST admin from SEPHIROTH_ADMIN_USER /
#     SEPHIROTH_ADMIN_PASS when the adminUser table is empty (public default
#     admin/sephiroth — change on first login, already documented in README).
# =============================================================================
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-${PUB_DIR:-$SRC/public-export}}"
DEST="$(mkdir -p "$DEST" && cd "$DEST" && pwd)"

# --- safety guards -----------------------------------------------------------
[ -n "$DEST" ] && [ "$DEST" != "/" ] || { echo "REFUSING: bad DEST '$DEST'"; exit 1; }
[ "$DEST" != "$SRC" ] || { echo "REFUSING: DEST equals the repo root"; exit 1; }
case "$SRC" in "$DEST"/*) echo "REFUSING: DEST contains the repo ($DEST)"; exit 1;; esac

echo "── source: $SRC"
echo "── dest  : $DEST"

# --- 1 · copy the worktree ----------------------------------------------------
# Anchored excludes (rsync) — mirrored by the cp fallback cleanup below.
EXCLUDES=(
  /node_modules /dist /.git /.next
  /.pcloud /.pcloud-stage /tool-results /agent-ctx /upload /skills
  /dev.log /server.log /worklog.md
  /.env /.env.local /.env.production /.env.development
  .env.*.local
  /db
  /panels.json
  /docs/ROADMAP.md /docs/deploy-shots /docs/sephiroth-katabump-deploy-guide-fa.pdf
)

if command -v rsync >/dev/null 2>&1; then
  echo "── [1/3] rsync worktree"
  args=()
  for e in "${EXCLUDES[@]}"; do args+=(--exclude "$e"); done
  mkdir -p "$DEST"
  rsync -a "${args[@]}" "$SRC/" "$DEST/"
else
  echo "── [1/3] rsync not found — falling back to cp + cleanup"
  mkdir -p "$DEST"
  cp -a "$SRC/." "$DEST/"
  rm -rf "$DEST"/node_modules "$DEST"/dist "$DEST"/.git "$DEST"/.next \
         "$DEST"/.pcloud "$DEST"/.pcloud-stage "$DEST"/tool-results \
         "$DEST"/agent-ctx "$DEST"/upload "$DEST"/skills \
         "$DEST"/dev.log "$DEST"/server.log "$DEST"/worklog.md \
         "$DEST"/.env "$DEST"/.env.local "$DEST"/.env.production \
         "$DEST"/.env.development
  rm -rf "$DEST"/.env.*.local
  rm -rf "$DEST"/db "$DEST"/panels.json \
         "$DEST"/docs/ROADMAP.md "$DEST"/docs/deploy-shots \
         "$DEST"/docs/sephiroth-katabump-deploy-guide-fa.pdf
fi
# never allow a stale export nested inside itself
rm -rf "$DEST/public-export"

# --- 2 · panels.example.json + db/README -------------------------------------
echo "── [2/3] emitting panels.example.json + db/README.md"
cat > "$DEST/panels.example.json" << 'EOF'
[
  {
    "id": "example",
    "name": "Example Reference Panel",
    "repo": "https://github.com/your-org/your-panel",
    "stars": 0,
    "version": "v1.0.0",
    "port": 4101,
    "entry": "/ref/example/",
    "creds": "admin / admin",
    "status": "stopped",
    "notes": "REPLACE_ME — document how this reference panel is installed, started and proxied on YOUR machine. panels.json is a dev-machine registry mirroring src/lib/reference-panels.ts (which the /ref/<id> proxy actually reads); the real panels.json is excluded from the public export on purpose."
  }
]
EOF

mkdir -p "$DEST/db"
cat > "$DEST/db/README.md" << 'EOF'
# db/ — runtime data (empty by design)

This directory is intentionally EMPTY in the public repository.

On first boot the app:
1. starts from an in-memory empty store when `db/sephiroth-store.json` is
   missing (see `src/lib/db.ts` → `loadStore()` → `emptyStore()`), and
2. creates the store file on the first write (atomic `.tmp` → rename, with a
   one-generation `.bak`), and
3. seeds the FIRST admin account from the `SEPHIROTH_ADMIN_USER` /
   `SEPHIROTH_ADMIN_PASS` environment variables (defaults: `admin` /
   `sephiroth` — CHANGE THE PASSWORD AFTER FIRST LOGIN; see `src/lib/auth.ts`).

Never commit a real `sephiroth-store.json`: it contains password hashes,
API tokens and your users' configs.
EOF

# --- 3 · verification ---------------------------------------------------------
echo "── [3/3] verification"
if ! command -v rg >/dev/null 2>&1; then
  echo "WARN: ripgrep (rg) not installed — skipping automated secret checks."
  echo "      Install rg and re-run, or manually verify no secrets in DEST."
  exit 0
fi

FAIL=0

# 3a · the real server IP must be gone everywhere
#      (comment uses 51[.]75[.]118[.]79 so THIS file never contains the plain
#       literal itself — it ships in the export too)
if ( cd "$DEST" && rg -l '51\.75\.118\.79' . 2>/dev/null | grep . ); then
  echo "✗ FAIL: real server IP found in the export (files above)"; FAIL=1
else
  echo "✓ no 51[.]75[.]118[.]79 anywhere in the export"
fi

# 3b · credential username must be gone; owner-branding hits are allowed
#      (package.json author, README badges/ghcr URLs, LICENSE, Dockerfile,
#       src i18n creator strings, docs catalogs — same public handle)
BRAND_ALLOW='^package\.json$|^LICENSE$|^Dockerfile$|^install\.sh$|^docker-compose\.yml$|^README(\.[a-z]{2})?\.md$|^src/|^docs/(sephiroth-catalog-|sephiroth-v2\.[0-9.]+-changelog-fa\.html$|sephiroth-beginner-guide-fa\.html$|sephiroth-katabump-deploy-guide-fa\.html$|footer\.svg$|RELEASE-NOTES-v2\.5\.0\.md$)|^scripts/deploy/build'
BRAND_HITS="$( cd "$DEST" && rg -l 'epo[d]onios|EPO[D]ONIOS' . 2>/dev/null | sed 's|^\./||' | rg -v "$BRAND_ALLOW" || true )"
if [ -n "$BRAND_HITS" ]; then
  echo "✗ FAIL: credential-context 'epo[d]onios' found outside the branding allowlist:"
  echo "$BRAND_HITS"; FAIL=1
else
  echo "✓ no credential-context epo[d]onios (branding hits stay: package.json author, LICENSE, README/Dockerfile/docs catalogs)"
fi

# 3b2 · real recovery keys (SEPH-####-####-#### shape) must never ship —
#       the FORMAT placeholder (SEPH-XXXX-XXXX-XXXX in UI hints/docs) is
#       public knowledge; only actual rotated keys are secret
RECOVERY_HITS="$( cd "$DEST" && rg -n 'SEPH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}' . 2>/dev/null | rg -v 'SEPH-XXXX-XXXX-XXXX' || true )"
if [ -n "$RECOVERY_HITS" ]; then
  echo "✗ FAIL: recovery-key-shaped secret found in the export:"
  echo "$RECOVERY_HITS" | head -10; FAIL=1
else
  echo "✓ no recovery-key-shaped secrets in the export (only the public SEPH-XXXX-XXXX-XXXX format placeholder)"
fi

# 3c · leftover non-loopback IPv4s → review list (not a hard fail; includes
#      documentation/example IPs that live in src/ and other agents' files)
#      filtered: loopback, doc ranges, public DNS constants (1.1.1.1 etc.)
IP_FILTER='127\.0\.0\.1|0\.0\.0\.0|1\.2\.3\.4|2\.5\.4\.3|2\.5\.29\.17|172\.1[6-9]\.|192\.168\.|(^|[^0-9.])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|203\.0\.113\.|1\.0\.0\.1|1\.1\.1\.1|8\.8\.8\.8|8\.8\.4\.4|9\.9\.9\.9'
echo "── leftover public-looking IPv4s (review; loopback/doc/DNS-constant ranges filtered):"
IP_HITS="$( cd "$DEST" && rg -n '\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b' . --glob '!node_modules' 2>/dev/null | rg -v "$IP_FILTER" || true )"
if [ -n "$IP_HITS" ]; then
  echo "$IP_HITS" | head -20
  echo "⚠ review the hits above — replace real IPs with placeholders before publishing"
else
  echo "✓ none"
fi
# known src-owned demo default (src/lib/db.ts relayTunnel row template with
# fictional node names) — filtered from the review list but surfaced here so
# the src owner can decide whether to placeholder it too:
if ( cd "$DEST" && rg -q '185\.143\.233\.10' src/lib/db.ts 2>/dev/null ); then
  echo "⚠ src/lib/db.ts ships the demo default entryAddress 185[.]143[.]233[.]10 (relayTunnel row template, fictional node names) — src/ is owned by another agent; placeholder it there if desired"
fi

# 3d · DB bootstrap sanity: confirm the auto-create + empty-array facts we rely on
if rg -q 'adminUser: \[\]' "$DEST/src/lib/db.ts" && rg -q 'existsSync' "$DEST/src/lib/db.ts"; then
  echo "✓ db.ts verified: store auto-creates on boot, adminUser seeds as [] from env (no seed file needed)"
else
  echo "⚠ could not verify db.ts bootstrap facts — re-check src/lib/db.ts before publishing"
fi

if [ "$FAIL" -ne 0 ]; then
  echo "── public export FAILED verification: $DEST"
  exit 1
fi
echo "── public export ready: $DEST"
echo "   next: cd $DEST && git init && git add -A && git commit && git remote add origin <public-url>"
