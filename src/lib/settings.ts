import { randomBytes } from "crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/lib/db";
import { verifyTotp } from "@/lib/totp";

/* ============================================================
   Sephiroth · Phase 7 — Settings & System (server-only)
   Panel settings live in the ServerSetting table under a
   "set_" key prefix (session_secret & seed flags stay out of
   the namespace). Telegram bot tokens never leave the server
   unmasked; backups carry full state but skip the session
   secret.
   ============================================================ */

export type CoreDriver = "simulator" | "xray";

export interface CoreSettings {
  driver: CoreDriver;
  apiHost: string;
  apiPort: number;
  tickSeconds: number; // live feed interval, 1-5s
  /** absolute path to a user-provided xray binary ("" = resolve PATH → auto-install) */
  xrayBin: string;
  /** Xray release pin, e.g. "v25.9.11" ("" = latest) */
  xrayVersion: string;
  /** stats poll interval for the real core, 5-120s */
  statsInterval: number;
  /** Hysteria2 sidecar release pin, e.g. "2.13.0" ("" = latest) — v2.5 */
  hysteriaVersion: string;
  /** absolute path to a user-provided hysteria binary ("" = PATH → auto-install) */
  hysteriaBin: string;
  /** Task 23-c — serve hysteria2+tuic via the secondary sing-box core when the real driver runs (default ON) */
  singboxEnabled: boolean;
  /** Task 23-g — auto-disable users that exceed their concurrent-IP limit (default OFF) */
  enforceIpLimit: boolean;
}

export interface TelegramNotify {
  userCreated: boolean;
  userExpired: boolean;
  trafficAlert: boolean;
  loginAlert: boolean;
  /** 26-a — daily 24h sales/orders digest to admin chats. */
  dailyDigest: boolean;
}

/** Languages the bot can speak (bot-facing texts live in lib/bot/texts.ts). */
export const BOT_LANGS = ["fa", "en", "ar", "zh", "tr", "ru"] as const;
export type BotLangCode = (typeof BOT_LANGS)[number];

export interface TelegramSettings {
  enabled: boolean;
  chatId: string;
  tokenConfigured: boolean;
  tokenMasked: string;
  notify: TelegramNotify;
  /** "console" (test executor, no worker) | "notify" (worker: alerts + admin commands) | "sales" (worker: everything + shop). */
  botMode: "console" | "notify" | "sales";
  /** Telegram chat ids allowed to drive the bot admin flows (owner first). */
  adminChatIds: string[];
  /** Bot API base (default https://api.telegram.org; can point at a mock for testing). */
  botApiBase: string;
  /** Optional HTTPS proxy for api.telegram.org ("" = direct). SOCKS5 not supported in Phase 1. */
  botProxyUrl: string;
  /** Default bot language for new users — one of BOT_LANGS (default "fa"). */
  botLang: BotLangCode;
  /** When set, the shop shows ONLY this sale template ("" = every active template). */
  salesTemplateId: string;
  /** Which payment method the buy flow leads with ("manual" | "zarinpal"). */
  salesPayMode: "manual" | "zarinpal";
  /** Task 18-3 — users may run self-service queries (quota, QR, sub links) themselves. */
  selfService: boolean;
  /** Task 18-3 — forward card-to-card receipts to the admin chat for approval. */
  receiptApprove: boolean;
  /** Task 18-3 — 60s core/sub self-healing guardian stays active. */
  guardianHeal: boolean;
  /** Task 18-3 — automated telegram backup cadence in hours (1 | 6 | 12 | 24). */
  backupIntervalHours: number;
  /** Legacy fa/en default (pre-23-a) — kept only as the botLang fallback. */
  shopLang: "fa" | "en";
}

const CORE_DEFAULT: CoreSettings = {
  driver: "simulator",
  apiHost: "127.0.0.1",
  apiPort: 10085,
  tickSeconds: 1,
  xrayBin: "",
  xrayVersion: "",
  statsInterval: 10,
  hysteriaVersion: "",
  hysteriaBin: "",
  singboxEnabled: true,
  // Task 23-b — concurrent-IP enforcement is ON by default (per-user ipLimit > 0
  // is the admin's per-user opt-in); the global toggle is a kill switch.
  enforceIpLimit: true,
};

const NOTIFY_DEFAULT: TelegramNotify = {
  userCreated: true,
  userExpired: true,
  trafficAlert: true,
  loginAlert: false,
  dailyDigest: false,
};

const K = {
  coreDriver: "set_core_driver",
  coreHost: "set_core_api_host",
  corePort: "set_core_api_port",
  coreTick: "set_core_tick_seconds",
  coreXrayBin: "set_core_xray_bin",
  coreXrayVersion: "set_core_xray_version",
  coreStatsInterval: "set_core_stats_interval",
  // hysteria2 sidecar engines (v2.5)
  sidecarHysteriaVersion: "set_sidecar_hysteria_version",
  sidecarHysteriaBin: "set_sidecar_hysteria_bin",
  // amneziawg sidecar engine (Phase 27) — admin-pinned awg-quick path
  sidecarAwgBin: "set_sidecar_awg_bin",
  // secondary sing-box core (Task 23-c, default ON)
  coreSingboxEnabled: "set_core_singbox_enabled",
  // concurrent-IP limit enforcement (Task 23-g, default OFF)
  coreEnforceIpLimit: "set_enforce_ip_limit",
  tgEnabled: "set_tg_enabled",
  tgToken: "set_tg_token",
  tgChatId: "set_tg_chat_id",
  tgNotify: "set_tg_notify",
  // sales bot (23-c, extended by 23-a)
  tgBotMode: "set_tg_bot_mode",
  tgAdminChatIds: "set_tg_admin_chat_ids",
  tgProxyUrl: "set_tg_proxy_url",
  tgShopLang: "set_tg_shop_lang",
  tgApiBase: "set_tg_api_base",
  tgBotLang: "set_tg_bot_lang",
  tgSalesTemplateId: "set_tg_sales_template_id",
  tgSalesPayMode: "set_tg_sales_pay_mode",
  // Task 18-3 — bot automation toggles + telegram backup cadence (bot panel)
  tgSelfService: "set_tg_self_service",
  tgReceiptApprove: "set_tg_receipt_approve",
  tgGuardianHeal: "set_tg_guardian_heal",
  tgBackupHours: "set_tg_backup_hours",
  /** Long-poll offset persistence (23-a) — internal bookkeeping. */
  tgOffset: "set_tg_bot_offset",
  // v2.7 — outbound webhooks (automation fan-out)
  whEnabled: "set_wh_enabled",
  whUrl: "set_wh_url",
  whSecret: "set_wh_secret",
  whEvents: "set_wh_events",
  whEventUrls: "set_wh_event_urls",
  // v2.7 — Discord bot (gateway worker, mirrors the Telegram bot)
  dcEnabled: "set_dc_enabled",
  dcToken: "set_dc_token",
  dcAdminUserIds: "set_dc_admin_user_ids",
  dcChannelId: "set_dc_channel_id",
  dcLang: "set_dc_lang",
  dcPrefix: "set_dc_prefix",
  // payment credentials + gateway toggles read by the sales bot (Task 18-3)
  payCardToCardEnabled: "set_pay_card_to_card_enabled",
  payZarinpalEnabled: "set_pay_zarinpal_enabled",
  payCryptoEnabled: "set_pay_crypto_enabled",
  payCardNumber: "set_pay_card_number",
  payCardHolder: "set_pay_card_holder",
  payZarinpalMerchant: "set_pay_zarinpal_merchant",
  payUsdtWallet: "set_pay_usdt_wallet",
  payPricePerGb: "set_pay_price_per_gb",
  // top-bar module visibility
  navHosts: "set_nav_hosts",
  navNodes: "set_nav_nodes",
  navOutbounds: "set_nav_outbounds",
  navRouting: "set_nav_routing",
  // general panel prefs
  datepicker: "set_datepicker",
  pageSize: "set_page_size",
  publicHost: "set_public_host",
  subSupportUrl: "set_sub_support_url",
  // Task 1-b — panel-level subscription brand (fallback when no reseller brand)
  subBrandName: "set_sub_brand_name",
  subBrandLogo: "set_sub_brand_logo",
  subBrandAccent: "set_sub_brand_accent",
  // expert
  xrayLogLevel: "set_xray_log_level",
  xrayDnsServers: "set_xray_dns_servers",
  xrayDomainStrategy: "set_xray_domain_strategy",
  xrayFreedomStrategy: "set_xray_freedom_strategy",
  xrayConnIdle: "set_xray_conn_idle",
  xrayBufferSize: "set_xray_buffer_size",
  xrayRawJson: "set_xray_raw_json",
  certFile: "set_web_cert_file",
  keyFile: "set_web_key_file",
  sessionMaxAge: "set_session_max_age",
  // security section (v2.2)
  secAutoBackup: "set_sec_auto_backup",
  secAutoKeep: "set_sec_auto_keep",
  secTotpEnabled: "set_sec_totp_enabled",
  secTotpSecret: "set_sec_totp_secret",
  // ssl / acme section (Task 23-f)
  sslAdminEmail: "set_ssl_admin_email",
  sslCerts: "set_ssl_certs",
  sslRenewCheck: "set_ssl_renew_check",
  // internal bookkeeping (never exposed via the settings API)
  autoBackupLast: "set_auto_backup_last",
  autoBackupLastSize: "set_auto_backup_last_size",
  // Task 2-d — referral program (own section, own keys)
  refEnabled: "set_referral_enabled",
  refReward: "set_referral_reward_amount",
  // Task 2-e — anti-abuse (own section, own keys)
  abuseForceChannel: "set_abuse_force_channel",
  abuseBanNotify: "set_abuse_ban_notify",
  // Task 3-c — update channel (stable | beta), own section
  updChannel: "set_updates_channel",
} as const;

