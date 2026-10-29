import { db } from "@/lib/db";
import { getDiscordSettings, getDiscordToken, appVersion, type BotLangCode } from "@/lib/settings";
import { botTexts, fmt, fmtGb } from "@/lib/bot/texts";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · v2.7 — Discord bot worker (server-only)

   A lean Discord gateway client on the global WebSocket
   (Node ≥22 / bun both ship one — zero new dependencies).
   Mirrors the Telegram sales-worker lifecycle contract:

   • startDiscordWorker / stopDiscordWorker / onDiscordSettingsSaved
   • getDiscordWorkerStatus → /api/discord/bot-status
   • relayDiscord(kind, html) → notify fan-out (called from
     notify.tgNotify so every panel event reaches Discord too)

   Commands (prefix-configurable, default "!"): help, status,
   users, user <query>, inbounds. Admin-only (adminUserIds).
   Intents: GUILD_MESSAGES + DIRECT_MESSAGES + MESSAGE_CONTENT.

   Never throws across the public surface — a dead Discord
   network must never break a panel route.
   ============================================================ */

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const REST_BASE = "https://discord.com/api/v10";
const GUILD_MESSAGES = 1 << 9;
const DIRECT_MESSAGES = 1 << 12;
const MESSAGE_CONTENT = 1 << 15;
const INTENTS = GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT;

export interface DiscordWorkerStatus {
  running: boolean;
  gateway: "idle" | "connecting" | "ready" | "reconnecting";
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastEventAt: string | null;
  handled: number;
  errors: number;
  lastError: string | null;
  generation: number;
}

interface Status {
  running: boolean;
  gateway: DiscordWorkerStatus["gateway"];
  startedAt: number | null;
  lastHeartbeatAt: number | null;
  lastEventAt: number | null;
  handled: number;
  errors: number;
  lastError: string | null;
  generation: number;
  stopRequested: boolean;
}

const status: Status = {
  running: false,
  gateway: "idle",
  startedAt: null,
  lastHeartbeatAt: null,
  lastEventAt: null,
  handled: 0,
  errors: 0,
  lastError: null,
  generation: 0,
  stopRequested: false,
};

export function getDiscordWorkerStatus(): DiscordWorkerStatus {
  return {
    running: status.running,
    gateway: status.gateway,
    startedAt: status.startedAt ? new Date(status.startedAt).toISOString() : null,
    lastHeartbeatAt: status.lastHeartbeatAt ? new Date(status.lastHeartbeatAt).toISOString() : null,
    lastEventAt: status.lastEventAt ? new Date(status.lastEventAt).toISOString() : null,
    handled: status.handled,
    errors: status.errors,
    lastError: status.lastError,
    generation: status.generation,
  };
}

/* ---------- REST helpers ---------- */

