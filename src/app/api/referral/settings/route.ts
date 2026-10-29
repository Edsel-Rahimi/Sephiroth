import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import {
  getReferralSettings,
  saveReferralSettings,
  validateReferralPatch,
} from "@/lib/settings";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Task 2-d — Referral settings API (admin only)

   Own section route (the referral settings card reads/writes
   HERE, not via /api/settings, so the shared settings route
   stays untouched):
   GET /api/referral/settings →
     { referral: { enabled, rewardAmount, currency } }
   PUT /api/referral/settings → body { enabled?, rewardAmount? }
     → { referral: { enabled, rewardAmount, currency } }

   `currency` is a display note — the panel's sale currency is
   always Toman (same wallet the v2.8 /credit flow tops up).
   ============================================================ */

async function view() {
  const s = await getReferralSettings();
  return { ...s, currency: "Toman" };
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ referral: await view() });
  } catch (err) {
    console.error("[referral:settings:GET]", err);
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

    const parsed = await validateReferralPatch(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }
    await saveReferralSettings(parsed.data);
    await logActivity({
      kind: "settings.updated",
      level: "info",
      actor: admin,
      message: `Referral settings updated (enabled: ${parsed.data.enabled}, reward: ${parsed.data.rewardAmount} Toman)`,
      meta: { section: "referral" },
    });
    return NextResponse.json({ referral: await view() });
  } catch (err) {
    console.error("[referral:settings:PUT]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
