# Sephiroth — Panel Gap Analysis vs Competitors

**Task 19-a · research only (no code changed) · sources fetched live from GitHub/docs on research day.**
Baseline: **Sephiroth v2.1.0** (Edsel-Rahimi/sephiroth, single-process Vite+Express, atomic JSON store, Xray *simulator* driver).

Versions researched:

| Panel | Latest release at research time | Source |
|---|---|---|
| 3x-ui (MHSanaei — «سنایی») | **v3.11.0** | README + full source clone (v3/main) + docs.sanaei.dev API reference |
| S-UI (alireza0) | **v1.6.6** | README + wiki Settings Reference |
| x-ui (alireza0 fork) | **v1.15.0** | README + `web/html/xui/settings.html` |
| Marzban (Gozargah) | **v0.8.4** | README (env table, webhook, backup, node) |
| Marzneshin | **v0.7.4** | README |
| Hiddify-Manager | **v14.0.5** | README (feature matrix) |
| Remnawave | **v3.4.7** | docs.rw (sitemap-crawled: features, learn-en, install) |

> Note on 3x-ui: the famous "check & update panel" button is **verified directly in source**, see §"How 3x-ui implements it" below.

---

## Sephiroth today (verified against code, not marketing)

Exists today: 9 inbound protocols (VLESS/VMess/Trojan/SS/Hysteria2/WireGuard/Dokodemo/SOCKS/HTTP) · transports tcp/ws/grpc/httpupgrade/xhttp · TLS/XTLS-Vision/REALITY + fallbacks · Forge dialog with live share-link preview · users with quota/expiry/resetPeriod (daily/weekly/calendar-month cron) · bulk enable/disable/delete/resetTraffic · per-client X25519 WG keypairs · sub-groups + password-locked portal `/sub/[token]` (6 apps, 6 languages) · 4 sub formats (raw/b64/Clash-Meta/Sing-Box) with Subscription-Userinfo + content-disposition + profile-web-page-url + support-url + X-Sephiroth headers + UA sniff · hosts · nodes (probe is still `Math.random`) · outbounds + real TCP test · routing rules + presets incl. WARP outbound · relay tunnels (xhttp-reverse/grpc-mux) · resellers + sale templates + payment-gateway UI (session-preview only) · Telegram terminal (4 commands; `/status` real, `/backup_now` real when token set) · whole-panel backup/restore (manual only) · 6 themes · 6 languages RTL · command palette · 13-chapter guide · brute-force lockout + recovery keys + session revocation.

Does **not** exist: real Xray-core driver (everything runs on the simulator), panel self-update, 2FA, ACME/cert management, IP-limit/fail2ban enforcement, online-client IPs, TG event notifications/scheduled reports, scheduled backups, Xray-JSON sub format, custom sub HTML templates, webhooks, public token API, HWID limit, auto-renewal cycles, on-hold users, node sync engine.

---

## Competitor feature inventories

