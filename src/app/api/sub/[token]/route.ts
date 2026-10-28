import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import {
  groupSubPayload,
  userSubPayload,
  type SubPayload,
} from "@/lib/sub-groups";
import {
  buildClashMetaYaml,
  buildSingboxJson,
  buildXrayJson,
  type SubExportItem,
} from "@/lib/share-links";
import { appVersion, getGeneralSettings } from "@/lib/settings";
import { deviceFingerprint, explicitDeviceId, parseDevices, registerDevice, type DeviceEntry } from "@/lib/hwid"; // Task 23-g/23-b
import { logActivity } from "@/lib/activity"; // Task 23-g
import { LANGS, type Lang } from "@/lib/i18n/dictionaries"; // Task 23-g — blocked page
import { subDictionaries, sfmt } from "@/lib/i18n/sub-dictionary"; // Task 23-g/23-b — blocked page

/* ============================================================
   Sephiroth · Phase 5+ — Public Subscription Endpoint
   GET  /api/sub/[token]                → JSON payload for the web page (or auto-detected client config)
        /api/sub/[token]?format=raw     → text/plain URI list
        /api/sub/[token]?format=b64     → base64-wrapped URI list
        /api/sub/[token]?format=clash   → Clash Meta (Mihomo) YAML config
        /api/sub/[token]?format=singbox → Sing-Box 1.10+ JSON config
        /api/sub/[token]?format=xray   → Xray/v2ray-core full JSON profile
   POST /api/sub/[token] {password}     → unlock a password-protected group page

   Task 23-g/23-b — HWID device gate: when the owning user has hwidLimit > 0,
   every request is identified by `?hwid=<client-sent>` when the client appends
   it (v2box/v2rayNG-style), else by a fingerprint of UA + Accept-Language +
   sec-ch-ua-platform. Known devices always pass; unknown devices are rejected
   with a branded 403 (HTML for config clients, JSON for the pass page) once
   the device list is full. Device ids are stored on the ClientUser row.
   ============================================================ */

type Resolved =
  | { type: "user"; payload: SubPayload; disabled: boolean; exportItems: SubExportItem[]; hwidLimit: number | null; devices: DeviceEntry[] }
  | {
      type: "group";
      payload: SubPayload | null;
      locked: boolean;
      disabled: boolean;
      name?: string;
      exportItems: SubExportItem[];
    };

