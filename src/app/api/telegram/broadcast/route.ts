import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { db } from "@/lib/db";
import { getTelegramSettings, getTelegramToken } from "@/lib/settings";
import { jobView, runBroadcast } from "@/lib/bot/broadcast";
import { logActivity, type ActivityKind } from "@/lib/activity";

/* ============================================================
   Sephiroth · Task 2-e — Broadcast queue API (admin only)

   POST /api/telegram/broadcast {text, parseMode?}
     → validates text (trimmed 1..4000 chars), snapshots the
       audience (every tgUser that is NOT banned — the notify
       engine's enabled/mode/token honesty gates apply too),
       creates a running job and fires the async sender
       (never awaited). 409 when a job is already running,
       400 bot_not_configured for the honest no-token state.
   GET /api/telegram/broadcast
     → { configured, eligibleCount, job (latest|null), history (last 10) }

   The sender loop lives in src/lib/bot/broadcast.ts — this
   route never blocks on Telegram I/O.
   ============================================================ */

const MAX_TEXT = 4000;

async function broadcastState() {
  const [tg, token, latest, history, eligibleCount] = await Promise.all([
    getTelegramSettings(),
    getTelegramToken(),
    db.broadcastJob.findMany({ orderBy: { createdAt: "desc" }, take: 1 }),
    db.broadcastJob.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    db.tgUser.count({ where: { banned: { not: true } } }),
  ]);
  return {
    configured: Boolean(tg.enabled && token),
    eligibleCount,
    job: latest[0] ? jobView(latest[0]) : null,
    history: history.map(jobView),
  };
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json(await broadcastState());
  } catch (err) {
    console.error("[telegram:broadcast:GET]", err);
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

    const text = typeof b.text === "string" ? b.text.trim() : "";
    const parseMode = b.parseMode === undefined ? "None" : b.parseMode;
    if (!text || text.length > MAX_TEXT) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "text", code: text ? "range" : "required" }] },
        { status: 400 }
      );
    }
    if (parseMode !== "None" && parseMode !== "MarkdownV2") {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "parseMode", code: "format" }] },
        { status: 400 }
      );
    }

    // single-flight FIRST: queue-state guard (a running job must answer 409
    // even if the bot was un-configured between enqueue and now)
    const running = await db.broadcastJob.findFirst({ where: { status: "running" } });
    if (running) {
      return NextResponse.json({ error: "job_running", job: jobView(running) }, { status: 409 });
    }

    // honesty gate — the SAME enabled/token checks the notify engine applies
    const [tg, token] = await Promise.all([getTelegramSettings(), getTelegramToken()]);
    if (!tg.enabled || !token) {
      return NextResponse.json({ error: "bot_not_configured" }, { status: 400 });
    }

    // audience snapshot: every bot user not banned (tgUser has no per-user
    // "enabled" flag — the enabled-ish honesty gates live on the bot itself)
    const users = await db.tgUser.findMany({ where: { banned: { not: true } } });
    const targets = users.map((u) => String(u.tgId));

    const job = await db.broadcastJob.create({
      data: {
        text,
        parseMode,
        targets,
        sent: 0,
        failed: 0,
        status: "running",
        lastError: "",
      },
    });
    // fire-and-forget: the request returns immediately, the sender loop
    // updates the row as it goes (rate-limited, 429-aware, cancellable)
    void runBroadcast(job.id).catch((err) =>
      console.warn("[telegram-broadcast] dispatch failed:", err)
    );
    await logActivity({
      kind: "settings.updated" as unknown as ActivityKind,
      level: "info",
      actor: admin,
      message: `Broadcast queued — ${targets.length} recipient(s), parse mode ${parseMode}`,
      meta: { section: "broadcast", jobId: job.id, total: targets.length, parseMode },
    });
    return NextResponse.json(
      { ...(await broadcastState()), job: jobView(job) },
      { status: 201 }
    );
  } catch (err) {
    console.error("[telegram:broadcast:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
