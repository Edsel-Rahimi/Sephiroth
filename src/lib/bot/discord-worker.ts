import { db } from "@/lib/db";
import { getDiscordSettings, getDiscordToken, appVersion, type BotLangCode } from "@/lib/settings";
import { botTexts, fmt, fmtGb } from "@/lib/bot/texts";
import { syncUserProjection, stripUserEverywhere } from "@/lib/user-sync";
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
   users, user <query>, inbounds — ALSO exposed as native global
   slash commands (idempotent PUT on every READY; the application
   id is derived from the bot token itself). /user answers with a
   rich embed + admin BUTTON components (enable/disable · reset
   traffic · delete with a two-button confirm) whose actions mirror
   the panel PATCH/DELETE semantics. Admin-only (adminUserIds) —
   enforced on every command AND every button interaction.
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
  commandsRegistered: number;
  lastInteractionAt: string | null;
  interactions: number;
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
  commandsRegistered: number;
  lastInteractionAt: number | null;
  interactions: number;
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
  commandsRegistered: 0,
  lastInteractionAt: null,
  interactions: 0,
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
    commandsRegistered: status.commandsRegistered,
    lastInteractionAt: status.lastInteractionAt
      ? new Date(status.lastInteractionAt).toISOString()
      : null,
    interactions: status.interactions,
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

/* ---------- global slash commands (v2.8) ---------- */

/** Rich-embed palette: violet = info, green = active, amber = inactive, red = destructive. */
const EMBED_INFO = 0x8b5cf6;
const EMBED_OK = 0x22c55e;
const EMBED_WARN = 0xf59e0b;
const EMBED_ERR = 0xef4444;

interface DcEmbed {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
}

interface DcButton {
  type: 2;
  style: 1 | 2 | 3 | 4; // primary / secondary / success / danger
  label: string;
  custom_id: string;
}

interface DcActionRow {
  type: 1;
  components: DcButton[];
}

