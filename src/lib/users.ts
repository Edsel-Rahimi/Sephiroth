import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { ClientUser, Inbound, UserInboundAccess } from "@/lib/db";
import {
  type AccessDTO,
  type EmbeddedClient,
  type UserDTO,
  type UserStatus,
  deriveStatus,
  parseClients,
} from "./user-types";
import { parseDevices } from "./hwid";

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

/* ---------- WireGuard per-client key material ---------- */

/** Raw base64 (32-byte) X25519 keypair — the shape WireGuard expects. */
export function makeWgKeypair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const privDer = privateKey.export({ type: "pkcs8", format: "der" });
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  return {
    // DER wrappers end with the raw 32-byte key
    privateKey: Buffer.from(privDer.subarray(privDer.length - 32)).toString("base64"),
    publicKey: Buffer.from(pubDer.subarray(pubDer.length - 32)).toString("base64"),
  };
}

/** Derives the public key for a raw base64 WireGuard private key (null if malformed). */
export function wgPublicKeyFrom(secret: string): string | null {
  const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
  try {
    const raw = Buffer.from(secret, "base64");
    if (raw.length !== 32) return null;
    const priv = createPrivateKey({
      key: Buffer.concat([PKCS8_PREFIX, raw]),
      format: "der",
      type: "pkcs8",
    });
    const pubDer = createPublicKey(priv).export({ type: "spki", format: "der" });
    return Buffer.from(pubDer.subarray(pubDer.length - 32)).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Identity material for one access row. WireGuard gets a REAL per-client
 * X25519 keypair (private key stays on the access row; the share/export
 * layer uses it for the [Interface] PrivateKey); other protocols only
 * carry the protocol-correct `key`.
 */
export function genAccessFields(protocol: string): {
  key: string;
  wgPrivateKey: string;
  wgPublicKey: string;
} {
  if (protocol === "wireguard") {
    const kp = makeWgKeypair();
    return { key: kp.publicKey, wgPrivateKey: kp.privateKey, wgPublicKey: kp.publicKey };
  }
  return { key: genKey(protocol), wgPrivateKey: "", wgPublicKey: "" };
}

/** Protocol-correct identity material for an access entry. */
export function genKey(protocol: string): string {
  switch (protocol) {
    case "vless":
    case "vmess":
      return randomUUID();
    case "tuic": {
      // Task 23-c — TUIC v5 needs uuid + password; the store carries the wire
      // composite "uuid:password" (the exact form the tuic:// URI splits on)
      let pw = "";
      const bytes = randomBytes(28);
      for (let i = 0; i < 28; i++) pw += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
      return `${randomUUID()}:${pw}`;
    }
    case "trojan":
    case "shadowsocks":
    case "hysteria2":
    case "socks":
    case "http":
    case "mixed": {
      let out = "";
      const bytes = randomBytes(28);
      for (let i = 0; i < 28; i++) out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
      return out;
    }
    case "mtproto": {
      // Task 25-a — the access key IS the mtg v2 secret (ee + 16-byte hex).
      // The fake-TLS domain, when configured, lives in the inbound stream and
      // is appended there; the bare faketls secret is valid on its own.
      return `ee${randomBytes(16).toString("hex")}`;
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
    hwidLimit: row.hwidLimit ?? null,
    devices: parseDevices(row.devices),
    usedTrafficGb: row.usedTrafficGb,
    resetPeriod: row.resetPeriod ?? null,
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
        wgPrivateKey: a.wgPrivateKey ?? "",
        wgPublicKey: a.wgPublicKey ?? "",
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
