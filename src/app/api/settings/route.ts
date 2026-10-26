import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import {
  getCoreSettings,
  getTelegramSettings,
  getNavModules,
  getGeneralSettings,
  getExpertSettings,
  getSecuritySettings,
  saveCoreSettings,
  saveTelegramSettings,
  saveNavModules,
  saveGeneralSettings,
  saveExpertSettings,
  saveSecuritySettings,
  validateCorePatch,
  validateTelegramPatch,
  validateNavPatch,
  validateGeneralPatch,
  validateExpertPatch,
  validateSecurityPatch,
} from "@/lib/settings";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Phase 7/8 — Settings API (admin only)
   GET  /api/settings           → { core, telegram, nav, general, expert, security }
   PUT  /api/settings           → body { section: "core" | "telegram" | "nav"
                                          | "general" | "expert" | "security", ...patch }
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const [core, telegram, nav, general, expert, security] = await Promise.all([
      getCoreSettings(),
      getTelegramSettings(),
      getNavModules(),
      getGeneralSettings(),
      getExpertSettings(),
      getSecuritySettings(),
    ]);
    return NextResponse.json({ core, telegram, nav, general, expert, security });
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
      const parsed = await validateCorePatch(patch);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "validation", fields: parsed.fields },
          { status: 400 }
        );
      }
      await saveCoreSettings(parsed.data);
      const core = await getCoreSettings();
      await logActivity({
        kind: "settings.updated",
        level: "info",
        actor: admin,
        message: `Core driver settings updated (driver: ${parsed.data.driver})`,
        meta: { section: "core" },
      });
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
      await logActivity({
        kind: "settings.updated",
        level: "info",
        actor: admin,
        message: `Telegram bot settings updated (enabled: ${parsed.data.enabled})`,
        meta: { section: "telegram" },
      });
      return NextResponse.json({ telegram });
    }

    if (section === "nav") {
      const parsed = validateNavPatch(patch);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "validation", fields: parsed.fields },
          { status: 400 }
        );
      }
      await saveNavModules(parsed.data);
      const nav = await getNavModules();
      return NextResponse.json({ nav });
    }

    if (section === "general") {
      const parsed = await validateGeneralPatch(patch);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "validation", fields: parsed.fields },
          { status: 400 }
        );
      }
      await saveGeneralSettings(parsed.data);
      const general = await getGeneralSettings();
      await logActivity({
        kind: "settings.updated",
        level: "info",
        actor: admin,
        message: "General panel preferences updated",
        meta: { section: "general" },
      });
      return NextResponse.json({ general });
    }

    if (section === "security") {
      const parsed = await validateSecurityPatch(patch);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "validation", fields: parsed.fields },
          { status: 400 }
        );
      }
      await saveSecuritySettings(parsed.data);
      const security = await getSecuritySettings();
      await logActivity({
        kind: "settings.updated",
        level: "warn",
        actor: admin,
        message: `Security settings updated (autoBackup: ${security.autoBackupEnabled}, totp: ${security.totpEnabled})`,
        meta: { section: "security" },
      });
      return NextResponse.json({ security });
    }

    if (section === "expert") {
      const parsed = await validateExpertPatch(patch);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "validation", fields: parsed.fields },
          { status: 400 }
        );
      }
      await saveExpertSettings(parsed.data);
      const expert = await getExpertSettings();
      await logActivity({
        kind: "settings.updated",
        level: "warn",
        actor: admin,
        message: "Expert / Xray config updated",
        meta: { section: "expert" },
      });
      return NextResponse.json({ expert });
    }

    return NextResponse.json({ error: "unknown_section" }, { status: 400 });
  } catch (err) {
    console.error("[settings:PUT]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
