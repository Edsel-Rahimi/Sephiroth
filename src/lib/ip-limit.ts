/* ============================================================
   Sephiroth · Task 23-g — per-user concurrent-IP tracking
   (PasarGuard-style IP limit, Xray access-log based)

   Pure module: parses Xray access-log lines and keeps a windowed
   email → Set(ip) map. No node APIs, no db imports — safe to unit
   test with tsx and to import from both server routes and drivers.
   ============================================================ */

/**
 * Xray access-log line — REAL shapes (verified against Xray-core v26.10.21
 * with log.access = file, Task 23-b E2E):
 *
 *   2026/10/28 13:14:27.698359 from tcp:127.0.0.1:57423 accepted tcp:127.0.0.1:3100 [ipsoc >> direct] email: ipu@ipsoc
 *   2026/10/28 13:12:34.302255 from 127.0.0.1:45534 accepted tcp:127.0.0.1:46577 [api >> api]
 *   2026/10/28 12:00:00 1.2.3.4:52194 accepted tcp:example.com:443 [inbound -> direct] email: user@tag   (older cores)
 *   2026/10/28 12:00:00 from [2001:db8::1]:443 accepted tcp:d.tld:443 [in -> out] email: v6@tag          (IPv6 source)
 *
 * Format is built by common/log/access.go: `from <src> accepted <to> [detour]
 * [reason] [email: <email>]` where <src> serializes WITH its network prefix
 * ("tcp:1.2.3.4:5"). The email suffix is only present when the inbound sets
 * AccessMessage.Email — vless/vmess/trojan/ss per-client users do; SOCKS
 * accounts do NOT (upstream omits it), so IP-limit attribution needs a
 * per-client-email protocol.
 *
 * Parser rules (liberal by design):
 *   - the SOURCE is the first `IP:port` token after the optional timestamp,
 *     optionally preceded by `from ` and/or the network prefix `tcp:` — we
 *     scan for the first IPv4 / bracketed-IPv6 :port shape and take it;
 *   - the CLIENT email is the token after `email:`;
 *   - lines that are clearly not access records (warnings, errors, DNS
 *     failures, the api door's email-less records) return null — never throw.
 */
export interface AccessLine {
  ip: string;
  email: string;
}

/** Very loose IP shapes: IPv4, bracketed IPv6, or a bare IPv6 address. */
const IP_SRC_RE =
  /(?:from\s+)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[[0-9a-fA-F:.]+\]):\d{1,5}/;
const EMAIL_RE = /email:\s*([^\s\]]+)/;

/** Parse one access-log line → {ip, email} or null when not an access record. */
export function parseAccessIps(line: string): AccessLine | null {
  if (!line) return null;
  if (!line.includes("accepted")) return null; // access records always say "accepted"
  const src = IP_SRC_RE.exec(line);
  if (!src) return null;
  const email = EMAIL_RE.exec(line);
  if (!email) return null;
  const ip = src[1]!.replace(/^\[|\]$/g, "");
  if (!isPlausibleIp(ip)) return null;
  return { ip, email: email[1]! };
}

function isPlausibleIp(ip: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return true; // IPv4
  return ip.includes(":") && /^[0-9a-fA-F:.]+$/.test(ip); // IPv6
}

/* ---------- windowed tracker ---------- */

/**
 * email → (ip → lastSeen epoch ms). Windowed: entries older than
 * `windowMs` are pruned on tick, so a user who left an hour ago no
 * longer counts toward the concurrent-IP limit.
 */
export class IpTracker {
  private entries = new Map<string, Map<string, number>>();

  constructor(private windowMs: number = 10 * 60_000) {}

  /** Record one observation. Returns true when the (email, ip) pair was new. */
  observe(email: string, ip: string, now: number = Date.now()): boolean {
    if (!email || !ip) return false;
    let ips = this.entries.get(email);
    if (!ips) {
      ips = new Map();
      this.entries.set(email, ips);
    }
    const prev = ips.get(ip);
    ips.set(ip, now);
    this.pruneStale(ips, now);
    return prev === undefined;
  }

  /** Parse + observe one line (convenience for log tailers). */
  observeLine(line: string, now: number = Date.now()): boolean {
    const parsed = parseAccessIps(line);
    if (!parsed) return false;
    return this.observe(parsed.email, parsed.ip, now);
  }

  /** Distinct IPs inside the window for one email (newest first). */
  ips(email: string, now: number = Date.now()): string[] {
    const ips = this.entries.get(email);
    if (!ips) return [];
    this.pruneStale(ips, now);
    return [...ips.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ip]) => ip);
  }

  count(email: string, now: number = Date.now()): number {
    return this.ips(email, now).length;
  }

  /** True when the user is over their concurrent-IP limit (0 = unlimited). */
  overLimit(email: string, limit: number, now: number = Date.now()): boolean {
    if (!limit || limit <= 0) return false;
    return this.count(email, now) > limit;
  }

  /** Whole map for admin surfacing: email → distinct IPs (newest first). */
  snapshot(now: number = Date.now()): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const email of this.entries.keys()) {
      const ips = this.ips(email, now);
      if (ips.length > 0) out[email] = ips;
    }
    return out;
  }

  /** Drop everything (used when the core restarts — window state is stale). */
  clear(): void {
    this.entries.clear();
  }

  /** Window length in minutes (surfaced by the admin API). */
  get windowMinutes(): number {
    return Math.round(this.windowMs / 60_000);
  }

  private pruneStale(ips: Map<string, number>, now: number): void {
    const cutoff = now - this.windowMs;
    for (const [ip, seen] of ips) {
      if (seen < cutoff) ips.delete(ip);
    }
  }
}
