# Telegram Sales & Management Bots — Research Report

**Project:** Sephiroth v2.1.0 · Task 19-b (research only — no code changed)
**Scope:** (A) landscape of panels with Telegram sales/management bots, (B) per-bot features & architecture, (C) top-5 strengths/weaknesses table, (D) security review, (E) proposal for "Sephiroth Sales Bot v1" (NOT implemented — awaits user approval).

Sources: GitHub repo metadata + READMEs fetched 2026-10-26 (marzban, 3x-ui, PasarGuard, Bedolaga, Mirza, RemnaShop, 3xui-shop, kavore shop, HolderBot, Sushbot), GitHub search API (queries: `marzban telegram bot`, `marzneshin`, `remnawave telegram`, `vpn shop bot`, `zarinpal telegram bot`, `ربات فروش`, `telegram bot sell vpn config`).

---

## A) Landscape

Two distinct families exist in the wild:

1. **Built-in panel bots (management only)** — ship inside the panel process, read the panel DB directly, serve admins (and sometimes end-users with usage info) but **do not sell anything**:
   - **Marzban (Gozargah/Marzban)** — integrated bot configured via env (`TELEGRAM_API_TOKEN`, `TELEGRAM_ADMIN_ID`, `TELEGRAM_PROXY_URL`). Server management, user create/remove, notifications, scheduled backup service that zips DB and sends it to the admin chat (splits oversized files). Notably supports running **through a proxy** (`TELEGRAM_PROXY_URL`) — required when the panel host cannot reach api.telegram.org.
   - **Marzneshin (marzneshin/marzneshin)** — Marzban fork; same style of integrated admin/user bot, no payments. ★704, AGPL-3.0.
   - **3x-ui (MHSanaei)** — Go panel with built-in **Telegram and Discord** bots: login alerts, DB backup, traffic-threshold and expiry reminders, client search, CPU/memory/status reports, IP-limit violation alerts. Management only, no shop. GPL-3.0, extremely active.
   - **x-ui forks (alireza0/x-ui, FranzKafkaYu/x-ui)** — same pattern (notifications, traffic reports, backup), no sales.
   - **PasarGuard (PasarGuard/panel, ★2756)** — modern Iranian Marzban-successor (Python+React/TS). README lists "**Integrated Telegram Bot**" plus multi-admin RBAC as headline features; positioned as the panel that *does* want the bot inside the product (docs.pasarguard.org has fa/en bot guides). This is the closest architectural precedent to what Sephiroth wants to build.
   - **Remnawave** — the panel itself ships **no** bot; instead it deliberately maintains a rich **third-party bot ecosystem** (Bedolaga, RemnaShop, Mini-Apps) that integrate via its API. This is the "sales bot as a separate product, API-first" model.

2. **Standalone Telegram shop bots** — separate service (PHP/Python/Go) that connects to one or many panel APIs, owns its own DB (users, orders, wallet, payments), and automates the whole sales funnel. Dominant in the Iranian market:
   - **Mirza Bot** (`mahdiMGF2/mirzabot`) — the de-facto Iranian market leader.
   - **Bedolaga** (`BEDOLAGA-DEV/remnawave-bedolaga-telegram-bot`) — leader of the Remnawave ecosystem (RU market).
   - **RemnaShop** (`snoups/remnashop`), **3xui-shop** (`snoups/3xui-shop`, archived→remnashop), **kavore/remnawave-tg-shop** (public archive), **Jolymmiels/remnawave-telegram-shop** (Go, repo unavailable at fetch time).
   - **HolderBot** (`erfjab/holderbot`) — multi-panel *management* bot (no payments).
   - **ZanborPanel** (★277, PHP, multi-panel sales, stale since 2023), **Faoxima** (★124, PHP, active), **VPNMarket/IranEclips** (★161, Laravel+Filament wrapper with auto-sales bot + Android app), **Sushbot** (`soroushdeimi/Sushbot`, small ★6 but the cleanest modern architecture: PTB 21 async + FastAPI + feature flags), **HooshNet**, **ZinixRobot**, **ConfigFlow**, **powerps-core**, **bobres** (Go, bot + Mini App, Zarinpal/USDT/Stars).
   - Many high-revenue Persian shop bots are **closed-source/obfuscated** (sold via Telegram channels) — not auditable; open-source list above is the auditable set.

