import { randomBytes } from "node:crypto";
import { db, type ClientUser, type Inbound, type SubGroup, type SubGroupMember, type UserInboundAccess } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { deriveStatus, type UserStatus } from "@/lib/user-types";
import { buildShareMaterial } from "@/lib/share-links";
import { makeWgKeypair } from "@/lib/users";

/* ============================================================
   Sephiroth · Phase 5 — Subscription groups (server helpers)
   A SubGroup unions several ClientUsers onto one public
   /sub/[token] page. Tokens resolve user-first (ClientUser
   .subId) then group (SubGroup.token). Group pages can be
   password-protected (scrypt, same primitive as Phase 1).
   ============================================================ */

/* ---------- token / password ---------- */

export function genGroupToken(): string {
  return randomBytes(12).toString("hex"); // 24 hex chars — distinct from user subIds (16)
}

export function groupPasswordHash(password: string): string {
  return hashPassword(password);
}

/* ---------- validation ---------- */

export type GroupFieldKey = "name" | "infoLine" | "password" | "memberIds";
export type GroupFieldError = { field: GroupFieldKey; code: string };

export interface GroupWrite {
  name: string;
  infoLine: string;
  enabled: boolean;
  /** null = leave untouched (patch) / no password (create);
   *  "" (empty string) = clear existing password */
  password: string | null;
  memberIds: string[];
}

export function validateGroup(
  body: unknown,
  opts: { partial?: boolean }
): { ok: true; data: GroupWrite } | { ok: false; fields: GroupFieldError[] } {
  const fields: GroupFieldError[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!(opts.partial && name === "") && (name.length < 1 || name.length > 48))
    fields.push({ field: "name", code: "format" });

  const infoLine = typeof b.infoLine === "string" ? b.infoLine.trim().slice(0, 200) : "";

  // password semantics: string ≥4 chars → set; null → no-op (create) ; "clear" sentinel
  let password: string | null = null;
  if (typeof b.password === "string") {
    const pw = b.password;
    if (pw === "") {
      if (!opts.partial) password = null; // create with empty = no password
    } else if (pw.length < 4) {
      fields.push({ field: "password", code: "short" });
    } else {
      password = pw;
    }
  }
  if (b.clearPassword === true) password = "";

  const memberIds = Array.isArray(b.memberIds)
    ? [...new Set(b.memberIds.filter((x): x is string => typeof x === "string"))]
    : [];

  if (fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    data: {
      name,
      infoLine,
      enabled: typeof b.enabled === "boolean" ? b.enabled : true,
      password,
      memberIds,
    },
  };
}

/* ---------- DTO ---------- */

