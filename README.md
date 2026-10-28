[English](README.md) | [فارسی](README.fa.md) | [العربية](README.ar.md) | [中文](README.zh.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

<p align="center">
  <img src="public/sephiroth-logo.png" alt="Sephiroth" width="140">
</p>

<h1 align="center">Sephiroth</h1>

<p align="center">
  <strong>Next-generation Xray VPN panel</strong> — obsidian dark UI, glassmorphism, 6 languages, real Xray core driver.
</p>

![Sephiroth v2.5.0 infographic](docs/infographic.png)

<p align="center">
  <a href="https://github.com/Edsel-Rahimi/Sephiroth/releases"><img alt="Release" src="https://img.shields.io/github/v/release/edsel-rahimi/sephiroth"></a>&nbsp;
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>&nbsp;
  <a href="https://nodejs.org"><img alt="Node.js 20 or newer" src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white"></a>&nbsp;
  <img alt="i18n: 6 languages" src="https://img.shields.io/badge/i18n-6%20languages-blueviolet">&nbsp;
  <img alt="Platform: Linux and Docker" src="https://img.shields.io/badge/platform-Linux%20%7C%20Docker-informational">&nbsp;
  <a href="https://github.com/Edsel-Rahimi/Sephiroth/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/edsel-rahimi/sephiroth?style=flat&logo=github&color=22d8ee"></a>
</p>

---

## What is Sephiroth?

**Sephiroth** is an open-source, next-generation control panel for [Xray-core](https://github.com/XTLS/Xray-core) servers. Everything a VPN operator touches — building inbounds, issuing client configs, watching traffic, running the real Xray core — lives behind one calm obsidian-glass cockpit that speaks six languages and treats right-to-left as a first-class citizen. There is no external database to babysit: a single Node.js process with an atomic local JSON store serves the UI, the API, the live telemetry socket and the maintenance cron on one port. Current release: **v2.4.0**.

What makes it different:

- 🪟 **Glass UI with 6 themes** — deep obsidian, cyan neon, platinum silver; six full themes (Sephiroth Cosmic, Jenova Violet, Masamune Crimson, Matrix Terminal, OLED Void Gold, One-Winged Angel) with real RTL.
- 🔨 **Per-client Forge with live preview** — a single dialog builds any protocol; the share link and subscription preview update as you turn the knobs.
- 🩺 **Config Doctor score** — 16 automated health checks with a 0–100 score; nothing like it ships in other panels.
- 📈 **Traffic forecast** — "≈ N days to cap · rate/day" burn-rate chips under every user's traffic bar.
- 💼 **Resellers + sale templates + payment gateways** — a combination no other open-source panel ships.
- ⚙️ **Real Xray core driver** — opt-in production core with true per-user statistics; the built-in simulator stays the zero-setup default.

## Features

### Protocols & Transports

- **9 inbound protocols** — VLESS, VMess, Trojan, Shadowsocks, Hysteria2, WireGuard, SOCKS, HTTP and Dokodemo-door.
- **Security & transports** — TLS and REALITY over TCP, WebSocket, gRPC, HTTPUpgrade and XHTTP.
- **Fallbacks & one-port combo preset** — serve multiple protocols (e.g. VLESS + Trojan + the panel itself) on a single port via Xray fallbacks.

### Management

- **Users, quotas & expiry** — per-client traffic limits, expiry dates, enable/disable and bulk actions; one identity can ride many inbounds.
- **Forecast chips** — burn-rate prediction ("≈ N days to cap") rendered under each user's traffic bar, amber at 7 days, crimson at 3.
- **Sub groups & branded portal** — one public subscription page per group, password-protectable; output as **raw list, Clash Meta (Mihomo), Sing-Box and Xray-JSON**, with `Subscription-Userinfo` metering and QR codes.

### Reliability

- **Real Xray core driver** (opt-in, simulator is the default) — actual Xray-core process built from your inbounds, real per-user/per-inbound stats, kill-resilient auto-restart and hash-diff hot reload.
- **Config Doctor** — 16 checks with a 100-point score: open SOCKS/HTTP proxies, TLS without a certificate, incomplete REALITY, broken fallbacks, duplicated WireGuard keys, dead routing rules, ghost accounts and more.
- **Scheduled backups** — daily server snapshots with N-file retention, one-click download or restore.
- **TOTP 2FA** — zero-dependency RFC-6238 authenticator login; disabling requires a valid code.
- **Self-update button** — check → apply → restart, straight from the panel.

### Business

- **Resellers** — scoped sub-operators with user-count and traffic quotas who can only see the users they own.
- **Sale templates** — one-click plans (traffic, expiry, IP limit) that resellers open instantly.
- **Payment gateways** — ZarinPal, Tether TRC20, TON and card-to-card, with a per-GB tariff and automated payment webhooks.

### Telegram

- **Bot console** — `/status`, `/users`, `/create_trial`, `/backup_now` with instant subscription links.
- **SOCKS5 proxy suite** — Telegram-native `t.me/socks` deep links and scannable QR.
- **MTProto secret tool** — dd/simple secrets, `tg://` links and ready-made daemon commands.

### Operations

- **Server IP auto-detect + free-port wand** — one-click listen-IP dropdown (public → private → all interfaces) and a suggested free port in the Forge, so `0.0.0.0` never leaks into client links.
- **Hosts · Nodes · Outbounds · Routing** — domain overrides for polished links, remote nodes with live probes, outbound chaining, and one-click routing presets (block ads, Iran→direct, block QUIC…).
- **Live ops** — socket-driven telemetry cockpit, live activity feed plus a searchable history with JSON export.
- **6 themes · 6 languages** — obsidian-glass dark UI with first-class RTL (فارسی / العربية) and a ⌘K command palette.

## Screenshots

<details open>
<summary><b>Screenshots & GIFs</b> — click to collapse</summary>

<p align="center">
  <img src="docs/gif-tour.gif" alt="Sephiroth tour — login, dashboard, inbounds, Forge, Config Doctor, core settings" width="92%">
</p>

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-dashboard.png" alt="Dashboard"><br><sub>Dashboard — live telemetry cockpit</sub></td>
    <td align="center" width="50%"><img src="docs/shot-forge-autofill.png" alt="Forge with server IP auto-fill"><br><sub>Forge — one-click server IP auto-fill</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-doctor.png" alt="Config Doctor"><br><sub>Config Doctor — 16 checks, 0–100 score</sub></td>
    <td align="center" width="50%"><img src="docs/shot-sub-portal.png" alt="Subscription portal"><br><sub>Branded subscription portal</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-settings-core.png" alt="Core driver settings"><br><sub>Settings → Core — real Xray driver</sub></td>
    <td align="center" width="50%"><img src="docs/shot-users.png" alt="Users view"><br><sub>Users — quotas, expiry and forecast chips</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-fa-dashboard.png" alt="Persian dashboard"><br><sub>فارسی — dashboard, native RTL</sub></td>
    <td align="center" width="50%"><img src="docs/shot-fa-inbounds.png" alt="Persian inbounds"><br><sub>فارسی — inbounds</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-mobile-dashboard.png" alt="Mobile dashboard"><br><sub>Mobile — dashboard</sub></td>
    <td align="center" width="50%"><img src="docs/shot-mobile-forge.png" alt="Mobile Forge"><br><sub>Mobile — Forge</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/gif-forge.gif" alt="Forge auto-fill in motion"><br><sub>Forge auto-fill in motion</sub></td>
    <td align="center" width="50%"><img src="docs/gif-mobile.gif" alt="Mobile experience in motion"><br><sub>Mobile experience in motion</sub></td>
  </tr>
</table>

</details>

## Quick Start

### One-click install

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/install.sh)
```

The installer detects your distro and architecture, installs system dependencies **plus Node 22**, clones the repository, builds the app and creates a hardened **systemd** service (guarded when systemd is unavailable). At the end it prints the panel URL and a **randomly generated admin password**, and stores both in `/etc/sephiroth/install-result.env` (mode `0600`).

Pin a specific release by passing the tag as an argument (the tag must exist in this repository's git tags — otherwise the installer exits with an actionable hint):

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/install.sh) v2.4.0
```

Unattended / cloud-init — zero prompts, credentials still written to the result file:

```bash
SEPH_NONINTERACTIVE=1 bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/install.sh)
```

> [!IMPORTANT]
> The admin password is printed **once** during install and saved to `/etc/sephiroth/install-result.env` (mode `0600`). **Change it right after the first login** — and turn on the panel's TOTP two-factor authentication.

### Docker

```bash
docker run -d --name sephiroth -p 3000:3000 -v sephiroth_data:/app/db \
  -e SEPHIROTH_ADMIN_USER=admin -e SEPHIROTH_ADMIN_PASS=change-me \
  --restart unless-stopped ghcr.io/edsel-rahimi/sephiroth:latest
```

Or with compose (multi-stage build, named volume, healthcheck included):

```bash
git clone https://github.com/Edsel-Rahimi/Sephiroth.git && cd Sephiroth
export SEPH_PORT=3000 SEPHIROTH_ADMIN_USER=admin SEPHIROTH_ADMIN_PASS='S3cure-Pass!'
docker compose up -d
```

- Host port defaults to `${SEPH_PORT:-3000}` — the panel always listens on 3000 inside the container.
- The JSON store and auto backups live in the `sephiroth_data` volume.
- A built-in healthcheck polls `/api/auth/session`; the prebuilt image is published to `ghcr.io/edsel-rahimi/sephiroth` on every push.

### `sephiroth` CLI

<details>
<summary><b>Management menu</b> — the <code>sephiroth</code> command (items 0–14)</summary>

```text
sephiroth                  # open the interactive menu
  0) exit                  8)  change password
  1) start                 9)  change port
  2) stop                 10)  backup now
  3) restart              11)  restore backup
  4) force restart        12)  check update
  5) status               13)  update panel
  6) logs (follow)        14)  uninstall
  7) logs (last 100 lines)
```

Shortcuts: `sephiroth start | stop | restart | status | logs | update | backup`

</details>

## The Core driver

Sephiroth ships two interchangeable core backends. Switch any time in **Settings → Core**:

| | **Simulator** (default) | **Real Xray core** |
|---|---|---|
| What runs | built-in telemetry simulator | a real **Xray-core** process |
| Config | panel state, previewed | generated from your inbounds, validated with `run -test` |
| Stats | simulated charts | true per-user and per-inbound counters (Xray stats API) |
| Resilience | n/a | kill-resilient auto-restart (3/10/30 s backoff) + hash-diff hot reload |
| Best for | trying the panel, staging | serving real traffic |

When you switch to **Real Xray**, the panel **auto-downloads the Xray-core binary** from the XTLS/Xray-core releases (with unzip → 7z → python3 extraction fallbacks) into `db/bin/xray`. You can pin a specific core version, set the stats interval (5–120 s) and watch the live core log right in Settings. If the real core ever fails to start, the panel falls back to the simulator automatically.

## Documentation

- 📕 **[Full catalog — Persian (PDF)](docs/sephiroth-catalog-fa.pdf)** — the complete visual guide to every view, field and setting.
- 🗒 Release changelogs (Persian PDF): [v2.2](public/sephiroth-v2.2-changelog-fa.pdf) · [v2.3](public/sephiroth-v2.3-changelog-fa.pdf)
- 🧭 The in-panel **Guide** view — 13 chapters that explain every field in plain language, zero jargon.

## Roadmap

**Shipped**

- [x] In-panel self-update (check → apply → restart)
- [x] Scheduled server backups with retention
- [x] TOTP two-factor login
- [x] MTProto Telegram proxy tool
- [x] Config Doctor — 16 checks + score
- [x] Traffic forecast chips
- [x] Real Xray core driver
- [x] Deployment suite — one-click installer · `sephiroth` CLI · Docker / GHCR

**Next**

- [ ] Telegram sales bot (research complete — see `docs/telegram-bot-research.md`)
- [ ] Multi-node sync engine
- [ ] ACME certificate management
- [ ] IP-limit enforcement

## Contributing

Issues and pull requests are welcome — bug reports, translation fixes and feature proposals alike. When touching translations, keep terminology aligned with the panel's in-app language files so the README and the UI tell the same story.

## Support Sephiroth

If Sephiroth makes your day easier, a ⭐ keeps the orbit alive. The in-panel **Donate** dialog lists wallet addresses and support links.

## License

[MIT](LICENSE) © EPODONIOS

## Disclaimer

This project is built for **educational purposes and lawful personal use**. You are responsible for complying with the laws of your jurisdiction; the authors accept no liability for misuse.

---

<p align="center"><sub><b>Sephiroth</b> · crafted by <a href="https://github.com/Edsel-Rahimi">EPODONIOS</a></sub></p>