async function readSettings(keys: string[]): Promise<Map<string, string>> {
  const rows = await db.serverSetting.findMany({
    where: { key: { in: keys } },
  });
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function writeSetting(key: string, value: string): Promise<void> {
  await db.serverSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function deleteSetting(key: string): Promise<void> {
  await db.serverSetting.deleteMany({ where: { key } });
}

/* ---------- core ---------- */

export async function getCoreSettings(): Promise<CoreSettings> {
  const m = await readSettings([
    K.coreDriver,
    K.coreHost,
    K.corePort,
    K.coreTick,
    K.coreXrayBin,
    K.coreXrayVersion,
    K.coreStatsInterval,
    K.sidecarHysteriaVersion,
    K.sidecarHysteriaBin,
    K.coreSingboxEnabled,
  ]);
  const driver = m.get(K.coreDriver);
  return {
    driver: driver === "xray" ? "xray" : CORE_DEFAULT.driver,
    apiHost: m.get(K.coreHost) ?? CORE_DEFAULT.apiHost,
    apiPort: toInt(m.get(K.corePort), CORE_DEFAULT.apiPort, 1, 65535),
    tickSeconds: toInt(m.get(K.coreTick), CORE_DEFAULT.tickSeconds, 1, 5),
    xrayBin: m.get(K.coreXrayBin) ?? CORE_DEFAULT.xrayBin,
    xrayVersion: m.get(K.coreXrayVersion) ?? CORE_DEFAULT.xrayVersion,
    statsInterval: toInt(m.get(K.coreStatsInterval), CORE_DEFAULT.statsInterval, 5, 120),
    hysteriaVersion: m.get(K.sidecarHysteriaVersion) ?? CORE_DEFAULT.hysteriaVersion,
    hysteriaBin: m.get(K.sidecarHysteriaBin) ?? CORE_DEFAULT.hysteriaBin,
    singboxEnabled: m.get(K.coreSingboxEnabled) !== "0", // default ON — "0" opts out
    enforceIpLimit: m.get(K.coreEnforceIpLimit) !== "0", // default ON — "0" opts out
  };
}

export interface FieldError {
  field: string;
  code: string;
}

export type PatchResult<T> =
  | { ok: true; data: T }
  | { ok: false; fields: FieldError[] };

const HOST_RE = /^[a-zA-Z0-9._-]{1,120}$/;

export async function validateCorePatch(body: unknown): Promise<PatchResult<CoreSettings>> {
  const b = (body ?? {}) as Record<string, unknown>;
  // merge onto the CURRENTLY SAVED values (not factory defaults) so a
  // partial PUT never wipes fields the request omitted
  const out: CoreSettings = { ...(await getCoreSettings()) };

  if (b.driver !== undefined) {
    if (b.driver !== "simulator" && b.driver !== "xray") {
      return { ok: false, fields: [{ field: "driver", code: "format" }] };
    }
    out.driver = b.driver;
  }
  if (b.apiHost !== undefined) {
    const host = String(b.apiHost).trim();
    if (!HOST_RE.test(host)) {
      return { ok: false, fields: [{ field: "apiHost", code: "format" }] };
    }
    out.apiHost = host;
  }
  if (b.apiPort !== undefined) {
    const port = Number(b.apiPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, fields: [{ field: "apiPort", code: "range" }] };
    }
    out.apiPort = port;
  }
  if (b.tickSeconds !== undefined) {
    const tick = Number(b.tickSeconds);
    if (!Number.isInteger(tick) || tick < 1 || tick > 5) {
      return { ok: false, fields: [{ field: "tickSeconds", code: "range" }] };
    }
    out.tickSeconds = tick;
  }
  if (b.xrayBin !== undefined) {
    const v = String(b.xrayBin).trim();
    if (v.length > 300 || /[\r\n]/.test(v)) {
      return { ok: false, fields: [{ field: "xrayBin", code: "format" }] };
    }
    out.xrayBin = v;
  }
  if (b.xrayVersion !== undefined) {
    const v = String(b.xrayVersion).trim().replace(/^v/i, "");
    if (v && !/^\d+\.\d+\.\d+$/.test(v)) {
      return { ok: false, fields: [{ field: "xrayVersion", code: "format" }] };
    }
    out.xrayVersion = v;
  }
  if (b.statsInterval !== undefined) {
    const n = Number(b.statsInterval);
    if (!Number.isInteger(n) || n < 5 || n > 120) {
      return { ok: false, fields: [{ field: "statsInterval", code: "range" }] };
    }
    out.statsInterval = n;
  }
  // hysteria2 sidecar (v2.5) — same pin format as the xray pin
  if (b.hysteriaVersion !== undefined) {
    const v = String(b.hysteriaVersion).trim().replace(/^v/i, "").replace(/^app\//i, "");
    if (v && !/^\d+\.\d+\.\d+$/.test(v)) {
      return { ok: false, fields: [{ field: "hysteriaVersion", code: "format" }] };
    }
    out.hysteriaVersion = v;
  }
  if (b.hysteriaBin !== undefined) {
    const v = String(b.hysteriaBin).trim();
    if (v.length > 300 || /[\r\n]/.test(v)) {
      return { ok: false, fields: [{ field: "hysteriaBin", code: "format" }] };
    }
    out.hysteriaBin = v;
  }
  // Task 23-c — secondary sing-box core (hysteria2 + tuic next to Xray)
  if (b.singboxEnabled !== undefined) {
    if (typeof b.singboxEnabled !== "boolean") {
      return { ok: false, fields: [{ field: "singboxEnabled", code: "format" }] };
    }
    out.singboxEnabled = b.singboxEnabled;
  }
  // Task 23-b — concurrent-IP auto-disable (default ON; "0" = warn only)
  if (b.enforceIpLimit !== undefined) {
    if (typeof b.enforceIpLimit !== "boolean") {
      return { ok: false, fields: [{ field: "enforceIpLimit", code: "format" }] };
    }
    out.enforceIpLimit = b.enforceIpLimit;
  }
  return { ok: true, data: out };
}

export async function saveCoreSettings(s: CoreSettings): Promise<void> {
  await Promise.all([
    writeSetting(K.coreDriver, s.driver),
    writeSetting(K.coreHost, s.apiHost),
    writeSetting(K.corePort, String(s.apiPort)),
    writeSetting(K.coreTick, String(s.tickSeconds)),
    writeSetting(K.coreXrayBin, s.xrayBin),
    writeSetting(K.coreXrayVersion, s.xrayVersion),
    writeSetting(K.coreStatsInterval, String(s.statsInterval)),
    writeSetting(K.sidecarHysteriaVersion, s.hysteriaVersion),
    writeSetting(K.sidecarHysteriaBin, s.hysteriaBin),
    writeSetting(K.coreSingboxEnabled, s.singboxEnabled ? "1" : "0"),
    writeSetting(K.coreEnforceIpLimit, s.enforceIpLimit ? "1" : "0"),
  ]);
}

/* ---------- telegram ---------- */

function maskBotToken(token: string): string {
  const colon = token.indexOf(":");
  if (colon > 0) return `${token.slice(0, Math.min(colon, 12))}:••••••••••••`;
  if (token.length <= 6) return "••••••";
  return `${token.slice(0, 4)}••••••••`;
}

export async function getTelegramSettings(): Promise<TelegramSettings> {
  const m = await readSettings([
    K.tgEnabled, K.tgToken, K.tgChatId, K.tgNotify,
    K.tgBotMode, K.tgAdminChatIds, K.tgProxyUrl, K.tgShopLang,
    K.tgApiBase, K.tgBotLang, K.tgSalesTemplateId, K.tgSalesPayMode,
    K.tgSelfService, K.tgReceiptApprove, K.tgGuardianHeal, K.tgBackupHours,
  ]);
  const token = m.get(K.tgToken) ?? "";
  let notify = NOTIFY_DEFAULT;
  const raw = m.get(K.tgNotify);
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<TelegramNotify>;
      notify = {
        userCreated: Boolean(p.userCreated),
        userExpired: Boolean(p.userExpired),
        trafficAlert: Boolean(p.trafficAlert),
        loginAlert: Boolean(p.loginAlert),
        dailyDigest: Boolean((p as { dailyDigest?: unknown }).dailyDigest),
      };
    } catch {
      /* keep defaults */
    }
  }
  const modeRaw = m.get(K.tgBotMode);
  const adminIdsRaw = m.get(K.tgAdminChatIds) ?? "";
  const shopLangRaw = m.get(K.tgShopLang) === "fa" ? "fa" : "en";
  // botLang (23-a, 6 languages) wins; legacy shopLang stays as the fallback
  const botLangRaw = m.get(K.tgBotLang) ?? shopLangRaw;
  const botLang = (BOT_LANGS as readonly string[]).includes(botLangRaw)
    ? (botLangRaw as BotLangCode)
    : "fa";
  const payModeRaw = m.get(K.tgSalesPayMode);
  const hoursRaw = Number(m.get(K.tgBackupHours));
  return {
    enabled: m.get(K.tgEnabled) === "1",
    chatId: m.get(K.tgChatId) ?? "",
    tokenConfigured: token.length > 0,
    tokenMasked: token ? maskBotToken(token) : "",
    notify,
    botMode: modeRaw === "sales" ? "sales" : modeRaw === "notify" ? "notify" : "console",
    adminChatIds: adminIdsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    botApiBase: m.get(K.tgApiBase) ?? "https://api.telegram.org",
    botProxyUrl: m.get(K.tgProxyUrl) ?? "",
    botLang,
    salesTemplateId: m.get(K.tgSalesTemplateId) ?? "",
    salesPayMode: payModeRaw === "zarinpal" ? "zarinpal" : "manual",
    shopLang: botLang === "en" ? "en" : "fa",
    // Task 18-3 — automation toggles default ON (panel parity); cadence 6h
    selfService: m.get(K.tgSelfService) !== "0", // "0" opts out
    receiptApprove: m.get(K.tgReceiptApprove) !== "0",
    guardianHeal: m.get(K.tgGuardianHeal) !== "0",
    backupIntervalHours:
      hoursRaw === 1 || hoursRaw === 6 || hoursRaw === 12 || hoursRaw === 24 ? hoursRaw : 6,
  };
}