async function dcRest<T = unknown>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await fetch(`${REST_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bot ${token}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 429) {
      // honor one rate-limit retry (Discord sends retry_after in seconds)
      const rl = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.min(Math.ceil((rl.retry_after ?? 1) * 1000), 5_000);
      await new Promise((r) => setTimeout(r, wait));
      const retry = await fetch(`${REST_BASE}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bot ${token}`,
          ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(8_000),
      });
      const data = (await retry.json().catch(() => null)) as T | null;
      return { ok: retry.ok, status: retry.status, data };
    }
    const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    return {
      ok: res.ok,
      status: res.status,
      data: res.ok ? data : null,
      error: res.ok ? undefined : (data?.message ?? `HTTP ${res.status}`),
    };
  } catch (err) {
    const e = err as Error;
    return { ok: false, status: 0, data: null, error: e?.name === "TimeoutError" ? "timeout" : String(e?.message ?? e) };
  }
}

export async function dcSendMessage(token: string, channelId: string, content: string): Promise<boolean> {
  // Discord caps message length at 2000 chars — split politely
  const chunks = content.match(/[\s\S]{1,1900}(?!\s*\S)|[\s\S]{1,1900}/g) ?? [content];
  let okAll = true;
  for (const chunk of chunks) {
    const r = await dcRest(token, `/channels/${channelId}/messages`, {
      method: "POST",
      body: { content: chunk },
    });
    if (!r.ok) {
      okAll = false;
      status.errors++;
      status.lastError = r.error ?? "send_failed";
    }
  }
  return okAll;
}

export async function dcSendToAdmins(token: string, adminIds: string[], channelId: string, content: string): Promise<boolean> {
  if (channelId) return dcSendMessage(token, channelId, content);
  let ok = false;
  for (const userId of adminIds.slice(0, 4)) {
    const dm = await dcRest<{ id?: string }>(token, "/users/@me/channels", {
      method: "POST",
      body: { recipient_id: userId },
    });
    if (dm.ok && dm.data?.id) {
      ok = (await dcSendMessage(token, dm.data.id, content)) || ok;
    }
  }
  return ok;
}

/* ---------- notify relay (called from notify.tgNotify) ---------- */

/** Same per-kind minimum interval philosophy as the Telegram engine. */
const RELAY_MIN_INTERVAL_MS: Record<string, number> = {
  "user.created": 5_000,
  "user.deleted": 5_000,
  "user.updated": 5_000,
  "user.expired": 30_000,
  "user.near-expiry": 20 * 3_600_000,
  "user.quota": 30_000,
  "user.traffic-reset": 30_000,
  "user.activated": 30_000,
  "user.renewed": 30_000,
  "login.failed": 10 * 60_000,
  "sales.digest": 60_000,
  "backup.done": 60_000,
  "panel.restart": 0,
  "inbound.created": 5_000,
  "inbound.deleted": 5_000,
};

/** Which Telegram notify toggle also gates this kind (same semantics). */
const RELAY_TOGGLES: Record<string, "userCreated" | "userExpired" | "trafficAlert" | "loginAlert" | "dailyDigest"> = {
  "user.created": "userCreated",
  "user.deleted": "userCreated",
  "user.updated": "userCreated",
  "user.traffic-reset": "trafficAlert",
  "user.expired": "userExpired",
  "user.near-expiry": "userExpired",
  "user.quota": "userExpired",
  "user.activated": "userExpired",
  "user.renewed": "userExpired",
  "login.failed": "loginAlert",
  "sales.digest": "dailyDigest",
};

const lastRelay = new Map<string, number>();

function relayDedupe(kind: string, entity: string): boolean {
  const key = `${kind}:${entity}`;
  const min = RELAY_MIN_INTERVAL_MS[kind] ?? 5_000;
  const now = Date.now();
  const prev = lastRelay.get(key) ?? 0;
  if (now - prev < min) return false;
  lastRelay.set(key, now);
  if (lastRelay.size > 500) {
    for (const [k, t] of lastRelay) {
      if (now - t > 10 * 60_000) lastRelay.delete(k);
    }
  }
  return true;
}

/** Fire-and-forget: one panel event → announce channel (or admin DMs). */
export async function relayDiscord(kind: string, htmlText: string, opts?: { dedupeKey?: string }): Promise<boolean> {
  try {
    const dc = await getDiscordSettings();
    if (!dc.enabled) return false;
    const token = await getDiscordToken();
    if (!token) return false;
    if (!relayDedupe(kind, opts?.dedupeKey ?? "*")) return false;
    // compose in the bot language (same catalogue as Telegram)
    const l = dc.botLang;
    const t = botTexts(l);
    const head = "🛰 **Sephiroth**";
    // reuse the Telegram-composed body (strip HTML tags → Discord markdown-safe)
    const body = htmlText
      .split("\n")
      .slice(1)
      .join("\n")
      .replace(/<b>|<\/b>/g, "**")
      .replace(/<[^>]+>/g, "")
      .trim();
    const text = `${head}\n${body}`;
    void t;
    return await dcSendToAdmins(token, dc.adminUserIds, dc.announceChannelId, text);
  } catch {
    return false;
  }
}

/* ---------- command surface ---------- */

interface DcMessage {
  author?: { id?: string; username?: string; bot?: boolean };
  content?: string;
  channel_id?: string;
  guild_id?: string;
}

async function buildStatusReply(lang: BotLangCode): Promise<string> {
  const t = botTexts(lang);
  try {
    const [users, inbounds] = await Promise.all([
      db.clientUser.findMany({ select: { enabled: true, usedTrafficGb: true } }),
      db.inbound.findMany({ select: { status: true } }),
    ]);
    const enabled = users.filter((u) => u.enabled).length;
    const online = inbounds.filter((i) => i.status === "online").length;
    const gb = users.reduce((acc, u) => acc + (Number(u.usedTrafficGb) || 0), 0);
    const upMin = Math.floor(process.uptime() / 60);
    const up = upMin >= 60 ? `${Math.floor(upMin / 60)}h ${upMin % 60}m` : `${upMin}m`;
    return [
      `🛰 **Sephiroth · v${appVersion()}**`,
      fmt(t.stUptime, { up }),
      fmt(t.stInbounds, { online: String(online), total: String(inbounds.length) }),
      fmt(t.stUsers, { enabled: String(enabled), total: String(users.length) }),
      fmt(t.stTraffic, { gb: (Math.round(gb * 10) / 10).toLocaleString("en-US") }),
    ].join("\n");
  } catch {
    return `🛰 Sephiroth v${appVersion()}`;
  }
}

async function handleCommand(
  token: string,
  lang: BotLangCode,
  isAdmin: boolean,
  channelId: string,
  raw: string
): Promise<void> {
  const t = botTexts(lang);
  // bot texts carry Telegram HTML entities — decode for Discord
  const dec = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/<\/?code>/g, "`");
  const args = raw.trim().split(/\s+/);
  const cmd = (args.shift() ?? "").toLowerCase();
  const reply = async (text: string) => {
    await dcSendMessage(token, channelId, text);
  };
  status.handled++;
  if (!isAdmin) {
    await reply(dec(t.notAuthorized));
    return;
  }
  switch (cmd) {
    case "help":
    case "start":
      await reply(`🛰 **Sephiroth** · v${appVersion()}\n\`\`\`\nstatus · users · user <query> · inbounds\n\`\`\``);
      return;
    case "status": {
      await reply(await buildStatusReply(lang));
      return;
    }
    case "users": {
      const users = await db.clientUser.findMany({
        orderBy: { usedTrafficGb: "desc" },
        take: 10,
        select: { username: true, usedTrafficGb: true, enabled: true },
      });
      await reply(
        `👥 ${t.stUsers} (top ${users.length})\n` +
          users
            .map((u, i) => `${i + 1}. ${u.enabled ? "🟢" : "🔴"} ${u.username} — ${fmtGb(Number(u.usedTrafficGb) || 0)}`)
            .join("\n")
      );
      return;
    }
    case "user": {
      const q = (args[0] ?? "").toLowerCase();
      if (!q) {
        await reply(dec(t.userQueryHint));
        return;
      }
      const u = await db.clientUser.findFirst({
        where: {
          OR: [{ username: q }, { subId: q }, { note: { contains: q } }],
        },
        select: {
          username: true,
          enabled: true,
          trafficLimitGb: true,
          expiryDays: true,
          usedTrafficGb: true,
          ipLimit: true,
        },
      });
      if (!u) {
        await reply(dec(t.userNotFound));
        return;
      }
      await reply(
        [
          `👤 **${u.username}** ${u.enabled ? "🟢" : "🔴"}`,
          `📊 ${fmtGb(Number(u.usedTrafficGb) || 0)} / ${fmtGb(u.trafficLimitGb)}`,
          `📅 Expiry: ${u.expiryDays === null ? "∞" : `${u.expiryDays}d`}`,
          `📶 IP limit: ${u.ipLimit || "∞"}`,
        ].join("\n")
      );
      return;
    }
    case "inbounds": {
      const rows = await db.inbound.findMany({
        select: { tag: true, protocol: true, port: true, status: true },
        take: 15,
      });
      await reply(
        `📡 ${t.stInbounds}\n` +
          rows.map((i) => `${i.status === "online" ? "🟢" : i.status === "maintenance" ? "🟡" : "🔴"} ${i.tag} · ${i.protocol} : ${i.port}`).join("\n")
      );
      return;
    }
    default:
      await reply(dec(t.notAuthorized));
  }
}

