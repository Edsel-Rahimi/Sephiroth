# Sephiroth — Protocol & Transport Gap Analysis (v2.4 → v2.5)

> Feeds the sidecar-protocol task. Verified against Sephiroth `src/lib/inbounds.ts`
> (`IN_PROTOCOLS` / `IN_TRANSPORTS`) and the 3x-ui feature set (README, v3.x).
> Written 2026-10-28 · Task 23-b.

## 1) Inbound protocol matrix

| Protocol | 3x-ui | Sephiroth v2.4 | Engine | Notes |
|---|---|---|---|---|
| VLESS | ✅ | ✅ | Xray | incl. REALITY, flow xtls-rprx-vision |
| VMess | ✅ | ✅ | Xray | |
| Trojan | ✅ | ✅ | Xray | |
| Shadowsocks | ✅ | ✅ | Xray | SS2022 ciphers added v2.5 (server-level method+password) |
| SOCKS / HTTP | ✅ | ✅ | Xray | |
| Dokodemo-door | ✅ | ✅ | Xray | |
| WireGuard | ✅ | ✅ | Xray | per-client keys |
| **Hysteria2** | ✅ | ⚠️ shells only | **sidecar** | UI + `hysteria2://` links + Clash/SingBox exports exist since v2.3, but no server engine (Xray never had it). v2.5 adds a real sidecar binary. |
| **TUIC v5** | ✅ (native Go) | ❌ | **sidecar** | QUIC-based; same sidecar pattern as Hysteria2. No per-user stats API → honest "connections only". |
| **AmneziaWG** | ✅ (userspace) | ❌ | sidecar (research) | amneziawg-go + obfuscation params (Jc/Jmin/Jmax/S1/S2/H1–H4). Needs TUN device → **root required**; cannot run in unprivileged containers (KataBump-style hosts). WireGuard UI is a natural host for the extra fields. |
| MTProto (inbound) | ✅ | ❌ (generator tool only) | skip | Xray-core removed mtproto inbound v24.10; 3x-ui serves its own. Our Settings MTProto tool (secret + tg links + mtg docker cmds) stays the honest path. |
| TUN | ✅ | ❌ | skip | server-side TUN is niche; requires root + routing table surgery. |

## 2) Transport matrix

| Transport | 3x-ui | Sephiroth v2.4+ | Notes |
|---|---|---|---|
| TCP (raw) | ✅ | ✅ | incl. http header obfuscation |
| WebSocket | ✅ | ✅ | incl. early-data |
| gRPC | ✅ | ✅ | |
| HTTPUpgrade | ✅ | ✅ | |
| XHTTP (Splithttp) | ✅ | ✅ | modes auto/packet/stream |
| **mKCP** | ✅ | ✅ **v2.5** | header types none/srtp/utp/wechat-video/dtls/wireguard/dns + seed; UDP-only (validated in config-builder `UDP_ONLY_TRANSPORTS`) |
| HTTP/2 (h2) | ❌ | ❌ | Xray supports it but 3x-ui hides it too — parity is fine |

## 3) Sidecar implementation plan (v2.5)

Pattern (shared for Hysteria2 + TUIC v5): the panel manages one OS process per
sidecar inbound, next to (not inside) the Xray core.

1. **Binary acquisition** — extend `src/lib/core/bin-manager.ts`:
   - Hysteria2: `github.com/apernet/hysteria` releases → `hysteria-linux-amd64` (+arm64) · **MIT license** ✅ (downloader-only shipping keeps the MIT panel clean)
   - TUIC v5: `github.com/EAimTY/tuic` releases → `tuic-server-linux-amd64` · **GPL-3.0** ⚠️ — we only download the binary at runtime (never ship/distribute it in the repo), same approach the install.sh uses for Xray (MPL). Disclose in UI.
   - Cache under `db/bin/<name>/` with `.version` marker (idempotent, like xray).
2. **Config generation** — per inbound row (protocol `hysteria2`/`tuic`):
   - Hysteria2 server YAML: listen `:port`, `auth: {type: password, password: <client key>}` (or userpass map from clients), `tls: {cert, key}` — panel generates a self-signed cert when none managed, obfs (salamander) optional field, `trafficStats: {enabled: true, secret}` for per-user counters, bandwidth caps passthrough.
   - TUIC server JSON: `server: ":port"`, `users: [{uuid, password}]` (clients carry uuid+password), `tls: {cert, key, alpn: [h3]}`, `congestion_control`, `udp_relay_mode`.
3. **Lifecycle** — `src/lib/core/sidecars.ts`: start/stop/restart/reload per inbound (hash-diff restart like the xray driver), unexpected-exit backoff 3/10/30 s, log ring buffer per process, status surfaced via `/api/system/core-status` (`sidecars: [...]`) and the inbound row (🟢/🔴 pill).
4. **Stats** — Hysteria2: poll `GET http://127.0.0.1:<apiPort>/traffic/<secret>` (JSON per-user uplink/downlink counters) → map into client traffic (delta accounting, same as xray stats). TUIC: no stats API → show running state + last-handshake from logs, marked "est." nowhere (honest).
5. **Links** — `hysteria2://<key>@host:port?sni=&insecure=&obfs=&obfs-password=` and `tuic://<uuid>:<password>@host:port?congestion_control=&udp_relay_mode=&alpn=h3` (hostOf rules apply — never leak 0.0.0.0). Clash Meta + sing-box exports already have hysteria2 shells — extend with obfs/bandwidth fields.
6. **Testing** (sandbox-proven procedure):
   - Server boots → `ss -uln` shows the port (QUIC/UDP).
   - Drive REAL traffic: hysteria binary in **client mode** (generated client config with socks5 bind 127.0.0.1:36xxx, server localhost) → `curl --socks5h` through it → trafficStats counter grows → client row updates. TUIC: `tuic-client` same pattern if the release ships it; else config-validate + UDP listen only.
   - Kill -9 → auto-restart; port change → reload.

## 4) AmneziaWG (research, deferred)

WireGuard UI extension: fields Jc (1–128), Jmin/Jmax, S1/S2 (16–90), H1–H4.
Server side = `amneziawg-go` userspace + `awg` tools; needs `/dev/net/tun` +
CAP_NET_ADMIN → **fails in unprivileged sandboxes/containers** (KataBump,
Docker default). Decision: ship the config generator + client .conf export
(obfuscation params included) first; runtime management only when the host has
TUN. GPL-2.0 binary — same downloader-only stance as TUIC.

## 5) Priority order

1. **Hysteria2 real engine** (highest demand, MIT, stats API, fully testable)
2. **TUIC v5** (same framework, cheap once sidecars exist; no stats — honest)
3. AmneziaWG config-gen + export (runtime deferred, root caveat in UI)
4. MTProto inbound / TUN — skipped (keep tools/docs path)
