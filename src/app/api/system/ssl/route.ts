import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import {
  acmeAvailable,
  acmeHome,
  acmeVersion,
  certsDir,
  listManagedCerts,
  removeManagedCert,
  tailAcmeLog,
} from "@/lib/acme";
import { getSslSettings } from "@/lib/settings";

/* ============================================================
   Sephiroth · v2.5 (Task 23-f) — Managed SSL certs (admin)
   GET    /api/system/ssl            → acme.sh status + cert list + log tail
   DELETE /api/system/ssl?domain=x   → untrack + delete db/certs files
                                     (acme.sh renewal conf is kept on purpose)
   ============================================================ */

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const installed = acmeAvailable();
    const [version, certs, sslSettings] = await Promise.all([
      installed ? acmeVersion() : Promise.resolve(null),
      listManagedCerts(),
      getSslSettings(),
    ]);
    return NextResponse.json({
      acmeInstalled: installed,
      acmeVersion: version,
      acmeHome: acmeHome(),
      certsDir: certsDir(),
      certs,
      lastLog: tailAcmeLog(30),
      adminEmail: sslSettings.adminEmail,
      renewCheck: sslSettings.renewCheck,
    });
  } catch (err) {
    console.error("[ssl:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let domain = "";
  try {
    domain = new URL(req.url).searchParams.get("domain") ?? "";
  } catch {
    domain = "";
  }
  if (!domain) {
    return NextResponse.json({ error: "domain_required" }, { status: 400 });
  }
  try {
    const r = await removeManagedCert(domain);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    await logActivity({
      kind: "settings.updated",
      level: "warn",
      actor: admin,
      message: `Managed certificate removed: ${domain}`,
      meta: { section: "ssl", domain, renewalConfKept: r.renewalConfKept },
    });
    return NextResponse.json({ ok: true, renewalConfKept: r.renewalConfKept });
  } catch (err) {
    console.error("[ssl:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