/* ---------- gateway ---------- */

interface GwPacket {
  op: number;
  t?: string | null;
  s?: number | null;
  d?: Record<string, unknown>;
}

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastSeq: number | null = null;
let sessionId: string | null = null;

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function runGateway(token: string): Promise<void> {
  status.gateway = "connecting";
  try {
    ws = new WebSocket(GATEWAY_URL);
  } catch (err) {
    status.errors++;
    status.lastError = String((err as Error)?.message ?? err);
    scheduleReconnect(token);
    return;
  }
  let identified = false;

  ws.addEventListener("message", (ev) => {
    let pkt: GwPacket;
    try {
      pkt = JSON.parse(String(ev.data)) as GwPacket;
    } catch {
      return;
    }
    if (typeof pkt.s === "number") lastSeq = pkt.s;
    switch (pkt.op) {
      case 10: {
        // HELLO — start heartbeats then IDENTIFY (fresh) or RESUME
        const interval = Number((pkt.d?.heartbeat_interval as number) ?? 41_250);
        clearHeartbeat();
        heartbeatTimer = setInterval(() => {
          try {
            ws?.send(JSON.stringify({ op: 1, d: lastSeq }));
            status.lastHeartbeatAt = Date.now();
          } catch {
            /* socket dying — reconnect handles it */
          }
        }, Math.max(5_000, interval * 0.8));
        const identify = sessionId
          ? { op: 6, d: { token, session_id: sessionId, seq: lastSeq } }
          : {
              op: 2,
              d: {
                token,
                intents: INTENTS,
                properties: { os: "linux", browser: "sephiroth", device: "sephiroth" },
              },
            };
        ws?.send(JSON.stringify(identify));
        identified = !sessionId;
        status.gateway = sessionId ? "connecting" : "connecting";
        return;
      }
      case 9: {
        // INVALID_SESSION — drop the session and re-identify
        sessionId = null;
        try {
          ws?.send(JSON.stringify({ op: 2, d: { token, intents: INTENTS, properties: { os: "linux", browser: "sephiroth", device: "sephiroth" } } }));
          identified = true;
        } catch {
          /* reconnect handles */
        }
        return;
      }
      case 7:
      case 11:
        // RECONNECT request / heartbeat ACK — nothing to do (ACK keeps us alive)
        return;
      case 0:
        status.lastEventAt = Date.now();
        if (pkt.t === "READY") {
          identified = true;
          sessionId = String(pkt.d?.session_id ?? "") || null;
          status.gateway = "ready";
          status.running = true;
          return;
        }
        if (pkt.t === "MESSAGE_CREATE" && identified) {
          const msg = pkt.d as DcMessage;
          void handleMessageCreate(token, msg);
        }
        return;
      default:
        return;
    }
  });

  ws.addEventListener("close", () => {
    clearHeartbeat();
    if (status.stopRequested) {
      status.running = false;
      status.gateway = "idle";
      return;
    }
    status.errors++;
    status.lastError = "gateway_closed";
    scheduleReconnect(token);
  });

  ws.addEventListener("error", () => {
    status.errors++;
    status.lastError = "gateway_error";
  });
  void identified;
}

