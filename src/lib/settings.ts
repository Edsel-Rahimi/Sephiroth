import { randomBytes } from "crypto";
import { db } from "@/lib/db";

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
  tgEnabled: "set_tg_enabled",
  tgToken: "set_tg_token",
  tgChatId: "set_tg_chat_id",
  tgNotify: "set_tg_notify",
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
  ]);
  const driver = m.get(K.coreDriver);
  return {
    driver: driver === "xray" ? "xray" : CORE_DEFAULT.driver,
    apiHost: m.get(K.coreHost) ?? CORE_DEFAULT.apiHost,
    apiPort: toInt(m.get(K.corePort), CORE_DEFAULT.apiPort, 1, 65535),
    tickSeconds: toInt(m.get(K.coreTick), CORE_DEFAULT.tickSeconds, 1, 5),
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

export function validateCorePatch(body: unknown): PatchResult<CoreSettings> {
  const b = (body ?? {}) as Record<string, unknown>;
  const current = CORE_DEFAULT; // route always merges onto saved values
  const out: CoreSettings = { ...current };

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
  return { ok: true, data: out };
}

export async function saveCoreSettings(s: CoreSettings): Promise<void> {
  await Promise.all([
    writeSetting(K.coreDriver, s.driver),
    writeSetting(K.coreHost, s.apiHost),
    writeSetting(K.corePort, String(s.apiPort)),
    writeSetting(K.coreTick, String(s.tickSeconds)),
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

function toInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}
