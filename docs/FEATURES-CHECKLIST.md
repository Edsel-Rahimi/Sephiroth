# Sephiroth Panel — Master Feature Checklist

**Version: 2.7.0 · Generated: 2026-02 (v2.7 task)**

The single source of truth for every feature, setting and option in the panel —
shipped ✔, partially shipped ◐, planned ☐. Mirrors the UI 1:1 (all views, the
Settings tabs, the bots, the public API) so release/QA can tick boxes against
the running panel.

Legend: ✔ shipped · ◐ shipped with known limits · ☐ planned

---

## 1. Dashboard (`dashboard`)
- ✔ Live socket feed (core:init / core:tick / core:event / core:inbounds)
- ✔ Performance card — CPU / RAM / disk / net pills
- ✔ KPI card — total users, online now, month egress
- ✔ Traffic frequency chart (24H / 7D / 30D)
- ✔ Summary + Pass cards (nodes online, subs/groups)
- ✔ Top consumers with sparkline + trend badge
- ✔ Throughput hero (MB/s, peak/avg/errors/saturation)
- ✔ Quick actions (new client, new inbound, backup now, bot, ⌘K)
- ✔ Uptime tracker (pause/stop controls)
- ✔ Distribution bubbles (connected / idle / limited %)
- ✔ Active alerts (near-limit ≥90%, expiring ≤48h)
- ✔ Live activity feed (warn/error filter, events/min)
- ✔ 6 theme presets + starfield/glow/reduced-motion switches
- ✔ ⌘K command palette (openCommandPalette)

## 2. Inbounds (`inbounds`)
- ✔ Protocol matrix — VLESS, VMess, Trojan, Shadowsocks, Hysteria2, WireGuard (+ AmneziaWG sidecar), TUIC, SOCKS, HTTP, Dokodemo, MTProto sidecar
- ✔ KPI strip (total / online / users / traffic)
- ✔ CRUD with per-protocol dialogs, REALITY section (dest/SNI/flow xtls-rprx-vision/x25519)
- ✔ Sniffing + stream settings (ws/grpc/tcp headers, xhttp)
- ✔ Quick create (simple-panel mode)
- ✔ Autopilot wizard — clone + multi fleet provisioning (Task 25-b)
- ✔ **Autopilot Single-Port mode (v2.8)** — adds the complementary VLESS↔Trojan protocol to an existing TCP+TLS inbound on the SAME public port via Xray `fallbacks` (internal 127.0.0.1:44301+ loopback row, Host-override public link, idempotent replay → 200+warning, honest link:null when no public address resolves)
- ✔ **REALITY Target Scanner (v2.7)** — TLS 1.3 / ALPN h2 / cert / RTT grading, preset + custom targets, ≤30 hosts, copy target
- ✔ Doctor (health scan incl. realityIncomplete audit)
- ✔ Traffic reset per inbound; clientsJson projection sync
- ✔ Core events mirrored to socket feed every 2s

## 3. Hosts (`hosts`) — module toggle
- ✔ Per-inbound share-link overrides (remark, address, port, security, sni, hostHeader, path, alpn, fingerprint, sortOrder, enable)

## 4. Nodes (`nodes`) — module toggle
- ✔ Remote panel nodes (scheme/address/port/basePath/apiToken)
- ✔ Probe / info / stats / apply / syncAll with inbound tag filter
- ✔ Latency + xray version + lastSeen/lastError telemetry

## 5. Outbounds (`outbounds`) — module toggle
- ✔ CRUD (tag, protocol, sendThrough, domainStrategy, settings/stream JSON, mux)
- ✔ Outbound test (per-outbound connectivity)
- ✔ Aggregate traffic reset

## 6. Routing (`routing`) — module toggle
- ✔ Ordered rules (domain/ip/protocol/inboundTag/source lists, port, network, outboundTag)
- ✔ Enable/disable, reorder

