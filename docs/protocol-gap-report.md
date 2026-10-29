# Sephiroth — Missing Protocols Audit vs 3x-ui + Sing-box Secondary Core (v2.6)

> Task 23-c. Research phase output — every verdict below was verified against
> LIVE sources on 2026-10-28, not from memory:
> - 3x-ui: `MHSanaei/3x-ui` @ `main` — **`internal/database/model/model.go`**
>   (the old `database/model/model.go` path 404s; the repo was restructured
>   into `internal/`) + the `internal/{tuic,mtproto,amneziawg}` package tree.
> - sing-box: official release **v1.14.4** (linux-amd64 tar.gz) downloaded,
>   run and probed in this sandbox (`sing-box version`, `sing-box check`,
>   real client/server traffic) — facts below are binary-verified.
> - Sephiroth: `src/lib/inbounds.ts` IN_PROTOCOLS / `src/lib/core/*`.

## 1) Gap table — 3x-ui vs Sephiroth

| Protocol | 3x-ui (main, model.go) | Sephiroth v2.5 | Engine 3x-ui uses | Engine we use (v2.6) | Feasible in our driver? |
|---|---|---|---|---|---|
| VLESS / VMess / Trojan / SS / SOCKS / HTTP / Mixed | ✅ | ✅ (vless/vmess/trojan/ss/socks/http) | Xray-core | Xray-core (real driver) | — parity |
| Dokodemo / TUN / tunnel | ✅ | ✅ dokodemo · ❌ tun | Xray (dokodemo), native (tun) | Xray dokodemo | TUN = privileged client/server device, see §4 |
| WireGuard | ✅ | ✅ | Xray-core | Xray-core | — parity |
| **Hysteria2** | ✅ (`hysteria` enum; "plain hysteria" = v2; links emit `hysteria2://`) | ✅ protocol+links+engine (per-inbound `hysteria` sidecar since Task 23-e) | **Forked Xray-core build with a hysteria inbound** (`hysteriaConfigVersion`, model.go L259-263) | **sing-box secondary core (v2.6)** + legacy per-inbound sidecar kept as fallback | ✅ **REAL, E2E-proven** (see §6) |
| **TUIC v5** | ✅ (`tuic` enum) | ❌ → ✅ **v2.6** | **Native Go server in-process** (`internal/tuic/*` — server.go, protocol.go, ~20 files) | **sing-box secondary core** | ✅ **REAL, E2E-proven** (see §6) |
| **AmneziaWG** | ✅ (`amneziawg` enum) | ❌ | **Userspace Go** (`internal/amneziawg{,kern,net}`) — still needs `/dev/net/tun` + CAP_NET_ADMIN | none — research note only | ❌ impossible to run/test in unprivileged containers (KataBump/Docker default); honest deferral, see §4 |
| **MTProto (inbound)** | ✅ (`mtproto` enum) | ❌ (Settings MTProto secret/link tool only) | **Native Go in-process** (`internal/mtproto/*`) | none — tool covers the flow | ❌ Xray-core removed mtproto (v24.10) **and sing-box v1.14.4 rejects it**: `unknown inbound type: mtproto` (binary-verified). No third engine is justified for one legacy protocol; our Settings MTProto tool (secret + t.me links + mtg docker commands) stays the path |
| MASQUE | ✅ (`masque` enum) | ❌ | Native Go (`internal/`) | none | Not demanded; QUIC-based HTTP/3 proxy, same sidecar pattern as TUIC if ever wanted — deferred |
| Shadowsocks-2022 | ✅ | ✅ (v2.5, `2022-blake3-*`, server-level method+password) | Xray-core | Xray-core | — parity |

## 2) sing-box binary facts (binary-verified, v1.14.4 linux-amd64)

- Release asset: **`sing-box-<ver>-linux-amd64.tar.gz`** (31.7 MB; tar.gz,
  NOT zip — arm64 equivalent exists). Binary inside
  `sing-box-<ver>-linux-amd64/sing-box`. Latest resolved via the
  `releases/latest` 302 redirect (the REST API is rate-limited; same
  fallback strategy as the xray bin-manager).
- Build tags include `with_quic,with_utls,with_clash_api` but **NOT
  `with_v2ray_api`** — `experimental.v2ray_api` is rejected at runtime
  ("v2ray api is not included in this build"), so the Xray-style gRPC stats
  door is unavailable; only **clash_api** is.
- **clash_api** (`experimental.clash_api.external_controller`):
  `GET /version` → `{"meta":true,"premium":true,"version":"sing-box 1.14.4"}`;
  `GET /connections` → `{connections:[...open conns w/ per-connection
  upload/download...], uploadTotal, downloadTotal}` where the totals are
  **cumulative session bytes** (verified: a 2 MB download moved
  `downloadTotal` 0 → 2001336).
- `sing-box check -c` validates config **and reads the TLS cert files**
  (certs must exist before check), and rejects unknown fields strictly —
  the accepted field set below is therefore exact.

## 3) Verified server config shapes (the exact JSON our driver generates)

