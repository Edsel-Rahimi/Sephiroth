/* ============================================================
   Sephiroth · Task 23-g — HWID device fingerprinting helpers
   (subscription-portal device limit, PasarGuard-style)

   Pure module: derives a stable device id from request headers and
   owns the find-or-append / cap semantics of the stored device list.
   No db imports — safe to unit test and reuse across routes.
   ============================================================ */

import { createHash } from "node:crypto";

export interface DeviceEntry {
  /** 16-hex-char fingerprint of (UA + Accept-Language + sec-ch-ua-platform). */
  id: string;
  /** First-seen User-Agent (trimmed for storage sanity). */
  ua: string;
  firstSeen: string; // ISO
  lastSeen: string; // ISO
}

/** Hard storage cap — the list never grows past this (drop stalest first). */
export const DEVICE_CAP = 50;

/**
 * Stable per-device id: sha256(UA + Accept-Language + sec-ch-ua-platform),
 * first 16 hex chars. Clients send these headers on every request, so the
 * same app on the same device hashes to the same id while a different app
 * (or a different system language) hashes differently — deliberate:
 * PasarGuard-style fingerprinting is UA-based by design.
 */
export function deviceFingerprint(headers: {
  "user-agent"?: string | null;
  "accept-language"?: string | null;
  "sec-ch-ua-platform"?: string | null;
}): string {
  const material = [
    (headers["user-agent"] ?? "").slice(0, 400),
    (headers["accept-language"] ?? "").slice(0, 120),
    (headers["sec-ch-ua-platform"] ?? "").slice(0, 60),
  ].join("|");
  return createSha256Hex(material).slice(0, 16);
}

function createSha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Task 23-b — explicit device id sent by the client as `?hwid=<id>` on the
 * subscription URL (v2box/v2rayNG-style clients can be configured to append
 * it). Sanitized to a safe storage/display charset and capped at 64 chars;
 * anything empty after sanitizing falls back to the header fingerprint.
 */
export function explicitDeviceId(raw: string | null | undefined): string | null {
  const clean = (raw ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64);
  return clean.length > 0 ? clean : null;
}

export function parseDevices(raw: string | null | undefined): DeviceEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((d) => d && typeof d === "object" && typeof (d as DeviceEntry).id === "string")
      .map((d) => ({
        id: String((d as DeviceEntry).id),
        ua: String((d as DeviceEntry).ua ?? "").slice(0, 200),
        firstSeen: String((d as DeviceEntry).firstSeen ?? ""),
        lastSeen: String((d as DeviceEntry).lastSeen ?? ""),
      }));
  } catch {
    return [];
  }
}

export interface RegisterResult {
  devices: DeviceEntry[];
  /** The device was already registered (admin sees this device in the list). */
  known: boolean;
  /** Unknown device AND the limit is already reached → reject the request. */
  blocked: boolean;
}

/**
 * Find-or-append the device. Known devices always pass and get their
 * lastSeen refreshed; unknown devices pass only while
 * devices.length < limit (limit <= 0 = unlimited). The stored list is
 * capped at DEVICE_CAP, dropping the stalest entries first.
 */
export function registerDevice(
  existing: DeviceEntry[],
  id: string,
  ua: string,
  limit: number,
  now: Date = new Date()
): RegisterResult {
  const nowIso = now.toISOString();
  const known = existing.some((d) => d.id === id);
  let devices: DeviceEntry[];

  if (known) {
    devices = existing.map((d) => (d.id === id ? { ...d, lastSeen: nowIso } : d));
    return { devices, known: true, blocked: false };
  }

  const limited = Number.isFinite(limit) && limit > 0;
  if (limited && existing.length >= limit) {
    return { devices: existing, known: false, blocked: true };
  }

  devices = [...existing, { id, ua: ua.slice(0, 200), firstSeen: nowIso, lastSeen: nowIso }];
  if (devices.length > DEVICE_CAP) {
    devices = [...devices]
      .sort((a, b) => Date.parse(a.lastSeen || a.firstSeen) - Date.parse(b.lastSeen || b.firstSeen))
      .slice(devices.length - DEVICE_CAP);
  }
  return { devices, known: false, blocked: false };
}