export async function getTelegramToken(): Promise<string> {
  const m = await readSettings([K.tgToken]);
  return m.get(K.tgToken) ?? "";
}

/* ---------- bot long-poll offset (23-a, internal bookkeeping) ---------- */

/** Persisted getUpdates offset so a worker restart never replays old updates. */
export async function getBotOffset(): Promise<number> {
  const m = await readSettings([K.tgOffset]);
  const n = Number(m.get(K.tgOffset));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export async function saveBotOffset(offset: number): Promise<void> {
  await writeSetting(K.tgOffset, String(Math.max(0, Math.floor(offset))));
}

export function validateTelegramPatch(
  body: unknown
): PatchResult<{
  enabled: boolean;
  chatId: string;
  token: string | null | undefined; // undefined = keep, null = clear, string = replace
  notify: TelegramNotify;
  botMode?: "console" | "notify" | "sales";
  adminChatIds?: string[];
  botApiBase?: string;
  botProxyUrl?: string;
  botLang?: BotLangCode;
  salesTemplateId?: string;
  salesPayMode?: "manual" | "zarinpal";
  shopLang?: "fa" | "en"; // legacy — kept for older clients, ignored when botLang is sent
  // Task 18-3 — bot automation toggles + telegram backup cadence (all optional:
  // undefined = keep the currently saved value)
  selfService?: boolean;
  receiptApprove?: boolean;
  guardianHeal?: boolean;
  backupIntervalHours?: number;
}> {
  const b = (body ?? {}) as Record<string, unknown>;
  let token: string | null | undefined = undefined;
  if (b.token === null) {
    token = null; // explicit clear
  } else if (b.token !== undefined) {
    if (typeof b.token !== "string") {
      return { ok: false, fields: [{ field: "token", code: "format" }] };
    }
    const t = b.token.trim();
    if (t === "") {
      token = undefined; // empty string = keep current
    } else {
      // telegram bot tokens: "<bot-id>:<35 chars>" — accept a sane subset
      if (!/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(t)) {
        return { ok: false, fields: [{ field: "token", code: "format" }] };
      }
      token = t;
    }
  }

  let chatId = "";
  if (b.chatId !== undefined) {
    chatId = String(b.chatId).trim();
    // "" = clear; otherwise numeric id or @channelname
    if (
      chatId !== "" &&
      (chatId.length > 32 || !/^-?\d+$|^@[A-Za-z0-9_]{4,31}$/.test(chatId))
    ) {
      return { ok: false, fields: [{ field: "chatId", code: "format" }] };
    }
  }

  const notify: TelegramNotify = { ...NOTIFY_DEFAULT };
  if (b.notify !== undefined && b.notify !== null) {
    const n = b.notify as Record<string, unknown>;
    for (const key of Object.keys(NOTIFY_DEFAULT) as (keyof TelegramNotify)[]) {
      if (typeof n[key] === "boolean") notify[key] = n[key] as boolean;
    }
  }

  let botMode: "console" | "notify" | "sales" | undefined;
  if (b.botMode !== undefined) {
    if (b.botMode !== "console" && b.botMode !== "notify" && b.botMode !== "sales") {
      return { ok: false, fields: [{ field: "botMode", code: "format" }] };
    }
    botMode = b.botMode;
  }

  let botApiBase: string | undefined;
  if (b.botApiBase !== undefined) {
    const v = String(b.botApiBase).trim().replace(/\/+$/, "");
    if (v !== "" && !/^https?:\/\/\S+$/.test(v)) {
      return { ok: false, fields: [{ field: "botApiBase", code: "format" }] };
    }
    if (v.length > 300) {
      return { ok: false, fields: [{ field: "botApiBase", code: "range" }] };
    }
    botApiBase = v;
  }

  let botLang: BotLangCode | undefined;
  if (b.botLang !== undefined) {
    if (typeof b.botLang !== "string" || !(BOT_LANGS as readonly string[]).includes(b.botLang)) {
      return { ok: false, fields: [{ field: "botLang", code: "format" }] };
    }
    botLang = b.botLang as BotLangCode;
  }

  let salesTemplateId: string | undefined;
  if (b.salesTemplateId !== undefined) {
    const v = String(b.salesTemplateId).trim();
    if (v.length > 64 || /\s/.test(v)) {
      return { ok: false, fields: [{ field: "salesTemplateId", code: "format" }] };
    }
    salesTemplateId = v;
  }

  let salesPayMode: "manual" | "zarinpal" | undefined;
  if (b.salesPayMode !== undefined) {
    if (b.salesPayMode !== "manual" && b.salesPayMode !== "zarinpal") {
      return { ok: false, fields: [{ field: "salesPayMode", code: "format" }] };
    }
    salesPayMode = b.salesPayMode;
  }

  let adminChatIds: string[] | undefined;
  if (b.adminChatIds !== undefined) {
    if (typeof b.adminChatIds !== "string") {
      return { ok: false, fields: [{ field: "adminChatIds", code: "format" }] };
    }
    const ids = b.adminChatIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // same per-id grammar as chatId (numeric id or @channelname), max 16 ids
    if (ids.length > 16 || ids.some((id) => id.length > 32 || !/^-?\d+$|^@[A-Za-z0-9_]{4,31}$/.test(id))) {
      return { ok: false, fields: [{ field: "adminChatIds", code: "format" }] };
    }
    adminChatIds = ids;
  }

  let botProxyUrl: string | undefined;
  if (b.botProxyUrl !== undefined) {
    const v = String(b.botProxyUrl).trim();
    if (v !== "" && !/^https:\/\/\S+$/.test(v)) {
      // Phase 1 accepts HTTPS proxies only (undici ProxyAgent). SOCKS5 needs a
      // local https-forward; the UI hint says so honestly.
      return { ok: false, fields: [{ field: "botProxyUrl", code: "format" }] };
    }
    if (v.length > 300) {
      return { ok: false, fields: [{ field: "botProxyUrl", code: "range" }] };
    }
    botProxyUrl = v;
  }

  let shopLang: "fa" | "en" | undefined;
  if (b.shopLang !== undefined) {
    if (b.shopLang !== "fa" && b.shopLang !== "en") {
      return { ok: false, fields: [{ field: "shopLang", code: "format" }] };
    }
    shopLang = b.shopLang;
  }

  // Task 18-3 — automation toggles (strict booleans) + backup cadence (1|6|12|24h)
  let selfService: boolean | undefined;
  if (b.selfService !== undefined) {
    if (typeof b.selfService !== "boolean") {
      return { ok: false, fields: [{ field: "selfService", code: "format" }] };
    }
    selfService = b.selfService;
  }
  let receiptApprove: boolean | undefined;
  if (b.receiptApprove !== undefined) {
    if (typeof b.receiptApprove !== "boolean") {
      return { ok: false, fields: [{ field: "receiptApprove", code: "format" }] };
    }
    receiptApprove = b.receiptApprove;
  }
  let guardianHeal: boolean | undefined;
  if (b.guardianHeal !== undefined) {
    if (typeof b.guardianHeal !== "boolean") {
      return { ok: false, fields: [{ field: "guardianHeal", code: "format" }] };
    }
    guardianHeal = b.guardianHeal;
  }
  let backupIntervalHours: number | undefined;
  if (b.backupIntervalHours !== undefined) {
    const n = Number(b.backupIntervalHours);
    if (!Number.isInteger(n) || (n !== 1 && n !== 6 && n !== 12 && n !== 24)) {
      return { ok: false, fields: [{ field: "backupIntervalHours", code: "range" }] };
    }
    backupIntervalHours = n;
  }

  return {
    ok: true,
    data: {
      enabled: b.enabled === undefined ? true : Boolean(b.enabled),
      chatId,
      token,
      notify,
      botMode,
      adminChatIds,
      botApiBase,
      botProxyUrl,
      botLang,
      salesTemplateId,
      salesPayMode,
      shopLang,
      selfService,
      receiptApprove,
      guardianHeal,
      backupIntervalHours,
    },
  };
}

export async function saveTelegramSettings(patch: {
  enabled: boolean;
  chatId: string;
  token: string | null | undefined;
  notify: TelegramNotify;
  botMode?: "console" | "notify" | "sales";
  adminChatIds?: string[];
  botApiBase?: string;
  botProxyUrl?: string;
  botLang?: BotLangCode;
  salesTemplateId?: string;
  salesPayMode?: "manual" | "zarinpal";
  shopLang?: "fa" | "en";
  selfService?: boolean;
  receiptApprove?: boolean;
  guardianHeal?: boolean;
  backupIntervalHours?: number;
}): Promise<void> {
  await writeSetting(K.tgEnabled, patch.enabled ? "1" : "0");
  await writeSetting(K.tgChatId, patch.chatId);
  if (patch.token === null) {
    await deleteSetting(K.tgToken);
  } else if (patch.token !== undefined) {
    await writeSetting(K.tgToken, patch.token);
  }
  await writeSetting(K.tgNotify, JSON.stringify(patch.notify));
  if (patch.botMode !== undefined) {
    await writeSetting(K.tgBotMode, patch.botMode);
  }
  if (patch.adminChatIds !== undefined) {
    await writeSetting(K.tgAdminChatIds, patch.adminChatIds.join(","));
  }
  if (patch.botProxyUrl !== undefined) {
    await writeSetting(K.tgProxyUrl, patch.botProxyUrl);
  }
  if (patch.botApiBase !== undefined) {
    await writeSetting(K.tgApiBase, patch.botApiBase);
  }
  if (patch.botLang !== undefined) {
    await writeSetting(K.tgBotLang, patch.botLang);
  }
  if (patch.salesTemplateId !== undefined) {
    await writeSetting(K.tgSalesTemplateId, patch.salesTemplateId);
  }
  if (patch.salesPayMode !== undefined) {
    await writeSetting(K.tgSalesPayMode, patch.salesPayMode);
  }
  if (patch.shopLang !== undefined) {
    await writeSetting(K.tgShopLang, patch.shopLang);
  }
  if (patch.selfService !== undefined) {
    await writeSetting(K.tgSelfService, patch.selfService ? "1" : "0");
  }
  if (patch.receiptApprove !== undefined) {
    await writeSetting(K.tgReceiptApprove, patch.receiptApprove ? "1" : "0");
  }
  if (patch.guardianHeal !== undefined) {
    await writeSetting(K.tgGuardianHeal, patch.guardianHeal ? "1" : "0");
  }
  if (patch.backupIntervalHours !== undefined) {
    await writeSetting(K.tgBackupHours, String(patch.backupIntervalHours));
  }
}

/* ---------- outbound webhooks (v2.7, automation fan-out) ---------- */

/**
 * Canonical webhook event names. Declared here (not in webhooks.ts) so the
 * settings layer can validate per-event URL overrides without a
 * settings → webhooks runtime import cycle; webhooks.ts re-exports both.
 */
export const WEBHOOK_EVENTS = [
  "user.created",
  "user.deleted",
  "user.updated",
  "user.expired",
  "user.near-expiry",
  "user.quota",
  "user.traffic-reset",
  "user.activated",
  "user.renewed",
  "login.failed",
  "sales.digest",
  "backup.done",
  "panel.restart",
  "inbound.created",
  "inbound.deleted",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookEventToggles {
  userCreated: boolean;
  userDeleted: boolean;
  userUpdated: boolean;
  userExpired: boolean;
  trafficAlert: boolean;
  loginAlert: boolean;
  salesDigest: boolean;
  backupDone: boolean;
  panelRestart: boolean;
  inboundCreated: boolean;
  inboundDeleted: boolean;
}

export interface WebhookSettings {
  enabled: boolean;
  /** HTTPS POST target (n8n / Make / Discord relay / custom). "" = unset. */
  url: string;
  /** Shared secret for the X-Sephiroth-Sign HMAC header ("" = unsigned). */
  secretConfigured: boolean;
  secretMasked: string;
  /** Per-event opt-in map (default: everything on). */
  events: WebhookEventToggles;
  /** Task 2-a — per-event URL overrides (empty/missing = use the global url). */
  eventUrls: Partial<Record<WebhookEvent, string>>;
}

const WEBHOOK_EVENTS_DEFAULT: WebhookEventToggles = {
  userCreated: true,
  userDeleted: true,
  userUpdated: true,
  userExpired: true,
  trafficAlert: true,
  loginAlert: false,
  salesDigest: false,
  backupDone: true,
  panelRestart: true,
  inboundCreated: true,
  inboundDeleted: true,
};

export async function getWebhookSettings(): Promise<WebhookSettings> {
  const m = await readSettings([K.whEnabled, K.whUrl, K.whSecret, K.whEvents, K.whEventUrls]);
  let events = WEBHOOK_EVENTS_DEFAULT;
  const raw = m.get(K.whEvents);
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<WebhookEventToggles>;
      events = { ...WEBHOOK_EVENTS_DEFAULT };
      for (const key of Object.keys(WEBHOOK_EVENTS_DEFAULT) as (keyof WebhookEventToggles)[]) {
        if (typeof p[key] === "boolean") events[key] = p[key] as boolean;
      }
    } catch {
      /* keep defaults */
    }
  }
  const secret = m.get(K.whSecret) ?? "";
  // Task 2-a — per-event URL overrides: keep only known events + non-empty
  // strings so a corrupted store value can never leak into the dispatcher.
  const eventUrls: Partial<Record<WebhookEvent, string>> = {};
  const rawUrls = m.get(K.whEventUrls);
  if (rawUrls) {
    try {
      const p = JSON.parse(rawUrls) as Record<string, unknown>;
      for (const ev of WEBHOOK_EVENTS) {
        const v = p[ev];
        if (typeof v === "string" && v.trim() !== "") eventUrls[ev] = v.trim();
      }
    } catch {
      /* keep empty */
    }
  }
  return {
    enabled: m.get(K.whEnabled) === "1",
    url: m.get(K.whUrl) ?? "",
    secretConfigured: secret.length > 0,
    secretMasked: secret ? `${secret.slice(0, 3)}••••••••` : "",
    events,
    eventUrls,
  };
}