## 7. Users (`users`)
- ✔ Table + mobile cards, filters (all/active/expired/disabled/capped/hold), sort (newest/traffic/expiry/name), search
- ✔ Create/edit with sale-template chips, inbound picker, per-user ipLimit + hwidLimit
- ✔ Status derivation: onhold / expired / disabled / capped / active
- ✔ Traffic bar + burn-rate forecast chip
- ✔ Concurrent-IP chip (live snapshot on real core) + HWID device chip
- ✔ User drawer: subId copy/open, usage + manual renew, HWID device list + reset, per-access share links/keys
- ✔ Single enable/disable/renew/delete; optimistic toggle
- ✔ **Bulk actions (11)**: enable, disable, delete, resetTraffic, renew, holdOn, holdOff, autoRenewOn, autoRenewOff, resetDevices, adjust (sparse merge)
- ✔ Bulk create — prefix-NN, 1–100 at once, per-field defaults, quota gates
- ✔ **Import (v2.7 = JSON + CSV)** — lenient aliases (Marzban fields), inbound tags resolution, key reuse, rename/skip collision modes, ≤500 rows
- ✔ **Export (v2.7 = JSON + CSV)** — full snapshot incl. startedAt/renewals/usedTraffic/keys; CSV is Excel-friendly (BOM, RFC-4180) and round-trips
- ✔ Reseller scoping (resellers see only their users)

## 8. Online Users (`online`) — **NEW v2.7**
- ✔ Live roster from core feed (topUsers[].up) with search
- ✔ KPI strip: online now / sessions / connected % / idle % / limited %
- ✔ Per-row: proto badge, traffic, signed delta, quota bar, expiry (d/h/expired), activity spark
- ✔ Concurrent-IP table from /api/users/ip-usage (window badge, live/stale badge, breach highlight)
- ✔ Honest empty/offline/simulator states
- ✔ 30s auto-refresh of IP usage + instant socket-driven roster

## 9. Sub Groups (`subgroups`)
- ✔ Groups with token, optional password, infoLine, enable
- ✔ Membership management; branded public sub page

## 10. Resellers (`resellers`)
- ✔ Reseller accounts (username, password, enabled, maxUsers, trafficQuotaGb)
- ✔ White-label branding (brandName/brandLogo/brandAccent) on subs + panel headers
- ✔ Payment panel (card-to-card / Zarinpal / USDT info cards) — **v2.8: persisted via the settings API with masked secrets** (honest-secret PUT: a masked round-trip keeps the stored value; GET no longer leaks the raw card number)
- ✔ Quota enforcement on user create/bulk-create

## 11. Activity (`activity`)
- ✔ Persisted audit trail (≤500 rows) with kind/level/actor/meta filters
- ✔ Top-nav notification bell (unread dot, last-seen stamp)
- ✔ Kinds: auth.*, inbound.*, user.*, sub.*, reseller.*, settings.updated, backup.*, system.*, **webhook.delivered/failed (v2.7)**

## 12. Guide (`guide`)
- ✔ In-app field guide (all screens) — 6 languages
- ✔ Beginner PDF/HTML catalog (28p Persian zero-to-hero + catalogs v2.6)

## 13. Settings — General tab
- ✔ Language (fa/en/ar/zh/tr/ru, RTL-aware)
- ✔ Appearance: starfield, glow, theme engine presets
- ✔ Top-bar module toggles (hosts/nodes/outbounds/routing)
- ✔ Panel defaults: datepicker (gregorian/jalalian), pageSize, publicHost, subSupportUrl
- ✔ Sub branding: subBrandName / subBrandLogo / subBrandAccent
- ✔ Telegram notify card — token/chatId + per-kind toggles + latency test
- ✔ Telegram bot card — botMode (console/notify/sales), botLang ×6, salesTemplateId, salesPayMode (manual/zarinpal), adminChatIds ≤16, botApiBase, HTTPS proxy, live worker pill (5s poll), test digest
- ✔ **Discord bot card (v2.7)** — enable, token (masked), adminUserIds ≤16 snowflakes, announce channel, prefix, botLang ×6, gateway pill (ready/connecting/reconnecting/stopped), handled/errors/lastEvent counters, test message, MESSAGE_CONTENT hint
- ✔ **Webhooks card (v2.7)** — enable, HTTPS URL, HMAC-SHA256 secret (masked), 11 event toggles, signed test delivery (latency+status), recent-deliveries strip (≤12, ok/fail badges)
- ✔ Backup/restore — payload export/import
- ✔ Auto-backup — enabled, keep 1–30, last-run stamp
- ✔ Core card — driver simulator/xray, apiHost/port, tick, stats interval, xray bin/version pin, hysteria sidecar, singbox secondary core, enforceIpLimit
- ✔ System update (check/download/apply + status)
- ✔ TOTP — enroll/verify/disable with valid codes
- ✔ MTProto sidecar settings
- ✔ Sessions — sessionMaxAge, revoke all