```jsonc
// hysteria2 inbound (sing-box ≥1.14; masquerade accepted since 1.14)
{ "type": "hysteria2", "tag": "hy2-e2e", "listen": "0.0.0.0", "listen_port": 31086,
  "users": [{ "name": "e2e@test", "password": "test123" }],
  "up_mbps": 100, "down_mbps": 200,
  "obfs": { "type": "salamander", "password": "..." },        // optional
  "masquerade": "https://example.com",                        // optional (1.14+)
  "tls": { "enabled": true, "certificate_path": "...", "key_path": "..." } }

// tuic inbound (congestion_control ∈ {bbr, cubic, new_reno} — binary-verified;
// "new_reality" and anything else is rejected)
{ "type": "tuic", "tag": "tuic-e2e", "listen": "0.0.0.0", "listen_port": 31087,
  "users": [{ "name": "e2e@test", "uuid": "…", "password": "…" }],
  "congestion_control": "bbr", "zero_rtt_handshake": false, "heartbeat": "10s",
  "tls": { "enabled": true, "alpn": ["h3"], "certificate_path": "...", "key_path": "..." } }
```

TLS material: hy2/tuic REJECT a config whose cert files are missing
(`check` fails on `open …: no such file`), so the driver always materializes
PEM files: managed cert PEM from the inbound stream (`certPublic/certPrivate`)
→ written under `db/certs/`, else a self-signed RSA-2048/10y cert generated
with the panel's zero-dependency DER generator (`generateSelfSignedCert`,
same code path the hysteria sidecar uses — already E2E-proven there).

## 4) Honest deferrals (no code, deliberately)

- **AmneziaWG**: 3x-ui ships it as a userspace Go daemon, but it still needs
  a TUN device + CAP_NET_ADMIN. Our sandbox (and KataBump-style
  unprivileged containers) cannot create `/dev/net/tun` — no way to ship AND
  test it here. When a privileged host is available, the config generator
  (Jc/Jmin/Jmax/S1/S2/H1–H4 fields on the WireGuard UI) is the first step.
- **TUN inbound**: server-side TUN is a privileged routing-table operation;
  wrong layer for a panel-managed core process. Client TUN is what users
  actually meet (their apps do it).
- **MTProto inbound**: neither Xray (removed v24.10) nor sing-box (rejected
  at config decode) can serve it → the Settings MTProto tool remains the
  supported path. Adding a third engine binary for one legacy protocol is
  not justified.
- **3x-ui's `masque` / `tunnel` / `mixed` protocols**: niche/native-Go
  features of 3x-ui's own stack; not demanded, deferred with the same
  sing-box sidecar pattern as a future option.

## 5) Architecture — how sing-box coexists with Xray

- One **`SingboxDriver`** process (`sing-box run -c db/core/singbox/config.json`)
  serves ALL enabled hysteria2 + tuic inbounds from the store (users mapped
  from clientsJson; `tuic` client key is the wire-format composite
  `uuid:password` — exactly how the `tuic://` URI carries it).
- It runs **only when driver=xray** (the simulator never spawns cores) and
  the new `set_core_singbox_enabled` setting is not "0" (default ON).
- While sing-box serves hysteria2, the legacy per-inbound hysteria sidecar
  **stands down** (same ports would collide); it resumes automatically when
  sing-box is disabled via settings. TUIC has never had another engine.
- Lifecycle mirrors XrayDriver: hash-diff config on the 2s store mirror →
  `sing-box check -c` → port pre-flight (UDP for QUIC) → spawn → exit-watch
  with 3/10/30 s backoff (max 5) → log ring. Status is additive on
  `/api/system/core-status` (`singbox: {...}`) and core-action
  start/stop/restart/reload drives both processes together.
- Traffic accounting (honest): the release build has no v2ray stats gRPC, so
  the driver polls clash_api `GET /connections` on the stats interval —
  cumulative `uploadTotal/downloadTotal` (exact, monotonic) plus per-connection
  `metadata.inbound` attribution for connections alive at poll time. Short-lived
  connections can be missed → per-inbound counters are labeled best-effort,
  global counters exact. Per-user accounting is not possible without a
  custom sing-box build — documented, not faked.

## 6) Proof it really works (pre-implementation sandbox E2E with raw sing-box)

- server config (shapes above) → `sing-box check -c` → OK (after cert
  materialization); `sing-box run` → `inbound/hysteria2[hy2-e2e]: udp server
  started at 0.0.0.0:31086`, `inbound/tuic[tuic-e2e]: udp server started at
  0.0.0.0:31087`.
- hy2 client (socks 127.0.0.1:31992 → outbound hysteria2, insecure):
  `curl --socks5-hostname 127.0.0.1:31992 http://api.ipify.org` →
  **`203.0.113.10`, code=200** (egress IP anonymized — TEST-NET-3).
- tuic client (socks 127.0.0.1:31991 → outbound tuic, bbr, insecure):
  `curl --socks5-hostname 127.0.0.1:31991 http://api.ipify.org` →
  **`203.0.113.11`, code=200** (egress IP anonymized — TEST-NET-3; server log
  shows the `[e2e@test] inbound connection to api.ipify.org:80`).
- The full panel-level E2E (store → driver → both cores → curl → sub export)
  is documented in the worklog Task 23-c entry.

## 7) Link / client-format sources

- `hysteria2://auth@host:port?sni=&insecure=1&obfs=salamander&obfs-password=`
  — apernet/hysteria wiki URI scheme (`hy2://` is the v2rayN/NekoBox alias;
  Sephiroth emits `hy2://` since v2.3 and keeps it).
- `tuic://uuid:password@host:port?congestion_control=bbr&alpn=h3&sni=&allow_insecure=1`
  — the TUIC v5 share convention used by v2rayN/NekoBox/Hiddify (params map
  1:1 onto the sing-box client outbound fields: uuid, password,
  congestion_control, tls.alpn, tls.server_name, tls.insecure).
- Sing-box client JSON sub export: outbounds `{"type":"hysteria2"|"tuic", …}`
  with the same field names as the verified client configs above.