export async function getWebhookSecret(): Promise<string> {
  const m = await readSettings([K.whSecret]);
  return m.get(K.whSecret) ?? "";
}

export function validateWebhookPatch(
  body: unknown
): PatchResult<{
  enabled: boolean;
  url: string;
  secret: string | null | undefined; // undefined = keep, null = clear, string = replace
  events: WebhookEventToggles;
  eventUrls: Partial<Record<WebhookEvent, string>>;
}> {
  const b = (body ?? {}) as Record<string, unknown>;
  let url = "";
  if (b.url !== undefined) {
    url = String(b.url).trim().replace(/\/$/, "");
    if (url !== "" && !/^https:\/\/\S+$/.test(url)) {
      return { ok: false, fields: [{ field: "url", code: "format" }] };
    }
    if (url.length > 500) {
      return { ok: false, fields: [{ field: "url", code: "range" }] };
    }
  }
  let secret: string | null | undefined = undefined;
  if (b.secret === null) {
    secret = null;
  } else if (b.secret !== undefined) {
    const s = String(b.secret).trim();
    if (s === "") {
      secret = undefined; // empty string = keep current
    } else {
      if (s.length < 8 || s.length > 128) {
        return { ok: false, fields: [{ field: "secret", code: "format" }] };
      }
      secret = s;
    }
  }
  const events: WebhookEventToggles = { ...WEBHOOK_EVENTS_DEFAULT };
  if (b.events !== undefined && b.events !== null) {
    const e = b.events as Record<string, unknown>;
    for (const key of Object.keys(WEBHOOK_EVENTS_DEFAULT) as (keyof WebhookEventToggles)[]) {
      if (typeof e[key] === "boolean") events[key] = e[key] as boolean;
    }
  }
  // Task 2-a — per-event URL overrides. Same https + length rules as the
  // global endpoint URL; empty string clears the override (falls back to
  // the default URL). Unknown event names are rejected, not silently kept.
  const eventUrls: Partial<Record<WebhookEvent, string>> = {};
  if (b.eventUrls !== undefined && b.eventUrls !== null) {
    if (typeof b.eventUrls !== "object" || Array.isArray(b.eventUrls)) {
      return { ok: false, fields: [{ field: "eventUrls", code: "format" }] };
    }
    const p = b.eventUrls as Record<string, unknown>;
    for (const [key, val] of Object.entries(p)) {
      const field = `eventUrls.${key}`;
      if (!(WEBHOOK_EVENTS as readonly string[]).includes(key)) {
        return { ok: false, fields: [{ field, code: "format" }] };
      }
      if (val === undefined || val === null) continue;
      if (typeof val !== "string") {
        return { ok: false, fields: [{ field, code: "format" }] };
      }
      const v = val.trim().replace(/\/$/, "");
      if (v === "") continue; // cleared override → use the global default
      if (!/^https:\/\/\S+$/.test(v)) {
        return { ok: false, fields: [{ field, code: "format" }] };
      }
      if (v.length > 500) {
        return { ok: false, fields: [{ field, code: "range" }] };
      }
      eventUrls[key as WebhookEvent] = v;
    }
  }
  return {
    ok: true,
    data: {
      enabled: b.enabled === undefined ? false : Boolean(b.enabled),
      url,
      secret,
      events,
      eventUrls,
    },
  };
}

export async function saveWebhookSettings(patch: {
  enabled: boolean;
  url: string;
  secret: string | null | undefined;
  events: WebhookEventToggles;
  eventUrls: Partial<Record<WebhookEvent, string>>;
}): Promise<void> {
  await writeSetting(K.whEnabled, patch.enabled ? "1" : "0");
  await writeSetting(K.whUrl, patch.url);
  if (patch.secret === null) {
    await deleteSetting(K.whSecret);
  } else if (patch.secret !== undefined) {
    await writeSetting(K.whSecret, patch.secret);
  }
  await writeSetting(K.whEvents, JSON.stringify(patch.events));
  await writeSetting(K.whEventUrls, JSON.stringify(patch.eventUrls ?? {}));
}

/* ---------- Discord bot (v2.7, gateway worker) ---------- */

export interface DiscordSettings {
  enabled: boolean;
  tokenConfigured: boolean;
  tokenMasked: string;
  /** Discord user ids allowed to drive admin commands (snowflakes). */
  adminUserIds: string[];
  /** Optional channel id for event announcements ("" = DM admins instead). */
  announceChannelId: string;
  /** Bot language for announcements — same catalogue as the Telegram bot. */
  botLang: BotLangCode;
  /** Message prefix for commands (default "!"). */
  prefix: string;
}

const DISCORD_DEFAULT: DiscordSettings = {
  enabled: false,
  tokenConfigured: false,
  tokenMasked: "",
  adminUserIds: [],
  announceChannelId: "",
  botLang: "fa",
  prefix: "!",
};