export interface GroupDTO {
  id: string;
  name: string;
  token: string;
  hasPassword: boolean;
  infoLine: string | null;
  enabled: boolean;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function toGroupDTO(
  row: SubGroup & { members: (SubGroupMember & { user: { id: string } })[] }
): GroupDTO {
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    hasPassword: Boolean(row.passwordHash),
    infoLine: row.infoLine,
    enabled: row.enabled,
    memberIds: row.members.map((m) => m.user.id),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/* ---------- public payload builders ---------- */

export interface SubConfigDTO {
  id: string;
  owner: string | null;
  ownerStatus: UserStatus;
  tag: string;
  protocol: string;
  port: number;
  transport: string;
  security: string;
  status: string;
  email: string;
  link: string | null;
  text: string;
  /** Task 25-a — secondary URI (mixed → http://, mtproto → t.me/proxy web link) */
  extra: string | null;
}

export interface SubMemberDTO {
  username: string;
  status: UserStatus;
  usedGb: number;
  limitGb: number | null;
  daysLeft: number | null;
}

export interface SubPayload {
  kind: "user" | "group";
  token: string;
  name: string;
  note: string | null;
  infoLine: string | null;
  locked: false;
  enabled: boolean;
  status: UserStatus;
  usage: { usedGb: number; limitGb: number | null };
  expiry: { daysLeft: number | null; never: boolean; endsAtIso: string | null };
  members: SubMemberDTO[] | null;
  configs: SubConfigDTO[];
}

/**
 * Legacy WG accesses were created without a per-client keypair; mint +
 * persist one on first share so buildWgConf never has to fall back to the
 * server secret. Idempotent — writes at most once per access row.
 */
async function ensureWgMaterial(access: UserInboundAccess & { inbound: Inbound }): Promise<{
  wgPrivateKey: string;
  wgPublicKey: string;
}> {
  if (access.inbound.protocol !== "wireguard") {
    return { wgPrivateKey: "", wgPublicKey: "" };
  }
  if (access.wgPrivateKey) {
    return { wgPrivateKey: access.wgPrivateKey, wgPublicKey: access.wgPublicKey ?? "" };
  }
  const kp = makeWgKeypair();
  try {
    await db.userInboundAccess.update({
      where: { id: access.id },
      data: { wgPrivateKey: kp.privateKey, wgPublicKey: kp.publicKey },
    });
  } catch (err) {
    console.error("[sub-groups] wg backfill failed for access", access.id, err);
  }
  return { wgPrivateKey: kp.privateKey, wgPublicKey: kp.publicKey };
}

async function configFromAccess(
  access: UserInboundAccess & { inbound: Inbound },
  owner: { username: string; status: UserStatus },
  fallbackHost?: string,
  publicHost?: string
): Promise<SubConfigDTO> {
  const wg = await ensureWgMaterial(access);
  const material = buildShareMaterial(
    {
      tag: access.inbound.tag,
      protocol: access.inbound.protocol,
      port: access.inbound.port,
      listen: access.inbound.listen,
      transport: access.inbound.transport,
      security: access.inbound.security,
      stream: safeJson(access.inbound.streamJson),
    },
    { email: access.email, key: access.key, flow: access.flow, ...wg },
    fallbackHost,
    publicHost
  );
  return {
    id: access.id,
    owner: owner.username,
    ownerStatus: owner.status,
    tag: access.inbound.tag,
    protocol: access.inbound.protocol,
    port: access.inbound.port,
    transport: access.inbound.transport,
    security: access.inbound.security,
    status: access.inbound.status,
    email: access.email,
    link: material.link,
    text: material.text,
    extra: material.extra ?? null,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function userStatusOf(u: ClientUser, now: Date): UserStatus {
  return deriveStatus({
    enabled: u.enabled,
    trafficLimitGb: u.trafficLimitGb,
    expiryDays: u.expiryDays,
    usedTrafficGb: u.usedTrafficGb,
    createdAt: u.createdAt,
    now,
  });
}

function daysLeftOf(u: Pick<ClientUser, "expiryDays" | "createdAt">, now: Date): number | null {
  if (u.expiryDays === null) return null;
  const end = new Date(u.createdAt).getTime() + u.expiryDays * 86_400_000;
  return Math.ceil((end - now.getTime()) / 86_400_000);
}

export async function userSubPayload(
  user: ClientUser & { accesses: (UserInboundAccess & { inbound: Inbound })[] },
  now = new Date(),
  fallbackHost?: string,
  publicHost?: string
): Promise<SubPayload> {
  const status = userStatusOf(user, now);
  const configs: SubConfigDTO[] = [];
  for (const a of user.accesses) {
    configs.push(await configFromAccess(a, { username: user.username, status }, fallbackHost, publicHost));
  }
  return {
    kind: "user",
    token: user.subId,
    name: user.username,
    note: user.note,
    infoLine: null,
    locked: false,
    enabled: user.enabled,
    status,
    usage: { usedGb: round1(user.usedTrafficGb), limitGb: user.trafficLimitGb },
    expiry: {
      daysLeft: daysLeftOf(user, now),
      never: user.expiryDays === null,
      endsAtIso:
        user.expiryDays === null
          ? null
          : new Date(new Date(user.createdAt).getTime() + user.expiryDays * 86_400_000).toISOString(),
    },
    members: null,
    configs,
  };
}

/** Priority: any active wins, then capped, expired, disabled. */
function aggregateStatus(statuses: UserStatus[]): UserStatus {
  for (const s of ["active", "capped", "expired", "disabled"] as UserStatus[]) {
    if (statuses.includes(s)) return s;
  }
  return "disabled";
}

export async function groupSubPayload(
  group: SubGroup & {
    members: (SubGroupMember & {
      user: ClientUser & { accesses: (UserInboundAccess & { inbound: Inbound })[] };
    })[];
  },
  now = new Date(),
  fallbackHost?: string,
  publicHost?: string
): Promise<SubPayload> {
  const members: SubMemberDTO[] = group.members.map((m) => ({
    username: m.user.username,
    status: userStatusOf(m.user, now),
    usedGb: round1(m.user.usedTrafficGb),
    limitGb: m.user.trafficLimitGb,
    daysLeft: daysLeftOf(m.user, now),
  }));

  const configs: SubConfigDTO[] = [];
  const sorted = [...group.members].sort((a, b) => a.user.username.localeCompare(b.user.username));
  for (const m of sorted) {
    const st = userStatusOf(m.user, now);
    for (const a of m.user.accesses) {
      configs.push(await configFromAccess(a, { username: m.user.username, status: st }, fallbackHost, publicHost));
    }
  }

  const used = members.reduce((acc, m) => acc + m.usedGb, 0);
  const anyUnlimited = group.members.some((m) => m.user.trafficLimitGb === null);
  const summed = group.members.reduce((acc, m) => acc + (m.user.trafficLimitGb ?? 0), 0);

  return {
    kind: "group",
    token: group.token,
    name: group.name,
    note: null,
    infoLine: group.infoLine,
    locked: false,
    enabled: group.enabled,
    status: aggregateStatus(members.map((m) => m.status)),
    usage: {
      usedGb: round1(used),
      limitGb: group.members.length === 0 || anyUnlimited ? null : round1(summed),
    },
    expiry: {
      daysLeft: members.length ? Math.max(...members.map((m) => m.daysLeft ?? -Infinity)) : null,
      never: group.members.some((m) => m.user.expiryDays === null) || group.members.length === 0,
      endsAtIso: null,
    },
    members,
    configs,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