### 1) 3x-ui (MHSanaei) — v3.11.0  ⭐ the reference panel («پنل سنایی»)
- **Protocols (13):** VLESS, VMess, Trojan, Shadowsocks, WireGuard, **AmneziaWG (userspace, DPI-resistant)**, **TUIC v5 (in-process Go QUIC server, per-client accounting, BBR/New-Reno)**, Hysteria2, **MTProto (per-client FakeTLS secrets, ad-tag, live apply)**, HTTP, SOCKS (Mixed), Dokodemo/Tunnel, **TUN**.
- **Transports/security:** TCP (Raw), **mKCP**, WS, gRPC, HTTPUpgrade, XHTTP · TLS, XTLS, REALITY · fallbacks · **REALITY target scanner** (`scanRealityTarget/s`, ranked by feasibility+latency) · **cert pinning** (`pinnedCertSha256`, remote `xray tls ping` hash) · keygen helpers: X25519, **mldsa65, mlkem768 (post-quantum), ECH cert**, new VLESS encryption.
- **Per-client:** quota, expiry, **IP limit with fail2ban enforcement + trusted-address exemptions**, **HWID device limit**, **scheduled renewal cycles (auto-renew)**, live online status + **connected-client IPs page**, one-click share links/QR/sub.
- **Traffic:** per inbound/client/outbound stats + resets; **online clients**; **xray observatory + metrics history buckets** (cpu/mem/net/online over websockets, persisted every 1m).
- **Multi-node (v3.11!):** manage multiple servers from one panel, **clone inbounds onto nodes**, node API tokens **encrypted at rest**, tunnel health monitor (probe URL → auto-restart xray, cooldown), master can **fan out panel self-updates to nodes**.
- **Outbounds/routing:** WARP, **NordVPN, PIA** built-in outbounds, custom rules, **load balancers with balancer-to-balancer fallback**, **outbound proxy chaining**, browsable geosite/geoip categories in rule editor, **geo-file updater with .sha256sum verification**.
- **Subscription:** built-in sub server, raw/JSON/Clash + UA auto-select, **custom HTML page templates**, ~25-token remark template engine, JSON sub with baked DNS/routing.
- **Bots:** **Telegram AND Discord** — menu-based client management, traffic/expiry warnings, login notifications, CPU threshold alerts, periodic reports, **DB backup push**, invite links.
- **API:** REST with **scoped, optionally-expiring API tokens**, in-panel API reference + published OpenAPI; Terraform provider + Android app exist in ecosystem.
- **Security:** **2FA TOTP on login/settings**, **LDAP sync (LdapEnable/LdapSyncCron)**, random secret URI path, session mgmt, **fail2ban for panel + IP limits**.
- **Certificates:** built-in ACME/SSL cert management with renewal (plus CLI menu), panel TLS + node cert paths resolvable from panel.
- **Ops:** **one-click self-update (see below)**, **in-panel Xray-core version install/switch** (`installXray/:version`), DB backup download (`getDb`) + import with keep-host-settings flag, SQLite↔PostgreSQL + cross-engine migration file, SQLite or Postgres storage, PWA, 14 languages, dark/light, cloud-init unattended install, **release archives published with `.sha256` sidecar**.

### How 3x-ui implements the panel self-update button (row #1 — verified in source)
Flow: settings/index page → `GET /panel/api/server/getPanelUpdateInfo` → `POST /panel/api/server/updatePanel` → poll `GET /panel/api/server/getUpdateStatus`.

