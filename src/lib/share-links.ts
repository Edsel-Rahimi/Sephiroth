/* ============================================================
   Sephiroth · Phase 5 — isomorphic share-link builders
   Pure functions used by BOTH client views (inbounds/users)
   and server routes (public /api/sub/[token] formats).
   No node-only and no DOM-only APIs: btoa/TextEncoder exist in
   Node 18+ and all browsers alike.
   ============================================================ */

/** Brand tag stamped on every generated config (URI label / conf comment). */
export const BRAND_TAG = "Sephiroth";

/** Structural inbound shape — rich DTOs (InboundDTO etc.) fit as-is. */
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
  /** parsed streamJson; values are string | number | boolean */
  stream?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

/** Structural client shape (embedded client / access entry). */
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

export function hostOf(row: { listen: string }): string {
  return row.listen && row.listen !== "0.0.0.0" ? row.listen : "0.0.0.0";
}

/** Placeholder identity when an inbound has no client yet — the link stays
 *  structurally valid; regenerate after adding a real client. */
const KEY_FALLBACK: Record<string, string> = {
  vless: "00000000-0000-0000-0000-000000000000",
  vmess: "00000000-0000-0000-0000-000000000000",
  trojan: "password",
  shadowsocks: "password",
  hysteria2: "password",
};

/**
 * Builds the standard share URI for an inbound + first client.
 * Returns null for protocols without a URI scheme (dokodemo-door, wireguard)
 * — the caller falls back to a text summary.
 */
export function buildShareLink(row: ShareInbound, first?: ShareClient): string | null {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  const host = hostOf(row);
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
      if (st.fingerprint) q.set("fp", String(st.fingerprint));
      if (st.alpn) q.set("alpn", String(st.alpn));
    }
    if (row.security === "reality") {
      if (st.serverNames) q.set("sni", String(st.serverNames).split(",")[0].trim());
      if (st.fingerprint) q.set("fp", String(st.fingerprint));
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
        fp: String(st.fingerprint ?? ""),
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
      if (st.allowInsecure === true || row.security === "none") q.set("insecure", "1");
      return `hy2://${encodeURIComponent(key)}@${host}:${port}?${q.toString()}#${encodeURIComponent(label)}`;
    }
    case "socks":
    case "http": {
      const auth = first ? `${encodeURIComponent(first.email ?? "")}:${encodeURIComponent(first.key ?? "")}@` : "";
      return `${row.protocol}://${auth}${host}:${port}#${encodeURIComponent(label)}`;
    }
    default:
      return null; // dokodemo-door / wireguard → caller uses text fallback
  }
}

/** Preview-grade WireGuard .conf text for the copy button. */
export function buildWgConf(row: ShareInbound, first?: ShareClient): string {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  const host = hostOf(row);
  return [
    `# ${BRAND_TAG} · ${row.tag}`,
    "[Interface]",
    `PrivateKey = ${st.wgSecretKey ?? "<private-key>"}`,
    "Address = 10.0.0.2/32",
    "DNS = 1.1.1.1",
    `MTU = ${st.wgMtu ?? 1420}`,
    "",
    "[Peer]",
    `PublicKey = ${first?.key ?? st.wgPublicKey ?? "<peer-public-key>"}`,
    "AllowedIPs = 0.0.0.0/0, ::/0",
    `Endpoint = ${host}:${row.port}`,
    "PersistentKeepalive = 25",
  ].join("\n");
}

/** Text summary for dokodemo-door (no URI scheme exists). */
export function buildDokoSummary(row: ShareInbound): string {
  const st = (row.stream ?? {}) as Record<string, unknown>;
  return [
    `${BRAND_TAG} · dokodemo-door · ${row.tag}`,
    `listen: ${hostOf(row)}:${row.port}`,
    `target: ${st.dokoAddress ?? "?"}:${st.dokoPort ?? "?"}`,
    `network: ${st.dokoNetwork ?? "tcp"}`,
  ].join("\n");
}

/** Protocol-correct export material: URI when one exists, text otherwise. */
export function buildShareMaterial(
  row: ShareInbound,
  first?: ShareClient
): { link: string | null; text: string } {
  const link = buildShareLink(row, first);
  if (link) return { link, text: link };
  if (row.protocol === "wireguard") return { link: null, text: buildWgConf(row, first) };
  return { link: null, text: buildDokoSummary(row) };
}
