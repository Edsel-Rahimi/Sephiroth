#!/usr/bin/env bash
# pcloud-restore-check.sh — make the newest pCloud backup the source of truth
#
# Compares the newest /Sephiroth-Backups/<folder>/MANIFEST-*.txt commit hash
# against the local git HEAD and reports — or with --apply, restores local
# from pCloud when the remote is newer (the anti-rollback cure).
#
# Usage:
#   scripts/pcloud-restore-check.sh           # verdict only (dry run)
#   scripts/pcloud-restore-check.sh --apply   # restore local if remote is newer
#
# Verdicts:
#   NEED_COOKIE               no valid pCloud auth (send fresh pcauth)
#   REMOTE_EMPTY              no backups on pCloud yet
#   LOCAL_IS_NEWEST           local HEAD == remote commit
#   LOCAL_IS_AHEAD            local has commits the remote never saw
#   DRY_RUN_REMOTE_IS_NEWER   remote newer; rerun with --apply to restore
#   RESTORED                  local reset to remote latest commit
#
# Environment quirks handled:
#   - this account returns RFC2822 string dates + 'isfolder' flag
#   - sandbox egress IP rotates between requests; pCloud binds download links
#     to the generating IP -> dl_file retries with fresh links until one matches
set -uo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

PROJ="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$HOME/.pcloud-backup.conf"
TOKEN_FILE="$HOME/.pcloud-authtoken"
MIRROR_FILE="$PROJ/.pcloud/auth"
STAGE="$PROJ/.pcloud-stage"
mkdir -p "$STAGE"
ROOT_REMOTE="/Sephiroth-Backups"

[ -f "$CONF" ] && { chmod 600 "$CONF" 2>/dev/null || true; source "$CONF"; }
REGION="${PCLOUD_REGION:-us}"
API="https://eapi.pcloud.com"
[ "$REGION" = "eu" ] && API="https://eapi.pcloud.com"
[ "$REGION" = "us" ] && API="https://api.pcloud.com"