export async function getDiscordSettings(): Promise<DiscordSettings> {
  const m = await readSettings([
    K.dcEnabled, K.dcToken, K.dcAdminUserIds, K.dcChannelId, K.dcLang,
  ]);
  const token = m.get(K.dcToken) ?? "";
  const langRaw = m.get(K.dcLang);
  return {
    ...DISCORD_DEFAULT,
    enabled: m.get(K.dcEnabled) === "1",
    tokenConfigured: token.length > 0,
    tokenMasked: token ? maskBotToken(token) : "",
    adminUserIds: (m.get(K.dcAdminUserIds) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    announceChannelId: m.get(K.dcChannelId) ?? "",
    botLang: (BOT_LANGS as readonly string[]).includes(langRaw ?? "")
      ? (langRaw as BotLangCode)
      : "fa",
  };
}

export async function getDiscordToken(): Promise<string> {
  const m = await readSettings([K.dcToken]);
  return m.get(K.dcToken) ?? "";
}

const DISCORD_SNOWFLAKE = /^\d{15,21}$/;

export function validateDiscordPatch(
  body: unknown
): PatchResult<{
  enabled: boolean;
  token: string | null | undefined; // undefined = keep, null = clear, string = replace
  adminUserIds?: string[];
  announceChannelId?: string;
  botLang?: BotLangCode;
  prefix?: string;
}> {
  const b = (body ?? {}) as Record<string, unknown>;
  let token: string | null | undefined = undefined;
  if (b.token === null) {
    token = null;
  } else if (b.token !== undefined) {
    const t = String(b.token).trim();
    if (t === "") {
      token = undefined;
    } else {
      // Discord bot tokens: <app-id>.<6 chars>.<32+ chars> — accept a sane subset
      if (!/^[A-Za-z0-9_-]{40,80}$/.test(t.replace(/\./g, "")) || t.length > 90) {
        return { ok: false, fields: [{ field: "token", code: "format" }] };
      }
      token = t;
    }
  }
  let adminUserIds: string[] | undefined;
  if (b.adminUserIds !== undefined) {
    if (typeof b.adminUserIds !== "string") {
      return { ok: false, fields: [{ field: "adminUserIds", code: "format" }] };
    }
    const ids = b.adminUserIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length > 16 || ids.some((id) => !DISCORD_SNOWFLAKE.test(id))) {
      return { ok: false, fields: [{ field: "adminUserIds", code: "format" }] };
    }
    adminUserIds = ids;
  }
  let announceChannelId: string | undefined;
  if (b.announceChannelId !== undefined) {
    const v = String(b.announceChannelId).trim();
    if (v !== "" && !DISCORD_SNOWFLAKE.test(v)) {
      return { ok: false, fields: [{ field: "announceChannelId", code: "format" }] };
    }
    announceChannelId = v;
  }
  let botLang: BotLangCode | undefined;
  if (b.botLang !== undefined) {
    if (typeof b.botLang !== "string" || !(BOT_LANGS as readonly string[]).includes(b.botLang)) {
      return { ok: false, fields: [{ field: "botLang", code: "format" }] };
    }
    botLang = b.botLang as BotLangCode;
  }
  let prefix: string | undefined;
  if (b.prefix !== undefined) {
    const p = String(b.prefix);
    if (p.length < 1 || p.length > 4 || /\s/.test(p)) {
      return { ok: false, fields: [{ field: "prefix", code: "format" }] };
    }
    prefix = p;
  }
  return {
    ok: true,
    data: {
      enabled: b.enabled === undefined ? false : Boolean(b.enabled),
      token,
      adminUserIds,
      announceChannelId,
      botLang,
      prefix,
    },
  };
}

export async function saveDiscordSettings(patch: {
  enabled: boolean;
  token: string | null | undefined;
  adminUserIds?: string[];
  announceChannelId?: string;
  botLang?: BotLangCode;
  prefix?: string;
}): Promise<void> {
  await writeSetting(K.dcEnabled, patch.enabled ? "1" : "0");
  if (patch.token === null) {
    await deleteSetting(K.dcToken);
  } else if (patch.token !== undefined) {
    await writeSetting(K.dcToken, patch.token);
  }
  if (patch.adminUserIds !== undefined) {
    await writeSetting(K.dcAdminUserIds, patch.adminUserIds.join(","));
  }
  if (patch.announceChannelId !== undefined) {
    await writeSetting(K.dcChannelId, patch.announceChannelId);
  }
  if (patch.botLang !== undefined) {
    await writeSetting(K.dcLang, patch.botLang);
  }
  if (patch.prefix !== undefined) {
    await writeSetting(K.dcPrefix, patch.prefix);
  }
}

/* ---------- payment / reseller gateway (read by the sales bot) ---------- */

export interface PaymentSettings {
  /** Card-to-card hook active (reseller panel toggle, default ON). */
  cardToCardEnabled: boolean;
  /** ZarinPal webhook hook active (default ON). */
  zarinpalEnabled: boolean;
  /** Crypto USDT (TRC20) hook active (default ON). */
  cryptoEnabled: boolean;
  /** Card-to-card destination number (digits, formatting free). RAW — server-only; the settings API ships the masked form via getPaymentSettingsView(). */
  cardNumber: string;
  /** Card holder name shown to buyers. */
  cardHolder: string;
  /** ZarinPal merchant id (GUID or 36-char id) — "" = gateway off. RAW — masked in the API view. */
  zarinpalMerchant: string;
  /** TRC20 wallet address — "" = crypto hook off. RAW — masked in the API view. */
  usdtWallet: string;
  /** Reseller tariff per GB as displayed in the panel (free text, e.g. "1800"). */
  pricePerGb: string;
}

const PAYMENT_DEFAULT: PaymentSettings = {
  cardToCardEnabled: true,
  zarinpalEnabled: true,
  cryptoEnabled: true,
  cardNumber: "",
  cardHolder: "",
  zarinpalMerchant: "",
  usdtWallet: "",
  pricePerGb: "",
};

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const m = await readSettings([
    K.payCardToCardEnabled, K.payZarinpalEnabled, K.payCryptoEnabled,
    K.payCardNumber, K.payCardHolder, K.payZarinpalMerchant,
    K.payUsdtWallet, K.payPricePerGb,
  ]);
  return {
    cardToCardEnabled: m.get(K.payCardToCardEnabled) !== "0", // default ON — "0" opts out
    zarinpalEnabled: m.get(K.payZarinpalEnabled) !== "0",
    cryptoEnabled: m.get(K.payCryptoEnabled) !== "0",
    cardNumber: m.get(K.payCardNumber) ?? PAYMENT_DEFAULT.cardNumber,
    cardHolder: m.get(K.payCardHolder) ?? PAYMENT_DEFAULT.cardHolder,
    zarinpalMerchant: m.get(K.payZarinpalMerchant) ?? PAYMENT_DEFAULT.zarinpalMerchant,
    usdtWallet: m.get(K.payUsdtWallet) ?? PAYMENT_DEFAULT.usdtWallet,
    pricePerGb: m.get(K.payPricePerGb) ?? PAYMENT_DEFAULT.pricePerGb,
  };
}

/**
 * Head/tail mask for payment credentials — mirrors maskBotToken: the raw
 * card number / merchant id / USDT wallet never leave the server through the
 * settings API. GET ships this mask, and a PUT whose value still carries the
 * "•" bullet is treated as "keep the stored secret" (only a fresh,
 * bullet-free value overwrites — "" clears the credential).
 */
