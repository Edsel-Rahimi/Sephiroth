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
}

export interface TelegramNotify {
  userCreated: boolean;
  userExpired: boolean;
  trafficAlert: boolean;
  loginAlert: boolean;
}

export interface TelegramSettings {
  enabled: boolean;
  chatId: string;
  tokenConfigured: boolean;
  tokenMasked: string;
  notify: TelegramNotify;
}

const CORE_DEFAULT: CoreSettings = {
  driver: "simulator",
  apiHost: "127.0.0.1",
  apiPort: 10085,
  tickSeconds: 1,
  xrayBin: "",
  xrayVersion: "",
  statsInterval: 10,
};

const NOTIFY_DEFAULT: TelegramNotify = {
  userCreated: true,
  userExpired: true,
  trafficAlert: true,
  loginAlert: false,
};

const K = {
  coreDriver: "set_core_driver",
  coreHost: "set_core_api_host",
  corePort: "set_core_api_port",
  coreTick: "set_core_tick_seconds",
  coreXrayBin: "set_core_xray_bin",
  coreXrayVersion: "set_core_xray_version",
  coreStatsInterval: "set_core_stats_interval",
  tgEnabled: "set_tg_enabled",
  tgToken: "set_tg_token",
  tgChatId: "set_tg_chat_id",
  tgNotify: "set_tg_notify",
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
  // internal bookkeeping (never exposed via the settings API)
  autoBackupLast: "set_auto_backup_last",
  autoBackupLastSize: "set_auto_backup_last_size",
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
  const m = await readSettings([K.tgEnabled, K.tgToken, K.tgChatId, K.tgNotify]);
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
      };
    } catch {
      /* keep defaults */
    }
  }
  return {
    enabled: m.get(K.tgEnabled) === "1",
    chatId: m.get(K.tgChatId) ?? "",
    tokenConfigured: token.length > 0,
    tokenMasked: token ? maskBotToken(token) : "",
    notify,
  };
}

export async function getTelegramToken(): Promise<string> {
  const m = await readSettings([K.tgToken]);
  return m.get(K.tgToken) ?? "";
}

export function validateTelegramPatch(
  body: unknown
): PatchResult<{
  enabled: boolean;
  chatId: string;
  token: string | null | undefined; // undefined = keep, null = clear, string = replace
  notify: TelegramNotify;
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

  return {
    ok: true,
    data: {
      enabled: b.enabled === undefined ? true : Boolean(b.enabled),
      chatId,
      token,
      notify,
    },
  };
}

export async function saveTelegramSettings(patch: {
  enabled: boolean;
  chatId: string;
  token: string | null | undefined;
  notify: TelegramNotify;
}): Promise<void> {
  await writeSetting(K.tgEnabled, patch.enabled ? "1" : "0");
  await writeSetting(K.tgChatId, patch.chatId);
  if (patch.token === null) {
    await deleteSetting(K.tgToken);
  } else if (patch.token !== undefined) {
    await writeSetting(K.tgToken, patch.token);
  }
  await writeSetting(K.tgNotify, JSON.stringify(patch.notify));
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
}

const GENERAL_DEFAULT: GeneralSettings = {
  datepicker: "gregorian",
  pageSize: 25,
  publicHost: "",
  subSupportUrl: "",
};

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const m = await readSettings([K.datepicker, K.pageSize, K.publicHost, K.subSupportUrl]);
  return {
    datepicker: m.get(K.datepicker) === "jalalian" ? "jalalian" : "gregorian",
    pageSize: toInt(m.get(K.pageSize), GENERAL_DEFAULT.pageSize, 10, 100),
    publicHost: m.get(K.publicHost) ?? GENERAL_DEFAULT.publicHost,
    subSupportUrl: m.get(K.subSupportUrl) ?? GENERAL_DEFAULT.subSupportUrl,
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
  return { ok: true, data: out };
}

export async function saveGeneralSettings(g: GeneralSettings): Promise<void> {
  await writeSetting(K.datepicker, g.datepicker);
  await writeSetting(K.pageSize, String(g.pageSize));
  await writeSetting(K.publicHost, g.publicHost);
  await writeSetting(K.subSupportUrl, g.subSupportUrl);
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
};

export async function getExpertSettings(): Promise<ExpertSettings> {
  const m = await readSettings([
    K.xrayLogLevel, K.xrayDnsServers, K.xrayDomainStrategy, K.xrayFreedomStrategy,
    K.xrayConnIdle, K.xrayBufferSize, K.xrayRawJson, K.certFile, K.keyFile, K.sessionMaxAge,
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