## 14. Settings — API tab
- ✔ Public API info + tokens CRUD (`seph_…`, sha256-stored, prefix, lastUsed, enable/revoke)
- ✔ Swagger UI embed at /api-docs (OpenAPI at /api/openapi.json)

## 15. Settings — Expert tab
- ✔ Core status/log/action/install/test-core
- ✔ Feed settings (logLevel, dnsServers, domainStrategy, freedomStrategy, connIdle, bufferSize)
- ✔ Raw JSON editor, TLS cert/key files, ACME issue/renew (Task 23-f)

## 16. Bots & automation
### Telegram bot (in-process long-poll worker)
- ✔ Modes: console / notify / sales
- ✔ Admin commands: /admin /help /status /users /inbounds /user /backup_now
- ✔ User flows: language picker, menu, shop (templates), trial, subscriptions, support
- ✔ Payments: card-to-card (photo receipts + admin ✅/❌) and ZarinPal v4 (start/verify, 60s verify loop)
- ✔ Provisioning: creates ClientUser from template, delivers sub/clash/singbox links, idempotent state machine
- ✔ Notifications ×15 kinds with per-kind dedupe + toggles
- ✔ Daily sales digest (24h orders/revenue/new users)
- ✔ Free-fulfillment rate-limit (one free order per user)
- ✔ **v2.8 wallet** — per-user balance (`TgUser.balanceToman`), wallet as a shop payment method (synchronous critical-section deduct, no double-spend), admin `/credit <query> <amount>` (± , clamped ≥0) with DM notice
- ✔ **v2.8 renew / top-up** — 🔄 on "my subscriptions": pick a paid template → on payment completion the SAME ClientUser is extended (expiry += remaining + template window, traffic += template cap; ownership re-verified; orphan guard)
- ✔ **v2.8 admin ops** — `/adduser <template>` (audited as a completed order, method "admin"), 🗑 delete user (two-step confirm, mirrors panel DELETE data rules), 📋 apply-template quota edit, 📵 reset HWID devices
- ✔ **v2.8 QR delivery** — qrcode PNG of the sub link after provisioning/renewal (best-effort, publicHost-gated; `sendPhoto` now accepts buffer input)
- ✔ help ×6 updated (/adduser, /credit)
- ◐ Known limit: bot must be configured with a real token to leave console mode
### Discord bot (**NEW v2.7**, gateway worker)
- ✔ Gateway v10 on the runtime WebSocket (zero new deps): HELLO/IDENTIFY/RESUME, heartbeat, invalid-session recovery, 5s reconnect backoff
- ✔ Intents: GUILD_MESSAGES + DIRECT_MESSAGES + MESSAGE_CONTENT
- ✔ Commands (prefix-configurable, default `!`): status, users, user <query>, inbounds, help — admin allow-list enforced
- ✔ Event relay: every notify event (same dedupe windows as Telegram) → announce channel or admin DMs
- ✔ Status API + test-send route + live settings card
- ✔ **v2.8 slash commands** — global registration on every READY (appId derived from the token, idempotent PUT), INTERACTION_CREATE handling with embeds + `/user` query option
- ✔ **v2.8 component buttons** — enable/disable/reset/delete (+ confirm flow) on user cards, admin-gated per interaction, ephemeral toasts + @original card refresh; status carries commandsRegistered / interactions / lastInteractionAt
- ◐ Known limit: global slash commands may take up to ~1h to propagate after first registration
- ◐ Known limit: needs a bot token + MESSAGE_CONTENT intent enabled in the Developer Portal
### Webhooks (**NEW v2.7**)
- ✔ Outbound dispatcher: 11 event families, HTTPS-only, 3 attempts / 1.5s backoff / 6s timeout
- ✔ HMAC-SHA256 signature headers (X-Sephiroth-Event / X-Sephiroth-Ts / X-Sephiroth-Sign)
- ✔ Delivery log (webhook.delivered/failed) + bounded pruning + UI strip
- ✔ Test endpoint (uses unsaved form values)