function maskSecretValue(v: string): string {
  const s = v.trim();
  if (!s) return "";
  if (s.length < 12) return "••••••••";
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

/** Client-facing payment settings — secrets masked, `*Configured` flags tell the UI a value exists. */
export interface PaymentSettingsView {
  cardToCardEnabled: boolean;
  zarinpalEnabled: boolean;
  cryptoEnabled: boolean;
  cardNumber: string; // masked
  cardNumberConfigured: boolean;
  cardHolder: string;
  zarinpalMerchant: string; // masked
  zarinpalMerchantConfigured: boolean;
  usdtWallet: string; // masked
  usdtWalletConfigured: boolean;
  pricePerGb: string;
}

export async function getPaymentSettingsView(): Promise<PaymentSettingsView> {
  const pay = await getPaymentSettings();
  return {
    cardToCardEnabled: pay.cardToCardEnabled,
    zarinpalEnabled: pay.zarinpalEnabled,
    cryptoEnabled: pay.cryptoEnabled,
    cardNumber: maskSecretValue(pay.cardNumber),
    cardNumberConfigured: pay.cardNumber.trim().length > 0,
    cardHolder: pay.cardHolder,
    zarinpalMerchant: maskSecretValue(pay.zarinpalMerchant),
    zarinpalMerchantConfigured: pay.zarinpalMerchant.trim().length > 0,
    usdtWallet: maskSecretValue(pay.usdtWallet),
    usdtWalletConfigured: pay.usdtWallet.trim().length > 0,
    pricePerGb: pay.pricePerGb,
  };
}

const PAYMENT_SECRETS = new Set<string>(["cardNumber", "zarinpalMerchant", "usdtWallet"]);

export async function validatePaymentPatch(body: unknown): Promise<PatchResult<PaymentSettings>> {
  const b = (body ?? {}) as Record<string, unknown>;
  // merge onto the CURRENTLY SAVED values so a partial PUT never wipes fields
  const out: PaymentSettings = { ...(await getPaymentSettings()) };
  for (const key of ["cardToCardEnabled", "zarinpalEnabled", "cryptoEnabled"] as const) {
    if (b[key] !== undefined) {
      if (typeof b[key] !== "boolean") {
        return { ok: false, fields: [{ field: key, code: "format" }] };
      }
      out[key] = b[key];
    }
  }
  for (const key of ["cardNumber", "cardHolder", "zarinpalMerchant", "usdtWallet", "pricePerGb"] as const) {
    if (b[key] !== undefined) {
      const v = String(b[key]).trim();
      if (v.length > 120 || /[\r\n]/.test(v)) {
        return { ok: false, fields: [{ field: key, code: "format" }] };
      }
      // Masked round-trip (honest-secret rule): the client echoed the masked
      // form back → keep the stored secret untouched. A new non-masked value
      // (including "" = clear) overwrites.
      if (PAYMENT_SECRETS.has(key) && v.includes("•")) continue;
      out[key] = v;
    }
  }
  return { ok: true, data: out };
}

export async function savePaymentSettings(p: PaymentSettings): Promise<void> {
  await writeSetting(K.payCardToCardEnabled, p.cardToCardEnabled ? "1" : "0");
  await writeSetting(K.payZarinpalEnabled, p.zarinpalEnabled ? "1" : "0");
  await writeSetting(K.payCryptoEnabled, p.cryptoEnabled ? "1" : "0");
  await writeSetting(K.payCardNumber, p.cardNumber);
  await writeSetting(K.payCardHolder, p.cardHolder);
  await writeSetting(K.payZarinpalMerchant, p.zarinpalMerchant);
  await writeSetting(K.payUsdtWallet, p.usdtWallet);
  await writeSetting(K.payPricePerGb, p.pricePerGb);
}

/* ---------- ssl / acme (Task 23-f) ---------- */

export interface SslSettings {
  /** Account email used for ACME registration + expiry notices ("" = unset). */
  adminEmail: string;
  /** Daily renewal check (acme.sh --renew-all when a cert is within 30 days). */
  renewCheck: boolean;
}

const SSL_DEFAULT: SslSettings = {
  adminEmail: "",
  renewCheck: true,
};

export async function getSslSettings(): Promise<SslSettings> {
  const m = await readSettings([K.sslAdminEmail, K.sslRenewCheck]);
  return {
    adminEmail: m.get(K.sslAdminEmail) ?? SSL_DEFAULT.adminEmail,
    renewCheck: m.get(K.sslRenewCheck) === null ? SSL_DEFAULT.renewCheck : m.get(K.sslRenewCheck) === "1",
  };
}

export async function validateSslPatch(body: unknown): Promise<PatchResult<SslSettings>> {
  const b = (body ?? {}) as Record<string, unknown>;
  // merge onto the CURRENTLY SAVED values so a partial PUT never wipes fields
  const out: SslSettings = { ...(await getSslSettings()) };
  if (b.adminEmail !== undefined) {
    const v = String(b.adminEmail).trim();
    if (v.length > 254 || /[\r\n\s]/.test(v)) {
      return { ok: false, fields: [{ field: "adminEmail", code: "format" }] };
    }
    if (v !== "" && !/^[^@]+@[^@]+\.[^@]+$/.test(v)) {
      return { ok: false, fields: [{ field: "adminEmail", code: "format" }] };
    }
    out.adminEmail = v;
  }
  if (b.renewCheck !== undefined) {
    out.renewCheck = Boolean(b.renewCheck);
  }
  return { ok: true, data: out };
}

export async function saveSslSettings(s: SslSettings): Promise<void> {
  await writeSetting(K.sslAdminEmail, s.adminEmail);
  await writeSetting(K.sslRenewCheck, s.renewCheck ? "1" : "0");
}

/** Tracked managed certs (set_ssl_certs JSON array) — owned by lib/acme.ts. */
export async function getSslCertsJson(): Promise<unknown[]> {
  const m = await readSettings([K.sslCerts]);
  const raw = m.get(K.sslCerts) ?? "[]";
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSslCertsJson(certs: unknown[]): Promise<void> {
  await writeSetting(K.sslCerts, JSON.stringify(certs));
}

/* ---------- nav module visibility ---------- */

export interface NavModules {
  hosts: boolean;
  nodes: boolean;
  outbounds: boolean;
  routing: boolean;
}

const NAV_DEFAULT: NavModules = {
  hosts: true,
  nodes: true,
  outbounds: true,
  routing: true,
};

export async function getNavModules(): Promise<NavModules> {
  const m = await readSettings([K.navHosts, K.navNodes, K.navOutbounds, K.navRouting]);
  const bool = (raw: string | undefined): boolean | undefined =>
    raw === "1" ? true : raw === "0" ? false : undefined;
  return {
    hosts: bool(m.get(K.navHosts)) ?? NAV_DEFAULT.hosts,
    nodes: bool(m.get(K.navNodes)) ?? NAV_DEFAULT.nodes,
    outbounds: bool(m.get(K.navOutbounds)) ?? NAV_DEFAULT.outbounds,
    routing: bool(m.get(K.navRouting)) ?? NAV_DEFAULT.routing,
  };
}

export function validateNavPatch(body: unknown): PatchResult<NavModules> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: NavModules = { ...NAV_DEFAULT };
  for (const key of Object.keys(NAV_DEFAULT) as (keyof NavModules)[]) {
    if (typeof b[key] === "boolean") out[key] = b[key] as boolean;
  }
  return { ok: true, data: out };
}

export async function saveNavModules(n: NavModules): Promise<void> {
  await Promise.all([
    writeSetting(K.navHosts, n.hosts ? "1" : "0"),
    writeSetting(K.navNodes, n.nodes ? "1" : "0"),
    writeSetting(K.navOutbounds, n.outbounds ? "1" : "0"),
    writeSetting(K.navRouting, n.routing ? "1" : "0"),
  ]);
}

/* ---------- general panel prefs ---------- */

export interface GeneralSettings {
  datepicker: "gregorian" | "jalalian";
  pageSize: number;
  /** Admin-declared public hostname for client configs / sub links ("" = unset). */
  publicHost: string;
  /** Optional support/portal URL surfaced via the `support-url` sub header. */
  subSupportUrl: string;
  /** Task 1-b — panel-level sub branding, fallback when no reseller brand ("" = Sephiroth default). */
  subBrandName: string;
  subBrandLogo: string;
  subBrandAccent: string;
}

const GENERAL_DEFAULT: GeneralSettings = {
  datepicker: "gregorian",
  pageSize: 25,
  publicHost: "",
  subSupportUrl: "",
  subBrandName: "",
  subBrandLogo: "",
  subBrandAccent: "",
};

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const m = await readSettings([
    K.datepicker, K.pageSize, K.publicHost, K.subSupportUrl,
    K.subBrandName, K.subBrandLogo, K.subBrandAccent,
  ]);
  return {
    datepicker: m.get(K.datepicker) === "jalalian" ? "jalalian" : "gregorian",
    pageSize: toInt(m.get(K.pageSize), GENERAL_DEFAULT.pageSize, 10, 100),
    publicHost: m.get(K.publicHost) ?? GENERAL_DEFAULT.publicHost,
    subSupportUrl: m.get(K.subSupportUrl) ?? GENERAL_DEFAULT.subSupportUrl,
    subBrandName: m.get(K.subBrandName) ?? GENERAL_DEFAULT.subBrandName,
    subBrandLogo: m.get(K.subBrandLogo) ?? GENERAL_DEFAULT.subBrandLogo,
    subBrandAccent: m.get(K.subBrandAccent) ?? GENERAL_DEFAULT.subBrandAccent,
  };
}

export async function validateGeneralPatch(body: unknown): Promise<PatchResult<GeneralSettings>> {
  const b = (body ?? {}) as Record<string, unknown>;
  // merge onto the CURRENTLY SAVED values (not factory defaults) so a
  // partial PUT never wipes fields the request omitted
  const out: GeneralSettings = { ...(await getGeneralSettings()) };
  if (b.datepicker !== undefined) {
    if (b.datepicker !== "gregorian" && b.datepicker !== "jalalian") {
      return { ok: false, fields: [{ field: "datepicker", code: "format" }] };
    }
    out.datepicker = b.datepicker;
  }
  if (b.pageSize !== undefined) {
    const n = Number(b.pageSize);
    if (!Number.isInteger(n) || n < 10 || n > 100) {
      return { ok: false, fields: [{ field: "pageSize", code: "range" }] };
    }
    out.pageSize = n;
  }
  if (b.publicHost !== undefined) {
    const v = String(b.publicHost).trim();
    if (v.length > 253 || /\s/.test(v)) {
      return { ok: false, fields: [{ field: "publicHost", code: "format" }] };
    }
    out.publicHost = v;
  }
  if (b.subSupportUrl !== undefined) {
    const v = String(b.subSupportUrl).trim();
    if (v.length > 300 || /\s/.test(v)) {
      return { ok: false, fields: [{ field: "subSupportUrl", code: "format" }] };
    }
    out.subSupportUrl = v;
  }
  /* Task 1-b — panel-level subscription branding (mirror of the reseller
     brand rules: name ≤40, logo = http(s) URL ≤500, accent = #rrggbb or ""). */
  if (b.subBrandName !== undefined) {
    const v = String(b.subBrandName).trim();
    if (v.length > 40) {
      return { ok: false, fields: [{ field: "subBrandName", code: "format" }] };
    }
    out.subBrandName = v;
  }
  if (b.subBrandLogo !== undefined) {
    const v = String(b.subBrandLogo).trim();
    if (v.length > 500 || (v !== "" && !/^https?:\/\/.+/.test(v))) {
      return { ok: false, fields: [{ field: "subBrandLogo", code: "format" }] };
    }
    out.subBrandLogo = v;
  }
  if (b.subBrandAccent !== undefined) {
    const v = String(b.subBrandAccent).trim();
    if (v !== "" && !/^#[0-9a-fA-F]{6}$/.test(v)) {
      return { ok: false, fields: [{ field: "subBrandAccent", code: "format" }] };
    }
    out.subBrandAccent = v;
  }
  return { ok: true, data: out };
}

export async function saveGeneralSettings(g: GeneralSettings): Promise<void> {
  await writeSetting(K.datepicker, g.datepicker);
  await writeSetting(K.pageSize, String(g.pageSize));
  await writeSetting(K.publicHost, g.publicHost);
  await writeSetting(K.subSupportUrl, g.subSupportUrl);
  await writeSetting(K.subBrandName, g.subBrandName);
  await writeSetting(K.subBrandLogo, g.subBrandLogo);
  await writeSetting(K.subBrandAccent, g.subBrandAccent);
}

/* ---------- expert / xray config ---------- */

