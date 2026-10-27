#!/usr/bin/env bash
# =============================================================================
# Sephiroth → KataBump deploy bundle builder
#
# Produces /tmp/seph-deploy.zip — a standalone Next.js 16 production bundle:
#   .next/standalone tree + static assets + public + prisma client
#   + socket.io dep tree + realtime sim bundle + server.js + app.py + db
#
# The portable Node runtime is NOT included (it already lives on the server
# at /runtime after the probe). app.py extracts/uses it.
#
# Usage: bash scripts/deploy/build.sh
# =============================================================================
set -euo pipefail

SRC=/home/z/my-project
WORK=/tmp/seph-build
OUT=/tmp/seph-deploy
ZIP=/tmp/seph-deploy.zip

echo "── [1/8] clean workspace"
rm -rf "$WORK" "$OUT" "$ZIP"
mkdir -p "$WORK" "$OUT"

echo "── [2/8] copy clean source"
rsync -a \
  --exclude node_modules --exclude .next --exclude db \
  --exclude upload --exclude download --exclude tool-results \
  --exclude 'dev.log' --exclude 'server.log' --exclude docs --exclude tests \
  --exclude examples --exclude mini-services --exclude .git \
  --exclude scripts \
  "$SRC/" "$WORK/src/"

echo "── [3/8] install deps (full, for build)"
cd "$WORK/src"
DATABASE_URL="file:$WORK/build.db" bun install --frozen-lockfile 2>&1 | tail -2
DATABASE_URL="file:$WORK/build.db" bunx prisma generate 2>&1 | tail -2

echo "── [4/8] next build (standalone)"
DATABASE_URL="file:$WORK/build.db" NEXT_TELEMETRY_DISABLED=1 bunx next build 2>&1 | tail -25

echo "── [5/8] assemble deploy root"
cp -r "$WORK/src/.next/standalone/." "$OUT/"
mkdir -p "$OUT/.next/static"
cp -r "$WORK/src/.next/static/." "$OUT/.next/static/"
cp -r "$WORK/src/public" "$OUT/public"
mkdir -p "$OUT/db"
cp "$SRC/db/custom.db" "$SRC/db/custom.db-wal" "$SRC/db/custom.db-shm" "$OUT/db/" 2>/dev/null || \
  cp "$SRC/db/custom.db" "$OUT/db/"

echo "── [6/8] realtime sim bundle (Prisma mirror replaces bun:sqlite)"
RT="$WORK/rt"
mkdir -p "$RT" "$OUT/realtime"
cp "$SRC/mini-services/core-sim/sim.ts" "$SRC/mini-services/core-sim/types.ts" "$RT/"
cp "$SRC/scripts/deploy/staging/realtime/sim-db.ts" "$RT/db.ts"
cp "$SRC/scripts/deploy/staging/realtime/entry.ts" "$RT/"
cd "$RT"
DATABASE_URL="file:$WORK/build.db" bun build entry.ts \
  --target=node --format=cjs \
  --external:@prisma/client \
  --outfile "$OUT/realtime/sim.js" 2>&1 | tail -3

echo "── [7/8] server.js + next.config.js + app.py + socket.io deps"
cp "$SRC/scripts/deploy/staging/server.js" "$OUT/"
cp "$SRC/scripts/deploy/staging/app.py" "$OUT/"
cat > "$OUT/next.config.js" << 'EOF'
/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: false,
  skipTrailingSlashRedirect: true,
  typescript: { ignoreBuildErrors: true },
};
EOF
# trimmed package.json (metadata only — deps live in the standalone tree)
cat > "$OUT/package.json" << 'EOF'
{
  "name": "sephiroth",
  "version": "1.0.0",
  "private": true,
  "author": "EPODONIOS"
}
EOF
# copy socket.io dependency tree (not traced — server.js loads it directly)
node "$SRC/scripts/deploy/copy-deps.cjs" "$WORK/src/node_modules" "$OUT/node_modules" socket.io

echo "── [8/8] zip"
cd "$OUT"
zip -qr "$ZIP" .
ls -lh "$ZIP"
echo "── deploy bundle ready: $ZIP"
du -sh "$OUT" | awk '{print "uncompressed:", $1}'