## 17. Public API (/api/v1)
- ✔ Bearer tokens (seph_), /api/v1/ping, users CRUD+bulk+import/export+ip-usage, inbounds, system info/core-status, activity
- ✔ OpenAPI 3 spec + Swagger UI

## 18. Realtime & infrastructure
- ✔ Socket.IO on the panel port (core snapshot/tick/events/inbounds)
- ✔ JSON store facade (atomic tmp+bak writes, Prisma-compatible API)
- ✔ Maintenance ticker (60s): traffic resets, expiry, auto-backup, ACME renew check, sales digest
- ✔ Sidecars: hysteria2 ×7 engines, sing-box secondary, AmneziaWG
- ✔ pCloud backup toolchain (scripts/pcloud-backup.sh + restore-check) — external offsite
- ✔ Share-links builder (vless/vmess/trojan/ss/hy2/tuic/wg/awg/mtproto/socks/http/doko + clash/singbox bundles)
- ✔ HWID device binding + reset; onHold lifecycle anchors; auto-renew + renewals counter
- ✔ Doctor diagnostics; login brute-force lockout; session HMAC tokens

## 19. i18n & docs
- ✔ 6 languages (fa/en/ar/zh/tr/ru) across dictionaries + sub + guide + live + dashboard + **feature-strings (v2.7)**
- ✔ i18n audit gate (key parity, placeholder parity, artifacts, per-language heuristics)
- ✔ This checklist + worklog + release notes v2.5.0

## 20. Roadmap (planned — not started)

> v2.8 note: wallet/renew/adduser/delete/QR (Telegram), single-port autopilot and Discord slash/buttons shipped from `docs/ROADMAP.md` phases 0–1 — see RELEASE-NOTES-v2.8.0.md.
> v2.9 note: shop cart + discount codes + referral, broadcast queue + anti-abuse, webhooks per-event/dead-letter, online drill-down + CSV, REALITY dest-prefill/SNI-rotation, /api/metrics, update channel — phases 2 (+3.5/3.6) done.
> v3.0 note: NowPayments crypto + Telegram Stars, multi-admin RBAC (owner/admin/viewer), per-reseller Telegram bots, Telegram Mini App storefront — phase 3 done. Remaining planned:
- ☑ Telegram sales: discount codes + multi-item carts (v2.9)
- ☑ Discord slash-commands (interaction endpoints) + button components (v2.8)
- ☑ Webhooks: per-event URL overrides + retry dead-letter queue viewer (v2.9)
- ☑ Online view: per-user session drill-down (IP ↔ user live graph) + export CSV (v2.9)
- ☑ REALITY scanner: batch "pick dest → prefill inbound dialog" action + SNI rotation suggestions (v2.9)
- ☐ Users: per-user traffic speed limit (core-level)
- ☑ Multi-admin RBAC (roles beyond owner/reseller) (v3.0 — owner/admin/viewer, last-owner + self-delete protections)
- ☑ Prometheus/Grafana metrics endpoint (v2.9 — /api/metrics, api-token auth)
- ☐ 2FA recovery-code regeneration UI batch
- ☑ Auto-update channel (stable/beta) selector (v2.9)