export const XRAY_LOG_LEVELS = ["none", "warning", "info", "debug"] as const;
export const XRAY_STRATEGIES = ["AsIs", "IPIfNonMatch", "IPOnDemand"] as const;
export const FREEDOM_STRATEGIES = ["AsIs", "UseIP", "UseIPv4", "UseIPv6"] as const;

export interface ExpertSettings {
  logLevel: (typeof XRAY_LOG_LEVELS)[number];
  dnsServers: string; // newline separated
  domainStrategy: (typeof XRAY_STRATEGIES)[number];
  freedomStrategy: (typeof FREEDOM_STRATEGIES)[number];
  connIdle: number; // seconds
  bufferSize: number; // KB
  rawJson: string; // raw template override, "" = none
  certFile: string;
  keyFile: string;
  sessionMaxAge: number; // minutes
  /** Absolute path to a pinned awg-quick; "" = resolve on PATH (Phase 27). */
  sidecarAwgBin: string;
}

const EXPERT_DEFAULT: ExpertSettings = {
  logLevel: "warning",
  dnsServers: "1.1.1.1\n8.8.8.8",
  domainStrategy: "AsIs",
  freedomStrategy: "AsIs",
  connIdle: 300,
  bufferSize: 512,
  rawJson: "",
  certFile: "",
  keyFile: "",
  sessionMaxAge: 360,
  sidecarAwgBin: "",
};

export async function getExpertSettings(): Promise<ExpertSettings> {
  const m = await readSettings([
    K.xrayLogLevel, K.xrayDnsServers, K.xrayDomainStrategy, K.xrayFreedomStrategy,
    K.xrayConnIdle, K.xrayBufferSize, K.xrayRawJson, K.certFile, K.keyFile, K.sessionMaxAge,
    K.sidecarAwgBin,
  ]);
  const level = m.get(K.xrayLogLevel);
  const strat = m.get(K.xrayDomainStrategy);
  const fstrat = m.get(K.xrayFreedomStrategy);
  return {
    logLevel: (XRAY_LOG_LEVELS.includes(level as never) ? level : EXPERT_DEFAULT.logLevel) as ExpertSettings["logLevel"],
    dnsServers: m.get(K.xrayDnsServers) ?? EXPERT_DEFAULT.dnsServers,
    domainStrategy: (XRAY_STRATEGIES.includes(strat as never) ? strat : EXPERT_DEFAULT.domainStrategy) as ExpertSettings["domainStrategy"],
    freedomStrategy: (FREEDOM_STRATEGIES.includes(fstrat as never) ? fstrat : EXPERT_DEFAULT.freedomStrategy) as ExpertSettings["freedomStrategy"],
    connIdle: toInt(m.get(K.xrayConnIdle), EXPERT_DEFAULT.connIdle, 4, 86400),
    bufferSize: toInt(m.get(K.xrayBufferSize), EXPERT_DEFAULT.bufferSize, 4, 65535),
    rawJson: m.get(K.xrayRawJson) ?? "",
    certFile: m.get(K.certFile) ?? "",
    keyFile: m.get(K.keyFile) ?? "",
    sessionMaxAge: toInt(m.get(K.sessionMaxAge), EXPERT_DEFAULT.sessionMaxAge, 5, 43200),
    sidecarAwgBin: m.get(K.sidecarAwgBin) ?? "",
  };
}

export async function validateExpertPatch(body: unknown): Promise<PatchResult<ExpertSettings>> {
  const b = (body ?? {}) as Record<string, unknown>;
  // merge onto the CURRENTLY SAVED values (not factory defaults) so a
  // partial PUT never wipes fields the request omitted (e.g. saving the
  // cert paths alone no longer erases rawJson/dns and vice-versa)
  const out: ExpertSettings = { ...(await getExpertSettings()) };

  if (b.logLevel !== undefined) {
    if (!XRAY_LOG_LEVELS.includes(b.logLevel as never)) {
      return { ok: false, fields: [{ field: "logLevel", code: "format" }] };
    }
    out.logLevel = b.logLevel as ExpertSettings["logLevel"];
  }
  if (b.dnsServers !== undefined) {
    const raw = String(b.dnsServers).trim();
    const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (lines.length > 16) {
      return { ok: false, fields: [{ field: "dnsServers", code: "range" }] };
    }
    const dnsRe = /^(?:[a-zA-Z0-9.:-]+|https:\/\/[a-zA-Z0-9.:-]+|localhost)$/;
    if (lines.some((l) => !dnsRe.test(l))) {
      return { ok: false, fields: [{ field: "dnsServers", code: "format" }] };
    }
    out.dnsServers = lines.join("\n");
  }
  if (b.domainStrategy !== undefined) {
    if (!XRAY_STRATEGIES.includes(b.domainStrategy as never)) {
      return { ok: false, fields: [{ field: "domainStrategy", code: "format" }] };
    }
    out.domainStrategy = b.domainStrategy as ExpertSettings["domainStrategy"];
  }
  if (b.freedomStrategy !== undefined) {
    if (!FREEDOM_STRATEGIES.includes(b.freedomStrategy as never)) {
      return { ok: false, fields: [{ field: "freedomStrategy", code: "format" }] };
    }
    out.freedomStrategy = b.freedomStrategy as ExpertSettings["freedomStrategy"];
  }
  if (b.connIdle !== undefined) {
    const n = Number(b.connIdle);
    if (!Number.isInteger(n) || n < 4 || n > 86400) {
      return { ok: false, fields: [{ field: "connIdle", code: "range" }] };
    }
    out.connIdle = n;
  }
  if (b.bufferSize !== undefined) {
    const n = Number(b.bufferSize);
    if (!Number.isInteger(n) || n < 4 || n > 65535) {
      return { ok: false, fields: [{ field: "bufferSize", code: "range" }] };
    }
    out.bufferSize = n;
  }
  if (b.rawJson !== undefined) {
    const raw = String(b.rawJson).trim();
    if (raw === "") {
      out.rawJson = "";
    } else {
      try {
        JSON.parse(raw);
      } catch {
        return { ok: false, fields: [{ field: "rawJson", code: "format" }] };
      }
      if (raw.length > 60_000) {
        return { ok: false, fields: [{ field: "rawJson", code: "range" }] };
      }
      out.rawJson = raw;
    }
  }
  if (b.certFile !== undefined) {
    const v = String(b.certFile).trim();
    if (v.length > 200) return { ok: false, fields: [{ field: "certFile", code: "range" }] };
    out.certFile = v;
  }
  if (b.keyFile !== undefined) {
    const v = String(b.keyFile).trim();
    if (v.length > 200) return { ok: false, fields: [{ field: "keyFile", code: "range" }] };
    out.keyFile = v;
  }
  if (b.sessionMaxAge !== undefined) {
    const n = Number(b.sessionMaxAge);
    if (!Number.isInteger(n) || n < 5 || n > 43200) {
      return { ok: false, fields: [{ field: "sessionMaxAge", code: "range" }] };
    }
    out.sessionMaxAge = n;
  }
  if (b.sidecarAwgBin !== undefined) {
    const v = String(b.sidecarAwgBin).trim();
    if (v.length > 200) return { ok: false, fields: [{ field: "sidecarAwgBin", code: "range" }] };
    if (v && !v.startsWith("/")) {
      return { ok: false, fields: [{ field: "sidecarAwgBin", code: "format" }] };
    }
    out.sidecarAwgBin = v;
  }
  return { ok: true, data: out };
}

export async function saveExpertSettings(e: ExpertSettings): Promise<void> {
  await Promise.all([
    writeSetting(K.xrayLogLevel, e.logLevel),
    writeSetting(K.xrayDnsServers, e.dnsServers),
    writeSetting(K.xrayDomainStrategy, e.domainStrategy),
    writeSetting(K.xrayFreedomStrategy, e.freedomStrategy),
    writeSetting(K.xrayConnIdle, String(e.connIdle)),
    writeSetting(K.xrayBufferSize, String(e.bufferSize)),
    writeSetting(K.xrayRawJson, e.rawJson),
    writeSetting(K.certFile, e.certFile),
    writeSetting(K.keyFile, e.keyFile),
    writeSetting(K.sessionMaxAge, String(e.sessionMaxAge)),
    writeSetting(K.sidecarAwgBin, e.sidecarAwgBin),
  ]);
}

/* ---------- security (auto-backup + TOTP 2FA) ---------- */

export interface SecuritySettings {
  /** Daily server-side backup into db/backups (keeps the last N files). */
  autoBackupEnabled: boolean;
  /** How many auto backup files to retain (1-30). */
  autoBackupKeep: number;
  /** TOTP second factor active at login. */
  totpEnabled: boolean;
  /** A TOTP secret exists (masked — raw value never leaves the server). */
  totpConfigured: boolean;
}

const SECURITY_DEFAULT: SecuritySettings = {
  autoBackupEnabled: false,
  autoBackupKeep: 7,
  totpEnabled: false,
  totpConfigured: false,
};

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const m = await readSettings([
    K.secAutoBackup,
    K.secAutoKeep,
    K.secTotpEnabled,
    K.secTotpSecret,
  ]);
  return {
    autoBackupEnabled: m.get(K.secAutoBackup) === "1",
    autoBackupKeep: toInt(m.get(K.secAutoKeep), SECURITY_DEFAULT.autoBackupKeep, 1, 30),
    totpEnabled: m.get(K.secTotpEnabled) === "1",
    totpConfigured: Boolean(m.get(K.secTotpSecret)),
  };
}

export async function getTotpSecret(): Promise<string> {
  const m = await readSettings([K.secTotpSecret]);
  return m.get(K.secTotpSecret) ?? "";
}

/**
 * Security patch semantics:
 *  - autoBackupEnabled / autoBackupKeep: plain values.
 *  - totpSecret + totpCode: enroll — code MUST verify against the provided
 *    secret before it is stored (protects against typos locking the admin out).
 *  - totpEnabled:false + totpCode: disable — code MUST verify against the
 *    SAVED secret (an attacker with only the session cannot silently turn 2FA off).
 */
