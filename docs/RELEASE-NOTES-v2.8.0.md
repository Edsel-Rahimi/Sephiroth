# Sephiroth v2.8.0 — Release Notes

**Date:** 2026-10-29 · **Scope:** ROADMAP phases 0 + 1 (release prep + bot completion + single-port autopilot)

> خلاصهٔ فارسی: پاکسازی کامل اسرار برای ریلیز عمومی + ابزار خروجی تمیز + LICENSE/CI؛ ربات تلگرام کامل شد (کیف پول، تمدید، /adduser، حذف، ویرایش سهمیه، ریست دستگاه، QR)؛ اتوپایلوت «حالت تک‌پورت» گرفت (دو پروتکل روی یک پورت با فالبک Xray)؛ دیسکورد اسلش-کامند و دکمه گرفت؛ تنظیمات پرداخت/اتوماسیون حالا واقعاً ذخیره می‌شوند.

## Telegram bot (sales worker)
- **Wallet** — per-user balance (`TgUser.balanceToman`); wallet as a shop payment method with a synchronous critical-section deduct (no double-spend); admin `/credit <query> <amount±>` with DM notice and audit trail.
- **Renew / top-up** — 🔄 button on "my subscriptions": pick a paid template, pay (ZarinPal / card / wallet), and the SAME ClientUser is extended — expiry += remaining window + template window, traffic += template cap. Ownership re-verified at completion; orphaned targets park with an admin alert.
- **Admin ops from Telegram** — `/adduser <template>` (creates + delivers, audited as a completed order with method "admin"), 🗑 delete user (two-step confirm, mirrors the panel DELETE data rules), 📋 apply-template quota edit, 📵 reset HWID devices.
- **QR delivery** — PNG QR of the subscription link after provisioning/renewal (best-effort, publicHost-gated). `sendPhoto` now accepts buffer input.
- help ×6 updated; 22 new bot strings across all 6 languages.

## Autopilot — Single-Port mode (KataBump-mode)
- New `POST /api/inbounds/autopilot` mode `single`: adds the ONE complementary protocol (vless↔trojan) to an existing TCP+TLS inbound **on the same public port** via Xray `fallbacks` — for hosts that expose exactly one port.
- Internal loopback inbound on `127.0.0.1:44301+` (identity shared: same emails/subIds), activation written last with rollback discipline, idempotent replay (200 + `already_fallbacked`), honest `link: null` + guidance when no public address resolves; config-builder passes `fallbacksJson` through to `streamSettings.fallbacks` (verified E2E).
- Wizard gets a third mode card with a candidates-only picker (vless/trojan + tls + tcp) and honest empty states.

## Discord bot
- **Slash commands** — global registration on every READY (appId derived from the token; idempotent PUT); INTERACTION_CREATE handling with rich embeds and `/user <query>`.
- **Buttons** — enable/disable/reset/delete (+ confirm) on user cards; admin-gated on every interaction; ephemeral toasts + @original card refresh.
- Status API + worker counters: `commandsRegistered`, `interactions`, `lastInteractionAt`. Known limit: global commands propagate within ~1h of first registration.

## Settings persistence (TODO 18-3 debt cleared)
- Reseller **payment panel** now persists via the settings API; secrets (card number / ZarinPal merchant / USDT wallet) are **masked on read** and only overwritten by fresh values (honest-secret PUT). The GET leak of the raw card number is fixed.
- Telegram-bot panel **automation toggles + backup cadence** persist too (auto-save on toggle).

## Release prep (Phase 0)
- **Secrets purge**: live KataBump IP/SFTP credentials, admin password and recovery key removed from scripts and docs (env-guarded deploy scripts: `KATA_BASE`, `KATA_SFTP_*`, …); contaminated deploy-guide PDF deleted; egress IPs → TEST-NET.
- **`scripts/prepare-public.sh`** — builds a clean publishable tree (excludes live store, worklog, agent-ctx, .pcloud, panels.json → emits `panels.example.json`; verified free of real IPs/credentials).
- **LICENSE** (MIT) · **CONTRIBUTING.md** · **`.github/workflows/ci.yml`** (bun install → lint → i18n-audit).
- **Telegram bot report** — `docs/TELEGRAM-BOT-REPORT.md` (engine complete; this instance runs mode=console with no token — 5-step go-live checklist inside).

## Quality gates
`tsc --noEmit` clean · `i18n-audit` exit 0 (6-language parity) · E2E regression `scripts/e2e-28-notify-whitelabel-bulk.cjs` ALL PASS (18/18) · single-port autopilot verified live (create → idempotent replay → fallbacksJson → cleanup) · browser-verified UI (login, autopilot wizard incl. single-port card + honest empty state).

## Upgrade notes
- `bun install` (new dep: `qrcode`).
- Bot: set mode `sales` + token + `adminChatIds` to leave console mode (see the report's checklist).
- Single-port mode requires the main inbound to be vless/trojan over TCP+TLS.
