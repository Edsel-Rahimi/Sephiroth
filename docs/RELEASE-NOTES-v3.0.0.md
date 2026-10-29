# Sephiroth v3.0.0 — Release Notes

**Date:** 2026-10-29 · **Scope:** ROADMAP phases 2 + 3 complete (v2.9.0 waves + v3.0.0 — all 13 roadmap items shipped) · **New home:** `Edsel-Rahimi/sephiroth`

> خلاصهٔ فارسی: وب‌هوک‌های رو-رویداد با صف dead-letter، دریل‌داون کاربران آنلاین، پیشنهاد dest/SNI برای REALITY، سبد خرید چند-آیتمی + کد تخفیف + ریفرال، صف برادکست ضد-۴۲۹، گیت عضویت کانال و بن، متریکس Prometheus، کانال آپدیت stable/beta، پرداخت کریپتو (NowPayments) و Telegram Stars، RBAC چند-ادمین، ربات اختصاصی هر ریسلر و مینی‌اپ فروشگاه داخل تلگرام. همچنین برندینگ مخزن عمومی به `Edsel-Rahimi/sephiroth` منتقل شد.

## v2.9 — Shop & Operations hardening

### Webhooks (wave-1)
- **Per-event URL overrides** — each webhook event can target its own endpoint (falls back to the global URL).
- **Dead-letter queue** — failed deliveries are stored with full request/response snapshots; retry from the panel, viewer card with replay, bounded retry budget.

### Online users (wave-1)
- **Bidirectional drill-down** — IP ↔ user both ways (all sessions behind one IP; all IPs of one user).
- **CSV exports** — live roster and per-IP usage.

### REALITY tooling (wave-2)
- **Dest picker** — scanning a target pre-fills the REALITY forge (dest/serverNames) in the inbound dialog.
- **SNI rotation suggestions** — graded suggestions with an explicit confirm step.

### Shop (wave-2)
- **Multi-item cart** — per-unit provisioning on checkout.
- **Discount codes** — full CRUD, usage caps, single-use codes, validity windows.
- **Referrals** — deep-link invites, wallet reward on the referee's first paid order, referral stats.

### Broadcast & anti-abuse (wave-3)
- **Broadcast queue** — ≤20 msg/s, 429-aware backoff, cancel/interrupt, honest resume + progress UI.
- **Force-join gate** — optional channel-membership check before service actions; ban/unban with fail-open on Telegram API errors.

### Observability & updates (wave-3)
- **Prometheus endpoint** — `GET /api/metrics`, API-token auth, 10 metric families.
- **Update channel** — stable/beta with a 5-minute-cached GitHub Releases check and honest failure states.

## v3.0 — Ecosystem

### Crypto payments (3.3)
- **NowPayments** — settings card (masked secrets), invoice creation, HMAC-SHA512-signed IPN route, verify sweep for pending invoices.

### Telegram Stars (3.3)
- **XTR invoices** in the sales bot, `pre_checkout_query` handling, `successful_payment` ledger with charge idempotency (no double-credit).

### Multi-admin RBAC (3.4)
- Roles **owner / admin / viewer** — viewer is read-only end-to-end; admin manages users but not system settings.
- **Admins management card** + API; last-owner and self-delete protections.

### Per-reseller bots (3.1)
- Each reseller gets **their own Telegram bot token** — multi-instance worker, scoped catalog/customers/orders, masked token storage, status + test-message API and card.

### Telegram Mini App storefront (3.2)
- `/miniapp` storefront inside Telegram with **`initData` HMAC validation**, catalog/checkout/me APIs, cart + discount + payment handoff, Telegram theme variables, honest out-of-Telegram state.

### Repository migration
- Public repo moved to **`github.com/Edsel-Rahimi/sephiroth`** — update-check source, install.sh, Docker OCI labels, docker-compose/ghcr image name, README badges ×6, donate dialog, sub-portal credit and all docs now point at the new home. `package.json` gained `repository`/`homepage`/`bugs`.

## Quality gates
`tsc --noEmit` clean · `i18n-audit` at baseline 1208 (zero new findings, 6-language parity) · live smoke: login, IPN signature rejection, 401/403 RBAC matrices, masked secrets · browser-verified UI for every wave.

## Upgrade notes
- `bun install` (no new runtime deps beyond earlier waves).
- Update channel reads releases from `Edsel-Rahimi/sephiroth` — create the `v3.0.0` GitHub release so existing panels see it.
- Crypto: fill NowPayments `apiKey`/`ipnSecret` in Settings → Payments; set the IPN callback URL to `<panel>/api/payments/nowpayments-ipn`.
- Stars: bot must have `payments` enabled; charges are idempotent per `telegram_payment_charge_id`.
