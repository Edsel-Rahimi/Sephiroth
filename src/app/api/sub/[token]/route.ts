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
  type SubExportItem,
} from "@/lib/share-links";
import { appVersion, getGeneralSettings } from "@/lib/settings";

/* ============================================================
   Sephiroth · Phase 5+ — Public Subscription Endpoint
   GET  /api/sub/[token]                → JSON payload for the web page (or auto-detected client config)
        /api/sub/[token]?format=raw     → text/plain URI list
        /api/sub/[token]?format=b64     → base64-wrapped URI list
        /api/sub/[token]?format=clash   → Clash Meta (Mihomo) YAML config
        /api/sub/[token]?format=singbox → Sing-Box 1.10+ JSON config
   POST /api/sub/[token] {password}     → unlock a password-protected group page
   ============================================================ */

type Resolved =
  | { type: "user"; payload: SubPayload; disabled: boolean; exportItems: SubExportItem[] }
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

    if (format === "raw" || format === "b64" || format === "clash" || format === "meta" || format === "singbox" || format === "sb") {
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
