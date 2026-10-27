import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import {
  getActiveBackend,
  getSidecarManager,
  isFallbackActive,
  swapBackend,
} from "@/lib/core/registry";
import { XrayDriver } from "@/lib/core/xray";
import { CoreSim } from "../../../../../mini-services/core-sim/sim";
import { SimBackend } from "@/lib/core/sim-backend";
import { appVersion, getCoreSettings } from "@/lib/settings";

/* ============================================================
   Sephiroth · v2.4 — Core lifecycle actions (admin)
   POST /api/system/core-action  { action: "start" | "stop" | "restart" | "reload" }
   start    → bring the configured driver up (constructs + swaps the
              real XrayDriver when settings say xray and it is not up)
   stop     → SIGTERM/SIGKILL the real core (no-op on the simulator)
   restart  → stop + start
   reload   → regenerate config from the store; restart only when it changed
   Every action also drives the v2.5 hysteria2 SIDECAR engines (they serve
   the inbounds the Xray core cannot) and answers with the resulting
   status payload incl. the `sidecars` array.
   ============================================================ */

async function startXrayFromSettings(): Promise<{ ok: true; driver: XrayDriver } | { ok: false; reason: string }> {
  const settings = await getCoreSettings();
  const driver = new XrayDriver({
    binPath: settings.xrayBin,
    versionPin: settings.xrayVersion,
    statsIntervalMs: settings.statsInterval * 1000,
  });
  try {
    await driver.start();
  } catch (err) {
    void driver.dispose().catch(() => undefined);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  await swapBackend(driver);
  return { ok: true, driver };
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { action?: unknown } = {};
  try {
    body = (await req.json()) as { action?: unknown };
  } catch {
    /* empty body tolerated */
  }
  const action = String(body.action ?? "");
  if (!["start", "stop", "restart", "reload"].includes(action)) {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }

  const backend = getActiveBackend();
  if (!backend) {
    return NextResponse.json({ error: "core_not_ready" }, { status: 503 });
  }

  const settings = await getCoreSettings();
  let message = "";
  let ok = true;

  try {
    // Task 23-e — the hysteria2 sidecars ride along with every core action
    const sidecars = getSidecarManager();
    if (action === "stop") {
      if (backend.kind === "xray") {
        await backend.stop();
        message = "stopped";
      } else {
        ok = false;
        message = "sim_no_stop";
      }
      if (sidecars) await sidecars.stopAll().catch(() => undefined);
    } else if (action === "start") {
      let coreMsg = "";
      let coreOk = true;
      if (backend.kind === "xray") {
        if (backend.status().running) {
          coreOk = false;
          coreMsg = "already_running";
        } else {
          await backend.start();
          coreMsg = "started";
        }
      } else if (settings.driver === "xray") {
        const res = await startXrayFromSettings();
        if (res.ok) {
          coreMsg = "started";
        } else {
          coreOk = false;
          coreMsg = "start_failed";
          // surface the reason through the status fallback fields
          const simBackend = new SimBackend(new CoreSim(`${appVersion()}-sim`), `${appVersion()}-sim`);
          await swapBackend(simBackend, { active: true, reason: res.reason });
        }
      } else {
        coreOk = false;
        coreMsg = "sim_selected";
      }
      // sidecars start independently of the core driver
      let sidecarErr = "";
      if (sidecars) {
        try {
          await sidecars.start();
        } catch (err) {
          sidecarErr = err instanceof Error ? err.message : String(err);
        }
      }
      if (coreOk) {
        ok = true;
        message = sidecarErr ? `core ${coreMsg}; sidecar error: ${sidecarErr}` : coreMsg;
      } else {
        ok = sidecarErr === "" && sidecars !== null; // sidecars may still have started
        message = sidecarErr
          ? `core ${coreMsg}; sidecar error: ${sidecarErr}`
          : `core ${coreMsg}; sidecars ok`;
      }
    } else if (action === "restart") {
      let coreMsg = "";
      let coreOk = true;
      if (backend.kind === "xray" && settings.driver === "xray") {
        await backend.restart();
        coreMsg = "restarted";
      } else if (settings.driver === "xray") {
        const res = await startXrayFromSettings();
        if (res.ok) {
          coreMsg = "started";
        } else {
          coreOk = false;
          coreMsg = "start_failed";
          const simBackend = new SimBackend(new CoreSim(`${appVersion()}-sim`), `${appVersion()}-sim`);
          await swapBackend(simBackend, { active: true, reason: res.reason });
        }
      } else if (backend.kind === "xray") {
        // settings switched back to the simulator → tear the real core down
        await backend.dispose();
        await swapBackend(new SimBackend(new CoreSim(`${appVersion()}-sim`), `${appVersion()}-sim`));
        coreMsg = "switched to simulator";
      } else {
        coreOk = false;
        coreMsg = "sim_selected";
      }
      let sidecarErr = "";
      if (sidecars) {
        try {
          await sidecars.restartAll();
        } catch (err) {
          sidecarErr = err instanceof Error ? err.message : String(err);
        }
      }
      if (coreOk) {
        ok = true;
        message = sidecarErr ? `core ${coreMsg}; sidecar error: ${sidecarErr}` : coreMsg;
      } else {
        ok = sidecarErr === "" && sidecars !== null;
        message = sidecarErr
          ? `core ${coreMsg}; sidecar error: ${sidecarErr}`
          : `core ${coreMsg}; sidecars ok`;
      }
    } else if (action === "reload") {
      let coreMsg = "";
      let coreOk = true;
      if (backend.kind === "xray") {
        await backend.reload();
        coreMsg = "reloaded";
      } else {
        coreOk = false;
        coreMsg = "sim_selected";
      }
      let sidecarErr = "";
      if (sidecars) {
        try {
          await sidecars.reload();
        } catch (err) {
          sidecarErr = err instanceof Error ? err.message : String(err);
        }
      }
      if (coreOk) {
        ok = true;
        message = sidecarErr ? `core ${coreMsg}; sidecar error: ${sidecarErr}` : coreMsg;
      } else {
        ok = sidecarErr === "" && sidecars !== null;
        message = sidecarErr
          ? `core ${coreMsg}; sidecar error: ${sidecarErr}`
          : `core ${coreMsg}; sidecars ok`;
      }
    }
  } catch (err) {
    ok = false;
    message = err instanceof Error ? err.message : String(err);
  }

  await logActivity({
    kind: "system.update",
    level: ok ? "info" : "warn",
    actor: admin,
    message: `Core ${action}: ${ok ? message : `failed (${message})`}`,
    meta: { coreAction: action, driver: settings.driver },
  });

  const status = getActiveBackend()?.status();
  const fb = isFallbackActive();
  const sidecarList = getSidecarManager()?.statusList() ?? null;
  return NextResponse.json({
    ok,
    message,
    status: status
      ? {
          ...status,
          fallbackActive: fb.active,
          fallbackReason: fb.reason,
          ...(sidecarList ? { sidecars: sidecarList } : {}),
        }
      : null,
  });
}
