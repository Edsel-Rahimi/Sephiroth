import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import { issueCert, validDomain, type AcmeMode } from "@/lib/acme";
import { getSslSettings, saveSslSettings } from "@/lib/settings";

/* ============================================================
   Sephiroth · v2.5 (Task 23-f) — issue a managed cert (admin)
   POST /api/system/ssl-issue
   body { domain, email?, mode: "standalone"|"webroot", webroot?,
          httpPort?, test?, server? }
   Synchronous acme.sh round (300 s cap) — the UI shows a spinner.
   Phase 1 ships standalone + webroot; dns-01 providers stay a
   lib-level pass-through (mode "dns") for a later phase.
   ============================================================ */

const MODES: AcmeMode[] = ["standalone", "webroot", "dns"];

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!domain || !validDomain(domain)) {
    return NextResponse.json({ error: "invalid_domain" }, { status: 400 });
  }
  const mode = String(body.mode ?? "standalone") as AcmeMode;
  if (!MODES.includes(mode)) {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }
  const server = typeof body.server === "string" ? body.server.trim() : "";
  if (server && !/^https:\/\/[a-zA-Z0-9.:\-/]+$/.test(server)) {
    return NextResponse.json({ error: "invalid_server" }, { status: 400 });
  }

  const saved = await getSslSettings();
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : saved.adminEmail;

  const r = await issueCert({
    domain,
    email,
    mode,
    webroot: typeof body.webroot === "string" ? body.webroot : undefined,
    httpPort: Number(body.httpPort) > 0 ? Number(body.httpPort) : undefined,
    test: body.test === true,
    server: server || undefined,
    dnsProvider: typeof body.dnsProvider === "string" ? body.dnsProvider : undefined,
  });

  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error, logTail: r.logTail }, { status: 400 });
  }

  // remember the email used so the next issue call is prefilled
  if (email && email !== saved.adminEmail) {
    await saveSslSettings({ ...saved, adminEmail: email });
  }
  await logActivity({
    kind: "settings.updated",
    level: "info",
    actor: admin,
    message: `Certificate issued for ${domain}${r.cert.test ? " (staging)" : ""}`,
    meta: {
      section: "ssl",
      action: "issue",
      domain,
      mode,
      test: r.cert.test,
      crt: r.cert.paths.crt,
    },
  });
  return NextResponse.json({ ok: true, cert: r.cert });
}
