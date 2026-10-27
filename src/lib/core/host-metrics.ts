/**
 * Sephiroth core adapter — REAL host telemetry (server-only).
 *
 * Mirrors the measurement code of mini-services/core-sim/sim.ts (cpu/ram/disk
 * from the OS, network byte-counter deltas from /proc/net/dev) so the xray
 * backend feeds the dashboard charts with the same honest values the
 * simulator produces. Zero synthetic data.
 */

import os from "node:os";
import fs from "node:fs";

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));
export const round1 = (x: number): number => Math.round(x * 10) / 10;
export const round2 = (x: number): number => Math.round(x * 100) / 100;
export const round4 = (x: number): number => Math.round(x * 10000) / 10000;

export function pushRing(arr: number[], value: number, cap: number): void {
  arr.push(value);
  if (arr.length > cap) arr.shift();
}

export interface CpuTimes {
  used: number;
  total: number;
}

export function cpuTimes(): CpuTimes {
  let used = 0;
  let total = 0;
  for (const c of os.cpus()) {
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
    used += c.times.user + c.times.nice + c.times.sys + c.times.irq;
  }
  return { used, total };
}

export function ramPct(): { pct: number; usedMb: number; totalMb: number } {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    pct: total > 0 ? round1(clamp(((total - free) / total) * 100, 0, 100)) : 0,
    usedMb: round1((total - free) / 1048576),
    totalMb: Math.round(total / 1048576),
  };
}

export function diskPct(): number {
  try {
    const s = fs.statfsSync("/");
    const used = s.blocks - s.bfree;
    return s.blocks > 0 ? round1(clamp((used / s.blocks) * 100, 0, 100)) : 0;
  } catch {
    return 0;
  }
}

export interface NetSample {
  rx: number;
  tx: number;
}

/** Sum of real interface byte counters from /proc/net/dev (loopback excluded). */
export function readNetCounters(): NetSample {
  try {
    const text = fs.readFileSync("/proc/net/dev", "utf8");
    let rx = 0;
    let tx = 0;
    for (const line of text.split("\n").slice(2)) {
      const [ifname, rest] = line.split(":");
      if (!ifname || !rest || ifname.trim() === "lo") continue;
      const cols = rest.trim().split(/\s+/);
      rx += Number(cols[0]) || 0;
      tx += Number(cols[8]) || 0;
    }
    return { rx, tx };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

/** "vless" + "ws" + "tls" → "VLESS · WS · TLS" (tcp transport is omitted). */
export function composeProto(protocol: string, transport: string, security: string): string {
  const bases: Record<string, string> = {
    vless: "VLESS",
    vmess: "VMess",
    trojan: "Trojan",
    shadowsocks: "Shadowsocks",
    hysteria2: "Hysteria2",
  };
  const parts = [bases[protocol] ?? protocol];
  if (transport === "ws") parts.push("WS");
  else if (transport === "grpc") parts.push("gRPC");
  else if (transport === "httpupgrade") parts.push("HTTPUpgrade");
  else if (transport === "xhttp") parts.push("XHTTP");
  if (security === "tls") parts.push("TLS");
  else if (security === "reality") parts.push("REALITY");
  return parts.join(" · ");
}

const INBOUND_STATUSES: readonly string[] = ["online", "maintenance", "disabled"];

/** DB `status` is a free string — clamp it onto the wire union defensively. */
export function asInboundStatus(
  value: string,
  fallback: "online" | "maintenance" | "disabled" = "online"
): "online" | "maintenance" | "disabled" {
  return INBOUND_STATUSES.includes(value)
    ? (value as "online" | "maintenance" | "disabled")
    : fallback;
}