1. **Check** (`internal/web/service/panel/panel.go`): `PanelService.GetUpdateInfo()` fetches `https://api.github.com/repos/MHSanaei/3x-ui/releases/latest` and semver-compares `tag_name` vs current (`isNewerVersion`). Optional **dev channel** (`setUpdateChannel`, setting `GetDevChannelEnable`): instead fetches rolling tag `dev-latest` and compares the `commit=<sha>` marker in the release body against the build-injected commit.
2. **Start** (`PanelService.startUpdate`): Linux-only; guards a **single in-flight update slot** (mutex + 20-min staleness + PID-liveness + 2h hard ceiling so a wedged run can't lock out retries). Downloads the **official updater script `update.sh` from repo main** (≤2 MB, temp file chmod 0700), then launches it **detached under `systemd-run --unit x-ui-web-update-<ts>`** with env `XUI_MAIN_FOLDER`, `XUI_SERVICE`, `XUI_UPDATE_TAG` (empty = latest stable, `dev-latest` = dev), `XUI_UPDATE_RUN_ID`, `XUI_UPDATE_STATUS_FILE`, + proxy vars; falls back to a detached bash process when systemd-run is missing. Returns `runId` (UnixNano string).
3. **The updater itself** (`update.sh`, 806 lines): installs deps via distro package manager, resolves target tag, probes that required repo files exist for that tag, downloads `x-ui-linux-<arch>.tar.gz` **plus its `.sha256` sidecar and verifies the checksum — aborts untouched on mismatch**, extracts, replaces the binary in `/usr/local/x-ui`, refreshes the systemd unit + hardening drop-in, `daemon-reload` + restarts the service, and via an **EXIT trap writes a JSON status file** `{runId, state: pending|success|failed, exitCode, finishedAt}`.
4. **Result** (`GetUpdateStatus`): panel reads the status file; the frontend polls and matches `runId` so a stale result from an older run can't be mistaken for this one.
5. **Multi-node bonus:** `NodeService.UpdatePanels(ids, dev)` POSTs `/panel/api/server/updatePanel` to every selected **node panel concurrently**, letting the master upgrade its whole fleet (with per-node `dev` override).

Key takeaway for Sephiroth: the heavy lifting lives in a *versioned shell script fetched at run time*, the Go/Node side only checks versions, launches it detached, and reports a status file — this pattern ports 1:1 to Node (`child_process.spawn detached` + `systemd-run`, status JSON, semver compare of `package.json` version vs `releases/latest`).

### 2) S-UI (alireza0) — v1.6.6
- Built on **Sing-Box** core (not Xray): VLESS, VMess, Trojan, SS, Mixed, SOCKS, HTTP/S, Direct, Redirect, TProxy, **ShadowTLS, Hysteria (1), Hysteria2, Naive, TUIC**; XTLS support.
- Advanced routing UI incl. **PROXY Protocol, external & transparent proxy, SSL certificate and port per rule**; inbound/outbound JSON editors.
- Clients: traffic cap + expiry; online clients; per-inbound/outbound **traffic statistics with bucketed graphs, retention (`trafficAge`), bucket size (`statsBucketSeconds`)**; **global cron traffic reset** (`globalReset` cron expr).
- Subscription service: **link/json/clash + info page**, external links, **JSON + Clash subscription templates (ext keys)**, `subShowInfo` (append remaining traffic/days to remarks), `Profile-Update-Interval`.
- Panel + subscription on separate ports/paths with **domain guards (`webDomain`/`subDomain` reject wrong Host)**, TLS cert files, session max age, secret key.
- **Maintenance mode** (hold core stopped for cert renewal/migration), core watchdog, system status monitoring.
- Settings all readable/writable via **token-authenticated `/apiv2` REST API**; change log of setting edits; 6 languages; dark/light; installer in 6 languages; Alpine/OpenRC + Windows support.
- Update: via installer script / docker pull (no in-panel button).

### 3) x-ui (alireza0 fork) — v1.15.0
- VLESS/VMess/Trojan/SS/Dokodemo/SOCKS/HTTP/WireGuard; XTLS Vision + REALITY; routing UI with PROXY Protocol, reverse proxy, external, transparent proxy, multi-domain, SSL cert per rule.
- **WARP one-click WireGuard outbound**; interactive Xray template JSON editor.
- Clients: traffic cap + **expiry counting from first use**; **per-client IP limit enforced with nftables**; online clients; depleted-clients view; deep DB search.
- Subscription service with (multi)link + info; import/export **inbounds** (`/import` API); **import/export database**.
- **One-click SSL cert application + automatic renewal** (CLI menu option 17, Cloudflare API); HTTPS for panel + sub.
- Telegram bot: daily traffic, **login notifications, CPU threshold, expiry/traffic advance warnings**, client reporting by TG ID/username, anonymous traffic reports by UUID search, menu bot, **periodic DB backup push**.
- **OpenAPI 3.0 spec at `{base}xui/API/openapi.json`** with CI test that fails when routes drift; xray version list + **installXray/:version**, xray restart/stop, logs endpoints.
- Update: install script / CLI menu only (no in-panel panel-update button; Xray version switch IS in-panel).

### 4) Marzban (Gozargah) — v0.8.4
- Xray; Vmess/VLESS/Trojan/SS; multi-protocol per user; multi-user per inbound; **multi-inbound on a single port (fallbacks)**; TLS + REALITY.
- **Multi-node** (marzban-node) for distribution/scalability; per-node **usage coefficient**; nodes via CLI/env.
- Users: traffic + expiry, **periodic traffic limits (daily/weekly…)**, **on-hold (start on first use)**, **auto-delete expired users after N days** (`USERS_AUTODELETE_DAYS`), custom JSON per client app (`USE_CUSTOM_JSON_FOR_V2RAYNG/STREISAND/V2RAYN`).
- Sub links: V2ray/Clash/ClashMeta (+Streisand), **custom subscription page template**, **decoy home page template**, `XRAY_SUBSCRIPTION_URL_PREFIX`, host-level overrides (SNI/ALPN/fingerprint) via UI, **XRAY_EXCLUDE_INBOUND_TAGS**.
- **Webhooks**: `WEBHOOK_ADDRESS` + `x-webhook-secret`, events `user_created/updated/deleted/limited/expired/disabled/enabled`, retries with timeout; **notification thresholds** (`NOTIFY_REACHED_USAGE_PERCENT` 80%, `NOTIFY_DAYS_LEFT` 3).
- Telegram bot: server management, user create/remove, notifications; **backup service: hourly scheduled zip of all files → Telegram, auto-split over TG limits, instant backup command**.
- JWT auth, multi-admin (WIP), **REST API with Swagger/ReDoc at /docs** (`DOCS=True`), full CLI (`marzban-cli`), MySQL/MariaDB/SQLite.
- Update: `marzban.sh @ install` script / docker — **no in-panel update button**.

### 5) Marzneshin — v0.7.4
- Xray (decoupled via **marznode** backends); Vmess/VLESS/Trojan/SS; **multi-node with fault tolerance**; **services** (bundles of inbounds assigned to users); user templates; multi-admin (WIP).
- Users: data limit, expiry, **periodic reset (daily/weekly…)**; nodes statistics; system monitoring.
- Sub links: V2ray/Clash/ClashMeta (+more formats), share link + QR, **custom external sub templates**, sub page customization.
- REST API; 6 languages (en/fa/ar/ku/zh/ru); CLI; Kubernetes roadmap; docker-deployed.
- Update: docker pull — no in-panel button.

### 6) Hiddify-Manager — v14.0.5
- **20+ configs**: Reality XTLS VLESS, Reality gRPC, **SSH**, Hysteria2, TUIC v5, Trojan/VLESS/VMess over TLS WS/TCP/gRPC/H2, ShadowTLS variants, WireGuard, Telegram proxy libs, domain fronting; **dual core Xray + Sing-Box with auto-select**; smart routing modes for CN/RU/IR (domestic direct).
- **Fully automatic maintenance**: **automatic update**, **automatic backup every 6 hours**, **auto-SSL (Let's Encrypt renewal)**, **auto Cloudflare connection + auto CDN IP selection**, DoH endpoint on panel domain, config redirector links (`/redirect/ss://…` deep links).
- **Multiple admin privileges**; user time/traffic limits; **dedicated user pages** for consumption + configs; Telegram bot user management; dedicated WARP; **speed test** page; multi-domain.
- Update: automatic via system (CLI-driven), no in-panel button.

### 7) Remnawave — v3.4.7 (modern Go+React, Postgres)
- Xray only; **multi-node (remnanode) with node autonomy** (nodes keep serving when panel is down); **config profiles**; **hosts managed via Web UI** (sorting, mux settings); Xray-JSON **full validator** (vs JSON-syntax-only); config stored in DB.
- **Users**: HWID device limit (x-hwid headers, per-user/per-squad override, device list + search, HWID response headers), extended filters/selection; **internal squads** (node pools per user group); on-hold ❌ (Marzban-only).
- **Subscription page as a separate deployable component** (bundled or separate server, display-raw-keys mode, many community templates); provider-id response headers.
- **Webhooks (users + nodes)**, **fine-tuned notifications** (per-event × per-channel YAML config for Telegram/webhook), **Telegram OAuth login to the dashboard**, built-in TG notifications (management bot is community).
- **API keys + SDKs (Go/Python/TS/XTLS)**, published OpenAPI; **Rescue CLI** (reset superadmin, re-enable password auth, reset certs, HWID cleanup, SRH cleanup); node billing alerts per node; HAPP integration.
- Update: `docker compose pull && up -d` (panel→nodes→sub-page order) — **no in-panel button**.

---

## GAP TABLE — features competitors have that Sephiroth LACKS

Effort: S ≤1d · M 1–3d · L >3d (Node/TS, single-process assumptions). Priority: P0 critical for public credibility/ops, P1 high, P2 medium, P3 nice-to-have.

| # | Feature | Seen in | Why it matters | Effort | Priority |
|---|---|---|---|---|---|
| **1** | **One-click panel self-update ("check & update") from GitHub releases** | **3x-ui** (only panel with a true in-panel updater) | The user's #1 named gap. Today updating Sephiroth = git pull + restart by hand; 3x-ui owners get "update available → click → done" with checksum verification. Desktop-user trust feature; also proves release discipline. | **M** | **P0** |
| 2 | Real Xray-core driver (run actual xray binary, live traffic stats, real online clients) | literally every competitor | Sephiroth is a simulator: quotas/expiry/IP-limit/online-IPs/charts cannot be *enforced* until a real core executes the config. Blocks rows 7/8/12/16. | L | P0 |
| 3 | Telegram event notifications + scheduled reports (login-failed alert, traffic ≥80% warning, expiry-in-3-days warning, CPU threshold, daily report) | 3x-ui, x-ui, Marzban (thresholds), Remnawave, Hiddify | Sephiroth saves notify flags but nothing reads them; bot is a 4-command terminal. This is the daily-driver feature admins judge panels by. | M | P1 |
| 4 | Scheduled automatic backups (cron) + push to Telegram (auto-split over TG limit) | Hiddify (6h), Marzban (hourly→TG), x-ui (cron→TG) | Sephiroth backup is manual-only. A crash that re-seeds the store is the exact scenario backups exist for. | S | P1 |
| 5 | 2FA TOTP on login (and for sensitive actions) | 3x-ui | Panels hold sellable client secrets; TOTP is table stakes for public release. Sephiroth has lockout+recovery but no second factor. | M | P1 |
| 6 | ACME / one-click SSL issuance + auto-renewal for panel & subscription domains | 3x-ui, x-ui (CF API + certbot), Hiddify (auto) | Without it every deploy needs manual certbot + reverse proxy; competitors do it in-panel. | M–L | P1 |
| 7 | Per-client IP limit enforcement (fail2ban/nftables) + online-client IP list | 3x-ui (fail2ban, trusted IPs), x-ui (nftables) | ipLimit field exists in Sephiroth but is stored-only; account-sharing control is a top seller request in the Iranian market. | M–L | P1 |
| 8 | Xray-JSON subscription format (+ baked DNS/routing in JSON sub) | 3x-ui, S-UI | Hiddify/NekoBox/v2rayN users increasingly expect full-JSON subs; Sephiroth already has sing-box+clash, JSON is the last common format. | S–M | P1 |
| 9 | Multi-node sync engine (push users/inbounds to real nodes; clone inbound to node; node tokens encrypted) | Marzban, Marzneshin, Remnawave, 3x-ui (v3.11) | Sephiroth stores nodes but probe is `Math.random` and no sync engine exists. Required for any "panel for resellers at scale" story. | L | P1 |
| 10 | Public token-authenticated REST API + OpenAPI/Swagger (+ in-panel reference) | x-ui (openapi.json+CI), 3x-ui (scoped tokens), Marzban (/docs), S-UI (/apiv2), Remnawave (SDKs) | Sephiroth API is cookie-only internal; sellers integrate bots/billing via API. | M | P2 |
| 11 | Webhook notifications (user created/expired/limited…, secret header, retries) | Marzban, Remnawave (users+nodes) | Standard integration point for billing bots (Bedolaga etc.); cheap once the notification engine (row 3) exists. | S–M | P2 |
| 12 | HWID device limit (x-hwid headers, device list UI, per-user override) | 3x-ui, Remnawave | Modern anti-sharing beyond IP limit; pairs with row 8 (sub endpoint change). | M | P2 |
| 13 | Custom subscription HTML templates + remark token system (~25 vars) | 3x-ui, Marzban (SUBSCRIPTION_PAGE_TEMPLATE), Marzneshin | Sub portal is fixed-design today; template support = white-labeling for resellers (fits Sephiroth's reseller story). | M | P2 |
| 14 | Bulk client **create** (count × prefix), bulk adjust traffic/expiry, **import/export clients JSON**, inbound import from share-link/URI, clone inbound | 3x-ui, x-ui (/import, /importDB) | Migration from other panels + mass-provisioning; Sephiroth has bulk enable/disable/delete/reset only. | S–M | P2 |
| 15 | In-panel Xray-core version switch + geo-file updater (sha256-verified) | 3x-ui (installXray, updateGeofile), x-ui (installXray) | Depends on row 2; once real core ships, core version control is expected. | M | P2 |
| 16 | Auto-renewal cycles for clients (scheduled reset of expiry/traffic on purchase cadence) | 3x-ui | Resellers sell monthly; Sephiroth resets *traffic* periodically but not expiry/renewal cycles. | S–M | P2 |
| 17 | On-hold users (quota/expiry clock starts at first use) | x-ui, Marzban | Standard "try before clock starts" seller feature. | S | P2 |
| 18 | Missing protocols: TUIC v5, AmneziaWG, MTProto, TUN (3x-ui); Hysteria-1/Naive/ShadowTLS (S-UI); SSH (Hiddify) | 3x-ui, S-UI, Hiddify | TUIC+AmneziaWG are the ones actively requested in Iran-market groups; others niche. | M–L | P2/P3 |
| 19 | mKCP transport (and h2) | 3x-ui | Small config-space completion for the Forge dialog. | S | P3 |
| 20 | REALITY target scanner, cert-hash pinning, post-quantum keygen (mldsa65/mlkem768/ECH) | 3x-ui | Nice differentiators, listed for completeness. | M | P3 |
| 21 | System monitoring: real CPU/RAM/net history charts + xray observatory + logs viewer in panel | 3x-ui, S-UI, x-ui | Sephiroth dashboard telemetry is fabricated by core-sim; needs real core (row 2) then history buckets. | M | P2/P3 |
| 22 | Outbound extras: NordVPN/PIA presets, load balancers + outbound chaining, browsable geosite/geoip in rule editor | 3x-ui | Sephiroth has WARP + presets; these are the remaining deltas. | M | P3 |
| 23 | PWA installability | 3x-ui | Already on Sephiroth roadmap, unchecked. | S | P3 |
| 24 | Secret panel URI path / host-guard / session-age settings | 3x-ui (random access path), S-UI (webDomain guard, sessionMaxAge) | Cheap hardening; Sephiroth has fixed login route. | S | P3 |
| 25 | Traffic-stat retention/bucketing controls; decoy home page; custom JSON per client app; node usage coefficient; Discord bot; LDAP | 3x-ui, S-UI, Marzban | Long tail — park until the top rows land. | M | P3 |

---

## WHERE SEPHIROTH IS AHEAD

- **Reseller economy** — scoped reseller role + sale templates + payment-gateway flows (Zarinpal/USDT/card). No competitor ships built-in resellers/billing (Marzban/Marzneshin only have multi-admin WIP; Remnawave has none).
- **Sub-groups with password-locked portal pages + info line**, branded multi-format subscriptions (raw/b64/Clash-Meta/Sing-Box) **with a complete branded header suite** (`x-sephiroth`, `content-disposition`, `profile-web-page-url`, `support-url`, `Subscription-Userinfo`) — matches/beats 3x-ui's header set.
- **Design & UX**: 6 cosmic themes (competitors: light/dark at best), command palette, 13-chapter field manual, obsidian glassmorphism, live share-link preview inside the Forge dialog, 6 languages with first-class RTL.
- **Relay tunnels** (xhttp-reverse / grpc-mux Iran→foreign with latency test) — only Hiddify offers comparable chaining; 3x-ui has a tunnel *health monitor* instead.
- **Zero-dependency single process** — no SQLite/Postgres/docker required; atomic JSON store with .bak recovery. Simplest install of all seven panels.
- Routing presets (block ads/porn/malware, Iran→direct, block QUIC, Telegram→proxy, WARP one-click) and per-client WireGuard keypairs done right (no server-key leaks).
- Honest post-v2.1 core: expiry + calendar-period traffic resets enforced by cron, atomic persistence, real TCP probes for outbounds.

---

## RECOMMENDED BUILD ORDER (top 10)

1. **Panel self-update button** (P0·M) — copy the 3x-ui pattern: `GET /api/panel/update-info` (compare `package.json` version vs GitHub `releases/latest`), `POST /api/panel/update` (spawn detached `systemd-run`/`bash` job running a versioned `update.sh` that downloads the release tarball + `.sha256`, verifies, swaps, restarts), status JSON file + polling `GET /api/panel/update-status`, stable/dev channel toggle.
2. **Real Xray-core driver phase 1** (P0·L) — generate config from inbounds/outbounds/routing, spawn xray, per-client stats via stats API; unlocks rows 7/15/21.
3. **Telegram notification engine** (P1·M) — read the existing notify flags, thresholds (80%/3-days), login-failed alert, daily report → then webhooks (row 11) fall out of the same event bus.
4. **Scheduled backups + TG push** (P1·S) — cron around existing `buildBackupPayload()`, reuse bot `sendDocument`.
5. **2FA TOTP** (P1·M) — settings + login flow + recovery-code fallback.
6. **Xray-JSON sub format** (P1·S–M) — new branch in `sub/[token]`, reuse sing-box converter knowledge; add remark template tokens.
7. **ACME cert issuance/renewal** (P1·M–L) — in-panel cert store + cron renew; feeds Hosts SNI fields.
8. **IP-limit enforcement + online IPs** (P1·M–L) — after real core; fail2ban or connection-count via xray stats.
9. **Bulk create/adjust + clients import/export + inbound clone/import** (P2·S–M) — quick seller QoL wins, eases migration from 3x-ui/Marzban.
10. **Node sync engine + HWID limit + on-hold users** (P1–P2·L/M) — the scale story; node tokens encrypted at rest like 3x-ui.

*Honorable mentions for fast follow: secret panel URI path (S), mKCP (S), PWA (S), sub HTML templates (M).*
