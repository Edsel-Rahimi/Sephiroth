import { randomBytes, randomUUID } from "node:crypto";
import type { ClientUser, Inbound, UserInboundAccess } from "@prisma/client";
import {
  type AccessDTO,
  type EmbeddedClient,
  type UserDTO,
  type UserStatus,
  deriveStatus,
  parseClients,
} from "./user-types";

/* ============================================================
   Sephiroth · Phase 4 — server-side user helpers

   A ClientUser owns one access entry per linked inbound. Each
   access is projected into the inbound's `clientsJson` with an
   `ownerId` so the core-facing config keeps the exact Phase-3
   shape. This module holds key generation, DTO mapping and the
   projection sync primitives (pure functions over JSON blobs).
   ============================================================ */

/* ---------- key / id generation ---------- */

const PW_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function genSubId(): string {
  return randomBytes(8).toString("hex"); // 16 hex chars
}

/** Protocol-correct identity material for an access entry. */
export function genKey(protocol: string): string {
  switch (protocol) {
    case "vless":
    case "vmess":
      return randomUUID();
    case "trojan":
    case "shadowsocks":
    case "hysteria2":
    case "socks":
    case "http": {
      let out = "";
      const bytes = randomBytes(28);
      for (let i = 0; i < 28; i++) out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
      return out;
    }
    case "wireguard": {
      // preview-grade visual key material (real peers need xray wg tooling)
      return randomBytes(32).toString("base64");
    }
    default:
      // dokodemo-door and any future protocol — entry key is informational
      return randomBytes(12).toString("hex");
  }
}

/** Reality-mode vless rides on xtls-rprx-vision. */
export function flowFor(inbound: Pick<Inbound, "protocol" | "security">): string {
  return inbound.protocol === "vless" && inbound.security === "reality"
    ? "xtls-rprx-vision"
    : "";
}

/** Unique email for an access inside one inbound. */
export function emailFor(username: string, tag: string, taken: ReadonlySet<string>): string {
  const base = `${username}@${tag}`.slice(0, 48);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const next = `${base}-${n}`;
    if (!taken.has(next)) return next;
  }
}

/* ---------- DTO ---------- */

type UserRow = ClientUser & { accesses: (UserInboundAccess & { inbound: Inbound })[] };

export function toUserDTO(row: UserRow, now?: Date): UserDTO & { status: UserStatus } {
  return {
    id: row.id,
    username: row.username,
    subId: row.subId,
    note: row.note,
    enabled: row.enabled,
    trafficLimitGb: row.trafficLimitGb,
    expiryDays: row.expiryDays,
    ipLimit: row.ipLimit,
    usedTrafficGb: row.usedTrafficGb,
    status: deriveStatus(row),
    resellerId: row.resellerId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    accesses: row.accesses.map(
      (a): AccessDTO => ({
        id: a.id,
        inboundId: a.inboundId,
        email: a.email,
        key: a.key,
        flow: a.flow,
        inbound: {
          id: a.inbound.id,
          tag: a.inbound.tag,
          protocol: a.inbound.protocol,
          port: a.inbound.port,
          transport: a.inbound.transport,
          security: a.inbound.security,
          status: a.inbound.status,
          listen: a.inbound.listen,
          streamJson: a.inbound.streamJson,
        },
      })
    ),
  };
}

/* ---------- clientsJson projection primitives ---------- */

/**
 * Syncs one inbound's clientsJson with the access entries owned by
 * `userId`. Entries carrying `ownerId === userId` are replaced with
 * the desired projection; foreign/manual entries are preserved.
 */
export function projectUserOntoInbound(
  clientsJson: string,
  userId: string,
  desired: EmbeddedClient[]
): string {
  const list = parseClients(clientsJson);
  const kept = list.filter((c) => c.ownerId !== userId);
  const merged = [...kept, ...desired.map((d) => ({ ...d, ownerId: userId }))];
  return JSON.stringify(merged);
}

/** Removes every entry owned by the user from one inbound's clientsJson. */
export function stripUserFromInbound(clientsJson: string, userId: string): string {
  const list = parseClients(clientsJson);
  return JSON.stringify(list.filter((c) => c.ownerId !== userId));
}
