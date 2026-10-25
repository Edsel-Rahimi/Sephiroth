import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import {
  getCoreSettings,
  getTelegramSettings,
  saveCoreSettings,
  saveTelegramSettings,
  validateCorePatch,
  validateTelegramPatch,
} from "@/lib/settings";

/* ============================================================
   Sephiroth · Phase 7 — Settings API (admin only)
   GET  /api/settings           → { core, telegram }
   PUT  /api/settings           → body { section: "core" | "telegram", ...patch }
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const [core, telegram] = await Promise.all([
      getCoreSettings(),
      getTelegramSettings(),
    ]);
    return NextResponse.json({ core, telegram });
  } catch (err) {
    console.error("[settings:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const { section, ...patch } = (body ?? {}) as Record<string, unknown>;

    if (section === "core") {
      const parsed = validateCorePatch(patch);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "validation", fields: parsed.fields },
          { status: 400 }
        );
      }
      await saveCoreSettings(parsed.data);
      const core = await getCoreSettings();
      return NextResponse.json({ core });
    }

    if (section === "telegram") {
      const parsed = validateTelegramPatch(patch);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "validation", fields: parsed.fields },
          { status: 400 }
        );
      }
      await saveTelegramSettings(parsed.data);
      const telegram = await getTelegramSettings();
      return NextResponse.json({ telegram });
    }

    return NextResponse.json({ error: "unknown_section" }, { status: 400 });
  } catch (err) {
    console.error("[settings:PUT]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