jget() { python3 -c "import json,sys
try: print(json.load(sys.stdin).get('$1',''))
except Exception: print('')"; }

save_token() {
  (umask 077; printf '%s' "$1" > "$TOKEN_FILE")
  mkdir -p "$(dirname "$MIRROR_FILE")"
  (umask 077; printf '%s' "$1" > "$MIRROR_FILE")
}

# ---------- auth (project mirror -> cached authtoken -> conf token) ----------
TOKEN=""; auth_ok=0
for CAND in "$MIRROR_FILE" "$TOKEN_FILE"; do
  [ "$auth_ok" = "1" ] && break
  if [ -f "$CAND" ]; then
    T="$(cat "$CAND")"
    R="$(curl -s -m 20 -G "$API/userinfo" --data-urlencode "auth=$T" | jget result || true)"
    if [ "$R" = "0" ]; then TOKEN="$T"; auth_ok=1; save_token "$T"; fi
  fi
done
if [ "$auth_ok" != "1" ] && [ -n "${PCLOUD_AUTH:-}" ]; then
  R="$(curl -s -m 20 -G "$API/userinfo" --data-urlencode "auth=$PCLOUD_AUTH" | jget result || true)"
  if [ "$R" = "0" ]; then TOKEN="$PCLOUD_AUTH"; auth_ok=1; save_token "$TOKEN"; fi
fi
if [ "$auth_ok" != "1" ]; then
  echo "NEED_COOKIE"
  exit 2
fi

# ---------- download helper (must be defined before first use) ----------
dl_file() { # $1=fileid $2=dest $3=expected text prefix (empty = just non-empty)
  local TRY=0 H P SZ
  local WANT="${3:-}"
  while [ "$TRY" -lt 10 ]; do
    TRY=$((TRY+1))
    L="$(curl -s -m 30 -G "$API/getfilelink" --data-urlencode "fileid=$1" --data-urlencode "auth=$TOKEN")"
    P="$(printf '%s' "$L" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    if d.get('result')!=0: raise SystemExit(1)
    print(d.get('path',''))
except Exception: print('')" 2>/dev/null || true)"
    [ -z "$P" ] && { sleep 2; continue; }
    for H in $(printf '%s' "$L" | python3 -c "
import json,sys
try: print(' '.join(json.load(sys.stdin).get('hosts') or []))
except Exception: pass" 2>/dev/null); do
      curl -s -m 540 -L --compressed "https://$H$P" -o "$2" 2>/dev/null || { sleep 2; continue; }
      if head -c 512 "$2" 2>/dev/null | grep -q "another IP\|Invalid link"; then continue; fi
      SZ=$(wc -c < "$2" 2>/dev/null || echo 0)
      [ "${SZ:-0}" -gt 0 ] || continue
      if [ -n "$WANT" ] && ! head -c 512 "$2" | grep -q "$WANT"; then continue; fi
      return 0
    done
    sleep 2
  done
  echo "ERROR: download failed after $TRY attempts (rotating egress IP vs pCloud link binding)"
  exit 1
}

# ---------- folder listing helpers ----------
RESOLVE_PY="
import json,sys
try:
    d=json.load(sys.stdin)
    if d.get('result')!=0: print(''); raise SystemExit
    for c in (d.get('metadata') or {}).get('contents') or []:
        if (c.get('isfolder') or c.get('folder')) and c.get('name')==sys.argv[1]:
            print(c.get('folderid','')); break
except Exception: print('')"

MT_PY="
import json,sys,datetime
def ep(m):
    try: return int(m)
    except Exception:
        try: return datetime.datetime.strptime(str(m),'%a, %d %b %Y %H:%M:%S %z').timestamp()
        except Exception: return 0
try:
    d=json.load(sys.stdin)
    if d.get('result')!=0: print(''); raise SystemExit
    cs=[c for c in (d.get('metadata') or {}).get('contents') or [] if (c.get('isfolder') or c.get('folder'))]
    cs.sort(key=lambda c:ep(c.get('modified',0)))
    print(cs[-1]['name'] if cs else '')
except Exception: print('')"

# ---------- find newest backup folder ----------
ROOT_ID="$(curl -s -m 30 -G "$API/listfolder" --data-urlencode "folderid=0" --data-urlencode "auth=$TOKEN" | python3 -c "$RESOLVE_PY" "${ROOT_REMOTE#/}")"
[ -z "$ROOT_ID" ] && { echo "REMOTE_EMPTY (no ${ROOT_REMOTE#/} folder)"; exit 0; }

LIST="$(curl -s -m 30 -G "$API/listfolder" --data-urlencode "folderid=$ROOT_ID" --data-urlencode "auth=$TOKEN")"
NEWEST="$(printf '%s' "$LIST" | python3 -c "$MT_PY")"
if [ -z "$NEWEST" ]; then
  echo "REMOTE_EMPTY"
  exit 0
fi
echo ">> newest pCloud backup: $NEWEST" >&2

# ---------- fetch its MANIFEST ----------
SUB_ID="$(printf '%s' "$LIST" | python3 -c "$RESOLVE_PY" "$NEWEST")"
[ -z "$SUB_ID" ] && { echo "REMOTE_EMPTY (cannot resolve $NEWEST)"; exit 0; }
FLIST="$(curl -s -m 30 -G "$API/listfolder" --data-urlencode "folderid=$SUB_ID" --data-urlencode "auth=$TOKEN")"
MAN_LINE="$(printf '%s' "$FLIST" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    cs=[c for c in (d.get('metadata') or {}).get('contents') or [] if not (c.get('isfolder') or c.get('folder')) and c.get('name','').startswith('MANIFEST')]
    print(cs[0]['fileid'] if cs else '')
except Exception: print('')")"
if [ -z "$MAN_LINE" ]; then
  echo "REMOTE_EMPTY (no MANIFEST in $NEWEST)"
  exit 0
fi
MAN_TXT_FILE="$STAGE/restore-MANIFEST.txt"
dl_file "$MAN_LINE" "$MAN_TXT_FILE" "Sephiroth off-site backup"
REMOTE_COMMIT="$(sed -n 's/^commit:[[:space:]]*\([0-9a-f]\{40\}\).*/\1/p' "$MAN_TXT_FILE" | head -1)"
if [ -z "$REMOTE_COMMIT" ]; then
  echo "REMOTE_EMPTY (MANIFEST unreadable)"
  exit 0
fi
LOCAL_COMMIT="$(cd "$PROJ" && git rev-parse HEAD)"
echo ">> remote commit: $REMOTE_COMMIT"
echo ">> local  commit: $LOCAL_COMMIT"

if [ "$REMOTE_COMMIT" = "$LOCAL_COMMIT" ]; then
  echo "LOCAL_IS_NEWEST (identical)"
  exit 0
fi

cd "$PROJ"
IN_LOCAL=0; git cat-file -e "$REMOTE_COMMIT^{commit}" 2>/dev/null && IN_LOCAL=1
if [ "$IN_LOCAL" = "1" ] && git merge-base --is-ancestor "$REMOTE_COMMIT" "$LOCAL_COMMIT" 2>/dev/null; then
  echo "LOCAL_IS_AHEAD (local has newer commits; run pcloud-backup.sh to sync)"
  exit 0
fi

# remote is newer -> restore
if [ "$APPLY" != "1" ]; then
  echo "DRY_RUN_REMOTE_IS_NEWER $REMOTE_COMMIT"
  exit 1
fi

echo ">> RESTORING local from pCloud:$ROOT_REMOTE/$NEWEST ..."
mkdir -p "$STAGE"

BUNDLE_NAME="$(printf '%s' "$FLIST" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    cs=[c for c in (d.get('metadata') or {}).get('contents') or [] if not (c.get('isfolder') or c.get('folder')) and c.get('name','').startswith('sephiroth-') and c.get('name','').endswith('.gitbundle')]
    print(cs[0]['name'] if cs else '')
except Exception: print('')")"
BUNDLE_ID="$(printf '%s' "$FLIST" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    cs=[c for c in (d.get('metadata') or {}).get('contents') or [] if not (c.get('isfolder') or c.get('folder')) and c.get('name','').endswith('.gitbundle')]
    print(cs[0]['fileid'] if cs else '')
except Exception: print('')")"
SRC_ID="$(printf '%s' "$FLIST" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    cs=[c for c in (d.get('metadata') or {}).get('contents') or [] if not (c.get('isfolder') or c.get('folder')) and c.get('name','').endswith('-src.tar.gz')]
    print(cs[0]['fileid'] if cs else '')
except Exception: print('')")"
SRC_NAME="$(printf '%s' "$FLIST" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    cs=[c for c in (d.get('metadata') or {}).get('contents') or [] if not (c.get('isfolder') or c.get('folder')) and c.get('name','').endswith('-src.tar.gz')]
    print(cs[0]['name'] if cs else '')
except Exception: print('')")"
[ -z "$BUNDLE_NAME" ] && { echo "ERROR: no gitbundle in $NEWEST"; exit 1; }

BUNDLE_DST="$STAGE/restore-$BUNDLE_NAME"
SRC_DST="$STAGE/restore-$SRC_NAME"
echo ">> downloading $BUNDLE_NAME ..."
dl_file "$BUNDLE_ID" "$BUNDLE_DST"
echo ">> downloading $SRC_NAME ..."
[ -n "$SRC_ID" ] && dl_file "$SRC_ID" "$SRC_DST"

# verify sha256 against MANIFEST
EXPECT_B="$(sed -n 's/^bundle_sha256:[[:space:]]*\([0-9a-f]\{64\}\).*/\1/p' "$MAN_TXT_FILE" | head -1)"
GOT_B="$(sha256sum "$BUNDLE_DST" | cut -d' ' -f1)"
if [ -n "$EXPECT_B" ] && [ "$EXPECT_B" != "$GOT_B" ]; then
  echo "ERROR: bundle sha256 mismatch (expected $EXPECT_B, got $GOT_B)"
  exit 1
fi
echo ">> sha256 OK"

# restore: fetch bundle refs, hard reset to remote commit, overlay src tarball
git fetch "$BUNDLE_DST" 'refs/heads/*:refs/remotes/pcloud-restore/*' || { echo "ERROR: bundle fetch failed"; exit 1; }
git reset --hard "$REMOTE_COMMIT" || { echo "ERROR: reset failed"; exit 1; }
if [ -n "$SRC_ID" ] && [ -f "$SRC_DST" ]; then
  # tolerate special dirs (e.g. root-owned ./upload) — skip them, git already
  # restored everything tracked; the tarball only adds untracked extras
  tar -xzf "$SRC_DST" -C "$PROJ" --exclude='./upload' --warning=no-failed-read 2>/dev/null \
    || tar -xzf "$SRC_DST" -C "$PROJ" --exclude='./upload' || { echo "ERROR: src tarball extract failed"; exit 1; }
fi
rm -f "$BUNDLE_DST" "$SRC_DST"
echo "RESTORED $REMOTE_COMMIT (from $NEWEST)"
echo ">> note: run 'bun install' and restart dev server after restore."
exit 0
