/* ============================================================
   Sephiroth · Phase 5+ — Isomorphic Share-Link & Client Config Builders
   Supports:
   - Standard URI schemes (vless://, vmess://, trojan://, ss://, hy2://, tuic://, wireguard://, socks://, http://)
   - WireGuard .conf generator
   - Clash Meta (Mihomo) full YAML profile generator
   - Sing-Box 1.10+ full JSON profile generator
   - Host resolution fix (never leaks 0.0.0.0 to client links)
   ============================================================ */

export const BRAND_TAG = "Sephiroth";

export interface ShareInbound {
  id?: string;
  tag: string;
  protocol: string;
  port: number;
  listen: string;
  transport: string;
  security: string;
  status?: string;
  note?: string | null;
  trafficLimitGb?: number | null;
  expiryDays?: number | null;
  clients?: unknown[];
  sniffing?: unknown;
  stream?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface ShareClient {
  email?: string;
  key?: string;
  flow?: string;
  subId?: string;
  ipLimit?: number;
  trafficLimitGb?: number | null;
  expiryDays?: number | null;
  enabled?: boolean;
  /** WireGuard: per-client X25519 material (base64 32-byte halves). */
  wgPrivateKey?: string;
  wgPublicKey?: string;
}

export function b64utf8(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

/**
 * Resolves a routable public hostname or IP for client configs.
 * Fixes the critical bug where listen="0.0.0.0" or "" produced unroutable 0.0.0.0 links.
 * Chain: listen → fallbackHost (request host) → stream sni/host → node domain →
 * publicHost (admin setting) → edge.sephiroth.network.
 */
export function hostOf(
  row: { listen: string; stream?: unknown },
  fallbackHost?: string,
  publicHost?: string
): string {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  const raw = (row.listen || "").trim();
  if (raw && raw !== "0.0.0.0" && raw !== "::" && raw !== "127.0.0.1" && raw !== "localhost") {
    return raw;
  }
  if (fallbackHost && fallbackHost !== "0.0.0.0" && fallbackHost !== "127.0.0.1" && fallbackHost !== "localhost") {
    return fallbackHost;
  }
  if (typeof st.sni === "string" && st.sni.trim()) {
    return st.sni.trim();
  }
  if (typeof st.host === "string" && st.host.trim()) {
    return st.host.trim();
  }
  if (typeof window !== "undefined" && window.location?.hostname) {
    const h = window.location.hostname;
    if (h !== "localhost" && h !== "127.0.0.1" && h !== "0.0.0.0") {
      return h;
    }
  }
  if (publicHost && publicHost.trim()) {
    return publicHost.trim();
  }
  return "edge.sephiroth.network";
}

const KEY_FALLBACK: Record<string, string> = {
  vless: "00000000-0000-0000-0000-000000000000",
  vmess: "00000000-0000-0000-0000-000000000000",
  trojan: "password",
  shadowsocks: "password",
  hysteria2: "password",
  tuic: "00000000-0000-0000-0000-000000000000:password",
};

/**
 * TUIC client keys are the wire composite "uuid:password" (exactly how the
 * tuic:// URI carries them) — split on the FIRST colon for the outbound.
 */
function splitTuicKey(key: string): { uuid: string; password: string } {
  const sep = key.indexOf(":");
  if (sep <= 0) return { uuid: "", password: key };
  return { uuid: key.slice(0, sep), password: key.slice(sep + 1) };
}

/**
 * Telegram-native SOCKS5 proxy links. Telegram clients do NOT understand
 * socks:// URIs — they need the t.me/socks deep link, optionally with
 * username/password auth. Works on any host:port reachable by the user.
 */
export function buildTelegramSocksLinks(
  host: string,
  port: number,
  user?: string,
  pass?: string
): { tg: string; web: string } {
  const q = new URLSearchParams();
  q.set("server", host);
  q.set("port", String(port));
  if (user) q.set("user", user);
  if (pass) q.set("pass", pass);
  const qs = q.toString();
  return { tg: `tg://socks?${qs}`, web: `https://t.me/socks?${qs}` };
}

export function buildShareLink(
  row: ShareInbound,
  first?: ShareClient,
  fallbackHost?: string,
  publicHost?: string
): string | null {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  const host = hostOf(row, fallbackHost, publicHost);
  const port = String(row.port);
  const label = first?.email
    ? `${BRAND_TAG} · ${row.tag} · ${first.email}`
    : `${BRAND_TAG} · ${row.tag}`;
  const q = new URLSearchParams();

  const commonParams = () => {
    q.set("type", row.transport);
    if (row.security !== "none") q.set("security", row.security);
    if (row.security === "tls") {
      if (st.sni) q.set("sni", String(st.sni));
      q.set("fp", String(st.fingerprint || "chrome"));
      if (st.alpn) q.set("alpn", String(st.alpn));
    }
    if (row.security === "reality") {
      if (st.serverNames) q.set("sni", String(st.serverNames).split(",")[0].trim());
      q.set("fp", String(st.fingerprint || "chrome"));
      if (st.publicKey) q.set("pbk", String(st.publicKey));
      if (st.shortIds) q.set("sid", String(st.shortIds).split(",")[0].trim());
      if (st.spiderX) q.set("spx", String(st.spiderX));
    }
    if (row.transport === "ws" || row.transport === "xhttp" || row.transport === "httpupgrade") {
      if (st.path) q.set("path", String(st.path));
      if (st.host) q.set("host", String(st.host));
    }
    if (row.transport === "xhttp" && st.mode) q.set("mode", String(st.mode));
    if (row.transport === "grpc") {
      if (st.serviceName) q.set("serviceName", String(st.serviceName));
      if (st.multiMode === true) q.set("mode", "multi");
    }
    if (row.transport === "kcp") {
      if (st.headerType && st.headerType !== "none") q.set("headerType", String(st.headerType));
      if (st.kcpSeed) q.set("seed", String(st.kcpSeed));
    }
    if (row.transport === "tcp" && st.headerType === "http") q.set("headerType", "http");
  };

  switch (row.protocol) {
    case "vless": {
      const key = first?.key || KEY_FALLBACK.vless;
      commonParams();
      if (first?.flow) q.set("flow", first.flow);
      return `vless://${key}@${host}:${port}?${q.toString()}#${encodeURIComponent(label)}`;
    }
    case "vmess": {
      const key = first?.key || KEY_FALLBACK.vmess;
      const json = {
        v: "2",
        ps: label,
        add: host,
        port,
        id: key,
        aid: "0",
        scy: "auto",
        net: row.transport,
        type:
          row.transport === "tcp" && st.headerType === "http"
            ? "http"
            : row.transport === "kcp"
              ? String(st.headerType || "none")
              : "none",
        ...(row.transport === "kcp" && st.kcpSeed ? { seed: String(st.kcpSeed) } : {}),
        host: String(st.host ?? ""),
        path: String(st.path ?? ""),
        tls: row.security === "none" ? "" : row.security,
        sni: String(st.sni ?? st.serverNames ?? ""),
        alpn: String(st.alpn ?? ""),
        fp: String(st.fingerprint || "chrome"),
      };
      return `vmess://${b64utf8(JSON.stringify(json))}`;
    }
    case "trojan": {
      const key = first?.key || KEY_FALLBACK.trojan;
      commonParams();
      return `trojan://${encodeURIComponent(key)}@${host}:${port}?${q.toString()}#${encodeURIComponent(label)}`;
    }
    case "shadowsocks": {
      const key = first?.key || KEY_FALLBACK.shadowsocks;
      const method = String(st.method || "2022-blake3-aes-128-gcm");
      const userinfo = b64utf8(`${method}:${key}`);
      return `ss://${userinfo}@${host}:${port}#${encodeURIComponent(label)}`;
    }
    case "hysteria2": {
      const key = first?.key || KEY_FALLBACK.hysteria2;
      if (st.sni) q.set("sni", String(st.sni));
      if (st.obfsPassword) {
        q.set("obfs", "salamander");
        q.set("obfs-password", String(st.obfsPassword));
      }
      // up/down travel as numbers from the API but as STRINGS through the
      // Forge's dtoToForm preview path — accept both
      const up = Number(st.upMbps);
      const down = Number(st.downMbps);
      if (Number.isFinite(up) && up > 0) q.set("upmbps", String(up));
      if (Number.isFinite(down) && down > 0) q.set("downmbps", String(down));
      if (st.allowInsecure === true || row.security === "none") q.set("insecure", "1");
      return `hy2://${encodeURIComponent(key)}@${host}:${port}?${q.toString()}#${encodeURIComponent(label)}`;
    }
    case "tuic": {
      // TUIC v5 share convention (v2rayN/NekoBox/Hiddify):
      // tuic://uuid:password@host:port?congestion_control=&alpn=&sni=&allow_insecure=
      const { uuid, password } = splitTuicKey(first?.key || KEY_FALLBACK.tuic);
      const cc = String(st.tuicCongestion || "bbr");
      if (cc) q.set("congestion_control", cc);
      const alpn = String(st.alpn || "h3").split(",").map((s) => s.trim()).filter(Boolean);
      if (alpn.length > 0) q.set("alpn", alpn.join(","));
      if (st.sni) q.set("sni", String(st.sni));
      if (st.allowInsecure === true || row.security === "none") q.set("allow_insecure", "1");
      return `tuic://${encodeURIComponent(uuid)}:${encodeURIComponent(password)}@${host}:${port}?${q.toString()}#${encodeURIComponent(label)}`;
    }
    case "wireguard": {
      // the CLIENT private key (never the server/inbound secret)
      const priv = encodeURIComponent(String(first?.wgPrivateKey || "<client-private-key>"));
      // the SERVER (inbound) public key from the stream settings
      const pub = encodeURIComponent(String(st.wgPublicKey || first?.wgPublicKey || "WG_PUBLIC_KEY"));
      const mtu = String(st.wgMtu ?? 1420);
      return `wireguard://${priv}@${host}:${port}?address=10.0.0.2%2F32&publickey=${pub}&mtu=${mtu}#${encodeURIComponent(label)}`;
    }
    case "socks":
    case "http": {
      const auth = first
        ? `${encodeURIComponent(first.email ?? "")}:${encodeURIComponent(first.key ?? "")}@`
        : "";
      return `${row.protocol}://${auth}${host}:${port}#${encodeURIComponent(label)}`;
    }
    default:
      return null;
  }
}

export function buildWgConf(
  row: ShareInbound,
  first?: ShareClient,
  fallbackHost?: string,
  publicHost?: string
): string {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  const host = hostOf(row, fallbackHost, publicHost);
  return [
    `# ${BRAND_TAG} · ${row.tag}`,
    "[Interface]",
    // per-client private key — the inbound's server secret must never ship
    `PrivateKey = ${first?.wgPrivateKey || "<client-private-key>"}`,
    "Address = 10.0.0.2/32",
    "DNS = 1.1.1.1, 1.0.0.1",
    `MTU = ${st.wgMtu ?? 1420}`,
    "",
    "[Peer]",
    // the inbound's SERVER public key
    `PublicKey = ${st.wgPublicKey ?? first?.wgPublicKey ?? "<server-public-key>"}`,
    "AllowedIPs = 0.0.0.0/0, ::/0",
    `Endpoint = ${host}:${row.port}`,
    "PersistentKeepalive = 25",
  ].join("\n");
}

export function buildDokoSummary(row: ShareInbound, fallbackHost?: string, publicHost?: string): string {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  return [
    `${BRAND_TAG} · dokodemo-door · ${row.tag}`,
    `listen: ${hostOf(row, fallbackHost, publicHost)}:${row.port}`,
    `target: ${st.dokoAddress ?? "127.0.0.1"}:${st.dokoPort ?? "8080"}`,
    `network: ${st.dokoNetwork ?? "tcp,udp"}`,
  ].join("\n");
}

export function buildShareMaterial(
  row: ShareInbound,
  first?: ShareClient,
  fallbackHost?: string,
  publicHost?: string
): { link: string | null; text: string } {
  const link = buildShareLink(row, first, fallbackHost, publicHost);
  if (row.protocol === "wireguard") {
    return { link, text: buildWgConf(row, first, fallbackHost, publicHost) };
  }
  if (link) return { link, text: link };
  return { link: null, text: buildDokoSummary(row, fallbackHost, publicHost) };
}

/* ============================================================
   Clash Meta (Mihomo) YAML & Sing-Box 1.10+ JSON Generators
   ============================================================ */

export interface SubExportItem {
  tag: string;
  protocol: string;
  port: number;
  listen?: string;
  transport: string;
  security: string;
  email: string;
  key?: string;
  flow?: string;
  stream?: Record<string, unknown>;
  link?: string | null;
}

/** Clash ws/grpc/kcp transport options — shared by vless/vmess/trojan (httpupgrade rides ws). */
function clashTransportLines(item: SubExportItem, st: Record<string, unknown>, host: string): string[] {
  const lines: string[] = [];
  if (item.transport === "ws" || item.transport === "httpupgrade") {
    lines.push(
      `    ws-opts:`,
      `      path: "${String(st.path || "/")}"`,
      `      headers:`,
      `        Host: "${String(st.host || host)}"`
    );
  } else if (item.transport === "grpc") {
    lines.push(
      `    grpc-opts:`,
      `      grpc-service-name: "${String(st.serviceName || "grpc")}"`
    );
  } else if (item.transport === "kcp") {
    // mihomo kcp-opts only knows up/down (Mbps) + smux — xray header.type /
    // seed have no clash equivalent, so they are honestly omitted here
    lines.push(
      `    kcp-opts:`,
      `      up: "5"`,
      `      down: "5"`,
      `      smux:`,
      `        enabled: false`
    );
  }
  return lines;
}

export function buildClashMetaYaml(
  items: SubExportItem[],
  subName: string,
  fallbackHost?: string,
  publicHost?: string
): string {
  const proxyLines: string[] = [];
  const proxyNames: string[] = [];

  items.forEach((item, idx) => {
    const name = `${BRAND_TAG}-${item.tag}-${idx + 1}`;
    const host = hostOf({ listen: item.listen || "", stream: item.stream }, fallbackHost, publicHost);
    const st = item.stream || {};
    const tls = item.security === "tls" || item.security === "reality";
    const sni = String(st.sni || (typeof st.serverNames === "string" ? st.serverNames.split(",")[0] : "") || host);
    // clash has no httpupgrade network — it rides ws
    const network = item.transport === "httpupgrade" ? "ws" : item.transport;
    const transport = clashTransportLines(item, st, host);

    if (item.protocol === "vless") {
      proxyNames.push(name);
      proxyLines.push(
        `  - name: "${name}"`,
        `    type: vless`,
        `    server: ${host}`,
        `    port: ${item.port}`,
        `    uuid: ${item.key || KEY_FALLBACK.vless}`,
        `    network: ${network}`,
        `    tls: ${tls}`,
        `    udp: true`,
        `    client-fingerprint: ${String(st.fingerprint || "chrome")}`,
        `    servername: ${sni}`
      );
      if (item.flow) proxyLines.push(`    flow: ${item.flow}`);
      if (item.security === "reality") {
        proxyLines.push(
          `    reality-opts:`,
          `      public-key: ${String(st.publicKey || "")}`,
          `      short-id: ${String(st.shortIds || "").split(",")[0].trim()}`
        );
      }
      proxyLines.push(...transport);
    } else if (item.protocol === "vmess") {
      proxyNames.push(name);
      proxyLines.push(
        `  - name: "${name}"`,
        `    type: vmess`,
        `    server: ${host}`,
        `    port: ${item.port}`,
        `    uuid: ${item.key || KEY_FALLBACK.vmess}`,
        `    alterId: 0`,
        `    cipher: auto`,
        `    network: ${network}`,
        `    tls: ${tls}`,
        `    udp: true`,
        `    servername: ${sni}`
      );
      proxyLines.push(...transport);
    } else if (item.protocol === "trojan") {
      proxyNames.push(name);
      proxyLines.push(
        `  - name: "${name}"`,
        `    type: trojan`,
        `    server: ${host}`,
        `    port: ${item.port}`,
        `    password: "${item.key || KEY_FALLBACK.trojan}"`,
        `    network: ${network}`,
        `    sni: ${sni}`,
        `    udp: true`
      );
      proxyLines.push(...transport);
    } else if (item.protocol === "shadowsocks") {
      proxyNames.push(name);
      proxyLines.push(
        `  - name: "${name}"`,
        `    type: ss`,
        `    server: ${host}`,
        `    port: ${item.port}`,
        `    cipher: ${String(st.method || "2022-blake3-aes-128-gcm")}`,
        `    password: "${item.key || KEY_FALLBACK.shadowsocks}"`,
        `    udp: true`
      );
    } else if (item.protocol === "hysteria2") {
      proxyNames.push(name);
      proxyLines.push(
        `  - name: "${name}"`,
        `    type: hysteria2`,
        `    server: ${host}`,
        `    port: ${item.port}`,
        `    password: "${item.key || KEY_FALLBACK.hysteria2}"`,
        `    sni: ${sni}`,
        `    skip-cert-verify: ${Boolean(st.allowInsecure)}`
      );
      if (st.obfsPassword) {
        proxyLines.push(`    obfs: salamander`, `    obfs-password: "${String(st.obfsPassword)}"`);
      }
      const upNum = Number(st.upMbps);
      const downNum = Number(st.downMbps);
      if (Number.isFinite(upNum) && upNum > 0) {
        proxyLines.push(`    up: "${upNum} Mbps"`);
      }
      if (Number.isFinite(downNum) && downNum > 0) {
        proxyLines.push(`    down: "${downNum} Mbps"`);
      }
    } else if (item.protocol === "tuic") {
      // mihomo tuic v5 proxy (uuid + password, congestion-controller, alpn)
      const { uuid, password } = splitTuicKey(item.key || KEY_FALLBACK.tuic);
      proxyNames.push(name);
      proxyLines.push(
        `  - name: "${name}"`,
        `    type: tuic`,
        `    server: ${host}`,
        `    port: ${item.port}`,
        `    uuid: ${uuid || KEY_FALLBACK.tuic.split(":")[0]}`,
        `    password: "${password}"`,
        `    sni: ${sni}`,
        `    udp: true`,
        `    congestion-controller: ${String(st.tuicCongestion || "bbr")}`,
        `    alpn:`,
        `      - ${String(st.alpn || "h3").split(",")[0]?.trim() || "h3"}`,
        `    disable-sni: false`,
        `    skip-cert-verify: ${Boolean(st.allowInsecure)}`
      );
    }
  });

  const quotedNames = proxyNames.map((n) => `      - "${n}"`).join("\n") || `      - DIRECT`;

  return [
    `# ${BRAND_TAG} Clash Meta (Mihomo) Subscription — ${subName}`,
    `mixed-port: 7890`,
    `allow-lan: true`,
    `mode: rule`,
    `log-level: info`,
    `ipv6: true`,
    `dns:`,
    `  enable: true`,
    `  enhanced-mode: fake-ip`,
    `  nameserver:`,
    `    - 1.1.1.1`,
    `    - 8.8.8.8`,
    `proxies:`,
    ...(proxyLines.length ? proxyLines : [`  []`]),
    `proxy-groups:`,
    `  - name: "🚀 ${BRAND_TAG} Select"`,
    `    type: select`,
    `    proxies:`,
    `      - "⚡ Auto Best-Ping"`,
    `      - "🛡️ Failover"`,
    quotedNames,
    `      - DIRECT`,
    `  - name: "⚡ Auto Best-Ping"`,
    `    type: url-test`,
    `    url: "https://www.gstatic.com/generate_204"`,
    `    interval: 180`,
    `    tolerance: 50`,
    `    proxies:`,
    quotedNames,
    `  - name: "🛡️ Failover"`,
    `    type: fallback`,
    `    url: "https://www.gstatic.com/generate_204"`,
    `    interval: 180`,
    `    proxies:`,
    quotedNames,
    `rules:`,
    `  - GEOIP,PRIVATE,DIRECT,no-resolve`,
    `  - GEOSITE,category-ads-all,REJECT`,
    `  - GEOSITE,ir,DIRECT`,
    `  - GEOIP,IR,DIRECT`,
    `  - MATCH,🚀 ${BRAND_TAG} Select`,
    ``,
  ].join("\n");
}

/**
 * Sing-Box transport object — vless/vmess/trojan/ss all dial through it.
 * httpupgrade is folded into type "http" (sing-box ≥1.11 merged them).
 * mKCP is NOT in sing-box's transport set (http/ws/quic/grpc/httpupgrade)
 * — callers must skip kcp nodes instead of emitting a broken outbound.
 */
function singboxTransport(st: Record<string, unknown>, transport: string): Record<string, unknown> | undefined {
  if (transport === "ws") {
    return {
      type: "ws",
      path: String(st.path || "/"),
      ...(st.host ? { headers: { Host: String(st.host) } } : {}),
    };
  }
  if (transport === "grpc") {
    return { type: "grpc", service_name: String(st.serviceName || "") };
  }
  if (transport === "http" || transport === "httpupgrade") {
    return {
      type: "http",
      path: String(st.path || "/"),
      ...(st.host ? { host: [String(st.host)] } : {}),
    };
  }
  return undefined; // tcp / reality-over-tcp need no transport object
}

export function buildSingboxJson(
  items: SubExportItem[],
  subName: string,
  fallbackHost?: string,
  publicHost?: string
): string {
  const outbounds: Record<string, unknown>[] = [];
  const tags: string[] = [];

  items.forEach((item, idx) => {
    const tag = `${BRAND_TAG}-${item.tag}-${idx + 1}`;
    const host = hostOf({ listen: item.listen || "", stream: item.stream }, fallbackHost, publicHost);
    const st = item.stream || {};
    // sing-box cannot dial mKCP (no kcp transport) — skip the node rather
    // than emit an outbound that silently dials plain TCP (use clash/xray)
    if (item.transport === "kcp") return;
    const tlsEnabled = item.security === "tls" || item.security === "reality";
    const sni = String(st.sni || (typeof st.serverNames === "string" ? st.serverNames.split(",")[0] : "") || host);
    const transport = singboxTransport(st, item.transport);

    const tlsObj = tlsEnabled
      ? {
          enabled: true,
          server_name: sni,
          insecure: Boolean(st.allowInsecure),
          utls: { enabled: true, fingerprint: String(st.fingerprint || "chrome") },
          ...(item.security === "reality"
            ? {
                reality: {
                  enabled: true,
                  public_key: String(st.publicKey || ""),
                  short_id: String(st.shortIds || "").split(",")[0].trim(),
                },
              }
            : {}),
        }
      : undefined;

    if (item.protocol === "vless") {
      tags.push(tag);
      outbounds.push({
        type: "vless",
        tag,
        server: host,
        server_port: item.port,
        uuid: item.key || KEY_FALLBACK.vless,
        flow: item.flow || undefined,
        ...(transport ? { transport } : {}),
        tls: tlsObj,
      });
    } else if (item.protocol === "vmess") {
      tags.push(tag);
      outbounds.push({
        type: "vmess",
        tag,
        server: host,
        server_port: item.port,
        uuid: item.key || KEY_FALLBACK.vmess,
        security: "auto",
        ...(transport ? { transport } : {}),
        tls: tlsObj,
      });
    } else if (item.protocol === "trojan") {
      tags.push(tag);
      outbounds.push({
        type: "trojan",
        tag,
        server: host,
        server_port: item.port,
        password: item.key || KEY_FALLBACK.trojan,
        ...(transport ? { transport } : {}),
        tls: tlsObj,
      });
    } else if (item.protocol === "shadowsocks") {
      tags.push(tag);
      outbounds.push({
        type: "shadowsocks",
        tag,
        server: host,
        server_port: item.port,
        method: String(st.method || "2022-blake3-aes-128-gcm"),
        password: item.key || KEY_FALLBACK.shadowsocks,
      });
    } else if (item.protocol === "hysteria2") {
      tags.push(tag);
      outbounds.push({
        type: "hysteria2",
        tag,
        server: host,
        server_port: item.port,
        password: item.key || KEY_FALLBACK.hysteria2,
        ...(st.obfsPassword
          ? { obfs: { type: "salamander", password: String(st.obfsPassword) } }
          : {}),
        ...(Number(st.upMbps) > 0 ? { up_mbps: Number(st.upMbps) } : {}),
        ...(Number(st.downMbps) > 0 ? { down_mbps: Number(st.downMbps) } : {}),
        tls: {
          enabled: true,
          server_name: sni,
          insecure: Boolean(st.allowInsecure),
        },
      });
    } else if (item.protocol === "tuic") {
      // Task 23-c — TUIC v5 outbound; key is the wire composite uuid:password
      const { uuid, password } = splitTuicKey(item.key || KEY_FALLBACK.tuic);
      const alpn = String(st.alpn || "h3")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      tags.push(tag);
      outbounds.push({
        type: "tuic",
        tag,
        server: host,
        server_port: item.port,
        uuid: uuid || KEY_FALLBACK.tuic.split(":")[0],
        password: password || "password",
        congestion_control: String(st.tuicCongestion || "bbr"),
        udp_relay_mode: "native",
        tls: {
          enabled: true,
          server_name: sni,
          insecure: Boolean(st.allowInsecure),
          ...(alpn.length > 0 ? { alpn } : {}),
        },
      });
    }
  });

  const profile = {
    _comment: `${BRAND_TAG} Sing-Box 1.10+ Profile — ${subName}`,
    log: { level: "info", timestamp: true },
    dns: {
      servers: [
        { tag: "dns-remote", address: "https://1.1.1.1/dns-query", detour: "select" },
        { tag: "dns-direct", address: "1.1.1.1", detour: "direct" },
      ],
    },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        inet4_address: "172.19.0.1/30",
        auto_route: true,
        strict_route: true,
        sniff: true,
      },
      {
        type: "mixed",
        tag: "mixed-in",
        listen: "127.0.0.1",
        listen_port: 2080,
        sniff: true,
      },
    ],
    outbounds: [
      {
        type: "selector",
        tag: "select",
        outbounds: ["auto", ...tags, "direct"],
        default: "auto",
      },
      {
        type: "urltest",
        tag: "auto",
        outbounds: tags.length ? tags : ["direct"],
        url: "https://www.gstatic.com/generate_204",
        interval: "3m",
        tolerance: 50,
      },
      ...outbounds,
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
    ],
    route: {
      auto_detect_interface: true,
      final: "select",
    },
  };