export async function validateSecurityPatch(
  body: unknown
): Promise<PatchResult<SecuritySettings & { _enrollSecret?: string }>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out = { ...(await getSecuritySettings()) } as SecuritySettings & {
    _enrollSecret?: string;
  };

  if (b.autoBackupEnabled !== undefined) {
    out.autoBackupEnabled = Boolean(b.autoBackupEnabled);
  }
  if (b.autoBackupKeep !== undefined) {
    const n = Number(b.autoBackupKeep);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      return { ok: false, fields: [{ field: "autoBackupKeep", code: "range" }] };
    }
    out.autoBackupKeep = n;
  }

  if (b.totpSecret !== undefined) {
    // enrollment path
    const secret = String(b.totpSecret).replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z2-7]{32}$/.test(secret)) {
      return { ok: false, fields: [{ field: "totpSecret", code: "format" }] };
    }
    const code = String(b.totpCode ?? "");
    if (!verifyTotp(secret, code)) {
      return { ok: false, fields: [{ field: "totpCode", code: "invalid" }] };
    }
    out._enrollSecret = secret;
    out.totpEnabled = true;
    out.totpConfigured = true;
  } else if (b.totpEnabled === true) {
    // re-enable path — require a valid code against the SAVED secret
    const saved = await getTotpSecret();
    if (saved) {
      const code = String(b.totpCode ?? "");
      if (!verifyTotp(saved, code)) {
        return { ok: false, fields: [{ field: "totpCode", code: "invalid" }] };
      }
    }
    out.totpEnabled = true;
  } else if (b.totpEnabled === false) {
    // disable path — require a valid code against the saved secret
    const saved = await getTotpSecret();
    if (saved) {
      const code = String(b.totpCode ?? "");
      if (!verifyTotp(saved, code)) {
        return { ok: false, fields: [{ field: "totpCode", code: "invalid" }] };
      }
    }
    out.totpEnabled = false;
  }

  return { ok: true, data: out };
}

export async function saveSecuritySettings(
  s: SecuritySettings & { _enrollSecret?: string }
): Promise<void> {
  await writeSetting(K.secAutoBackup, s.autoBackupEnabled ? "1" : "0");
  await writeSetting(K.secAutoKeep, String(s.autoBackupKeep));
  await writeSetting(K.secTotpEnabled, s.totpEnabled ? "1" : "0");
  if (s._enrollSecret) {
    await writeSetting(K.secTotpSecret, s._enrollSecret);
  }
}

/** Internal timestamp of the last successful auto-backup (never in the API). */
export async function getAutoBackupLastRun(): Promise<string> {
  const m = await readSettings([K.autoBackupLast]);
  return m.get(K.autoBackupLast) ?? "";
}

export async function markAutoBackupRun(sizeBytes: number): Promise<void> {
  await writeSetting(K.autoBackupLast, new Date().toISOString());
  await writeSetting(K.autoBackupLastSize, String(Math.max(0, Math.round(sizeBytes))));
}

/* ---------- referral program (Task 2-d — own section) ----------
   Rewards live in the SAME wallet the v2.8 /credit flow tops up; the
   currency is always Toman (the panel has no other sale currency),
   exposed as a note for the settings card. */

export interface ReferralSettings {
  /** Master switch — hides the bot menu entry and stops all rewards. */
  enabled: boolean;
  /** Toman credited to the referrer on a friend's FIRST PAID order (≥ 0; 0 = no reward). */
  rewardAmount: number;
}

const REFERRAL_DEFAULT: ReferralSettings = {
  enabled: false,
  rewardAmount: 0,
};

export async function getReferralSettings(): Promise<ReferralSettings> {
  const m = await readSettings([K.refEnabled, K.refReward]);
  const amount = Number(m.get(K.refReward));
  return {
    enabled: m.get(K.refEnabled) === "1",
    rewardAmount: Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : REFERRAL_DEFAULT.rewardAmount,
  };
}

export async function validateReferralPatch(body: unknown): Promise<PatchResult<ReferralSettings>> {
  const b = (body ?? {}) as Record<string, unknown>;
  // merge onto the CURRENTLY SAVED values so a partial PUT never wipes fields
  const out: ReferralSettings = { ...(await getReferralSettings()) };
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") {
      return { ok: false, fields: [{ field: "enabled", code: "format" }] };
    }
    out.enabled = b.enabled;
  }
  if (b.rewardAmount !== undefined) {
    const n = Number(b.rewardAmount);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) {
      return { ok: false, fields: [{ field: "rewardAmount", code: "range" }] };
    }
    out.rewardAmount = Math.floor(n);
  }
  return { ok: true, data: out };
}

export async function saveReferralSettings(s: ReferralSettings): Promise<void> {
  await writeSetting(K.refEnabled, s.enabled ? "1" : "0");
  await writeSetting(K.refReward, String(Math.max(0, Math.floor(s.rewardAmount))));
}

/* ---------- anti-abuse (Task 2-e — own section) ----------
   forceChannel: "" = off; accepts @name or https://t.me/<name>
   (normalized to the bare <name>). banNotify: send one "you are
   banned" notice per cooldown when the gate stops a user. */

export interface AbuseSettings {
  /** Public channel username (bare, no @) users must join; "" = off. */
  forceChannel: string;
  /** Send a one-time "you are banned" notice when a banned user writes. */
  banNotify: boolean;
}

const ABUSE_DEFAULT: AbuseSettings = {
  forceChannel: "",
  banNotify: true,
};

/** Telegram public usernames: 5–32 chars, letters/digits/underscores, not all digits. */
const TG_CHANNEL_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** Normalize "@name" / "https://t.me/name" / "t.me/name" → bare "name" ("" stays ""). */
export function normalizeForceChannel(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/^@/, "");
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^t\.me\//i, "");
  s = s.replace(/^\//, "");
  return s.trim();
}

export async function getAbuseSettings(): Promise<AbuseSettings> {
  const m = await readSettings([K.abuseForceChannel, K.abuseBanNotify]);
  const ch = normalizeForceChannel(m.get(K.abuseForceChannel) ?? "");
  return {
    forceChannel: ch,
    banNotify: m.get(K.abuseBanNotify) === null ? ABUSE_DEFAULT.banNotify : m.get(K.abuseBanNotify) === "1",
  };
}

export async function validateAbusePatch(body: unknown): Promise<PatchResult<AbuseSettings>> {
  const b = (body ?? {}) as Record<string, unknown>;
  // merge onto the CURRENTLY SAVED values so a partial PUT never wipes fields
  const out: AbuseSettings = { ...(await getAbuseSettings()) };
  if (b.forceChannel !== undefined) {
    if (typeof b.forceChannel !== "string") {
      return { ok: false, fields: [{ field: "forceChannel", code: "format" }] };
    }
    const norm = normalizeForceChannel(b.forceChannel);
    if (norm && !TG_CHANNEL_RE.test(norm)) {
      // private invite links (t.me/+hash, joinchat) and malformed names are rejected honestly
      return { ok: false, fields: [{ field: "forceChannel", code: "format" }] };
    }
    out.forceChannel = norm;
  }
  if (b.banNotify !== undefined) {
    if (typeof b.banNotify !== "boolean") {
      return { ok: false, fields: [{ field: "banNotify", code: "format" }] };
    }
    out.banNotify = b.banNotify;
  }
  return { ok: true, data: out };
}

export async function saveAbuseSettings(s: AbuseSettings): Promise<void> {
  await writeSetting(K.abuseForceChannel, s.forceChannel);
  await writeSetting(K.abuseBanNotify, s.banNotify ? "1" : "0");
}

/* ---------- update channel (Task 3-c — own section) ----------
   Chooses which GitHub release line /api/system/update-check
   reports: "stable" = newest non-prerelease release, "beta" =
   newest release including prereleases. Single-key section so
   future update prefs can join without a schema migration. */

export type UpdateChannel = "stable" | "beta";

export interface UpdateSettings {
  channel: UpdateChannel;
}

const UPDATES_DEFAULT: UpdateSettings = { channel: "stable" };

export async function getUpdateSettings(): Promise<UpdateSettings> {
  const m = await readSettings([K.updChannel]);
  const raw = m.get(K.updChannel);
  return { channel: raw === "beta" ? "beta" : UPDATES_DEFAULT.channel };
}

export async function validateUpdatePatch(body: unknown): Promise<PatchResult<UpdateSettings>> {
  const b = (body ?? {}) as Record<string, unknown>;
  // merge onto the CURRENTLY SAVED values so a partial PUT never wipes fields
  const out: UpdateSettings = { ...(await getUpdateSettings()) };
  if (b.channel !== undefined) {
    if (b.channel !== "stable" && b.channel !== "beta") {
      return { ok: false, fields: [{ field: "channel", code: "format" }] };
    }
    out.channel = b.channel;
  }
  return { ok: true, data: out };
}

export async function saveUpdateSettings(s: UpdateSettings): Promise<void> {
  await writeSetting(K.updChannel, s.channel === "beta" ? "beta" : "stable");
}

/* ---------- recovery key ---------- */

const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function keyGroup(): string {
  const bytes = randomBytes(4);
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += KEY_ALPHABET[bytes[i]! % KEY_ALPHABET.length];
  }
  return out;
}

/** SEPH-XXXX-XXXX-XXXX (unambiguous alphabet, collision-checked by caller). */
export function genRecoveryKey(): string {
  return `SEPH-${keyGroup()}-${keyGroup()}-${keyGroup()}`;
}

/* ---------- helpers ---------- */

let cachedVersion: string | null = null;

/** Branded app version from package.json (cached; "2.0.0" fallback). */
export function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      version?: string;
    };
    cachedVersion = typeof pkg.version === "string" && pkg.version ? pkg.version : "2.0.0";
  } catch {
    cachedVersion = "2.0.0";
  }
  return cachedVersion;
}

function toInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}