/** The same 5 commands as the prefix surface; `user` carries one required string option. */
const SLASH_COMMANDS = [
  { name: "status", description: "Panel status — uptime, inbounds, users, traffic" },
  { name: "users", description: "Top 10 users by consumed traffic" },
  {
    name: "user",
    description: "Find a user and get admin control buttons",
    options: [
      {
        name: "query",
        description: "Username, subscription id or note fragment",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  { name: "inbounds", description: "List inbounds with their live status" },
  { name: "help", description: "Show the Sephiroth command list" },
];

/**
 * Discord bot tokens embed the application id as their first
 * dot-segment (`appId.timestamp.hmac`). Most write-ups show it raw;
 * live tokens base64-encode it. Accept either — but ONLY a strictly
 * numeric result in the snowflake range, otherwise null (guarded).
 */
function appIdFromToken(token: string): string | null {
  const seg = token.split(".")[0] ?? "";
  if (/^\d{15,21}$/.test(seg)) return seg;
  try {
    const decoded = Buffer.from(seg, "base64").toString("utf8").trim();
    if (/^\d{15,21}$/.test(decoded)) return decoded;
  } catch {
    /* not base64 either */
  }
  return null;
}

/** Idempotent global command registration — a full-set PUT, safe to re-run on every READY. */
async function registerSlashCommands(token: string): Promise<void> {
  try {
    const appId = appIdFromToken(token);
    if (!appId) {
      status.errors++;
      status.lastError = "slash_register: cannot derive application id from token";
      return;
    }
    const r = await dcRest<Array<{ id: string }>>(token, `/applications/${appId}/commands`, {
      method: "PUT",
      body: SLASH_COMMANDS,
    });
    if (r.ok && Array.isArray(r.data)) {
      status.commandsRegistered = r.data.length;
      return;
    }
    status.errors++;
    status.lastError = `slash_register: ${r.error ?? `HTTP ${r.status}`}`;
  } catch (err) {
    status.errors++;
    status.lastError = String((err as Error)?.message ?? err).slice(0, 200);
  }
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

/** Bot texts carry Telegram HTML entities — decode for Discord markdown. */
function dcDecode(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/<\/?code>/g, "`");
}

async function handleCommand(
  token: string,
  lang: BotLangCode,
  isAdmin: boolean,
  channelId: string,
  raw: string
): Promise<void> {
  const t = botTexts(lang);
  const dec = dcDecode;
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

/* ---------- interactions (slash commands + buttons, v2.8) ---------- */

interface DcInteraction {
  id?: string;
  token?: string; // interaction token (distinct from the bot token)
  application_id?: string;
  type?: number; // 2 = application command, 3 = message component
  user?: { id?: string };
  member?: { user?: { id?: string } };
  channel_id?: string;
  guild_id?: string;
  data?: {
    name?: string;
    custom_id?: string;
    options?: Array<{ name?: string; value?: unknown }>;
  };
}

/** Guild members arrive as member.user; DMs as user. */
function itxActorId(itx: DcInteraction): string {
  return String(itx.user?.id ?? itx.member?.user?.id ?? "");
}

async function dcRespondInteraction(
  token: string,
  itxId: string,
  itxToken: string,
  body: Record<string, unknown>
): Promise<boolean> {
  const r = await dcRest(token, `/interactions/${itxId}/${itxToken}/callback`, {
    method: "POST",
    body,
  });
  if (!r.ok) {
    status.errors++;
    status.lastError = r.error ?? "interaction_callback_failed";
    return false;
  }
  return true;
}

/** Edits the message a component sits on — the interaction-token webhook "@original". */
async function dcEditInteractionMessage(
  token: string,
  appId: string,
  itxToken: string,
  body: Record<string, unknown>
): Promise<boolean> {
  if (!appId || !itxToken) return false;
  const r = await dcRest(token, `/webhooks/${appId}/${itxToken}/messages/@original`, {
    method: "PATCH",
    body,
  });
  if (!r.ok) {
    status.errors++;
    status.lastError = r.error ?? "interaction_edit_failed";
    return false;
  }
  return true;
}

/** Rich card for /user and after every button action (same lines as the prefix command). */
function userCardEmbed(
  u: {
    username: string;
    enabled: boolean;
    usedTrafficGb: unknown;
    trafficLimitGb: number | null;
    expiryDays: number | null;
    ipLimit: number;
  },
  color: number
): DcEmbed {
  return {
    title: `👤 ${u.username} ${u.enabled ? "🟢" : "🔴"}`,
    description: [
      `📊 ${fmtGb(Number(u.usedTrafficGb) || 0)} / ${fmtGb(u.trafficLimitGb)}`,
      `📅 Expiry: ${u.expiryDays === null ? "∞" : `${u.expiryDays}d`}`,
      `📶 IP limit: ${u.ipLimit || "∞"}`,
    ].join("\n"),
    color,
    footer: { text: `Sephiroth · v${appVersion()}` },
  };
}

/** Toggle button mirrors the Telegram card: the label shows the NEXT action. */
function userActionRow(u: { id: string; enabled: boolean }, t: ReturnType<typeof botTexts>): DcActionRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: u.enabled ? 4 : 3,
        label: u.enabled ? t.btnDisable : t.btnEnable,
        custom_id: `dcu${u.enabled ? "sdis" : "seen"}:${u.id}`,
      },
      { type: 2, style: 2, label: t.btnReset, custom_id: `dcusreset:${u.id}` },
      { type: 2, style: 4, label: "🗑 Delete", custom_id: `dcudel:${u.id}` },
    ],
  };
}

function deleteConfirmRow(userId: string): DcActionRow {
  return {
    type: 1,
    components: [
      { type: 2, style: 4, label: "✅ Confirm delete", custom_id: `dcudely:${userId}` },
      { type: 2, style: 2, label: "Cancel", custom_id: `dccancel:${userId}` },
    ],
  };
}

