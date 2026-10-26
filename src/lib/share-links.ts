/* ============================================================
   Sephiroth · Phase 5+ — Isomorphic Share-Link & Client Config Builders
   Supports:
   - Standard URI schemes (vless://, vmess://, trojan://, ss://, hy2://, wireguard://, socks://, http://)
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
}

export function b64utf8(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

/**
 * Resolves a routable public hostname or IP for client configs.
 * Fixes the critical bug where listen="0.0.0.0" or "" produced unroutable 0.0.0.0 links.
 */
export function hostOf(row: { listen: string; stream?: unknown }, fallbackHost?: string): string {
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
  return "edge.sephiroth.network";
}

const KEY_FALLBACK: Record<string, string> = {
  vless: "00000000-0000-0000-0000-000000000000",
  vmess: "00000000-0000-0000-0000-000000000000",
  trojan: "password",
  shadowsocks: "password",
  hysteria2: "password",
};

export function buildShareLink(row: ShareInbound, first?: ShareClient, fallbackHost?: string): string | null {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  const host = hostOf(row, fallbackHost);
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
        type: row.transport === "tcp" && st.headerType === "http" ? "http" : "none",
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
      if (st.allowInsecure === true || row.security === "none") q.set("insecure", "1");
      return `hy2://${encodeURIComponent(key)}@${host}:${port}?${q.toString()}#${encodeURIComponent(label)}`;
    }
    case "wireguard": {
      const priv = encodeURIComponent(String(st.wgSecretKey || first?.key || "WG_PRIVATE_KEY"));
      const pub = encodeURIComponent(String(st.wgPublicKey || first?.key || "WG_PUBLIC_KEY"));
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

export function buildWgConf(row: ShareInbound, first?: ShareClient, fallbackHost?: string): string {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  const host = hostOf(row, fallbackHost);
  return [
    `# ${BRAND_TAG} · ${row.tag}`,
    "[Interface]",
    `PrivateKey = ${st.wgSecretKey ?? "<private-key>"}`,
    "Address = 10.0.0.2/32",
    "DNS = 1.1.1.1, 1.0.0.1",
    `MTU = ${st.wgMtu ?? 1420}`,
    "",
    "[Peer]",
    `PublicKey = ${first?.key ?? st.wgPublicKey ?? "<peer-public-key>"}`,
    "AllowedIPs = 0.0.0.0/0, ::/0",
    `Endpoint = ${host}:${row.port}`,
    "PersistentKeepalive = 25",
  ].join("\n");
}

export function buildDokoSummary(row: ShareInbound, fallbackHost?: string): string {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  return [
    `${BRAND_TAG} · dokodemo-door · ${row.tag}`,
    `listen: ${hostOf(row, fallbackHost)}:${row.port}`,
    `target: ${st.dokoAddress ?? "127.0.0.1"}:${st.dokoPort ?? "8080"}`,
    `network: ${st.dokoNetwork ?? "tcp,udp"}`,
  ].join("\n");
}

export function buildShareMaterial(
  row: ShareInbound,
  first?: ShareClient,
  fallbackHost?: string
): { link: string | null; text: string } {
  const link = buildShareLink(row, first, fallbackHost);
  if (row.protocol === "wireguard") {
    return { link, text: buildWgConf(row, first, fallbackHost) };
  }
  if (link) return { link, text: link };
  return { link: null, text: buildDokoSummary(row, fallbackHost) };
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

export function buildClashMetaYaml(items: SubExportItem[], subName: string, fallbackHost?: string): string {
  const proxyLines: string[] = [];
  const proxyNames: string[] = [];

  items.forEach((item, idx) => {
    const name = `${BRAND_TAG}-${item.tag}-${idx + 1}`;
    const host = hostOf({ listen: item.listen || "", stream: item.stream }, fallbackHost);
    const st = item.stream || {};
    const tls = item.security === "tls" || item.security === "reality";
    const sni = String(st.sni || (typeof st.serverNames === "string" ? st.serverNames.split(",")[0] : "") || host);

    if (item.protocol === "vless") {
      proxyNames.push(name);
      proxyLines.push(
        `  - name: "${name}"`,
        `    type: vless`,
        `    server: ${host}`,
        `    port: ${item.port}`,
        `    uuid: ${item.key || KEY_FALLBACK.vless}`,
        `    network: ${item.transport === "httpupgrade" ? "ws" : item.transport}`,
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
      if (item.transport === "ws" || item.transport === "httpupgrade") {
        proxyLines.push(
          `    ws-opts:`,
          `      path: "${String(st.path || "/")}"`,
          `      headers:`,
          `        Host: "${String(st.host || host)}"`
        );
      } else if (item.transport === "grpc") {
        proxyLines.push(
          `    grpc-opts:`,
          `      grpc-service-name: "${String(st.serviceName || "grpc")}"`
        );
      }
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
        `    network: ${item.transport}`,
        `    tls: ${tls}`,
        `    udp: true`,
        `    servername: ${sni}`
      );
    } else if (item.protocol === "trojan") {
      proxyNames.push(name);
      proxyLines.push(
        `  - name: "${name}"`,
        `    type: trojan`,
        `    server: ${host}`,
        `    port: ${item.port}`,
        `    password: "${item.key || KEY_FALLBACK.trojan}"`,
        `    network: ${item.transport}`,
        `    sni: ${sni}`,
        `    udp: true`
      );
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

export function buildSingboxJson(items: SubExportItem[], subName: string, fallbackHost?: string): string {
  const outbounds: Record<string, unknown>[] = [];
  const tags: string[] = [];

  items.forEach((item, idx) => {
    const tag = `${BRAND_TAG}-${item.tag}-${idx + 1}`;
    const host = hostOf({ listen: item.listen || "", stream: item.stream }, fallbackHost);
    const st = item.stream || {};
    const tlsEnabled = item.security === "tls" || item.security === "reality";
    const sni = String(st.sni || (typeof st.serverNames === "string" ? st.serverNames.split(",")[0] : "") || host);

    const tlsObj = tlsEnabled
      ? {
          enabled: true,
          server_name: sni,
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
        tls: {
          enabled: true,
          server_name: sni,
          insecure: Boolean(st.allowInsecure),
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
