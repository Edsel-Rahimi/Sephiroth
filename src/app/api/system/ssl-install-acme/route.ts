import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import { installAcme, acmeVersion } from "@/lib/acme";
import { getSslSettings, saveSslSettings, validateSslPatch } from "@/lib/settings";

/* ============================================================
   Sephiroth · v2.5 (Task 23-f) — acme.sh installer (admin)
   POST /api/system/ssl-install-acme  body { email? }
   Runs the official get.acme.sh one-liner (internet required),
   registering the given account email. 120 s cap. The email is
   remembered as the ssl section default for future issuance.
   ============================================================ */

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  // email: explicit body value wins; otherwise fall back to the saved default
  const saved = await getSslSettings();
  const rawEmail = typeof body.email === "string" ? body.email.trim() : saved.adminEmail;
  if (!rawEmail) {
    return NextResponse.json({ error: "email_required" }, { status: 400 });
  }
  const check = await validateSslPatch({ adminEmail: rawEmail });
  if (!check.ok) {
    return NextResponse.json({ error: "validation", fields: check.fields }, { status: 400 });
  }

  const r = await installAcme(check.data.adminEmail);
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: r.error, logTail: r.logTail },
      { status: 500 }
    );
  }

  // remember the registration email for the issue form
  await saveSslSettings({ ...saved, adminEmail: check.data.adminEmail });
  await logActivity({
    kind: "settings.updated",
    level: "info",
    actor: admin,
    message: `acme.sh installed (email: ${check.data.adminEmail})`,
    meta: { section: "ssl", action: "install-acme" },
  });
  const version = await acmeVersion();
  return NextResponse.json({ ok: true, version, logTail: r.logTail });
}