function scheduleReconnect(token: string) {
  status.running = false;
  status.gateway = "reconnecting";
  if (status.stopRequested || reconnectTimer) return;
  reconnectTimer = setTimeout(
    () => {
      reconnectTimer = null;
      if (!status.stopRequested) void runGateway(token);
    },
    5_000
  );
}

async function handleMessageCreate(token: string, msg: DcMessage): Promise<void> {
  try {
    const content = String(msg.content ?? "").trim();
    if (!content || msg.author?.bot) return;
    const dc = await getDiscordSettings();
    const prefix = dc.prefix || "!";
    if (!content.startsWith(prefix)) return;
    const raw = content.slice(prefix.length);
    const isAdmin = Boolean(msg.author?.id && dc.adminUserIds.includes(msg.author.id));
    status.lastEventAt = Date.now();
    await handleCommand(token, dc.botLang, isAdmin, String(msg.channel_id ?? ""), raw);
  } catch (err) {
    status.errors++;
    status.lastError = String((err as Error)?.message ?? err).slice(0, 200);
  }
}

/* ---------- lifecycle ---------- */

export async function startDiscordWorker(): Promise<boolean> {
  const dc = await getDiscordSettings();
  if (!dc.enabled) return false;
  const token = await getDiscordToken();
  if (!token) return false;
  if (status.running || status.gateway === "connecting" || status.gateway === "reconnecting") {
    return true; // already up
  }
  status.stopRequested = false;
  status.startedAt = Date.now();
  status.generation++;
  sessionId = null;
  lastSeq = null;
  await logActivity({
    kind: "settings.updated",
    level: "info",
    actor: "discord-bot",
    message: "Discord bot worker starting (gateway connect)",
    meta: { section: "discord" },
  });
  void runGateway(token);
  return true;
}

export async function stopDiscordWorker(): Promise<void> {
  status.stopRequested = true;
  clearHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    ws?.close();
  } catch {
    /* already closed */
  }
  ws = null;
  sessionId = null;
  status.running = false;
  status.gateway = "idle";
}

/** Called after every save of the discord settings section. */
export async function onDiscordSettingsSaved(): Promise<void> {
  await stopDiscordWorker();
  await startDiscordWorker();
}

export async function discordWorkerBoot(): Promise<void> {
  try {
    await startDiscordWorker();
  } catch (err) {
    console.warn("[discord:boot]", err);
  }
}

export async function discordWorkerShutdown(): Promise<void> {
  await stopDiscordWorker();
}