  return JSON.stringify(profile, null, 2);
}

/* ============================================================
   Xray (v2ray-core compatible) full client profile — v2.2
   Full config JSON importable by v2rayN / v2rayNG / Nekoray /
   Xray clients. Only protocols Xray-core supports are mapped
   (vless / vmess / trojan / shadowsocks); hysteria2 & wireguard
   items are skipped (use sing-box / clash profiles for those).
   ============================================================ */

function xrayStreamSettings(
  st: Record<string, unknown>,
  transport: string,
  security: string
): Record<string, unknown> {
  const stream: Record<string, unknown> = { network: transport || "tcp", security: security || "none" };

  if (security === "tls") {
    stream.tlsSettings = {
      serverName: String(st.sni || ""),
      allowInsecure: Boolean(st.allowInsecure),
      fingerprint: String(st.fingerprint || "chrome"),
      ...(st.alpn ? { alpn: String(st.alpn).split(",").map((s) => s.trim()).filter(Boolean) } : {}),
    };
  } else if (security === "reality") {
    stream.realitySettings = {
      serverName: String(st.sni || ""),
      fingerprint: String(st.fingerprint || "chrome"),
      publicKey: String(st.publicKey || ""),
      shortId: String(st.shortIds || "").split(",")[0]?.trim() || "",
      spiderX: String(st.spiderX || "/"),
    };
  }

  if (transport === "ws") {
    stream.wsSettings = {
      path: String(st.path || "/"),
      ...(st.host ? { headers: { Host: String(st.host) } } : {}),
    };
  } else if (transport === "grpc") {
    stream.grpcSettings = { serviceName: String(st.serviceName || ""), multiMode: st.multiMode === true };
  } else if (transport === "httpupgrade") {
    stream.httpupgradeSettings = { path: String(st.path || "/"), ...(st.host ? { host: String(st.host) } : {}) };
  } else if (transport === "xhttp") {
    stream.xhttpSettings = { path: String(st.path || "/"), ...(st.host ? { host: String(st.host) } : {}) };
  } else if (transport === "kcp") {
    const kcp: Record<string, unknown> = {
      mtu: 1350,
      tti: 50,
      uplinkCapacity: 5,
      downlinkCapacity: 5,
      congestion: false,
      readBufferSize: 2,
      writeBufferSize: 2,
      header: { type: String(st.headerType || "none") },
    };
    if (st.kcpSeed) kcp.seed = String(st.kcpSeed);
    stream.kcpSettings = kcp;
  } else if (transport === "http") {
    stream.httpSettings = { path: String(st.path || "/"), ...(st.host ? { host: [String(st.host)] } : {}) };
  }
  return stream;
}

