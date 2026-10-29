import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

function cuid(): string {
  return "c" + Date.now().toString(36) + randomBytes(6).toString("hex");
}

/* ---------- Model Types (matching Prisma schema) ---------- */

export interface AdminUser {
  id: string;
  username: string;
  passwordHash: string;
  recoveryKey: string;
  displayName: string | null;
  /** task 3-b — fine-grained RBAC: "owner" | "admin" | "viewer" (legacy rows = "owner") */
  role: string;
  /** task 3-b — disabled admins cannot sign in (sessions die immediately) */
  enabled: boolean;
  /** task 3-b — last successful sign-in */
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServerSetting {
  key: string;
  value: string;
}

export interface Inbound {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  listen: string;
  transport: string;
  security: string;
  status: string;
  note: string | null;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  clientsJson: string;
  sniffingJson: string;
  streamJson: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientUser {
  id: string;
  username: string;
  subId: string;
  note: string | null;
  enabled: boolean;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  usedTrafficGb: number;
  /** "daily" | "weekly" | "monthly" | "none" | null (null = never reset) */
  resetPeriod: string | null;
  /** Anchor for the reset window; falls back to createdAt when null. */
  lastResetAt: Date | null;
  resellerId: string | null;
  /** Telegram user id when the account was bought/linked via the sales bot (null otherwise). */
  tgId: string | null;
  /** Task 23-g — HWID device limit for the sub portal (null/0 = unlimited). */
  hwidLimit: number | null;
  /** Task 23-g — registered sub-portal devices, JSON array of {id, ua, firstSeen, lastSeen}. */
  devices: string;
  /** 26-a — on-hold: the expiry clock starts at the FIRST connection, not at purchase. */
  onHold: boolean;
  /** 26-a — first-connect timestamp; null = never connected (clock not started). */
  startedAt: Date | null;
  /** 26-a — roll the window forward automatically instead of disabling on expiry. */
  autoRenew: boolean;
  /** 26-a — how many times auto-renew has extended this subscription. */
  renewals: number;
  /** 26-a — last “expires soon” warning sent at (prevents daily spam across restarts). */
  expiryWarnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserInboundAccess {
  id: string;
  userId: string;
  inboundId: string;
  email: string;
  key: string;
  flow: string;
  /** WireGuard: per-client X25519 keypair (base64, 32 raw bytes). Empty for non-WG. */
  wgPrivateKey: string;
  wgPublicKey: string;
}

export interface SubGroup {
  id: string;
  name: string;
  token: string;
  passwordHash: string | null;
  infoLine: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubGroupMember {
  id: string;
  groupId: string;
  userId: string;
}

export interface Reseller {
  id: string;
  username: string;
  passwordHash: string;
  note: string | null;
  enabled: boolean;
  maxUsers: number | null;
  trafficQuotaGb: number | null;
  /** 26-c — white-label for the reseller's /sub pages (null = Sephiroth branding). */
  brandName: string | null;
  /** 26-c — logo URL (https or data URI) shown on their sub pages. */
  brandLogo: string | null;
  /** 26-c — accent hex color (e.g. "#f59e0b") for their sub pages. */
  brandAccent: string | null;
  /* task 3-1 — per-reseller Telegram bot (own token, own shop). "" = no token;
     botUsername is the getMe result cached by the reseller worker. */
  botToken: string;
  botEnabled: boolean;
  botUsername: string;
  /* task 3-1 — the reseller's OWN payment gateway for their bot (never falls
     back to the owner's gateway; "" = not configured → honest pay-unavailable). */
  payCardNumber: string;
  payCardHolder: string;
  payZarinpalMerchant: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaleTemplate {
  id: string;
  name: string;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  enabled: boolean;
  /** Price in Toman; 0 = free / trial template (sales bot, Task 23-c). */
  priceToman: number;
  /** Whether the sales bot lists this template in the shop. */
  botVisible: boolean;
  /** task 3-1 — catalog scoping: "" = owner's (global) catalog; otherwise this
   *  template is only listed in THAT reseller's bot shop. */
  resellerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Host {
  id: string;
  inboundId: string;
  remark: string;
  address: string;
  port: number;
  security: string;
  sni: string;
  hostHeader: string;
  path: string;
  alpn: string;
  fingerprint: string;
  enable: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Node {
  id: string;
  name: string;
  scheme: string;
  address: string;
  port: number;
  basePath: string;
  apiToken: string;
  enable: boolean;
  syncAll: boolean;
  inboundTags: string;
  outboundTag: string;
  tlsVerify: string;
  status: string;
  latencyMs: number;
  xrayVersion: string;
  /** Core driver reported by the agent ("" = never probed): sim | xray */
  coreKind: string;
  lastSeen: Date | null;
  /** Last successful config push to the agent (null = never). */
  lastSyncAt: Date | null;
  /** Last agent-call error ("" = none). */
  lastError: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Outbound {
  id: string;
  tag: string;
  protocol: string;
  sendThrough: string;
  domainStrategy: string;
  settingsJson: string;
  streamJson: string;
  muxEnabled: boolean;
  muxConcurrency: number;
  sortOrder: number;
  upBytes: number;
  downBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoutingRule {
  id: string;
  enabled: boolean;
  comment: string;
  outboundTag: string;
  domainJson: string;
  ipJson: string;
  port: string;
  network: string;
  protocolJson: string;
  inboundTagJson: string;
  sourceJson: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityLog {
  id: string;
  kind: string;
  level: string;
  actor: string;
  message: string;
  metaJson: string;
  createdAt: Date;
}

/** Bot-side profile of a Telegram user (language preference + ban flag). */
export interface TgUser {
  id: string;
  tgId: string;
  tgUsername: string;
  /** "fa" | "en" — per-user interface language for the sales bot. */
  lang: string;
  banned: boolean;
  /** 2-e — optional ban note surfaced by the anti-abuse gate ("" = no reason). */
  banReason?: string;
  /** 2-e — ISO instant of the ban (absent/null = never banned or unbanned). */
  bannedAt?: string | null;
  /** v2.8 — wallet balance in Toman. OPTIONAL: rows created before v2.8 lack
   *  it entirely — EVERY read must use `?? 0` (no migration needed). */
  balanceToman?: number;
  /** 2-d — referral program. OPTIONAL: pre-2-d rows lack them — every read
   *  must tolerate `undefined`. refCode is generated LAZILY ("REF-XXXXXX",
   *  unique-ish via collision-checked generation); refBy is the referrer's
   *  chatId ("" = nobody); refRewarded flips once the first PAID order of
   *  this user completed; refEarnedToman is the exact lifetime reward total
   *  credited to this user (reward settings may change over time, so the
   *  earned figure is accumulated per grant, never recomputed). */
  refCode?: string;
  refBy?: string;
  refRewarded?: boolean;
  refEarnedToman?: number;
  /** task 3-1 — which shop this Telegram customer belongs to: "" = the
   *  owner's main bot; a reseller id = they /started THAT reseller's bot.
   *  Backfilled to "" at load (pre-3-1 rows are main-bot customers). */
  resellerId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One bot purchase. Status machine:
 *  awaiting_payment (zarinpal) → completed | canceled
 *  pending_manual  (card)     → completed | rejected
 *  completed / rejected / canceled are terminal. */
export interface TgOrder {
  id: string;
  tgId: string;
  tgUsername: string;
  templateId: string;
  templateName: string;
  amountToman: number;
  /** "zarinpal" | "card" */
  method: string;
  /** "awaiting_payment" | "pending_manual" | "completed" | "rejected" | "canceled" */
  status: string;
  /** ZarinPal authority token (zarinpal orders only). */
  authority: string;
  /** Telegram file_id of the uploaded card-to-card receipt photo. */
  receiptFileId: string;
  /** ClientUser created on completion ("provisioning" = claim in-flight). */
  provisionedUserId: string | null;
  /** v2.8 — when set, completing this order EXTENDS the subscription with
   *  this subId instead of creating a new ClientUser. OPTIONAL: rows created
   *  before v2.8 lack it — reads use `?? null` (no migration needed). */
  renewTargetSubId?: string;
  /** 2-d — multi-item cart orders: JSON array of {templateId, qty}. OPTIONAL:
   *  absent (or unparseable) = legacy single-item order → treat as
   *  [{templateId: order.templateId, qty: 1}] (backward compatible). */
  itemsJson?: string;
  /** 2-d — discount applied at checkout: JSON {code, percentOff, maxOff,
   *  discountToman}. OPTIONAL: absent = no discount. amountToman ALWAYS holds
   *  the post-discount payable so the whole payment pipeline (zarinpal verify,
   *  wallet debit, admin revenue) stays on one number. */
  discountJson?: string;
  /** 3-a — Telegram Stars idempotency: telegram_payment_charge_id from the
   *  successful_payment message. OPTIONAL: stars orders only; absent = not
   *  settled yet (or a non-stars order). */
  chargeId?: string;
  /** task 3-1 — which bot created this order: "" = the owner's main bot;
   *  a reseller id = the order came through THAT reseller's bot. Backfilled
   *  to "" at load; the owner worker filters on "" so reseller commerce
   *  never rides the owner's payment sweeps or receipt matching. */
  resellerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelayTunnelRow {
  id: string;
  name: string;
  mode: string; // "tcp-relay" | "ws-tunnel" | "grpc-mux" | "xhttp-reverse" | "load-balance"
  entryNode: string;
  entryAddress: string;
  entryPort: number;
  exitNode: string;
  exitAddress: string;
  exitPort: number;
  inboundTag: string;
  lbStrategy: string; // "round-robin" | "least-ping" | "failover" | "hash-ip"
  enabled: boolean;
  latencyMs: number;
  upBytes: number;
  downBytes: number;
  status: string; // "active" | "degraded" | "offline"
  createdAt: Date;
  updatedAt: Date;
}

// ------------------------------------------------------------
// Phase 27 — Public API tokens (Bearer auth for the REST API).
// Only the sha256 hash is stored; the raw secret is shown once.
// ------------------------------------------------------------
export interface ApiToken {
  id: string;
  name: string;
  tokenHash: string;
  prefix: string;
  actorUsername: string;
  enabled: boolean;
  lastUsedAt: Date | null;
  lastUsedIp: string;
  createdAt: Date;
  updatedAt: Date;
}

// ------------------------------------------------------------
// Task 2-a — Webhook dead-letter queue. Rows are appended by
// fireWebhook after all 3 delivery attempts fail; payload is the
// raw JSON body truncated to 4096 chars. Cap 100 (pruned by the
// dispatcher, not here).
// ------------------------------------------------------------
export interface WebhookDeadLetter {
  id: string;
  createdAt: Date;
  event: string;
  url: string;
  status: number | null;
  error: string;
  attempts: number;
  payload: string;
  /** X-Sephiroth-Sign that was used ("" when unsigned). */
  sign: string;
}

// ------------------------------------------------------------
// Task 2-d — admin-managed discount codes for the bot shop.
// code is UNIQUE + UPPERCASE (`^[A-Z0-9_-]{3,32}$`). usageLimit
// 0 = unlimited. usedBy lists the tg chatIds that already consumed
// the code (per-user single use). maxOff null = no currency cap.
// ------------------------------------------------------------
export interface DiscountCode {
  id: string;
  code: string;
  enabled: boolean;
  percentOff: number;
  maxOff: number | null;
  usageLimit: number;
  usedCount: number;
  usedBy: string[];
  expiresAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// ------------------------------------------------------------
// Task 2-e — broadcast queue. One row per admin broadcast; the
// async sender (src/lib/bot/broadcast.ts) walks the `targets`
// chatId snapshot and updates sent/failed in place. status:
// running | done | cancelled | interrupted (boot sweep).
// ------------------------------------------------------------
export interface BroadcastJob {
  id: string;
  text: string;
  /** "None" | "MarkdownV2" */
  parseMode: string;
  targets: string[];
  sent: number;
  failed: number;
  status: string;
  lastError: string;
  createdAt: Date;
  finishedAt: Date | null;
}

export namespace Prisma {
  export class PrismaClientKnownRequestError extends Error {
    code: string;
    meta?: Record<string, unknown>;
    constructor(message: string, opts: { code: string; meta?: Record<string, unknown> }) {
      super(message);
      this.name = "PrismaClientKnownRequestError";
      this.code = opts.code;
      this.meta = opts.meta;
    }
  }
  export type ActivityLogWhereInput = Record<string, any>;
}

type TableName =
  | "adminUser"
  | "serverSetting"
  | "inbound"
  | "clientUser"
  | "userInboundAccess"
  | "subGroup"
  | "subGroupMember"
  | "reseller"
  | "saleTemplate"
  | "host"
  | "node"
  | "outbound"
  | "routingRule"
  | "activityLog"
  | "relayTunnel"
  | "tgUser"
  | "tgOrder"
  | "apiToken"
  | "webhookDead"
  | "discountCode"
  | "broadcastJob";

type StoreData = Record<TableName, Record<string, any>[]>;

const STORE_FILE = resolve(process.cwd(), "db", "sephiroth-store.json");

function emptyStore(): StoreData {
  return {
    adminUser: [],
    serverSetting: [],
    inbound: [],
    clientUser: [],
    userInboundAccess: [],
    subGroup: [],
    subGroupMember: [],
    reseller: [],
    saleTemplate: [],
    host: [],
    node: [],
    outbound: [],
    routingRule: [],
    activityLog: [],
    relayTunnel: [],
    tgUser: [],
    tgOrder: [],
    apiToken: [],
    webhookDead: [],
    discountCode: [],
    broadcastJob: [],
  };
}

function reviveDates(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(reviveDates);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (
      (k === "createdAt" || k === "updatedAt" || k === "lastSeen" || k === "lastResetAt" ||
        k === "lastUsedAt" || k === "startedAt" || k === "expiryWarnedAt" || k === "expiresAt" ||
        k === "finishedAt") &&
      typeof v === "string"
    ) {
      const d = new Date(v);
      out[k] = Number.isNaN(d.getTime()) ? v : d;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function parseStoreFile(file: string): StoreData | null {
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const base = emptyStore();
    for (const k of Object.keys(base) as TableName[]) {
      if (Array.isArray(raw[k])) {
        base[k] = raw[k].map(reviveDates);
      }
    }
    return base;
  } catch {
    return null;
  }
}

function loadStore(): StoreData {
  const main = parseStoreFile(STORE_FILE);
  if (main) return main;
  // main file missing or corrupt → try the one-generation backup
  const bak = parseStoreFile(STORE_FILE + ".bak");
  if (bak) {
    console.error("[db] main store unreadable — recovered from", STORE_FILE + ".bak");
    return bak;
  }
  if (existsSync(STORE_FILE)) {
    console.error("[db] failed to load store file, starting fresh:", STORE_FILE);
  }
  return emptyStore();
}

const state: StoreData = loadStore();

/* 26-a — backfill client users created before the on-hold/auto-renew wave
   so every row always carries the full scalar set (defensive; the JSON
   store tolerates missing keys but typed reads should not see undefined). */
for (const u of state.clientUser as Array<Record<string, unknown>>) {
  if (typeof u.onHold !== "boolean") u.onHold = false;
  if (u.startedAt === undefined) u.startedAt = null;
  if (typeof u.autoRenew !== "boolean") u.autoRenew = false;
  if (typeof u.renewals !== "number") u.renewals = 0;
  if (u.expiryWarnedAt === undefined) u.expiryWarnedAt = null;
}

/* task 3-1 — reseller-bot scoping backfills: pre-3-1 tgUser/tgOrder rows are
   the owner's main-bot customers/orders (""), templates are global (""), and
   every reseller row gets its bot + gateway scalar set. Defensive — the JSON
   store tolerates missing keys but typed reads should not see undefined. */
for (const r of state.reseller as Array<Record<string, unknown>>) {
  if (typeof r.botToken !== "string") r.botToken = "";
  if (typeof r.botEnabled !== "boolean") r.botEnabled = false;
  if (typeof r.botUsername !== "string") r.botUsername = "";
  if (typeof r.payCardNumber !== "string") r.payCardNumber = "";
  if (typeof r.payCardHolder !== "string") r.payCardHolder = "";
  if (typeof r.payZarinpalMerchant !== "string") r.payZarinpalMerchant = "";
}
for (const t of state.saleTemplate as Array<Record<string, unknown>>) {
  if (typeof t.resellerId !== "string") t.resellerId = "";
}
for (const u of state.tgUser as Array<Record<string, unknown>>) {
  if (typeof u.resellerId !== "string") u.resellerId = "";
}
for (const o of state.tgOrder as Array<Record<string, unknown>>) {
  if (typeof o.resellerId !== "string") o.resellerId = "";
}

/* task 3-b — backfill admin users created before fine-grained RBAC so every
   row carries the full scalar set: single-admin deployments become "owner"
   automatically (no migration), enabled defaults on, lastLogin starts null. */
for (const a of state.adminUser as Array<Record<string, unknown>>) {
  if (a.role !== "owner" && a.role !== "admin" && a.role !== "viewer") a.role = "owner";
  if (typeof a.enabled !== "boolean") a.enabled = true;
  if (a.lastLoginAt === undefined) a.lastLoginAt = null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistStore(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(STORE_FILE), { recursive: true });
      // atomic-ish write: stage into a tmp sibling, keep a one-generation
      // .bak of the previous live file, then rename onto the live path so a
      // crash mid-write can never truncate the store.
      const tmpFile = STORE_FILE + ".tmp";
      const bakFile = STORE_FILE + ".bak";
      if (existsSync(STORE_FILE)) {
        try {
          copyFileSync(STORE_FILE, bakFile);
        } catch (bakErr) {
          console.error("[db] failed to stage .bak (continuing):", bakErr);
        }
      }
      writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf8");
      renameSync(tmpFile, STORE_FILE);
    } catch (err) {
      console.error("[db] failed to persist store:", err);
    }
  }, 50);
}

const UNIQUE_FIELDS: Partial<Record<TableName, string[]>> = {
  adminUser: ["username", "recoveryKey"],
  serverSetting: ["key"],
  inbound: ["tag", "port"],
  clientUser: ["username", "subId"],
  subGroup: ["token"],
  reseller: ["username"],
  outbound: ["tag"],
  tgUser: ["tgId"],
  apiToken: ["tokenHash"],
  discountCode: ["code"],
};

function checkUniqueness(table: TableName, candidate: Record<string, any>, ignoreId?: string): void {
  const fields = UNIQUE_FIELDS[table];
  if (!fields) return;
  for (const f of fields) {
    if (candidate[f] === undefined || candidate[f] === null) continue;
    const conflict = state[table].find((r) => {
      if (ignoreId && (r.id === ignoreId || r.key === ignoreId)) return false;
      return r[f] === candidate[f];
    });
    if (conflict) {
      throw new Prisma.PrismaClientKnownRequestError(
        `Unique constraint failed on the fields: (\`${f}\`)`,
        { code: "P2002", meta: { target: [f] } }
      );
    }
  }
}

const DEFAULTS: Record<TableName, () => Record<string, any>> = {
  adminUser: () => ({
    id: cuid(),
    displayName: null,
    role: "owner", // task 3-b — first/legacy admins are owners (backward compatible)
    enabled: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  serverSetting: () => ({}),
  inbound: () => ({
    id: cuid(),
    listen: "",
    transport: "tcp",
    security: "none",
    status: "online",
    note: null,
    trafficLimitGb: null,
    expiryDays: null,
    clientsJson: "[]",
    sniffingJson: "{}",
    streamJson: "{}",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  clientUser: () => ({
    id: cuid(),
    note: null,
    enabled: true,
    trafficLimitGb: null,
    expiryDays: null,
    ipLimit: 0,
    usedTrafficGb: 0,
    resetPeriod: null,
    lastResetAt: null,
    resellerId: null,
    tgId: null,
    hwidLimit: null,
    devices: "[]",
    onHold: false,
    startedAt: null,
    autoRenew: false,
    renewals: 0,
    expiryWarnedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  userInboundAccess: () => ({
    id: cuid(),
    flow: "",
    wgPrivateKey: "",
    wgPublicKey: "",
  }),
  subGroup: () => ({
    id: cuid(),
    passwordHash: null,
    infoLine: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  subGroupMember: () => ({
    id: cuid(),
  }),
  reseller: () => ({
    id: cuid(),
    note: null,
    enabled: true,
    maxUsers: null,
    trafficQuotaGb: null,
    brandName: null,
    brandLogo: null,
    brandAccent: null,
    // task 3-1 — per-reseller bot + own payment gateway ("" = unset)
    botToken: "",
    botEnabled: false,
    botUsername: "",
    payCardNumber: "",
    payCardHolder: "",
    payZarinpalMerchant: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  saleTemplate: () => ({
    id: cuid(),
    trafficLimitGb: null,
    expiryDays: null,
    ipLimit: 0,
    enabled: true,
    priceToman: 0,
    botVisible: false,
    resellerId: "", // task 3-1 — "" = owner's global catalog
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  host: () => ({
    id: cuid(),
    port: 0,
    security: "same",
    sni: "",
    hostHeader: "",
    path: "",
    alpn: "",
    fingerprint: "",
    enable: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  node: () => ({
    id: cuid(),
    scheme: "https",
    port: 443,
    basePath: "/",
    apiToken: "",
    enable: true,
    syncAll: true,
    inboundTags: "[]",
    outboundTag: "",
    tlsVerify: "verify",
    status: "unknown",
    latencyMs: 0,
    xrayVersion: "",
    coreKind: "",
    lastSeen: null,
    lastSyncAt: null,
    lastError: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  outbound: () => ({
    id: cuid(),
    sendThrough: "",
    domainStrategy: "AsIs",
    settingsJson: "{}",
    streamJson: "{}",
    muxEnabled: false,
    muxConcurrency: 8,
    sortOrder: 0,
    upBytes: 0,
    downBytes: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  routingRule: () => ({
    id: cuid(),
    enabled: true,
    comment: "",
    outboundTag: "direct",
    domainJson: "[]",
    ipJson: "[]",
    port: "",
    network: "",
    protocolJson: "[]",
    inboundTagJson: "[]",
    sourceJson: "[]",
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  activityLog: () => ({
    id: cuid(),
    level: "info",
    actor: "",
    metaJson: "{}",
    createdAt: new Date(),
  }),
  tgUser: () => ({
    id: cuid(),
    tgUsername: "",
    lang: "en",
    banned: false,
    resellerId: "", // task 3-1 — "" = owner's main bot (reseller bots set their own id on first /start)
    // 2-e — anti-abuse defaults (bannedAt stays ABSENT until a ban happens)
    banReason: "",
    // 2-d — referral defaults (refCode stays ABSENT until lazily generated)
    refBy: "",
    refRewarded: false,
    refEarnedToman: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  tgOrder: () => ({
    id: cuid(),
    tgUsername: "",
    amountToman: 0,
    authority: "",
    receiptFileId: "",
    provisionedUserId: null,
    resellerId: "", // task 3-1 — "" = created by the owner's main bot
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  apiToken: () => ({
    id: cuid(),
    enabled: true,
    lastUsedAt: null,
    lastUsedIp: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  webhookDead: () => ({
    id: cuid(),
    event: "",
    url: "",
    status: null,
    error: "",
    attempts: 0,
    payload: "",
    sign: "",
    createdAt: new Date(),
  }),
  discountCode: () => ({
    id: cuid(),
    enabled: true,
    percentOff: 1,
    maxOff: null,
    usageLimit: 0,
    usedCount: 0,
    usedBy: [],
    expiresAt: null,
    createdBy: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  // 2-e — broadcast queue row (status starts running; the sender finalizes)
  broadcastJob: () => ({
    id: cuid(),
    text: "",
    parseMode: "None",
    targets: [],
    sent: 0,
    failed: 0,
    status: "running",
    lastError: "",
    finishedAt: null,
    createdAt: new Date(),
  }),
  relayTunnel: () => ({
    id: cuid(),
    mode: "tcp-relay",
    entryNode: "IR-Tehran-Gateway",
    entryAddress: "203.0.113.10",
    entryPort: 2083,
    exitNode: "DE-Frankfurt-Core",
    exitAddress: "de1.sephiroth.edge",
    exitPort: 443,
    inboundTag: "vless-reality",
    lbStrategy: "least-ping",
    enabled: true,
    latencyMs: 36,
    upBytes: 148000000,
    downBytes: 942000000,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
};

function matchesWhere(row: Record<string, any>, where?: Record<string, any>): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (k === "AND" && Array.isArray(cond)) {
      if (!cond.every((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (k === "OR" && Array.isArray(cond)) {
      if (!cond.some((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (k === "userId_inboundId" && cond && typeof cond === "object") {
      if (row.userId !== cond.userId || row.inboundId !== cond.inboundId) return false;
      continue;
    }
    if (k === "inboundId_email" && cond && typeof cond === "object") {
      if (row.inboundId !== cond.inboundId || row.email !== cond.email) return false;
      continue;
    }
    if (k === "groupId_userId" && cond && typeof cond === "object") {
      if (row.groupId !== cond.groupId || row.userId !== cond.userId) return false;
      continue;
    }

    const val = row[k];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond && Array.isArray(cond.in)) {
        if (!cond.in.includes(val)) return false;
      }
      if ("notIn" in cond && Array.isArray(cond.notIn)) {
        if (cond.notIn.includes(val)) return false;
      }
      if ("not" in cond) {
        if (val === cond.not) return false;
      }
      if ("startsWith" in cond && typeof cond.startsWith === "string") {
        if (typeof val !== "string" || !val.startsWith(cond.startsWith)) return false;
      }
      if ("contains" in cond && typeof cond.contains === "string") {
        if (typeof val !== "string" || !val.toLowerCase().includes(cond.contains.toLowerCase()))
          return false;
      }
      const vTime = val instanceof Date ? val.getTime() : val;
      if ("lt" in cond) {
        const cTime = cond.lt instanceof Date ? cond.lt.getTime() : cond.lt;
        if (!(vTime < cTime)) return false;
      }
      if ("lte" in cond) {
        const cTime = cond.lte instanceof Date ? cond.lte.getTime() : cond.lte;
        if (!(vTime <= cTime)) return false;
      }
      if ("gt" in cond) {
        const cTime = cond.gt instanceof Date ? cond.gt.getTime() : cond.gt;
        if (!(vTime > cTime)) return false;
      }
      if ("gte" in cond) {
        const cTime = cond.gte instanceof Date ? cond.gte.getTime() : cond.gte;
        if (!(vTime >= cTime)) return false;
      }
    } else {
      if (val !== cond) return false;
    }
  }
  return true;
}

function sortRows(rows: Record<string, any>[], orderBy?: any): Record<string, any>[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [field, dir] = Object.entries(spec)[0] as [string, "asc" | "desc"];
      const va = a[field] instanceof Date ? a[field].getTime() : a[field];
      const vb = b[field] instanceof Date ? b[field].getTime() : b[field];
      if (va === vb) continue;
      if (va == null) return dir === "asc" ? -1 : 1;
      if (vb == null) return dir === "asc" ? 1 : -1;
      const cmp = va < vb ? -1 : 1;
      return dir === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

function hydrateRow(
  table: TableName,
  row: Record<string, any>,
  opts?: { include?: Record<string, any>; select?: Record<string, any> }
): any {
  if (!row) return null;
  const clone: Record<string, any> = { ...row };
  const inc = opts?.include || opts?.select;

  if (inc) {
    if (table === "inbound") {
      if (inc.accesses) {
        const acc = state.userInboundAccess.filter((a) => a.inboundId === row.id);
        clone.accesses = acc.map((a) =>
          typeof inc.accesses === "object" ? hydrateRow("userInboundAccess", a, inc.accesses) : { ...a }
        );
      }
      if (inc.hosts) {
        const h = state.host.filter((x) => x.inboundId === row.id);
        clone.hosts = h.map((x) => ({ ...x }));
      }
    }
    if (table === "clientUser") {
      if (inc.accesses) {
        const acc = state.userInboundAccess.filter((a) => a.userId === row.id);
        clone.accesses = acc.map((a) =>
          typeof inc.accesses === "object" ? hydrateRow("userInboundAccess", a, inc.accesses) : { ...a }
        );
      }
      if (inc.groupMembers) {
        const gm = state.subGroupMember.filter((m) => m.userId === row.id);
        clone.groupMembers = gm.map((m) =>
          typeof inc.groupMembers === "object" ? hydrateRow("subGroupMember", m, inc.groupMembers) : { ...m }
        );
      }
      if (inc.reseller) {
        const r = row.resellerId ? state.reseller.find((x) => x.id === row.resellerId) || null : null;
        clone.reseller = r
          ? typeof inc.reseller === "object"
            ? hydrateRow("reseller", r, inc.reseller)
            : { ...r }
          : null;
      }
    }
    if (table === "userInboundAccess") {
      if (inc.inbound) {
        const inb = state.inbound.find((i) => i.id === row.inboundId) || null;
        clone.inbound = inb
          ? typeof inc.inbound === "object"
            ? hydrateRow("inbound", inb, inc.inbound)
            : { ...inb }
          : null;
      }
      if (inc.user) {
        const u = state.clientUser.find((x) => x.id === row.userId) || null;
        clone.user = u
          ? typeof inc.user === "object"
            ? hydrateRow("clientUser", u, inc.user)
            : { ...u }
          : null;
      }
    }
    if (table === "subGroup") {
      if (inc.members) {
        const mems = state.subGroupMember.filter((m) => m.groupId === row.id);
        clone.members = mems.map((m) =>
          typeof inc.members === "object" ? hydrateRow("subGroupMember", m, inc.members) : { ...m }
        );
      }
    }
    if (table === "subGroupMember") {
      if (inc.user) {
        const u = state.clientUser.find((x) => x.id === row.userId) || null;
        clone.user = u
          ? typeof inc.user === "object"
            ? hydrateRow("clientUser", u, inc.user)
            : { ...u }
          : null;
      }
      if (inc.group) {
        const g = state.subGroup.find((x) => x.id === row.groupId) || null;
        clone.group = g
          ? typeof inc.group === "object"
            ? hydrateRow("subGroup", g, inc.group)
            : { ...g }
          : null;
      }
    }
    if (table === "reseller") {
      if (inc.users) {
        const us = state.clientUser.filter((u) => u.resellerId === row.id);
        clone.users = us.map((u) =>
          typeof inc.users === "object" ? hydrateRow("clientUser", u, inc.users) : { ...u }
        );
      }
    }
    if (table === "host") {
      if (inc.inbound) {
        const inb = state.inbound.find((i) => i.id === row.inboundId) || null;
        clone.inbound = inb
          ? typeof inc.inbound === "object"
            ? hydrateRow("inbound", inb, inc.inbound)
            : { ...inb }
          : null;
      }
    }
  }

  if (opts?.select) {
    const picked: Record<string, any> = {};
    for (const [k, v] of Object.entries(opts.select)) {
      if (v) picked[k] = clone[k];
    }
    return picked;
  }

  return clone;
}

function handleCascadeDelete(table: TableName, deletedRow: Record<string, any>): void {
  if (table === "inbound") {
    state.userInboundAccess = state.userInboundAccess.filter((a) => a.inboundId !== deletedRow.id);
    state.host = state.host.filter((h) => h.inboundId !== deletedRow.id);
  } else if (table === "clientUser") {
    state.userInboundAccess = state.userInboundAccess.filter((a) => a.userId !== deletedRow.id);
    state.subGroupMember = state.subGroupMember.filter((m) => m.userId !== deletedRow.id);
  } else if (table === "subGroup") {
    state.subGroupMember = state.subGroupMember.filter((m) => m.groupId !== deletedRow.id);
  } else if (table === "reseller") {
    for (const u of state.clientUser) {
      if (u.resellerId === deletedRow.id) {
        u.resellerId = null;
      }
    }
  }
}

function makeDelegate(table: TableName) {
  return {
    async findUnique(args?: { where: Record<string, any>; include?: any; select?: any }) {
      if (!args?.where) return null;
      const row = state[table].find((r) => matchesWhere(r, args.where)) || null;
      return row ? hydrateRow(table, row, args) : null;
    },
    async findFirst(args?: { where?: Record<string, any>; orderBy?: any; include?: any; select?: any }) {
      let rows = state[table].filter((r) => matchesWhere(r, args?.where));
      if (args?.orderBy) rows = sortRows(rows, args.orderBy);
      const row = rows[0] || null;
      return row ? hydrateRow(table, row, args) : null;
    },
    async findMany(args?: {
      where?: Record<string, any>;
      orderBy?: any;
      take?: number;
      skip?: number;
      include?: any;
      select?: any;
    }) {
      let rows = state[table].filter((r) => matchesWhere(r, args?.where));
      if (args?.orderBy) rows = sortRows(rows, args.orderBy);
      if (typeof args?.skip === "number") rows = rows.slice(args.skip);
      if (typeof args?.take === "number") rows = rows.slice(0, args.take);
      return rows.map((r) => hydrateRow(table, r, args));
    },
    async count(args?: { where?: Record<string, any> }) {
      return state[table].filter((r) => matchesWhere(r, args?.where)).length;
    },
    async create(args: { data: Record<string, any>; include?: any; select?: any }) {
      const base = DEFAULTS[table]();
      const { accesses, members, ...scalarData } = args.data;
      const row: Record<string, any> = {
        ...base,
        ...scalarData,
      };
      if ("updatedAt" in base && !scalarData.updatedAt) {
        row.updatedAt = new Date();
      }
      checkUniqueness(table, row);
      state[table].push(row);

      if (table === "clientUser" && accesses?.create) {
        const list = Array.isArray(accesses.create) ? accesses.create : [accesses.create];
        for (const item of list) {
          state.userInboundAccess.push({
            ...DEFAULTS.userInboundAccess(),
            ...item,
            userId: row.id,
          });
        }
      }
      if (table === "subGroup" && members?.create) {
        for (const item of Array.isArray(members.create) ? members.create : [members.create]) {
          state.subGroupMember.push({
            ...DEFAULTS.subGroupMember(),
            ...item,
            groupId: row.id,
          });
        }
      }

      persistStore();
      return hydrateRow(table, row, args);
    },
    async createMany(args: { data: Record<string, any>[] }) {
      let count = 0;
      for (const item of args.data) {
        const base = DEFAULTS[table]();
        const row = { ...base, ...item };
        state[table].push(row);
        count++;
      }
      persistStore();
      return { count };
    },
    async update(args: { where: Record<string, any>; data: Record<string, any>; include?: any; select?: any }) {
      const idx = state[table].findIndex((r) => matchesWhere(r, args.where));
      if (idx === -1) {
        // Prisma-compatible P2025 so routes mapping prismaErrorCode() → 404 work
        throw new Prisma.PrismaClientKnownRequestError(
          `[db.${table}.update] Record not found for ${JSON.stringify(args.where)}`,
          { code: "P2025", meta: { cause: "Record to update not found" } }
        );
      }
      const existing = state[table][idx];
      const updated: Record<string, any> = { ...existing };
      for (const [k, v] of Object.entries(args.data)) {
        if (v !== undefined) updated[k] = v;
      }
      if ("updatedAt" in existing) {
        updated.updatedAt = new Date();
      }
      checkUniqueness(table, updated, existing.id || existing.key);
      state[table][idx] = updated;
      persistStore();
      return hydrateRow(table, updated, args);
    },
    async updateMany(args: { where?: Record<string, any>; data: Record<string, any> }) {
      let count = 0;
      for (let i = 0; i < state[table].length; i++) {
        if (matchesWhere(state[table][i], args.where)) {
          const updated = { ...state[table][i] };
          for (const [k, v] of Object.entries(args.data)) {
            if (v !== undefined) updated[k] = v;
          }
          if ("updatedAt" in updated) updated.updatedAt = new Date();
          state[table][i] = updated;
          count++;
        }
      }
      if (count > 0) persistStore();
      return { count };
    },
    async upsert(args: {
      where: Record<string, any>;
      update: Record<string, any>;
      create: Record<string, any>;
      include?: any;
      select?: any;
    }) {
      const idx = state[table].findIndex((r) => matchesWhere(r, args.where));
      if (idx !== -1) {
        const existing = state[table][idx];
        const updated: Record<string, any> = { ...existing };
        for (const [k, v] of Object.entries(args.update)) {
          if (v !== undefined) updated[k] = v;
        }
        if ("updatedAt" in existing) updated.updatedAt = new Date();
        state[table][idx] = updated;
        persistStore();
        return hydrateRow(table, updated, args);
      } else {
        const base = DEFAULTS[table]();
        const created: Record<string, any> = { ...base, ...args.create };
        state[table].push(created);
        persistStore();
        return hydrateRow(table, created, args);
      }
    },
    async delete(args: { where: Record<string, any> }) {
      const idx = state[table].findIndex((r) => matchesWhere(r, args.where));
      if (idx === -1) {
        // Prisma-compatible P2025 so routes mapping prismaErrorCode() → 404 work
        throw new Prisma.PrismaClientKnownRequestError(
          `[db.${table}.delete] Record not found for ${JSON.stringify(args.where)}`,
          { code: "P2025", meta: { cause: "Record to delete does not exist" } }
        );
      }
      const [removed] = state[table].splice(idx, 1);
      handleCascadeDelete(table, removed);
      persistStore();
      return removed;
    },
    async deleteMany(args?: { where?: Record<string, any> }) {
      const keep: Record<string, any>[] = [];
      let count = 0;
      for (const r of state[table]) {
        if (matchesWhere(r, args?.where)) {
          handleCascadeDelete(table, r);
          count++;
        } else {
          keep.push(r);
        }
      }
      state[table] = keep;
      if (count > 0) persistStore();
      return { count };
    },
  };
}

const baseDb = {
  adminUser: makeDelegate("adminUser"),
  serverSetting: makeDelegate("serverSetting"),
  inbound: makeDelegate("inbound"),
  clientUser: makeDelegate("clientUser"),
  userInboundAccess: makeDelegate("userInboundAccess"),
  subGroup: makeDelegate("subGroup"),
  subGroupMember: makeDelegate("subGroupMember"),
  reseller: makeDelegate("reseller"),
  saleTemplate: makeDelegate("saleTemplate"),
  host: makeDelegate("host"),
  node: makeDelegate("node"),
  outbound: makeDelegate("outbound"),
  routingRule: makeDelegate("routingRule"),
  activityLog: makeDelegate("activityLog"),
  relayTunnel: makeDelegate("relayTunnel"),
  tgUser: makeDelegate("tgUser"),
  tgOrder: makeDelegate("tgOrder"),
  apiToken: makeDelegate("apiToken"),
  webhookDead: makeDelegate("webhookDead"),
  discountCode: makeDelegate("discountCode"),
  broadcastJob: makeDelegate("broadcastJob"),
};

export type DbTransactionClient = typeof baseDb;

export const db = {
  ...baseDb,
  async $transaction<T>(
    arg: ((tx: DbTransactionClient) => Promise<T>) | Promise<any>[],
    _options?: Record<string, any>
  ): Promise<any> {
    if (typeof arg === "function") {
      const res = await arg(baseDb);
      persistStore();
      return res;
    }
    if (Array.isArray(arg)) {
      const res = await Promise.all(arg);
      persistStore();
      return res;
    }
    return null;
  },
  _syncReadInbounds() {
    return sortRows(state.inbound, [{ createdAt: "asc" }, { tag: "asc" }]).map((r) => ({
      tag: String(r.tag),
      protocol: String(r.protocol),
      port: Number(r.port),
      transport: String(r.transport || "tcp"),
      security: String(r.security || "none"),
      status: String(r.status || "online"),
    }));
  },
  /** Full inbound rows (incl. JSON blob columns) for the Xray config builder. */
  _syncReadInboundsFull() {
    return sortRows(state.inbound, [{ createdAt: "asc" }, { tag: "asc" }]).map((r) => ({
      id: String(r.id),
      tag: String(r.tag),
      protocol: String(r.protocol),
      port: Number(r.port),
      listen: String(r.listen || ""),
      transport: String(r.transport || "tcp"),
      security: String(r.security || "none"),
      status: String(r.status || "online"),
      clientsJson: String(r.clientsJson || "[]"),
      sniffingJson: String(r.sniffingJson || "{}"),
      streamJson: String(r.streamJson || "{}"),
    }));
  },
  /** Outbound rows for the Xray config builder (sortOrder → createdAt order). */
  _syncReadOutbounds() {
    return sortRows(state.outbound, [{ sortOrder: "asc" }, { createdAt: "asc" }]).map((r) => ({
      tag: String(r.tag),
      protocol: String(r.protocol),
      sendThrough: String(r.sendThrough || ""),
      domainStrategy: String(r.domainStrategy || "AsIs"),
      settingsJson: String(r.settingsJson || "{}"),
      streamJson: String(r.streamJson || "{}"),
      muxEnabled: Boolean(r.muxEnabled),
      muxConcurrency: Number(r.muxConcurrency) || 8,
      sortOrder: Number(r.sortOrder) || 0,
    }));
  },
  /** Routing-rule rows for the Xray config builder. */
  _syncReadRoutingRules() {
    return sortRows(state.routingRule, [{ sortOrder: "asc" }, { createdAt: "asc" }]).map((r) => ({
      enabled: Boolean(r.enabled),
      outboundTag: String(r.outboundTag || ""),
      domainJson: String(r.domainJson || "[]"),
      ipJson: String(r.ipJson || "[]"),
      port: String(r.port || ""),
      network: String(r.network || ""),
      protocolJson: String(r.protocolJson || "[]"),
      inboundTagJson: String(r.inboundTagJson || "[]"),
      sourceJson: String(r.sourceJson || "[]"),
      sortOrder: Number(r.sortOrder) || 0,
    }));
  },
  /** email → {userId} map for the Xray driver's per-user traffic writer. */
  _syncReadAccessEmails() {
    return (state.userInboundAccess ?? []).map((a) => ({
      email: String(a.email || ""),
      userId: String(a.userId || ""),
      inboundId: String(a.inboundId || ""),
    }));
  },
  /** Task 23-g — minimal ClientUser rows for the driver's IP-limit enforcement. */
  _syncReadClientUsers() {
    return (state.clientUser ?? []).map((u) => ({
      id: String(u.id || ""),
      username: String(u.username || ""),
      enabled: u.enabled === true,
      ipLimit: Number(u.ipLimit) || 0,
      // Task 23-b — full limit set so core-side auto-disable can re-sync the
      // clientsJson projection (embedded entries flip to enabled:false) without
      // a second async read in the enforcement hot path.
      trafficLimitGb: u.trafficLimitGb === null || u.trafficLimitGb === undefined ? null : Number(u.trafficLimitGb),
      expiryDays: u.expiryDays === null || u.expiryDays === undefined ? null : Number(u.expiryDays),
      resellerId: u.resellerId ? String(u.resellerId) : null,
    }));
  },
  _syncReadSetting(key: string): string | undefined {
    const row = state.serverSetting.find((s) => s.key === key);
    return row?.value;
  },
  /** Real aggregate stats for the dashboard telemetry engine (no synthetic data). */
  _syncReadCoreStats() {
    const users = state.clientUser ?? [];
    const accesses = state.userInboundAccess ?? [];
    const inboundById = new Map(
      (state.inbound ?? []).map((i) => [String(i.id), i]),
    );
    const used = (u: Record<string, unknown>) =>
      Number(u.usedTrafficGb) || 0;
    const topUsers = [...users]
      .sort((a, b) => used(b) - used(a))
      .slice(0, 5)
      .map((u) => {
        const acc = accesses.find(
          (a) => String(a.userId) === String(u.id),
        );
        const inb = acc ? inboundById.get(String(acc.inboundId)) : undefined;
        // 26-a — expiry anchor: startedAt when set, else createdAt… UNLESS the
        // on-hold clock has not started yet (null anchor → no known end date)
        const anchorMs =
          u.startedAt !== null && u.startedAt !== undefined
            ? Date.parse(String(u.startedAt))
            : u.onHold === true
              ? null
              : Date.parse(String(u.createdAt));
        return {
          uid: String(u.id).slice(-6).toUpperCase(),
          user: String(u.username),
          protoBase: inb
            ? {
                protocol: String(inb.protocol),
                transport: String(inb.transport || "tcp"),
                security: String(inb.security || "none"),
              }
            : null,
          gb: Math.round(used(u) * 100) / 100,
          expiresAtMs:
            (Number(u.expiryDays) || 0) > 0 && anchorMs !== null
              ? anchorMs + (Number(u.expiryDays) || 0) * 86_400_000
              : null,
          usagePct:
            (Number(u.trafficLimitGb) || 0) > 0
              ? Math.min(
                  100,
                  Math.round((used(u) / Number(u.trafficLimitGb)) * 10_000) /
                    100,
                )
              : null,
        };
      });
    return {
      usersTotal: users.length,
      groupsTotal: (state.subGroup ?? []).length,
      /** users at ≥90% of their quota (drives the dashboard distribution donut) */
      limitedCount: users.filter((u) => {
        const limit = Number(u.trafficLimitGb) || 0;
        return limit > 0 && (Number(u.usedTrafficGb) || 0) / limit >= 0.9;
      }).length,
      monthTxGb:
        Math.round(users.reduce((acc, u) => acc + used(u), 0) * 10_000) /
        10_000,
      topUsers,
    };
  },
};