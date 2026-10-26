# Sephiroth — Next-Gen Xray VPN Panel (production image)
# Single-process full-stack: Express API + Vite SPA build + socket.io telemetry
FROM node:22-alpine

WORKDIR /app
RUN apk add --no-cache wget

# Install ALL deps (tsx is required at runtime by server.ts)
COPY package.json bun.lock ./
RUN npm install --no-audit --no-fund

# Build the SPA
COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    SEPH_COOKIE_SECURE=off

# Runtime JSON database lives here — mount a volume for persistence
VOLUME ["/app/db"]

EXPOSE 3000
CMD ["npm", "run", "start"]