async function handleInteraction(token: string, itx: DcInteraction): Promise<void> {
  try {
    const itxId = String(itx.id ?? "");
    const itxToken = String(itx.token ?? "");
    if (!itxId || !itxToken) return;
    status.lastInteractionAt = Date.now();
    status.interactions++;
    const type = Number(itx.type ?? 0);
    if (type === 2) {
      await handleCommandInteraction(token, itx, itxId, itxToken);
    } else if (type === 3) {
      await handleComponentInteraction(token, itx, itxId, itxToken);
    }
  } catch (err) {
    status.errors++;
    status.lastError = String((err as Error)?.message ?? err).slice(0, 200);
  }
}

/** type 2 — same logic as the prefix commands, answered as rich embeds (errors ephemeral). */
async function handleCommandInteraction(
  token: string,
  itx: DcInteraction,
  itxId: string,
  itxToken: string
): Promise<void> {
  const dc = await getDiscordSettings();
  const lang = dc.botLang;
  const t = botTexts(lang);
  status.handled++;

  // same guard style as the prefix commands — admin allow-list only
  if (!dc.adminUserIds.includes(itxActorId(itx))) {
    await dcRespondInteraction(token, itxId, itxToken, {
      type: 4,
      data: { content: dcDecode(t.notAuthorized), flags: 64 },
    });
    return;
  }

  const ephemeralErr = (description: string): Record<string, unknown> => ({
    type: 4,
    data: { embeds: [{ color: EMBED_ERR, description } as DcEmbed], flags: 64 },
  });
  const name = String(itx.data?.name ?? "").toLowerCase();

  switch (name) {
    case "help":
    case "start": {
      await dcRespondInteraction(token, itxId, itxToken, {
        type: 4,
        data: {
          embeds: [
            {
              title: `🛰 Sephiroth · v${appVersion()}`,
              description:
                "Slash: `/status` · `/users` · `/user <query>` · `/inbounds` · `/help`\n" +
                "Prefix: `!status` · `!users` · `!user <name>` · `!inbounds` · `!help`\n\n" +
                "User cards carry admin buttons: enable/disable · reset traffic · delete (with confirm).",
              color: EMBED_INFO,
            } as DcEmbed,
          ],
        },
      });
      return;
    }
    case "status": {
      await dcRespondInteraction(token, itxId, itxToken, {
        type: 4,
        data: {
          embeds: [
            { title: "🛰 Sephiroth · Status", description: await buildStatusReply(lang), color: EMBED_INFO } as DcEmbed,
          ],
        },
      });
      return;
    }
    case "users": {
      const users = await db.clientUser.findMany({
        orderBy: { usedTrafficGb: "desc" },
        take: 10,
        select: { username: true, usedTrafficGb: true, enabled: true },
      });
      await dcRespondInteraction(token, itxId, itxToken, {
        type: 4,
        data: {
          embeds: [
            {
              title: `👥 Top users (${users.length})`,
              description:
                users
                  .map(
                    (u, i) =>
                      `${i + 1}. ${u.enabled ? "🟢" : "🔴"} **${u.username}** — ${fmtGb(Number(u.usedTrafficGb) || 0)}`
                  )
                  .join("\n") || "No users yet.",
              color: EMBED_INFO,
            } as DcEmbed,
          ],
        },
      });
      return;
    }
    case "user": {
      const q = String(
        itx.data?.options?.find((o) => o.name === "query")?.value ?? ""
      )
        .trim()
        .toLowerCase();
      if (!q) {
        await dcRespondInteraction(token, itxId, itxToken, ephemeralErr(dcDecode(t.userQueryHint)));
        return;
      }
      const u = await db.clientUser.findFirst({
        where: { OR: [{ username: q }, { subId: q }, { note: { contains: q } }] },
      });
      if (!u) {
        await dcRespondInteraction(token, itxId, itxToken, ephemeralErr(dcDecode(t.userNotFound)));
        return;
      }
      await dcRespondInteraction(token, itxId, itxToken, {
        type: 4,
        data: {
          embeds: [userCardEmbed(u, u.enabled ? EMBED_OK : EMBED_WARN)],
          components: [userActionRow(u, t)],
        },
      });
      return;
    }
    case "inbounds": {
      const rows = await db.inbound.findMany({
        select: { tag: true, protocol: true, port: true, status: true },
        take: 15,
      });
      await dcRespondInteraction(token, itxId, itxToken, {
        type: 4,
        data: {
          embeds: [
            {
              title: `📡 Inbounds (${rows.length})`,
              description:
                rows
                  .map(
                    (i) =>
                      `${i.status === "online" ? "🟢" : i.status === "maintenance" ? "🟡" : "🔴"} **${i.tag}** · ${i.protocol} : ${i.port}`
                  )
                  .join("\n") || "No inbounds yet.",
              color: EMBED_INFO,
            } as DcEmbed,
          ],
        },
      });
      return;
    }
    default:
      await dcRespondInteraction(token, itxId, itxToken, ephemeralErr("Unknown command."));
  }
}

