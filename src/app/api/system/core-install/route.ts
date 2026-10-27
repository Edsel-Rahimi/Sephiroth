import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import { getCoreSettings } from "@/lib/settings";
import { installOrUpdateXray } from "@/lib/core/bin-manager";

/* ============================================================
   Sephiroth · v2.4 — Install / update the Xray core binary (admin)
   POST /api/system/core-install
   Resolves the binary: admin path → PATH → auto-download from
   GitHub (XTLS/Xray-core, settings-pinned tag or latest) with the
   unzip → 7z → python3 extraction chain. Can take ~30-60s.
   ============================================================ */

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const settings = await getCoreSettings();
  const logs: string[] = [];
  try {
    const bin = await installOrUpdateXray({
      binPath: settings.xrayBin,
      versionPin: settings.xrayVersion,
      log: (m) => logs.push(m),
    });
    await logActivity({
      kind: "system.update",
      level: "success",
      actor: admin,
      message: `Xray core ready: ${bin.version} at ${bin.path} (${bin.source})`,
      meta: { coreInstall: true, version: bin.version, source: bin.source },
    });
    return NextResponse.json({ ok: true, version: bin.version, path: bin.path, source: bin.source, logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logActivity({
      kind: "system.update",
      level: "error",
      actor: admin,
      message: `Xray core install failed: ${message}`,
      meta: { coreInstall: true, error: message },
    });
    return NextResponse.json({ ok: false, error: message, logs }, { status: 500 });
  }
}
