# =============================================================================
#  Sephiroth — Next-Gen Xray VPN Panel · production image (multi-stage)
#
#  Stage 1 builds the SPA (vite) and bundles a single-file server (esbuild,
#  same flags as scripts/deploy/build-katabump.sh) → zero node_modules runtime.
#  Stage 2 ships only server.cjs + dist/ + package.json (~200MB final image,
#  no source, no dev dependencies).
#
#  Build:  docker build -t sephiroth .
#  Run:    docker run -d -p 3000:3000 -v sephiroth_data:/app/db sephiroth
# =============================================================================

# syntax=docker/dockerfile:1

ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------- stage 1: build
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# dependency layer (cached until package.json / bun.lock change)
# --legacy-peer-deps: esbuild 0.25 (server bundling) is outside vite 8's peer range
COPY package.json bun.lock ./
RUN npm install --no-audit --no-fund --legacy-peer-deps

# full source + build
COPY . .
RUN npm run build

# single-file server bundle — exact flags of scripts/deploy/build-katabump.sh
RUN ./node_modules/.bin/esbuild server.ts \
      --bundle --platform=node --format=cjs \
      --alias:@=/app/src \
      --alias:next/server=/app/src/lib/shims/next-server.ts \
      --alias:next/image=/app/src/lib/shims/next-image.tsx \
      --alias:next/navigation=/app/src/lib/shims/next-navigation.ts \
      --external:vite \
      --outfile=/app/server.cjs \
      --log-level=warning

# ---------------------------------------------------------------- stage 2: runtime
FROM node:${NODE_VERSION}

ARG SEPH_VERSION=2.3.1

LABEL org.opencontainers.image.title="Sephiroth Panel" \
      org.opencontainers.image.description="Next-Gen Xray VPN Panel — single-process full-stack (Express + Vite SPA + Socket.IO), zero external DB" \
      org.opencontainers.image.version="${SEPH_VERSION}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/Epodonios/Sephiroth" \
      org.opencontainers.image.url="https://github.com/Epodonios/Sephiroth" \
      org.opencontainers.image.documentation="https://github.com/Epodonios/Sephiroth#readme" \
      org.opencontainers.image.authors="EPODONIOS"

WORKDIR /app

# busybox wget (healthcheck) is present on alpine; keep it explicit for clarity
RUN apk add --no-cache wget \
    && mkdir -p /app/db

COPY --from=build /app/server.cjs /app/server.cjs
COPY --from=build /app/dist /app/dist
COPY package.json /app/package.json

ENV NODE_ENV=production \
    PORT=3000 \
    SEPH_COOKIE_SECURE=auto

# persistent runtime JSON database (db/sephiroth-store.json + auto-backups)
VOLUME ["/app/db"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/auth/session" || exit 1

CMD ["node", "server.cjs"]