/**
 * type 3 — button components. Admin allow-list is enforced on EVERY
 * interaction (custom_ids are forgeable, so the gate never trusts the
 * payload). Actions mirror the panel PATCH/DELETE semantics exactly.
 */
async function handleComponentInteraction(
  token: string,
  itx: DcInteraction,
  itxId: string,
  itxToken: string
): Promise<void> {
  const dc = await getDiscordSettings();
  const t = botTexts(dc.botLang);
  const appId = String(itx.application_id ?? "") || appIdFromToken(token) || "";
  const customId = String(itx.data?.custom_id ?? "");
  const sep = customId.indexOf(":");
  const action = (sep === -1 ? customId : customId.slice(0, sep)).trim();
  const userId = sep === -1 ? "" : customId.slice(sep + 1).trim();

  // decorative button — bare ack, nothing visible
  if (action === "dcnoop") {
    await dcRespondInteraction(token, itxId, itxToken, { type: 6 });
    return;
  }

  if (!dc.adminUserIds.includes(itxActorId(itx))) {
    await dcRespondInteraction(token, itxId, itxToken, {
      type: 4,
      data: { content: dcDecode(t.notAuthorized), flags: 64 },
    });
    return;
  }

  if (action === "dccancel") {
    // restore the normal card (drops the confirm row) + ephemeral ack
    const u = await db.clientUser.findUnique({ where: { id: userId } });
    await dcRespondInteraction(token, itxId, itxToken, {
      type: 4,
      data: { content: "✖️ Cancelled — nothing changed.", flags: 64 },
    });
    if (u) {
      await dcEditInteractionMessage(token, appId, itxToken, {
        embeds: [userCardEmbed(u, u.enabled ? EMBED_OK : EMBED_WARN)],
        components: [userActionRow(u, t)],
      }).catch(() => {});
    }
    return;
  }

  const ACTIONS = new Set(["dcuseen", "dcusdis", "dcusreset", "dcudel", "dcudely"]);
  if (!ACTIONS.has(action) || !userId) {
    await dcRespondInteraction(token, itxId, itxToken, { type: 6 });
    return;
  }

  // delete asks for confirmation — swap the card to a two-button confirm row
  if (action === "dcudel") {
    const u = await db.clientUser.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!u) {
      await dcRespondInteraction(token, itxId, itxToken, {
        type: 4,
        data: { content: dcDecode(t.userNotFound), flags: 64 },
      });
      return;
    }
    await dcRespondInteraction(token, itxId, itxToken, { type: 6 });
    await dcEditInteractionMessage(token, appId, itxToken, {
      embeds: [
        {
          title: `🗑 Delete ${u.username}?`,
          description:
            "This removes the user, every inbound access row and wipes the projected clients from all inbounds. This cannot be undone.",
          color: EMBED_ERR,
          footer: { text: `Sephiroth · v${appVersion()}` },
        } as DcEmbed,
      ],
      components: [deleteConfirmRow(userId)],
    }).catch(() => {});
    return;
  }

  const user = await db.clientUser.findUnique({ where: { id: userId } });
  if (!user) {
    await dcRespondInteraction(token, itxId, itxToken, {
      type: 4,
      data: { content: dcDecode(t.userNotFound), flags: 64 },
    });
    return;
  }

  let toast = "";
  if (action === "dcuseen" || action === "dcusdis") {
    const enabled = action === "dcuseen";
    // mirrors the panel PATCH + Telegram adminUserAction semantics
    await db.clientUser.update({ where: { id: user.id }, data: { enabled } });
    await syncUserProjection(user.id, {
      ipLimit: user.ipLimit,
      trafficLimitGb: user.trafficLimitGb,
      expiryDays: user.expiryDays,
      enabled,
    });
    await logActivity({
      kind: "user.updated",
      level: enabled ? "success" : "warn",
      actor: "discord-bot",
      message: `Discord bot ${enabled ? "enabled" : "disabled"} user "${user.username}"`,
      meta: { userId: user.id, username: user.username },
    });
    toast = enabled ? `✅ Enabled **${user.username}**` : `⛔ Disabled **${user.username}**`;
  } else if (action === "dcusreset") {
    await db.clientUser.update({ where: { id: user.id }, data: { usedTrafficGb: 0 } });
    await logActivity({
      kind: "user.updated",
      level: "info",
      actor: "discord-bot",
      message: `Discord bot reset traffic for "${user.username}"`,
      meta: { userId: user.id, username: user.username },
    });
    toast = `♻️ Traffic reset for **${user.username}**`;
  } else if (action === "dcudely") {
    // mirrors /api/users/:id DELETE — strip projections, then delete (cascades accesses)
    await stripUserEverywhere(user.id);
    await db.clientUser.delete({ where: { id: user.id } });
    await logActivity({
      kind: "user.deleted",
      level: "warn",
      actor: "discord-bot",
      message: `User deleted via Discord button (id ${user.id})`,
      meta: { userId: user.id, username: user.username },
    });
    toast = `🗑 Deleted **${user.username}**`;
  }

  // ephemeral result toast …
  await dcRespondInteraction(token, itxId, itxToken, {
    type: 4,
    data: { content: toast, flags: 64 },
  });

  // … then refresh the original card in place (best-effort — never crash the worker)
  try {
    if (action === "dcudely") {
      await dcEditInteractionMessage(token, appId, itxToken, {
        embeds: [
          { title: `🗑 ${user.username} — deleted`, description: "This user no longer exists.", color: EMBED_WARN } as DcEmbed,
        ],
        components: [],
      });
    } else {
      const fresh = await db.clientUser.findUnique({ where: { id: user.id } });
      if (fresh) {
        await dcEditInteractionMessage(token, appId, itxToken, {
          embeds: [userCardEmbed(fresh, fresh.enabled ? EMBED_OK : EMBED_WARN)],
          components: [userActionRow(fresh, t)],
        });
      } else {
        await dcEditInteractionMessage(token, appId, itxToken, { components: [] });
      }
    }
  } catch {
    /* the toast already went out — a failed card refresh is harmless */
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
          // global slash commands — idempotent full-set PUT, re-asserted on
          // every READY (token/settings changes restart the gateway, so they
          // re-register too). Never awaited: a slow REST call must not gate
          // the event loop.
          void registerSlashCommands(token);
          return;
        }
        if (pkt.t === "INTERACTION_CREATE" && identified) {
          void handleInteraction(token, pkt.d as DcInteraction);
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
