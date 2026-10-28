#!/usr/bin/env bash
# pcloud-backup.sh — full off-site backup of Sephiroth to pCloud (per-task bundles)
#
# Usage:
#   scripts/pcloud-backup.sh <label>              # build archives + upload to pCloud
#   SKIP_UPLOAD=1 scripts/pcloud-backup.sh <label> # build archives only (dry run)
#
# What it uploads to pCloud:/Sephiroth-Backups/<label>/ :
#   sephiroth-<label>.gitbundle   -> FULL git history (restore: git clone <bundle> sephiroth)
#   sephiroth-<label>-src.tar.gz  -> full worktree (minus node_modules/.next/db/bin/.git)
#   MANIFEST-<label>.txt          -> commit hash, branch, timestamps, sha256 checksums
#
# Config file ~/.pcloud-backup.conf (auto chmod 600):
#   PCLOUD_EMAIL=you@example.com
#   PCLOUD_PASSWORD=...
#   PCLOUD_REGION=eu     # 'eu' -> eapi.pcloud.com, 'us' -> api.pcloud.com
#   PCLOUD_AUTH=...      # optional: pre-existing auth token (bypasses login/2FA)
#
# Auth order: cached authtoken (~/.pcloud-authtoken, 0600) -> PCLOUD_AUTH from
# config -> digest login (SHA1(digest+SHA1(password))). Token is cached after
# any successful auth so the password is only used on re-login.
set -euo pipefail

LABEL="${1:-$(date +%Y-%m-%d_%H%M%S)}"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$PROJ/.pcloud-stage"
CONF="$HOME/.pcloud-backup.conf"
TOKEN_FILE="$HOME/.pcloud-authtoken"
ROOT_REMOTE="/Sephiroth-Backups"

# Durable fallbacks INSIDE the repo (survive HOME/sandbox wipes when the
# repo persists; repo dir is 0700, .gitignored, never leaves the machine)
PCLOUD_DIR="$PROJ/.pcloud"
[ -f "$CONF" ]      || [ ! -f "$PCLOUD_DIR/backup.conf" ] || CONF="$PCLOUD_DIR/backup.conf"
[ -f "$TOKEN_FILE" ] || [ ! -f "$PCLOUD_DIR/authtoken" ]  || TOKEN_FILE="$PCLOUD_DIR/authtoken"

if [ ! -f "$CONF" ]; then
  if [ "${SKIP_UPLOAD:-0}" = "1" ]; then
    echo "(no $CONF — SKIP_UPLOAD mode, archives only)"
  else
    echo "ERROR: missing config $CONF (PCLOUD_EMAIL/PCLOUD_PASSWORD/PCLOUD_REGION)" >&2
    exit 1
  fi
else
  chmod 600 "$CONF" 2>/dev/null || true
  # shellcheck disable=SC1090
  source "$CONF"
fi
REGION="${PCLOUD_REGION:-eu}"
API="https://eapi.pcloud.com"
[ "$REGION" = "us" ] && API="https://api.pcloud.com"