export function buildXrayJson(
  items: SubExportItem[],
  subName: string,
  fallbackHost?: string,
  publicHost?: string
): string {
  const outbounds: Record<string, unknown>[] = [];
  const tags: string[] = [];

  items.forEach((item, idx) => {
    const host = hostOf({ listen: item.listen || "", stream: item.stream }, fallbackHost, publicHost);
    const st = item.stream || {};
    const stream = xrayStreamSettings(st, item.transport, item.security);
    const tag = `${BRAND_TAG}-${item.tag}-${idx + 1}`;
    let outbound: Record<string, unknown> | null = null;

    if (item.protocol === "vless") {
      outbound = {
        tag,
        protocol: "vless",
        settings: {
          vnext: [
            {
              address: host,
              port: item.port,
              users: [{ id: item.key || KEY_FALLBACK.vless, encryption: "none", flow: item.flow || "", level: 0 }],
            },
          ],
        },
        streamSettings: stream,
        mux: { enabled: false, concurrency: -1 },
      };
    } else if (item.protocol === "vmess") {
      outbound = {
        tag,
        protocol: "vmess",
        settings: {
          vnext: [
            {
              address: host,
              port: item.port,
              users: [{ id: item.key || KEY_FALLBACK.vmess, alterId: 0, security: "auto", level: 0 }],
            },
          ],
        },
        streamSettings: stream,
        mux: { enabled: false, concurrency: -1 },
      };
    } else if (item.protocol === "trojan") {
      outbound = {
        tag,
        protocol: "trojan",
        settings: {
          servers: [{ address: host, port: item.port, password: item.key || KEY_FALLBACK.trojan, level: 0 }],
        },
        streamSettings: stream,
      };
    } else if (item.protocol === "shadowsocks") {
      outbound = {
        tag,
        protocol: "shadowsocks",
        settings: {
          servers: [
            {
              address: host,
              port: item.port,
              method: String(st.method || "2022-blake3-aes-128-gcm"),
              password: item.key || KEY_FALLBACK.shadowsocks,
              uot: true,
            },
          ],
        },
      };
    }

    if (outbound) {
      tags.push(tag);
      outbounds.push(outbound);
    }
  });

  const profile = {
    _comment: `${BRAND_TAG} Xray client profile — ${subName}`,
    log: { loglevel: "warning" },
    inbounds: [
      { tag: "socks-in", listen: "127.0.0.1", port: 10808, protocol: "socks", settings: { udp: true }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } },
      { tag: "http-in", listen: "127.0.0.1", port: 10809, protocol: "http", settings: {} },
    ],
    outbounds: [
      ...outbounds,
      { tag: "direct", protocol: "freedom", settings: {} },
      { tag: "block", protocol: "blackhole", settings: { response: { type: "http" } } },
    ],
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: [
        { type: "field", outboundTag: "block", protocol: ["bittorrent"] },
        { type: "field", outboundTag: "direct", ip: ["geoip:private"] },
        ...(tags.length ? [{ type: "field", outboundTag: tags[0], port: "0-65535" }] : []),
      ],
    },
  };

  return JSON.stringify(profile, null, 2);
}
