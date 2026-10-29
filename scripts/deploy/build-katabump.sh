#!/usr/bin/env bash
# =============================================================================
# Sephiroth v2.3.0 → KataBump deploy bundle builder (Vite+Express era)
# Produces /home/z/seph-deploy.zip:
#   server.cjs          — esbuild single-file server bundle (no node_modules)
#   dist/               — vite production build (SPA + copied public/)
#   db/                 — empty (fresh store on first boot)
#   package.json        — start script for Pterodactyl node egg
#   .env                — NODE_ENV=production
# Usage: bash scripts/deploy/build-katabump.sh   (logs → build log via caller)
# =============================================================================
set -euo pipefail

SRC=/home/z/my-project
STAGE=/home/z/seph-stage
WORK=$STAGE/src
OUT=$STAGE/deploy
ZIP=/home/z/seph-deploy.zip

echo "── [1/7] clean workspace"
rm -rf "$WORK" "$OUT" "$ZIP"
mkdir -p "$STAGE" "$WORK" "$OUT"

echo "── [2/7] copy clean source"
rsync -a \
  --exclude node_modules --exclude dist --exclude db \
  --exclude upload --exclude download --exclude tool-results \
  --exclude 'dev.log' --exclude 'server.log' --exclude docs --exclude tests \
  --exclude examples --exclude .git \
  --exclude scripts --exclude skills --exclude '.env*' \
  "$SRC/" "$WORK/"

echo "── [3/7] install deps"
cd "$WORK"
bun install --frozen-lockfile 2>&1 | tail -3

echo "── [4/7] vite build (frontend)"
bunx vite build 2>&1 | tail -6

echo "── [5/7] esbuild server bundle"
bunx esbuild server.ts \
  --bundle --platform=node --format=cjs \
  --alias:@=$WORK/src \
  --alias:next/server=$WORK/src/lib/shims/next-server.ts \
  --alias:next/image=$WORK/src/lib/shims/next-image.tsx \
  --alias:next/navigation=$WORK/src/lib/shims/next-navigation.ts \
  --external:vite \
  --outfile=$OUT/server.cjs \
  --log-level=warning 2>&1 | tail -5
ls -lh "$OUT/server.cjs"

echo "── [6/7] assemble deploy root"
cp -r "$WORK/dist" "$OUT/dist"
mkdir -p "$OUT/db"
cat > "$OUT/package.json" << 'EOF'
{
  "name": "sephiroth",
  "version": "2.3.0",
  "private": true,
  "author": "Edsel-Rahimi",
  "scripts": {
    "start": "node server.cjs"
  }
}
EOF
cat > "$OUT/.env" << 'EOF'
NODE_ENV=production
EOF

echo "── [7/7] zip"
cd "$OUT"
zip -qr "$ZIP" .
ls -lh "$ZIP"
du -sh "$OUT" | awk '{print "uncompressed:", $1}'
echo "── deploy bundle ready: $ZIP"
