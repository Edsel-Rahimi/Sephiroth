# PLAN — New VPN Panel (Brand TBD)

> Research date: based on study of 6 panels: 3x-ui, PasarGuard, SuperJinX, NewYork (Gateway), JinX-X4G, VodiWalker Kata

## 1. Research Summary (strengths to adopt, per panel)

### 3x-ui (Go + Vue) — the mature backbone
- Multi-protocol inbounds: VLESS / VMess / Trojan / Shadowsocks / WireGuard / Hysteria2 / TUIC …
- Transports: TCP, WS, gRPC, HTTPUpgrade, XHTTP + TLS / XTLS / REALITY
- Per-client traffic accounting, multi-language, Telegram bot, backups, dark/light
- Weakness: dense/dated UI, steep learning curve

### PasarGuard (Python + React) — the engine
- Multi-node, multi-admin with RBAC, REST API-first
- Periodic traffic limits (daily/weekly), HWID device limits, expiry
- Sub links compatible with V2ray/Clash/ClashMeta, QR generator
- Weakness: VPS-only, setup complexity

### SuperJinX (PasarGuard build for Railway) — reseller + sub page UX
- Reseller role with volume quota, sees only own users; 10 sale templates
- Luxury subscription page (holographic pass card, live ping, QR, one-click connect to 6 apps, FA/EN)
- Self-healing guardian (checks core/groups every 1 min, sub-link every 3 s)
- Security: login lockout after 5 tries, one-time recovery key, in-app password change

### NewYork / Gateway — live dashboard & link limits
- Per-config limits: traffic (KB/MB/GB), speed (Mbps), concurrent IPs, days-based expiry
- Instant enable/disable, custom port / uTLS fingerprint / ALPN per config
- Sub groups: multiple configs → one professional public sub page (password-protectable)
- Live connections, hourly traffic charts, activity/error logs

### JinX-X4G — subscription page delight
- 5 languages, 3 themes (incl. pure-black OLED), glowing QR, one-click app install buttons
- Live usage + expiry on sub page, device detection
- Auto-boosted configs (Chrome fingerprint, early data ed=2048/2560)

### VodiWalker Kata (FastAPI) — customization & sales
- Sales plans (plans.json), Telegram bot with admin management
- Sub remark customization (show name/volume/id/inbound), sub "info line"
- Relay/tunnel modules (tcp_relay, relay_vless, xhttp), speed limit, nodes
- Persisted settings across restarts

## 2. Feature Matrix for OUR panel (what we take from whom)

| Feature | Source inspiration |
|---|---|
| Multi-protocol config CRUD (VLESS/VMess/Trojan/SS) + TLS/REALITY fields | 3x-ui, PasarGuard |
| Per-client traffic + expiry + status | 3x-ui |
| Speed limit / IP limit / periodic reset (daily-weekly) / HWID | PasarGuard, NewYork |
| Reseller system (roles, quotas, own-users-only, sale templates) | SuperJinX |
| Luxury sub page (pass card, glowing QR, one-click apps, themes, FA/EN) | SuperJinX, JinX-X4G |
| Sub groups → one public page (password-protectable) | NewYork |
| Live dashboard: connections, hourly charts, activity log | NewYork, 3x-ui |
| Telegram bot (optional, via webhook/token settings) | PasarGuard, VodiWalker, NewYork |
| Sub customization (remark, info line) | VodiWalker |
| Security: lockout, recovery key, password change, custom paths | SuperJinX |
| One-click deploy story (Docker / Railway) | all |

## 3. Brand
- User has a new brand — name TBD in chat. Working codename: **NOVA** (placeholder until user provides real name).
- Logo: geometric "pulse/shield" mark, gradient accent, dark+light variants, generated with image-generation skill.

## 4. Design Direction (unique, not a clone)
- **RTL-first** Persian UI (Vazirmatn font), EN switchable.
- **Dark-first "Aurora Glass"**: deep graphite background, soft aurora gradient mesh, glass cards, single accent (emerald/violet user-selectable), no blue/indigo default.
- **Bento-grid dashboard**: asymmetric cards (health ring, live gauge, traffic sparklines, activity pulse).
- **Command palette (⌘K)** for power admin: jump to user, create config, toggle theme.
- **Original "Pass Card"** on sub page: layered gradient + shine animation (own design).
- Micro-interactions via framer-motion; skeleton shimmer; toast feedback everywhere.
- Sticky footer, min-h-screen flex layout, mobile-first responsive, 44px touch targets.

## 5. Tech Stack
- Next.js 16 App Router + TypeScript 5
- Tailwind CSS 4 + shadcn/ui (New York) + Lucide
- Prisma + SQLite (schema: Admin, Inbound, Client, SubGroup, SaleTemplate, Setting, ActivityLog, StatSample)
- REST API routes (no server actions), Zustand + TanStack Query
- socket.io **mini-service** (port 3003) for live stats/events, frontend via `io("/?XTransformPort=3003")`
- recharts for charts, framer-motion for motion, next-themes for dark/light
- **Core Adapter pattern**: `lib/core/` with `driver` interface → `simulator` driver (demo/preview, generates realistic traffic) + future `xray` driver (real Xray API) so the panel is production-deployable later.

## 6. Phased Roadmap (live-preview, step by step)
- **Phase 0 — Brand & Design System**: logo/OG images, theme tokens, RTL layout shell, sidebar+topbar, fonts, worklog. 
- **Phase 1 — Auth & Security**: login page, session, lockout, recovery key, password change.
- **Phase 2 — Dashboard**: bento cards, health ring, traffic charts (hourly/daily), live socket stats, activity log.
- **Phase 3 — Inbounds & Configs**: CRUD, protocol/transports/TLS fields, QR + share link, enable/disable, per-config limits.
- **Phase 4 — Clients/Users**: table with search/filter/sort, create wizard, limits (volume/expiry/speed/IP/HWID/periodic), bulk actions, user drawer.
- **Phase 5 — Subscription Page**: public /sub/[token] pass page, QR glow, one-click apps, themes, sub groups.
- **Phase 6 — Reseller System**: roles, quotas, scoped user lists, sale templates.
- **Phase 7 — Settings & System**: core adapter settings, backups (export/import), Telegram bot settings, languages, appearance.
- **Phase 8 — Polish**: empty/error/loading states, a11y, responsive audit, performance, final pass.

Each phase ends with: lint + browser self-verification + worklog append.
