import { NextResponse } from "next/server";
import { isIP } from "node:net";
import net from "node:net";
import os from "node:os";
import { requireAdmin } from "@/lib/inbounds";

/* ============================================================
   Sephiroth · v2.4 — Server IP / port auto-detection
   GET /api/system/server-info (admin only)
   Feeds the Forge "auto-fill" buttons: detects the machine's
   public IPv4 (4 echo services, 3s timeout each), lists the
   private IPv4 addresses, reports the REAL panel port and
   probes a free suggested port on 0.0.0.0.

   Module-scope cache: 10 min on success, 60 s when the public
   IP could not be detected (offline host) so an air-gapped
   server never hammers the echo services.
   ============================================================ */

interface ServerInfo {
  publicIp: string | null;
  privateIps: string[];
  panelPort: number;
  suggestedPort: number;
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
}

const PUBLIC_IP_SOURCES = [
  "https://api.ipify.org",
  "https://api.ip.sb/ip",
  "https://ifconfig.me/ip",
  "https://icanhazip.com",
];

// Probe order for the suggested port: right after the panel,
// then well-known CDN-friendly HTTPS ports.
const SUGGESTED_CANDIDATES = [8443, 443, 2053, 2087, 2096, 8880];

const CACHE_OK_MS = 10 * 60_000;
const CACHE_NULL_MS = 60_000;
const ECHO_TIMEOUT_MS = 3000;
const PROBE_TIMEOUT_MS = 1500;

let cache: { value: ServerInfo; at: number } | null = null;

function panelPort(): number {
  return (
    Number.parseInt(process.env.PORT ?? "", 10) ||
    Number.parseInt(process.env.SERVER_PORT ?? "", 10) ||
    3000
  );
}

/** Ask the echo services for the public IPv4 — first valid v4 answer wins. */
async function detectPublicIp(): Promise<string | null> {
  for (const url of PUBLIC_IP_SOURCES) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "curl/8.5.0", accept: "text/plain" },
        signal: AbortSignal.timeout(ECHO_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (isIP(text) === 4) return text;
    } catch {
      /* timeout / offline / bad body — try the next source */
    }
  }
  return null;
}

/** IPv4, non-internal interfaces from the OS. */
function detectPrivateIps(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === "IPv4" && !info.internal) out.push(info.address);
    }
  }
  return out;
}

/** True if the panel process could bind this port on 0.0.0.0 right now. */
function probeFreePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const srv = net.createServer();
    const finish = (free: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        srv.close();
      } catch {
        /* already closed */
      }
      resolve(free);
    };
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    srv.once("error", () => finish(false));
    srv.listen(port, "0.0.0.0", () => finish(true));
  });
}

async function detectSuggestedPort(base: number): Promise<number> {
  for (const port of [base + 1, base + 2, ...SUGGESTED_CANDIDATES]) {
    // eslint-disable-next-line no-await-in-loop
    if (await probeFreePort(port)) return port;
  }
  return 0;
}

async function buildServerInfo(): Promise<ServerInfo> {
  const port = panelPort();
  return {
    publicIp: await detectPublicIp(),
    privateIps: detectPrivateIps(),
    panelPort: port,
    suggestedPort: await detectSuggestedPort(port),
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  };
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  if (cache) {
    const ttl = cache.value.publicIp ? CACHE_OK_MS : CACHE_NULL_MS;
    if (now - cache.at < ttl) {
      return NextResponse.json(cache.value);
    }
  }

  const value = await buildServerInfo();
  cache = { value, at: now };
  return NextResponse.json(value);
}