jget() { python3 -c "import json,sys
try: print(json.load(sys.stdin).get('$1',''))
except Exception: print('')"; }

# Mirror auth artifacts into the repo so the 2-hourly cron can always log in
# even after a sandbox restore (both locations kept in sync)
pcloud_mirror_auth() {
  mkdir -p "$PCLOUD_DIR" 2>/dev/null || return 0
  [ -f "$CONF" ] && cp -f "$CONF" "$PCLOUD_DIR/backup.conf" 2>/dev/null
  [ -f "$TOKEN_FILE" ] && cp -f "$TOKEN_FILE" "$PCLOUD_DIR/authtoken" 2>/dev/null
  chmod 700 "$PCLOUD_DIR" 2>/dev/null || true
  chmod 600 "$PCLOUD_DIR/backup.conf" "$PCLOUD_DIR/authtoken" 2>/dev/null || true
  return 0
}

# ---------- auth (cached authtoken -> conf token -> digest login) ----------
auth_ok=0
if [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(cat "$TOKEN_FILE")"
  R="$(curl -s -G "$API/userinfo" --data-urlencode "auth=$TOKEN" | jget result || true)"
  [ "$R" = "0" ] && auth_ok=1
fi
if [ "$auth_ok" != "1" ] && [ -n "${PCLOUD_AUTH:-}" ]; then
  TOKEN="$PCLOUD_AUTH"
  R="$(curl -s -G "$API/userinfo" --data-urlencode "auth=$TOKEN" | jget result || true)"
  if [ "$R" = "0" ]; then
    auth_ok=1
    (umask 077; printf '%s' "$TOKEN" > "$TOKEN_FILE")
    pcloud_mirror_auth
    echo ">> using PCLOUD_AUTH from config (cached)"
  else
    echo "WARN: PCLOUD_AUTH token rejected (result=$R)" >&2
  fi
fi
if [ "$auth_ok" != "1" ]; then
  if [ "${SKIP_UPLOAD:-0}" = "1" ]; then
    echo "(SKIP_UPLOAD mode — skipping login)"
  else
    DIGEST="$(curl -s "$API/getdigest" | jget digest)"
    INNER="$(printf '%s' "$PCLOUD_PASSWORD" | sha1sum | cut -d' ' -f1)"
    PASSHASH="$(printf '%s' "${DIGEST}${INNER}" | sha1sum | cut -d' ' -f1)"
    RESP="$(curl -s -G "$API/login" \
      --data-urlencode "username=$PCLOUD_EMAIL" \
      --data-urlencode "digest=$DIGEST" \
      --data-urlencode "password=$PASSHASH" \
      --data-urlencode "getauth=1")"
    R="$(printf '%s' "$RESP" | jget result)"
    if [ "$R" != "0" ]; then
      echo "ERROR: pCloud login failed: $RESP" >&2
      exit 1
    fi
    TOKEN="$(printf '%s' "$RESP" | jget auth)"
    (umask 077; printf '%s' "$TOKEN" > "$TOKEN_FILE")
    pcloud_mirror_auth
    echo ">> logged in to pCloud ($REGION), authtoken cached"
  fi
fi

# ---------- build archives ----------
mkdir -p "$STAGE"
cd "$PROJ"
COMMIT="$(git rev-parse HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BUNDLE="$STAGE/sephiroth-$LABEL.gitbundle"
SRC="$STAGE/sephiroth-$LABEL-src.tar.gz"

echo ">> git bundle (full history) ..."
git bundle create "$BUNDLE" --all

echo ">> worktree tarball (minus node_modules/.next/db/bin) ..."
tar -czf "$SRC" \
  --exclude='./node_modules' --exclude='./.next' \
  --exclude='./db/bin' --exclude='./.git' --exclude='./.pcloud-stage' \
  --exclude='./dist' --exclude='./skills' --exclude='./tool-results' \
  --exclude='./dev.log' \
  -C "$PROJ" .

MANIFEST="$STAGE/MANIFEST-$LABEL.txt"
{
  echo "Sephiroth off-site backup"
  echo "label:        $LABEL"
  echo "commit:       $COMMIT ($BRANCH)"
  echo "created_utc:  $STAMP"
  echo "bundle_sha256:  $(sha256sum "$BUNDLE" | cut -d' ' -f1)"
  echo "src_sha256:     $(sha256sum "$SRC" | cut -d' ' -f1)"
  echo "restore:      git clone sephiroth-$LABEL.gitbundle sephiroth && tar -xzf sephiroth-$LABEL-src.tar.gz -C sephiroth"
} > "$MANIFEST"

echo ">> archives ready:"
ls -lh "$BUNDLE" "$SRC" "$MANIFEST" | awk '{print "   " $5 "  " $9}'

# ---------- upload ----------
if [ "${SKIP_UPLOAD:-0}" = "1" ]; then
  echo "(SKIP_UPLOAD=1 — done, nothing uploaded)"
  exit 0
fi

for P in "$ROOT_REMOTE" "$ROOT_REMOTE/$LABEL"; do
  R="$(curl -s -G "$API/createfolderifnotexists" --data-urlencode "path=$P" --data-urlencode "auth=$TOKEN" | jget result)"
  if [ "$R" != "0" ]; then
    echo "ERROR: createfolder $P failed (result=$R)" >&2
    exit 1
  fi
done

for F in "$BUNDLE" "$SRC" "$MANIFEST"; do
  echo ">> uploading $(basename "$F") ..."
  RESP="$(curl -s --max-time 540 "$API/uploadfile" \
    -F "auth=$TOKEN" \
    -F "path=$ROOT_REMOTE/$LABEL" \
    -F "nopartial=1" \
    -F "file=@$F")"
  R="$(printf '%s' "$RESP" | jget result)"
  if [ "$R" != "0" ]; then
    echo "ERROR: upload failed for $(basename "$F"): $(printf '%s' "$RESP" | head -c 300)" >&2
    exit 1
  fi
done

echo "✅ uploaded to pCloud:$ROOT_REMOTE/$LABEL"
echo "   (restore: see MANIFEST)"

# ---------- retention: prune auto-* folders older than AUTO_RETENTION_DAYS ----------
RET_DAYS="${AUTO_RETENTION_DAYS:-7}"
if [ "$RET_DAYS" != "0" ]; then
  CUTOFF=$(( $(date -u +%s) - RET_DAYS * 86400 ))
  PRUNE_LIST="$(printf '%s' "$(curl -s -G "$API/listfolder" --data-urlencode "path=$ROOT_REMOTE" --data-urlencode "auth=$TOKEN")" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for c in (d.get('metadata') or {}).get('contents') or []:
        n=c.get('name','')
        if c.get('folder') and n.startswith('auto-') and int(c.get('modified',0)) < $CUTOFF:
            print(n)
except Exception: pass")"
  printf '%s\n' "$PRUNE_LIST" | while IFS= read -r OLD; do
    [ -n "$OLD" ] || continue
    echo ">> pruning old auto-backup: $OLD"
    curl -s -G "$API/deletefolderrecursive" --data-urlencode "path=$ROOT_REMOTE/$OLD" --data-urlencode "auth=$TOKEN" >/dev/null || true
  done
fi
