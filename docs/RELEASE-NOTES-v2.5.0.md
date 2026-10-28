# Sephiroth v2.5.0 — Fleet & Commerce Release

> Next-generation Xray VPN panel — obsidian glass UI, six languages, full RTL — now with a **second engine, a sales bot, and a fleet**.

---

## ✨ Highlights

**🛒 Telegram Sales Bot (Phase 1)**
- Long-poll bot worker (`src/lib/bot/*`): single-instance, 1/5/30 s backoff, `SEPH_TG_API_BASE` override for mocks/proxies
- Shop mode with per-template pricing (`priceToman` + `botVisible`), multilingual bot texts (6 languages)
- **ZarinPal v4** payments (request/verify) + **card-to-card manual approval** (admin sends receipt photo → approve in chat)
- Fully automatic provisioning: order completed → `genAccessFields` + user projection → delivery message with `/sub/` link
- `/admin` live stats, admin chat notifications (bot-notify: panel restarts, new orders), `botMode: off | notify | sales`
- E2E-verified 13/13 against a mock Bot API (start → language → shop → template → card → photo → approve → completed → delivery)

**🛰 Multi-Node Fleet (v1)**
- Remote agents: run Sephiroth with `SEPH_NODE_MODE=1` + `SEPH_NODE_SECRET` (constant-time compare) — `/api/agent/{info,inbounds,apply,traffic}`
- Master-side fleet manager: `/api/nodes` CRUD, config push (`syncAll` or per-`inboundTags`), info probe, traffic rollup
- **Fleet UI**: nodes view with add-node wizard, masked tokens, Apply / Refresh / Traffic actions, online/offline/latency cards
- E2E-verified 11/11 (agent :3104 + master :3105): push applied=2, wrong secret 401, agent info probe OK

**🔌 New protocols & transports**
- **mKCP** transport in Forge (header types: none / srtp / utp / wechat-video / dtls / wireguard / dns + obfuscation seed)
- **Shadowsocks 2022** ciphers (`2022-blake3-aes-128-gcm`, `2022-blake3-aes-256-gcm`, `2022-blake3-chacha20-poly1305`) with base64 key-length validation (16/32-byte keys → 24/44 chars)
- **Hysteria2 sidecar protocol** (QUIC-based) selectable in Forge alongside VLESS / VMess / Trojan / Shadowsocks
- Share links, Clash and sing-box subscription formats updated for all of the above

**🧭 Dual engine — Xray + sing-box**
- **sing-box secondary core** (`src/lib/core/singbox.ts`): config builder, binary manager (checksummed auto-download), registry-driven selection
- Settings → Core: Simulator / Xray / sing-box, per-core version pinning, health-checked core actions
- Hysteria2 sidecar binary lifecycle managed alongside the active core

**🔐 SSL / ACME in-panel**
- Issue & renew certificates without leaving the panel (`src/lib/acme.ts` + `ssl-issue` / `ssl-install-acme` routes, SSL card UI)

**🛡 Abuse control**
- **Per-client IP limits** with live IP usage API + bulk user actions
- **HWID device binding** (per-user device count, reset-devices endpoint, users-view device manager)

**📚 Documentation wave**
- **Catalog ×6 languages** — 20-page obsidian PDF in en / fa / tr / ru / ar / zh (`/sephiroth-catalog-<lang>.pdf`, served by the panel)
- **README infographic** (SVG + 2× PNG) embedded in all six READMEs with localized alt text
- `docs/protocol-gap-analysis.md` + `docs/protocol-gap-report.md` — protocol matrix, sidecar plan, licenses, test plan

## 🌍 i18n & quality
- Lint **0 errors**; golden-path browser E2E re-verified on v2.5.0 (login → Forge protocols → SS2022 ciphers → NodesView → 401-gated system APIs, console clean)
- Store untouched by E2E runs (all acceptance on throwaway /tmp copies)

## 📦 Install
```bash
# one-click (recommended)
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/install.sh)

# pinned version
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/install.sh) v2.5.0

# unattended
SEPH_NONINTERACTIVE=1 bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/install.sh)
```
```bash
# docker
mkdir -p db && docker run -d --name sephiroth -p 3000:3000 -v "$PWD/db:/app/db" --restart unless-stopped ghcr.io/edsel-rahimi/sephiroth
```
After install run `sephiroth` for the management menu. **Change the generated admin password and enable TOTP 2FA.**

## ⬆️ Upgrade
- Git installs: `sephiroth update` (or the in-panel **Software Update** button)
- Docker: pull the new image and recreate the container (db volume survives)
- Prebuilt bundle: replace `server.cjs` + `dist/`, keep `db/`

---

### 🇮🇷 خلاصه فارسی
نسخه ۲.۵.۰: ربات فروش تلگرام (فروش خودکار با زرین‌پل و کارت‌به‌کارت، تحویل خودکار کانفیگ)، ناوگان چندنودی (پوش کانفیگ به نودهای دور + نمای ناوگان)، پروتکل‌های جدید (mKCP، Shadowsocks 2022، Hysteria2)، هسته دوم sing-box در کنار Xray، صدور گواهی SSL/ACME داخل پنل، محدودیت IP و قفل دستگاه HWID، کاتالوگ ۲۰ صفحه‌ای در ۶ زبان و اینفوگرافیک README.

**Full changelog:** https://github.com/Edsel-Rahimi/Sephiroth/commits/main · **Docs:** `docs/sephiroth-catalog-<fa|en|tr|ru|ar|zh>.pdf`
