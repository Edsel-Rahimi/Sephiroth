import { ProxyAgent, fetch as undiciFetch } from "undici";

/* ============================================================
   Sephiroth · Task 23-c — Telegram Bot API helper (server-only)

   Small typed wrapper around the Telegram Bot API used by the
   sales worker. Design rules:
   • The bot token NEVER appears in a log line — errors surface
     only method names + HTTP status / Telegram descriptions.
   • Optional HTTPS proxy via `botProxyUrl`: requests go through
     an undici ProxyAgent dispatcher. Phase 1 supports HTTPS
     proxies only; SOCKS5 users should run a local https-forward
     (documented in the settings UI hint).
   • SEPH_TG_API_BASE overrides https://api.telegram.org — used
     by the mock-E2E acceptance harness (no other purpose).
   ============================================================ */

const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;

/** Runtime override (23-a): the botApiBase SETTING wins over the env fallback. */
let apiBaseOverride = "";

/** Called by the worker when settings load/change (and by tests). */
export function setTgApiBase(base: string): void {
  apiBaseOverride = base.trim().replace(/\/+$/, "");
}

/** Base URL for the Bot API (setting > env > https://api.telegram.org). */
export function tgApiBase(): string {
  return (apiBaseOverride || env.SEPH_TG_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
}

const agentCache = new Map<string, ProxyAgent>();

/** Cached undici dispatcher for an HTTPS proxy URL. */
function proxyDispatcher(proxyUrl: string): ProxyAgent | undefined {
  const url = proxyUrl.trim();
  if (!url) return undefined;
  let agent = agentCache.get(url);
  if (!agent) {
    agent = new ProxyAgent(url);
    agentCache.set(url, agent);
  }
  return agent;
}

export class TgApiError extends Error {
  status: number;
  description: string;
  constructor(status: number, description: string) {
    super(`telegram ${status}: ${description}`);
    this.name = "TgApiError";
    this.status = status;
    this.description = description;
  }
}

/** Raw Bot API call (JSON POST). Never logs the token. */
export async function tgCall<T = any>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
  opts?: { proxyUrl?: string; timeoutMs?: number }
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const url = `${tgApiBase()}/bot${token}/${method}`;
  const dispatcher = proxyDispatcher(opts?.proxyUrl ?? "");
  const init: Record<string, unknown> = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (dispatcher) init.dispatcher = dispatcher;
  const res = await (dispatcher
    ? undiciFetch(url, init as Parameters<typeof undiciFetch>[1])
    : fetch(url, init as RequestInit));
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: T };
  if (!res.ok || !data.ok) {
    throw new TgApiError(res.status, data.description || `HTTP ${res.status}`);
  }
  return data.result as T;
}

/** Multipart Bot API call (sendDocument with a real file attachment). */
export async function tgCallMultipart<T = any>(
  token: string,
  method: string,
  form: FormData,
  opts?: { proxyUrl?: string; timeoutMs?: number }
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const url = `${tgApiBase()}/bot${token}/${method}`;
  const dispatcher = proxyDispatcher(opts?.proxyUrl ?? "");
  const init: Record<string, unknown> = {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (dispatcher) init.dispatcher = dispatcher;
  const res = await (dispatcher
    ? undiciFetch(url, init as Parameters<typeof undiciFetch>[1])
    : fetch(url, init as RequestInit));
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: T };
  if (!res.ok || !data.ok) {
    throw new TgApiError(res.status, data.description || `HTTP ${res.status}`);
  }
  return data.result as T;
}

/* ---------- typed conveniences (all safe to fire-and-forget) ---------- */

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  keyboard?: InlineKeyboard,
  opts?: { proxyUrl?: string }
): Promise<any> {
  return tgCall(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  }, opts);
}

export async function sendPhoto(
  token: string,
  chatId: string,
  photoFileId: string,
  caption?: string,
  keyboard?: InlineKeyboard,
  opts?: { proxyUrl?: string }
): Promise<any> {
  return tgCall(token, "sendPhoto", {
    chat_id: chatId,
    photo: photoFileId,
    ...(caption ? { caption, parse_mode: "HTML" } : {}),
    ...(keyboard ? { reply_markup: keyboard } : {}),
  }, opts);
}

export async function sendChatAction(
  token: string,
  chatId: string,
  action = "typing",
  opts?: { proxyUrl?: string }
): Promise<any> {
  return tgCall(token, "sendChatAction", { chat_id: chatId, action }, opts);
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  opts?: { proxyUrl?: string }
): Promise<any> {
  return tgCall(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  }, opts);
}

export async function editMessageText(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
  opts?: { proxyUrl?: string }
): Promise<any> {
  return tgCall(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  }, opts);
}

/** Send a JSON document (admin /backup_now parity with the console route). */
export async function sendDocument(
  token: string,
  chatId: string,
  filename: string,
  content: string,
  caption?: string,
  opts?: { proxyUrl?: string }
): Promise<any> {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([content], { type: "application/json" }), filename);
  return tgCallMultipart(token, "sendDocument", form, opts);
}
