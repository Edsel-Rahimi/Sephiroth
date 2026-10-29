import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { db } from "@/lib/db";
import {
  getAbuseSettings,
  saveAbuseSettings,
  validateAbusePatch,
} from "@/lib/settings";
import { logActivity, type ActivityKind } from "@/lib/activity";

/* ============================================================
   Sephiroth · Task 2-e — Anti-abuse API (admin only)

   GET  /api/telegram/abuse
     → { abuse: { forceChannel, banNotify },
         banned: [{ chatId, username, reason, bannedAt }] }
   PUT  /api/telegram/abuse { forceChannel?, banNotify? }
     → validated + normalized (accepts @name / https://t.me/<name>
       → bare <name>), merge-onto-saved like every other section.
   POST /api/telegram/abuse { action: "ban"|"unban", chatId, reason? }
     → flips the tgUser ban flag; the sales-worker's gate enforces
       it at the top of update handling (one notice per cooldown).
   ============================================================ */

const CHAT_ID_RE = /^-?\d{3,20}$/;
const MAX_REASON = 500;

async function abuseState() {
  const [abuse, rows] = await Promise.all([
    getAbuseSettings(),
    db.tgUser.findMany({ where: { banned: true }, orderBy: { updatedAt: "desc" } }),
  ]);
  return {
    abuse,
    banned: rows.map((u) => ({
      chatId: String(u.tgId),
      username: u.tgUsername ?? "",
      reason: u.banReason ?? "",
      bannedAt: u.bannedAt ?? null,
    })),
  };
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json(await abuseState());
  } catch (err) {
    console.error("[telegram:abuse:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = await validateAbusePatch(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "validation", fields: parsed.fields }, { status: 400 });
    }
    await saveAbuseSettings(parsed.data);
    await logActivity({
      kind: "settings.updated",
      level: "info",
      actor: admin,
      message: `Anti-abuse settings updated (forceChannel: ${parsed.data.forceChannel || "off"}, banNotify: ${parsed.data.banNotify})`,
      meta: { section: "abuse" },
    });
    return NextResponse.json(await abuseState());
  } catch (err) {
    console.error("[telegram:abuse:PUT]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }
    const b = (body ?? {}) as Record<string, unknown>;

    const action = b.action;
    if (action !== "ban" && action !== "unban") {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "action", code: "format" }] },
        { status: 400 }
      );
    }
    const chatId = typeof b.chatId === "string" ? b.chatId.trim() : "";
    if (!CHAT_ID_RE.test(chatId)) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "chatId", code: "format" }] },
        { status: 400 }
      );
    }
    let reason = "";
    if (b.reason !== undefined) {
      if (typeof b.reason !== "string" || b.reason.length > MAX_REASON) {
        return NextResponse.json(
          { error: "validation", fields: [{ field: "reason", code: "range" }] },
          { status: 400 }
        );
      }
      reason = b.reason.trim();
    }

    const user = await db.tgUser.findUnique({ where: { tgId: chatId } });
    if (!user) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }

    if (action === "ban") {
      await db.tgUser.update({
        where: { tgId: chatId },
        data: { banned: true, banReason: reason, bannedAt: new Date().toISOString() },
      });
      await logActivity({
        kind: "settings.updated" as unknown as ActivityKind,
        level: "warn",
        actor: admin,
        message: `Telegram user banned: ${user.tgUsername || chatId}${reason ? ` — ${reason}` : ""}`,
        meta: { section: "abuse", chatId, action: "ban", reason },
      });
    } else {
      await db.tgUser.update({
        where: { tgId: chatId },
        data: { banned: false, banReason: "", bannedAt: null },
      });
      await logActivity({
        kind: "settings.updated" as unknown as ActivityKind,
        level: "info",
        actor: admin,
        message: `Telegram user unbanned: ${user.tgUsername || chatId}`,
        meta: { section: "abuse", chatId, action: "unban" },
      });
    }
    return NextResponse.json(await abuseState());
  } catch (err) {
    console.error("[telegram:abuse:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