---

## B) Per-bot feature & architecture matrix

Legend: ✅ yes · ❌ no · ⚙️ partial/optional. "Activity" = last push seen 2026-10-26.

| Bot | Panel integration | Buy/Renew/Trial | Payments | Referral/Reseller | Broadcast | Alerts to admin | QR | Mini App | Lang | License | Activity | Architecture |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Mirza Bot** ★675 | 13 panels: Marzban, Marzneshin, Sanaei/Alireza, S-UI, Hiddify, WGDashboard, MikroTik, IBSng, PasarGuard | ✅ buy, renew, volume top-up, trial, on-hold configs, bulk purchase | Card-to-card (receipt + admin approval), ZarinPal, Aqayepardakht, IranPay, NowPayments, Plisio, CubePay, wallet+refunds | ✅ referral, cashback, discount/gift codes, lottery/wheel, agent/reseller system | ⚙️ report channel+topics | ✅ cron expiry reminders, auto-backup | ✅ | ✅ (user) + web admin panel | fa (61-page docs), en, ru, zh | AGPL-3.0 (Free/Pro split — some modules paid) | Active 2026-10 | Standalone PHP 8.5 + MySQL + Apache, installer on clean Ubuntu |
| **Bedolaga** ★1180 | Remnawave API (3.0+) | ✅ tariffs, traffic packs, device limits 1–20, server auto-select/manual configurator, paid trial, smart cart, **auto-renew 3d before expiry**, gifting via deep-links | **20+ providers in parallel**: Telegram Stars, YooKassa(+SBP), CryptoBot, Heleket, CloudPayments, Freekassa, Platega, RollyPay, AuraPay, Overpay, Donut/Jupiter (P2P SBP QR), Apple IAP, Tribute…; unified balance, recurring cards, auto-check of payment status | ✅ referral with payouts, partner system, promo codes, personal offers, mandatory channel sub | ✅ audience-filtered broadcasts with recipient preview | ✅ purchases/renewals/top-ups into forum topics, DB auto-backups from bot, maintenance auto-detect, traffic anomaly monitor | ✅ | ✅ + separate React "Cabinet" (OAuth, RBAC, sales analytics) | ru, en | MIT | Very active 2026-10 | Standalone Python aiogram3 + PostgreSQL 18 + Redis + FastAPI (webhook+payments) + Docker |
| **RemnaShop** ★532 | Remnawave API | ✅ buy/renew/trial/promocodes (inherits 3xui-shop feature set) | YooKassa, FreeKassa, Platega, SeverPay, CryptoPay, Telegram Stars (per env matrix; RU-centric) | ✅ two-level referral | ✅ to all / active / expired, HTML preview, edit last message | ✅ stats, payment notifications, sync status | ✅ | ⚙️ optional sub Mini App URL | ru, en | MIT | Active 2026-08 | Standalone Python aiogram3 + Postgres + aiohttp webhook + Docker |
| **3xui-shop** ★460 | 3X-UI API | ✅ buy/trial/renew; **server pool with auto-distribution of new clients** | Cryptomus, Heleket, YooKassa, YooMoney, Telegram Stars | ✅ two-level referral, promocodes | ✅ per-user or all, preview | ✅ dev/admin system notifications, DB backup from bot | ✅ | ❌ | ru, en | MIT | **Unmaintained** (README banner: moved to remnashop) | Standalone Python + Docker; plans in plans.json |
| **HolderBot** ★339 | Marzban + Marzneshin (multi-server, multi-panel) | ❌ (management only) — bulk creation w/ templates + suffixes, QR delivery | ❌ | ❌ (admins/owner transfer) | ⚙️ bulk ops | ✅ node monitoring + **auto node restart** | ✅ | ❌ | en (fa community) | none (no license file) | Stale 2025-05 | Standalone Python + Docker |
| **Marzban built-in** ★~30k | Itself (in-process) | ❌ | ❌ | ❌ | ❌ | ✅ notifications, hourly backup service (auto-split files) | ⚙️ (share links) | ❌ | en/fa | AGPL-3.0 | Very active | In-process Python, env-config, optional `TELEGRAM_PROXY_URL` |
| **3x-ui built-in** ★~25k | Itself (in-process) | ❌ | ❌ | ❌ | ❌ | ✅ login alerts, backup, traffic/expiry reminders, IP-limit alerts, CPU/mem | ⚙️ | ❌ | 14 langs | GPL-3.0 | Very active | In-process Go |
| **PasarGuard** ★2756 | Itself (in-process) | ⚙️ bot is a first-class built-in module (fa/en docs); sales flows via its bot+RBAC multi-admin | ⚙️ (docs list gateway configs) | ⚙️ multi-admin RBAC | ⚙️ | ✅ | ✅ | ⚙️ sub template | fa/en/ru/zh | AGPL-3.0 | Very active 2026-10 | In-process (panel service), SQLite/MySQL/PG |
| **Sushbot** ★6 | Marzban HTTP API, PasarGuard (direct DB) | ✅ buy/trial/protocol picker per product/renew/rotate | Card-to-card (photo → approve/reject), NowPayments (IPN), Aqayepardakht | ✅ affiliate, discount, refunds, transfers | ⚙️ | ✅ daily admin report, expiry/low-traffic reminders, payment reconcile job | ✅ | ❌ | fa/en | MIT/AGPL mixed header | Small but active 2026-10 | Standalone python-telegram-bot 21 async + FastAPI webhook + Postgres + 35 feature flags + Fernet-encrypted panel creds |

