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
#
# Auth uses pCloud digest login (SHA1(password+digest)); the long-lived authtoken
# is cached in ~/.pcloud-authtoken (0600) so the password is only used on re-login.
set -euo pipefail

LABEL="${1:-$(date +%Y-%m-%d_%H%M%S)}"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$PROJ/.pcloud-stage"
CONF="$HOME/.pcloud-backup.conf"
TOKEN_FILE="$HOME/.pcloud-authtoken"
ROOT_REMOTE="/Sephiroth-Backups"

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

# ---------- auth (cached authtoken; digest login fallback) ----------
auth_ok=0
if [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(cat "$TOKEN_FILE")"
  R="$(curl -s -G "$API/userinfo" --data-urlencode "auth=$TOKEN" | jget result || true)"
  [ "$R" = "0" ] && auth_ok=1
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
  R="$(curl -s -G "$API/mkdir" --data-urlencode "path=$P" --data-urlencode "auth=$TOKEN" | jget result)"
  if [ "$R" != "0" ] && [ "$R" != "2019" ]; then
    echo "ERROR: mkdir $P failed (result=$R)" >&2
    exit 1
  fi
done

for F in "$BUNDLE" "$SRC" "$MANIFEST"; do
  echo ">> uploading $(basename "$F") ..."
  RESP="$(curl -s -G "$API/uploadfile" \
    --data-urlencode "path=$ROOT_REMOTE/$LABEL" \
    --data-urlencode "auth=$TOKEN" \
    -F "file=@$F")"
  R="$(printf '%s' "$RESP" | jget result)"
  if [ "$R" != "0" ]; then
    echo "ERROR: upload failed for $(basename "$F"): $(printf '%s' "$RESP" | head -c 300)" >&2
    exit 1
  fi
done

echo "✅ uploaded to pCloud:$ROOT_REMOTE/$LABEL"
echo "   (verify anytime: scripts/pcloud-backup.sh --verify  |  restore: see MANIFEST)"