function safeJsonRecord(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function resolveToken(token: string, fallbackHost?: string, publicHost?: string): Promise<Resolved | null> {
  const user = await db.clientUser.findUnique({
    where: { subId: token },
    include: { accesses: { include: { inbound: true } } },
  });
  if (user) {
    const exportItems: SubExportItem[] = user.accesses.map((a: any) => ({
      tag: a.inbound.tag,
      protocol: a.inbound.protocol,
      port: a.inbound.port,
      listen: a.inbound.listen || fallbackHost || "",
      transport: a.inbound.transport,
      security: a.inbound.security,
      email: a.email,
      key: a.key,
      flow: a.flow,
      stream: safeJsonRecord(a.inbound.streamJson),
    }));
    return {
      type: "user",
      payload: await userSubPayload(user, new Date(), fallbackHost, publicHost),
      disabled: !user.enabled,
      exportItems,
      hwidLimit: user.hwidLimit ?? null,
      devices: parseDevices(user.devices),
    };
  }

  const group = await db.subGroup.findUnique({
    where: { token },
    include: {
      members: {
        include: {
          user: { include: { accesses: { include: { inbound: true } } } },
        },
      },
    },
  });
  if (!group || !group.enabled) return null;

  const exportItems: SubExportItem[] = [];
  for (const m of group.members || []) {
    if (!m.user?.enabled) continue;
    for (const a of m.user.accesses || []) {
      exportItems.push({
        tag: a.inbound.tag,
        protocol: a.inbound.protocol,
        port: a.inbound.port,
        listen: a.inbound.listen || fallbackHost || "",
        transport: a.inbound.transport,
        security: a.inbound.security,
        email: a.email,
        key: a.key,
        flow: a.flow,
        stream: safeJsonRecord(a.inbound.streamJson),
      });
    }
  }

  if (group.passwordHash) {
    return { type: "group", payload: null, locked: true, disabled: false, name: group.name, exportItems };
  }
  return {
    type: "group",
    payload: await groupSubPayload(group, new Date(), fallbackHost, publicHost),
    locked: false,
    disabled: false,
    exportItems,
  };
}

function textResponse(body: string, status: number, contentType = "text/plain; charset=utf-8", extraHeaders?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function payloadToRaw(payload: SubPayload): string {
  const lines: string[] = [];
  for (const c of payload.configs) {
    if (c.link) lines.push(c.link);
    else lines.push(`# ${c.tag} — copy from the sub page`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function sanitizeFilenamePart(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "sub";
}

/* ---------- Task 23-g — HWID device gate ---------- */

function langFromAcceptLanguage(header: string | null): Lang {
  const raw = (header ?? "").toLowerCase();
  for (const part of raw.split(",")) {
    const code = part.trim().split(";")[0]!.slice(0, 2);
    if ((LANGS as readonly string[]).includes(code)) return code as Lang;
  }
  return "en";
}

/** Branded 403 page shown to config clients when the device list is full. */
function blockedHtmlPage(lang: Lang, devices: number, limit: number): string {
  const t = subDictionaries[lang];
  const rtl = lang === "fa" || lang === "ar" ? ` dir="rtl"` : "";
  return `<!doctype html>
<html lang="${lang}"${rtl}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t.blockedTitle} · Sephiroth</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(1200px 700px at 50% -10%, #0b1a24 0%, #05070c 55%, #03040a 100%);
    color: #e7ecef; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 24px;
  }
  .card {
    max-width: 420px; width: 100%; text-align: center;
    border: 1px solid rgba(255,255,255,.08); border-radius: 20px;
    background: rgba(255,255,255,.03); padding: 36px 28px;
    box-shadow: 0 24px 70px rgba(0,0,0,.55);
  }
  .mark { font-size: 13px; letter-spacing: .34em; font-weight: 700; color: #e7ecef; }
  .tag { margin-top: 6px; font-size: 9px; letter-spacing: .32em; text-transform: uppercase; color: rgba(231,236,239,.5); }
  .glow { width: 64px; height: 64px; margin: 26px auto 18px; border-radius: 18px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(34,216,238,.08); border: 1px solid rgba(34,216,238,.35); color: #22d8ee;
    box-shadow: 0 0 34px rgba(34,216,238,.25); }
  h1 { font-size: 19px; font-weight: 700; color: #fff; }
  p.desc { margin-top: 10px; font-size: 13px; line-height: 1.7; color: rgba(231,236,239,.72); }
  p.count { margin-top: 12px; display: inline-block; font-size: 11px; letter-spacing: .06em; color: rgba(231,236,239,.85);
    border: 1px solid rgba(34,216,238,.3); background: rgba(34,216,238,.06); border-radius: 999px; padding: 4px 12px; }
  p.contact { margin-top: 14px; font-size: 12px; color: #22d8ee; }
  .foot { margin-top: 26px; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: rgba(231,236,239,.35); }
</style>
</head>
<body>
  <main class="card">
    <div class="mark">SEPHIROTH</div>
    <div class="tag">${t.tagline}</div>
    <div class="glow" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20M12 2v20"/><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
    </div>
    <h1>${t.blockedTitle}</h1>
    <p class="desc">${t.blockedDesc}</p>
    <p class="count">${sfmt(t.blockedCount, { n: devices, s: limit })}</p>
    <p class="contact">${t.blockedContact}</p>
    <div class="foot">${t.poweredBy}</div>
  </main>
</body>
</html>`;
}

/**
 * Task 23-g — enforce the owning user's HWID device limit before serving.
 * Returns a Response when the request must be blocked, otherwise null
 * (and the device registration has been persisted when it changed).
 */
async function hwidGate(
  req: Request,
  token: string,
  found: Extract<Resolved, { type: "user" }>,
  isPageRequest: boolean
): Promise<Response | null> {
  const limit = found.hwidLimit ?? 0;
  if (!(limit > 0)) return null;

  const ua = req.headers.get("user-agent") || "";
  // Task 23-b — device id: the client-sent `?hwid=` wins (v2box/v2rayNG can
  // append it), otherwise fall back to the header fingerprint.
  const deviceId =
    explicitDeviceId(new URL(req.url).searchParams.get("hwid")) ??
    deviceFingerprint({
      "user-agent": ua,
      "accept-language": req.headers.get("accept-language"),
      "sec-ch-ua-platform": req.headers.get("sec-ch-ua-platform"),
    });
  const reg = registerDevice(found.devices, deviceId, ua, limit);

  if (reg.blocked) {
    void logActivity({
      kind: "sub.hwidBlocked",
      level: "warn",
      actor: "sub-portal",
      message: `Subscription "${found.payload.name}" blocked an unknown device — HWID limit ${limit} reached`,
      meta: { token: token.slice(0, 8), deviceId, devices: found.devices.length, limit, reason: "hwid_limit" },
    });
    if (isPageRequest) {
      // the pass page fetches JSON — it renders the branded blocked state itself
      return NextResponse.json(
        { kind: "user", blocked: true, hwid: true, devices: found.devices.length, limit, token },
        { status: 403, headers: { "cache-control": "no-store" } }
      );
    }
    const lang = langFromAcceptLanguage(req.headers.get("accept-language"));
    return new Response(blockedHtmlPage(lang, found.devices.length, limit), {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // known device → lastSeen refresh; unknown → appended. Persist when changed.
  if (reg.known) {
    const unchanged = found.devices.every(
      (d) => d.id !== deviceId || d.lastSeen === reg.devices.find((x) => x.id === deviceId)?.lastSeen
    );
    if (unchanged) return null;
  }
  await db.clientUser.update({
    where: { subId: token },
    data: { devices: JSON.stringify(reg.devices) },
  });
  return null;
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const url = new URL(req.url);
    let format = url.searchParams.get("format")?.toLowerCase() || "";
    const pw = url.searchParams.get("pw") ?? "";
    const reqHost = url.hostname && url.hostname !== "localhost" && url.hostname !== "127.0.0.1" ? url.hostname : "edge.sephiroth.network";
    const general = await getGeneralSettings();
    const publicHost = general.publicHost || "";

    // Auto-detect VPN client User-Agents when no ?format= is specified and Accept does not prefer application/json from fetch()
    const ua = (req.headers.get("user-agent") || "").toLowerCase();
    const accept = (req.headers.get("accept") || "").toLowerCase();
    if (!format && !accept.includes("application/json")) {
      if (ua.includes("clash") || ua.includes("mihomo") || ua.includes("stash") || ua.includes("verge")) {
        format = "clash";
      } else if (ua.includes("sing-box") || ua.includes("sfi") || ua.includes("sfa") || ua.includes("hiddify")) {
        format = "singbox";
      } else if (ua.includes("v2ray") || ua.includes("shadowrocket") || ua.includes("streisand") || ua.includes("nekobox") || ua.includes("v2box")) {
        format = "b64";
      }
    }

    const found = await resolveToken(token, reqHost, publicHost);
    if (!found) return textResponse("not found", 404);

    // Task 23-g — HWID device gate (user subs only) — runs before any body
    // is served so both the pass page and every config format are covered.
    if (found.type === "user") {
      const gate = await hwidGate(req, token, found, format === "");
      if (gate) return gate;
    }

    if (format === "raw" || format === "b64" || format === "clash" || format === "meta" || format === "singbox" || format === "sb" || format === "xray" || format === "xray-json" || format === "v2ray") {
      if (found.type === "user" && found.disabled) {
        return textResponse("subscription disabled", 410);
      }
      let payload = found.payload;
      if (!payload) {
        const group = await db.subGroup.findUnique({ where: { token } });
        if (!group || !group.passwordHash || !verifyPassword(pw, group.passwordHash)) {
          return textResponse("password required", 401);
        }
        const fresh = await db.subGroup.findUnique({
          where: { token },
          include: {
            members: {
              include: { user: { include: { accesses: { include: { inbound: true } } } } },
            },
          },
        });
        if (!fresh) return textResponse("not found", 404);
        payload = await groupSubPayload(fresh, new Date(), reqHost, publicHost);
      }

      const usedBytes = Math.round((payload.usage.usedGb || 0) * 1073741824);
      const totalBytes = payload.usage.limitGb ? Math.round(payload.usage.limitGb * 1073741824) : 0;
      const expireUnix = payload.expiry.endsAtIso ? Math.floor(new Date(payload.expiry.endsAtIso).getTime() / 1000) : 0;

      // public landing page for this subscription (request host wins, admin
      // publicHost is the fallback) — surfaced via profile-web-page-url
      const pageBase = publicHost || (url.hostname !== "localhost" && url.hostname !== "127.0.0.1" ? url.host : "edge.sephiroth.network");
      const profileWebPageUrl = `${url.protocol}//${pageBase.replace(/\/$/, "")}/sub/${token}`;

      const subHeaders: Record<string, string> = {
        "profile-title": `base64:${Buffer.from(`Sephiroth · ${payload.name}`).toString("base64")}`,
        "subscription-userinfo": `upload=0; download=${usedBytes}; total=${totalBytes}; expire=${expireUnix}`,
        "profile-update-interval": "6",
        "profile-web-page-url": profileWebPageUrl,
        "x-sephiroth": appVersion(),
      };
      if (general.subSupportUrl) {
        subHeaders["support-url"] = general.subSupportUrl;
      }

      const token8 = token.slice(0, 8);
      const namePart = sanitizeFilenamePart(payload.name);
      const disposition = (ext: string): Record<string, string> => ({
        "content-disposition": `attachment; filename="sephiroth-${namePart}-${token8}.${ext}"`,
      });

      if (format === "clash" || format === "meta") {
        const yaml = buildClashMetaYaml(found.exportItems, payload.name, reqHost, publicHost);
        return textResponse(yaml, 200, "text/yaml; charset=utf-8", {
          ...subHeaders,
          ...disposition("yaml"),
        });
      }
      if (format === "singbox" || format === "sb") {
        const json = buildSingboxJson(found.exportItems, payload.name, reqHost, publicHost);
        return textResponse(json, 200, "application/json; charset=utf-8", {
          ...subHeaders,
          ...disposition("json"),
        });
      }
      if (format === "xray" || format === "xray-json" || format === "v2ray") {
        const json = buildXrayJson(found.exportItems, payload.name, reqHost, publicHost);
        return textResponse(json, 200, "application/json; charset=utf-8", {
          ...subHeaders,
          ...disposition("json"),
        });
      }

      const raw = payloadToRaw(payload);
      if (format === "b64") {
        return textResponse(Buffer.from(raw, "utf-8").toString("base64"), 200, "text/plain; charset=utf-8", {
          ...subHeaders,
          ...disposition("txt"),
        });
      }
      return textResponse(raw, 200, "text/plain; charset=utf-8", {
        ...subHeaders,
        ...disposition("txt"),
      });
    }

    if (found.type === "group" && found.locked) {
      return NextResponse.json({ kind: "group", locked: true, token });
    }
    return NextResponse.json(found.payload);
  } catch (err) {
    console.error("[sub:token:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    let body: { password?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }
    const password = typeof body.password === "string" ? body.password : "";

    const group = await db.subGroup.findUnique({ where: { token } });
    if (!group || !group.enabled) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!group.passwordHash || !verifyPassword(password, group.passwordHash)) {
      return NextResponse.json({ error: "wrong_password" }, { status: 401 });
    }

    const fresh = await db.subGroup.findUnique({
      where: { token },
      include: {
        members: {
          include: { user: { include: { accesses: { include: { inbound: true } } } } },
        },
      },
    });
    if (!fresh) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(await groupSubPayload(fresh));
  } catch (err) {
    console.error("[sub:token:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