Common denominator of every *sales* bot: template/product catalog → payment choice → **auto user provisioning in the panel on payment success** → deliver subscription link (+QR) → wallet/history → renewal reminders. Payments are the whole product; provisioning is trivial.

**Most common payment gateways across the Iranian-market bots:** ① ZarinPal (online, IRR), ② card-to-card manual (receipt photo → admin approve/reject), ③ crypto via NowPayments / Plisio / Cryptomus / Heleket / CubePay / CryptoBot / CryptoPay (USDT-first), ④ internal wallet/balance, ⑤ other Iranian gateways (Aqayepardakht, IranPay, IDPay, Zibal), ⑥ Telegram Stars (newest, already in 3 bots). RU-market bots add YooKassa/Freekassa/Platega/SeverPay — irrelevant for Sephiroth's target user but useful as payment-adapter design reference.

---

## C) Top-5 strengths & weaknesses (ranked by market fit + quality)

| # | Bot | Strengths | Weaknesses |
|---|---|---|---|
| 1 | **Bedolaga** (Remnawave) | Most feature-complete open shop bot (20+ parallel payment providers, auto-renew, gifting, audiences, RBAC, topic notifications); MIT; excellent docs; web cabinet as separate repo | Heavy stack (Postgres+Redis+FastAPI on top of the panel); RU-payment-centric — no ZarinPal/card-to-card; big config surface; bot UX texts RU-first |
| 2 | **Mirza Bot** | Exact match for the Iranian market: ZarinPal + card-to-card receipt approval + crypto; 13 panel adapters; wallet, referral/cashback, reseller agents, lottery; 61-page fa docs; Mini App + web admin | Separate LAMP stack to install/maintain; PHP; **AGPL-3.0** (can't copy code into MIT Sephiroth); Free/Pro paywall splits features; installer demands a clean server |
| 3 | **RemnaShop** | Clean aiogram3 architecture; MIT; full sales funnel (trials, promocodes, 2-level referral); broadcast tooling is a good UX reference | RU gateway focus; thin English docs (mostly RU); tied to Remnawave API shape |
| 4 | **3xui-shop** (as reference) | Server-pool concept (auto-distribute clients across servers) is worth copying conceptually; simple plans.json; MIT | **Abandoned** (README says moved to remnashop); plans only in a JSON file, no admin CRUD for them |
| 5 | **Sushbot** (architecture reference) | Best-practice skeleton: async PTB21 + FastAPI webhook, Fernet-encrypted panel credentials, 35 feature flags, idempotency keys on payments, audit log, tickets, dynamic config editable from chat, fa/en | Tiny community (★6), few battle-test hours; no Mini App; dual AGPL/MIT header ambiguity |

Honorable mentions: **HolderBot** (multi-panel bulk ops + node auto-restart — good admin-side inspiration), **PasarGuard built-in bot** (proof that in-process panel bots with RBAC work at ★2.7k scale), **bobres** (bot + Mini App + Zarinpal/USDT/Stars in Go).

---

## D) Security review of these bots

**Token handling**
- Most bots keep `BOT_TOKEN` in `.env` with 0600; panels keep it in their config DB. Bedolaga stores NaloGo/OAuth tokens atomically with `0600` and warns never to publish them; Sushbot **encrypts panel credentials at rest (Fernet)** and treats the encryption key as unrecoverable-if-lost. Common gap: many bot *backups* (DB dumps sent to the admin chat) contain the token/session secrets in plaintext.
- Telegram Bot API URLs embed the token (`/bot<token>/…`); bots that log full request URLs leak tokens into logs. Rotation via @BotFather is the standard remedy.

**Admin chat-id verification**
- Universal pattern: numeric `ADMIN_IDS` allowlist (Marzban `TELEGRAM_ADMIN_ID`, 3xui-shop `BOT_ADMINS`, kavore `ADMIN_IDS`, Bedolaga `ADMIN_IDS`). Checks must be on `update.effective_user.id` on **every** message *and* callback, not just commands — several forks historically checked only `/admin` text commands, so button callbacks bypassed admin checks.
- Footgun found in Sushbot: `SUPER_ADMIN_TELEGRAM_ID=0` ⇒ **first user to /start becomes super admin**. Convenient for bootstrap, catastrophic if deployed unset.
- Group-chat hazard: commands intended for admins must compare `from.id` (not `chat.id`); otherwise any member of a group where the bot is admin can trigger admin actions, and bot replies can leak subscription links into the group.

**Callback auth**
- aiogram/PTB state machines (FSM) are keyed by user id — safe by construction. Danger: bots that pack sensitive state into `callback_data` (e.g., order id, plan id) and act on it without re-checking that the *sender* owns that state — e.g. replaying another user's "approve payment" callback or guessing order ids. Mitigations seen in the better bots: server-side state keyed by tg id (Bedolaga FSM + re-validation), idempotent claim semantics for gift codes ("first claim wins, later attempts 404"), tokens never placed in callback_data/logs (Bedolaga explicitly documents this).

**Payment webhook verification**
- **NowPayments**: IPN callback must be verified by recomputing **HMAC-SHA512 over the sorted JSON body with the `ipn_secret`** and comparing to `x-nowpayments-sig`; then re-fetch the payment status from the API server-side. Sushbot validates "all IPN callbacks + signatures + idempotency keys".
- **ZarinPal**: flow is redirect → callback with `Authority` → **server-side `/pg/v4/payment/verify.json`** call; the amount sent to verify must equal the original order amount; never provision on the client callback alone. (Several small Persian bots historically provisioned on the callback GET without verify — free configs.)
- **YooKassa/Freekassa/Platega/SeverPay**: notification signature/secret2 checks, IP allowlists (FreeKassa sends the server IP to verify).
- **Card-to-card**: the "gateway" is a human — mitigations in Mirza/Sushbot: receipt *photo* attached, admin approve/reject buttons (`/payapprove`, `/payreject`), duplicate-amount dedupe, audit trail. Fraud vector: fake edited receipts / reused screenshots → dedupe by (amount, date, sender) and admin review.
- **Idempotency**: the single most important invariant — one order must transition `pending → completed` exactly once (DB transaction / unique constraint), otherwise wallet credit and provisioning happen twice on webhook retries. Bedolaga documents replay-attack protection and "sticky status guards" for its P2P partners; Sushbot lists idempotency keys explicitly.

**Rate limiting / abuse**
- Telegram-level: ~1 msg/s per chat, 30 msg/s global — broadcast tools must queue with backoff on 429 `retry_after` (Bedolaga/RemnaShop implement queueing).
- Bot-level: Sushbot exposes "rate limits, auto-ban thresholds" in its dynamic config; Bedolaga ships a shared blacklist file (`BLACKLIST_CHECK_ENABLED`, one tg id per line) plus admin ban management.
- Forced channel-membership checks (`is_member` via getChatMember) double as an anti-abuse gate (Mirza, kavore, Sushbot).

**Common vulnerabilities across the set (checklist for us)**
1. Webhook endpoint without `X-Telegram-Bot-Api-Secret-Token` check → anyone can POST fake updates (kavore sets `TELEGRAM_WEBHOOK_SECRET` — recommended).
2. Admin check only on command, not callback / only on `chat.id`, not `from.id`.
3. Provisioning on unverified payment callbacks (ZarinPal) or trusting amount/plan from client-supplied callback_data.
4. No idempotency on webhook retries → double provisioning / double wallet credit (race without DB transaction).
5. Tokens & panel creds in plaintext dumps sent to Telegram backups.
6. Telegram **Mini App `initData` not validated** — must HMAC-SHA256-verify `data_check_string` with secret key `HMAC_SHA256(bot_token, "WebAppData")` before trusting `user.id`.
7. Legacy PHP bots: unparameterized SQL, world-readable `.env`, no CSRF on the web admin panel.
8. Logging full Bot API URLs / payment authorities.
9. Unbounded broadcasts → account ban (Telegram ToS on spam) and 429 storms.
10. SSRF: user-editable panel URL used by multi-panel bots (Sushbot mitigates by admin-only panel CRUD + connection tests).

---

## E) Proposal — "Sephiroth Sales Bot v1" (design only, awaiting approval)

### Positioning
Keep the existing admin console bot (the `tgBot` settings card + `/status` `/users` `/create_trial` `/backup_now` executor at `POST /api/telegram/bot-action`) as the **test console**, and add a **Sales Bot worker** as a new mode. Precedent: PasarGuard ships its bot inside the panel; Sephiroth can too, with zero extra services (no Postgres/Redis/Docker needed — the JSON store is already there and the panel is single-process).

### Admin configuration (Settings → Telegram, extends what exists today)
- `botToken` — already stored in the settings store and masked in UI (`maskBotToken`); keep.
- `botMode`: `console` (today's behavior) | `sales` (new long-poll worker) — worker starts on boot if `sales` + token present.
- `adminChatIds` — comma-separated list (new; today only a single `chatId` exists) — allowlist for admin flows; owner chat id first.
- `botProxyUrl` — optional HTTPS/SOCKS proxy for api.telegram.org (Mirza/Marzban both support this; Iranian-hosted panels can't reach Telegram directly).
- `shopLang`: fa | en default for new users (per-user choice remembered).
- Payment credentials live in the **existing payment settings card** (card / ZarinPal merchant / tether / wallet keys already exist in `payment` i18n) — the bot only reads them.
- `saleTemplate` gains price fields (currently: name, trafficLimitGb, expiryDays, ipLimit, enabled — **no price**): `priceToman` (+ optional `priceUsd`), plus `botVisible` flag.

### Architecture & the panel APIs it would call
- **Single-process Node/Bun long-polling worker** (`getUpdates` with offset, ~1s loop, sequential to avoid Telegram 429s) started/stopped by the settings lifecycle. In-process ⇒ it calls **the same lib functions the API routes use** (`db`, `syncUserProjection`, `genAccessFields`, `buildBackupPayload`, `logActivity`) — no HTTP hop, no duplicate auth surface. If we later want it out-of-process, the same feature set maps 1:1 onto existing routes with an internal token header:
  - `GET /api/sale-templates` — shop catalog (enabled only)
  - `POST /api/users` (+ `syncUserProjection` equivalent) — provisioning on payment success
  - `GET /api/users` — "my subscriptions" & admin stats
  - `GET /api/settings/backup` — `/backup` admin command (already proven by `/backup_now`)
  - `GET /sub/<subId>` (+ `?format=clash` / `?format=singbox`) — delivery links; QR generated from `publicHost + /sub/<subId>`
  - `POST /api/telegram/bot-action` — kept for the console mode
- New store collections: `tgUser` (tgId ↔ ClientUser, lang, ban flag), `tgOrder` (id, tgId, templateId, amount, method, status, authority/receiptFileId, createdAt, provisionedUserId) — write via a single transactional transition to guarantee idempotency.

### User flow
`/start` → language pick → inline main menu **(🛒 Shop · 📦 My subscriptions · 🎁 Trial · 💰 Balance · 🆘 Support)** → Shop lists enabled Sale Templates (name, GB/days/IPs, price) → payment picker →
- **ZarinPal**: send payment URL → callback/verify server-side (amount match) → complete;
- **Card-to-card**: show card number+holder → user uploads receipt photo → order `pending_manual` → admin gets photo + ✅/❌ buttons;
- **Wallet**: instant deduct (Phase 2);
on `completed` → create `ClientUser` (generalize the existing `/create_trial` logic; reuse `genAccessFields` + `syncUserProjection`) → deliver message with sub link + Clash/Sing-Box URLs + **QR photo** + app tutorials → log via `logActivity` (actor: `telegram-bot`).

### Admin flow (only for `adminChatIds`, checked on every update & callback)
`/admin` → **📊 Stats** (users enabled/total, revenue today/week, pending orders) · **🧾 Pending card payments** (photo preview, approve/reject) · **📢 Broadcast** (compose → preview → confirm → queue with 429 backoff) · **🔔 Guardian settings** (reuse the already-i18n'd `tgBot.guardian` concept: expiry ≤3 days & traffic <10% alerts to user + admin, wired onto the existing maintenance cron) · **⚙️ quick ops** (`/status`, `/users`, `/backup_now` unchanged).

### Phased roadmap
- **Phase 1 — MVP (~1 week)**: worker + mode/admin-ids/proxy settings; `/start` menu; Shop from saleTemplate (fa/en); **ZarinPal + manual card-to-card**; auto-provision ClientUser + deliver sub link & QR; admin new-order & payment-approval notifications; basic `/stats`; idempotent order transitions; full `logActivity` audit.
- **Phase 2 — full shop**: wallet + renew/top-up existing subs; trial flow for new tg users; referral codes; broadcast queue; guardian alerts (expiry/low-traffic); support chat forwarding (forward to owner, reply back); Telegram Stars.
- **Phase 3 — pro**: NowPayments/crypto; promo codes; Telegram **Mini App** shop (reuses the sub-portal design language); reseller sub-bots (per-`Reseller` bot token with scoped catalogs — mirrors Sephiroth's reseller table); gifting via deep-links; multi-panel federation.

### Risks
1. **Reachability**: api.telegram.org is blocked from IR-hosted servers → `botProxyUrl` is a Phase-1 requirement, not a nice-to-have.
2. **JSON store concurrency**: orders + wallet must mutate through one transactional path; long-poll loop must stay single-instance (lock on settings) to avoid `getUpdates` 409 conflicts.
3. **Payment fraud**: card-to-card receipts are forgeable → require photo + amount/date match + dedupe + admin approval (Phase 1 keeps manual approval mandatory).
4. **Secrets in backups**: verify whether `buildBackupPayload` includes settings; if it can carry the bot token, mask/exclude it before shipping backups to chat.
5. **Telegram ToS**: broadcasts must be opt-in-ish and rate-limited; 429 handling mandatory.
6. **License hygiene**: Mirza (AGPL) and Marzban (AGPL) code must not be copied into MIT Sephiroth — implement from scratch; MIT projects (Bedolaga/RemnaShop) are reference-only too.
7. **Dev-server lifecycle**: Vite restarts would kill the poller → worker must auto-respawn on boot and self-heal on repeated getUpdates failures (backoff, then alert the admin chat).

---

### Quick reference — repos studied
| Repo | ★ | License | Status (2026-10-26) |
|---|---|---|---|
| BEDOLAGA-DEV/remnawave-bedolaga-telegram-bot | 1180 | MIT | active |
| PasarGuard/panel | 2756 | AGPL-3.0 | active |
| marzneshin/marzneshin | 704 | AGPL-3.0 | active |
| mahdiMGF2/mirzabot | 675 | AGPL-3.0 | active |
| snoups/remnashop | 532 | MIT | active |
| snoups/3xui-shop | 460 | MIT | **unmaintained** |
| Jolymmiels/remnawave-telegram-shop | 359 | AGPL-3.0 | repo unavailable |
| erfjab/holderbot | 339 | none | stale |
| ZanborPanel/ZanborPanel | 277 | none | dead (2023) |
| kavore/remnawave-tg-shop | 274 | MIT | **public archive** |
| IranEclips/VPNMarket | 161 | none | semi-active |
| Mmd-Amir/Faoxima | 124 | GPL-3.0 | active |
| MHSanaei/3x-ui · Gozargah/Marzban · soroushdeimi/Sushbot | — | GPL/AGPL/MIT | active |
