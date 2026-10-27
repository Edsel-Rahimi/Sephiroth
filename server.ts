import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import { Server as SocketIOServer } from "socket.io";

import { CoreSim } from "./mini-services/core-sim/sim";
import { getTickMs, refreshTickMs } from "./mini-services/core-sim/db";
import type { ActivityEvent } from "./mini-services/core-sim/types";
import { SimBackend } from "./src/lib/core/sim-backend";
import { XrayDriver } from "./src/lib/core/xray";
import { SidecarManager } from "./src/lib/core/sidecars"; // Task 23-e — hysteria2 sidecar engines
import type { CoreBackend } from "./src/lib/core/types";
import {
  getActiveBackend,
  getSidecarManager,
  setActiveBackend,
  setSidecarManager,
  swapBackend,
} from "./src/lib/core/registry";
import { ensureSeed } from "./src/lib/auth";
import { ensureNetSeeds } from "./src/lib/net-objects";
import { runAutoBackup } from "./src/lib/backup-job";
import { db } from "./src/lib/db";
import { logActivity } from "./src/lib/activity";
import { appVersion, getCoreSettings } from "./src/lib/settings";

// Import all Next-style route handlers
import * as apiRoot from "./src/app/api/route";
import * as apiActivity from "./src/app/api/activity/route";
import * as apiAuthChangePassword from "./src/app/api/auth/change-password/route";
import * as apiAuthLogin from "./src/app/api/auth/login/route";
import * as apiAuthLogout from "./src/app/api/auth/logout/route";
import * as apiAuthRecover from "./src/app/api/auth/recover/route";
import * as apiAuthRecoveryRotate from "./src/app/api/auth/recovery/rotate/route";
import * as apiAuthRevokeSessions from "./src/app/api/auth/revoke-sessions/route";
import * as apiAuthSession from "./src/app/api/auth/session/route";
import * as apiHosts from "./src/app/api/hosts/route";
import * as apiHostsId from "./src/app/api/hosts/[id]/route";
import * as apiInbounds from "./src/app/api/inbounds/route";
import * as apiInboundsId from "./src/app/api/inbounds/[id]/route";
import * as apiNodes from "./src/app/api/nodes/route";
import * as apiNodesId from "./src/app/api/nodes/[id]/route";
import * as apiAgentInfo from "./src/app/api/agent/info/route";
import * as apiAgentInbounds from "./src/app/api/agent/inbounds/route";
import * as apiAgentApply from "./src/app/api/agent/apply/route";
import * as apiAgentTraffic from "./src/app/api/agent/traffic/route";
import * as apiNodesIdProbe from "./src/app/api/nodes/[id]/probe/route";
import * as apiNodesIdApply from "./src/app/api/nodes/[id]/apply/route";
import * as apiNodesIdStats from "./src/app/api/nodes/[id]/stats/route";
import * as apiNodesIdInfo from "./src/app/api/nodes/[id]/info/route";
import * as apiOutbounds from "./src/app/api/outbounds/route";
import * as apiOutboundsTrafficReset from "./src/app/api/outbounds/traffic-reset/route";
import * as apiOutboundsId from "./src/app/api/outbounds/[id]/route";
import * as apiOutboundsIdTest from "./src/app/api/outbounds/[id]/test/route";
import * as apiProfile from "./src/app/api/profile/route";
import * as apiResellers from "./src/app/api/resellers/route";
import * as apiResellersId from "./src/app/api/resellers/[id]/route";
import * as apiRouting from "./src/app/api/routing/route";
import * as apiSaleTemplates from "./src/app/api/sale-templates/route";
import * as apiSaleTemplatesId from "./src/app/api/sale-templates/[id]/route";
import * as apiSettings from "./src/app/api/settings/route";
import * as apiSettingsBackup from "./src/app/api/settings/backup/route";
import * as apiSettingsRestore from "./src/app/api/settings/restore/route";
import * as apiSettingsTestCore from "./src/app/api/settings/test-core/route";
import * as apiSettingsTestTelegram from "./src/app/api/settings/test-telegram/route";
import * as apiSubGroups from "./src/app/api/sub/groups/route";
import * as apiSubGroupsId from "./src/app/api/sub/groups/[id]/route";
import * as apiSubToken from "./src/app/api/sub/[token]/route";
import * as apiSystemBackups from "./src/app/api/system/backups/route";
import * as apiSystemCoreAction from "./src/app/api/system/core-action/route";
import * as apiSystemCoreInstall from "./src/app/api/system/core-install/route";
import * as apiSystemCoreLog from "./src/app/api/system/core-log/route";
import * as apiSystemCoreStatus from "./src/app/api/system/core-status/route";
import * as apiSystemDoctor from "./src/app/api/system/doctor/route";
import * as apiSystemRestart from "./src/app/api/system/restart/route";
import * as apiSystemServerInfo from "./src/app/api/system/server-info/route";
import * as apiSystemUpdate from "./src/app/api/system/update/route";
import * as apiSystemUpdateInfo from "./src/app/api/system/update-info/route";
import * as apiSystemUpdateStatus from "./src/app/api/system/update-status/route";
import * as apiTelegramBotAction from "./src/app/api/telegram/bot-action/route";
import * as apiTelegramBotStatus from "./src/app/api/telegram/bot-status/route";
import { salesWorkerBoot, salesWorkerShutdown } from "./src/lib/bot/sales-worker"; // Task 23-c — Sephiroth Sales Bot worker
import { runSslRenewalTick } from "./src/lib/acme"; // Task 23-f — daily ACME renewal watcher
import * as apiSystemSsl from "./src/app/api/system/ssl/route";
import * as apiSystemSslInstall from "./src/app/api/system/ssl-install-acme/route";
import * as apiSystemSslIssue from "./src/app/api/system/ssl-issue/route";
import * as apiTunnels from "./src/app/api/tunnels/route";
import * as apiUsers from "./src/app/api/users/route";
import * as apiUsersIpUsage from "./src/app/api/users/ip-usage/route"; // Task 23-g — concurrent-IP usage
import * as apiUsersResetDevices from "./src/app/api/users/[id]/reset-devices/route"; // Task 23-g — HWID reset
import * as apiUsersBulk from "./src/app/api/users/bulk/route";
import * as apiUsersId from "./src/app/api/users/[id]/route";
import * as apiRefProxy from "./src/app/ref/[panel]/[[...path]]/route";

type RouteHandler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response> | Response;

function mountRoute(app: express.Express, expressPath: string, mod: unknown) {
  const handlers = mod as Record<string, RouteHandler | undefined>;
  app.all(expressPath, async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const method = req.method.toUpperCase();
      const handler = handlers[method];
      if (!handler) {
        res.status(405).json({ error: `Method ${method} Not Allowed` });
        return;
      }

      const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
      const host = req.headers.host || "localhost:3000";
      const fullUrl = `${proto}://${host}${req.originalUrl}`;

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, item);
        } else if (typeof v === "string") {
          headers.set(k, v);
        }
      }

      const hasBody = method !== "GET" && method !== "HEAD";
      const rawBody = hasBody && Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;

      const webReq = new Request(fullUrl, {
        method,
        headers,
        body: rawBody ? new Uint8Array(rawBody) : undefined,
      });

      const paramsObj: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.params)) {
        if (typeof v === "string") paramsObj[k] = v;
      }

      const webRes = await handler(webReq, {
        params: Promise.resolve(paramsObj),
      });

      res.status(webRes.status);

      webRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") return;
        res.setHeader(key, value);
      });

      const setCookies =
        typeof (webRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
          ? (webRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
          : [];
      if (setCookies.length > 0) {
        res.setHeader("set-cookie", setCookies);
      } else {
        const singleCookie = webRes.headers.get("set-cookie");
        if (singleCookie) res.setHeader("set-cookie", singleCookie);
      }

      const buf = Buffer.from(await webRes.arrayBuffer());
      res.send(buf);
    } catch (err) {
      console.error(`[api] Error in ${expressPath}:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Internal Server Error",
        });
      }
    }
  });
}

async function runPeriodicUserMaintenance(): Promise<void> {
  try {
    const users = await db.clientUser.findMany();
    const now = new Date();
    const nowMs = now.getTime();
    let expiredCount = 0;
    let resetCount = 0;

    for (const user of users) {
      // 1) expiry enforcement — idempotent: expired users get disabled once
      if (user.enabled && user.expiryDays !== null) {
        const endsAt = new Date(user.createdAt).getTime() + user.expiryDays * 86_400_000;
        if (nowMs >= endsAt) {
          await db.clientUser.update({ where: { id: user.id }, data: { enabled: false } });
          expiredCount += 1;
          console.log(`[cron] user "${user.username}" expired — disabled`);
          void logActivity({
            kind: "user.updated",
            level: "warn",
            actor: "system",
            message: `User "${user.username}" expired and was disabled by maintenance`,
            meta: { userId: user.id, username: user.username, reason: "expired" },
          });
          continue;
        }
      }

      // 2) traffic counter reset by period (daily=1d, weekly=7d,
      //    monthly=calendar month — NOT a fixed 30 days)
      const period = user.resetPeriod;
      if (period && period !== "none") {
        const refTime = new Date(user.lastResetAt ?? user.createdAt).getTime();
        let due = false;
        if (period === "daily") {
          due = nowMs - refTime >= 86_400_000;
        } else if (period === "weekly") {
          due = nowMs - refTime >= 7 * 86_400_000;
        } else if (period === "monthly") {
          const ref = new Date(refTime);
          due =
            now.getFullYear() > ref.getFullYear() ||
            (now.getFullYear() === ref.getFullYear() && now.getMonth() > ref.getMonth());
        }
        if (due) {
          const hadTraffic = (Number(user.usedTrafficGb) || 0) !== 0;
          await db.clientUser.update({
            where: { id: user.id },
            data: { usedTrafficGb: 0, lastResetAt: now },
          });
          if (hadTraffic) {
            resetCount += 1;
            console.log(`[cron] traffic counter reset for "${user.username}" (${period})`);
            void logActivity({
              kind: "user.updated",
              level: "info",
              actor: "system",
              message: `Traffic counter reset for "${user.username}" (${period})`,
              meta: { userId: user.id, username: user.username, period },
            });
          }
        }
      }
    }

    if (expiredCount || resetCount) {
      console.log(`[cron] user maintenance: ${expiredCount} expired, ${resetCount} traffic reset(s)`);
    }
  } catch (err) {
    console.error("[cron] user maintenance error:", err);
  }
}

async function startServer() {
  // Ensure database seeds exist before starting simulator or serving requests
  await ensureSeed();
  await ensureNetSeeds();
  await runPeriodicUserMaintenance();

  const app = express();
  const httpServer = http.createServer(app);

  // Raw body parser for /api/* so Web Request can consume body stream directly
  app.use("/api", express.raw({ type: "*/*", limit: "25mb" }));
  // Same for /ref/* so proxied POST/PUT/PATCH bodies reach the reference panels
  app.use("/ref", express.raw({ type: "*/*", limit: "25mb" }));

  // Mount specific routes before parameterized routes
  mountRoute(app, "/api", apiRoot);
  mountRoute(app, "/api/activity", apiActivity);
  mountRoute(app, "/api/auth/change-password", apiAuthChangePassword);
  mountRoute(app, "/api/auth/login", apiAuthLogin);
  mountRoute(app, "/api/auth/logout", apiAuthLogout);
  mountRoute(app, "/api/auth/recover", apiAuthRecover);
  mountRoute(app, "/api/auth/recovery/rotate", apiAuthRecoveryRotate);
  mountRoute(app, "/api/auth/revoke-sessions", apiAuthRevokeSessions);
  mountRoute(app, "/api/auth/session", apiAuthSession);

  mountRoute(app, "/api/hosts", apiHosts);
  mountRoute(app, "/api/hosts/:id", apiHostsId);

  mountRoute(app, "/api/inbounds", apiInbounds);
  mountRoute(app, "/api/inbounds/:id", apiInboundsId);

  mountRoute(app, "/api/nodes", apiNodes);
  mountRoute(app, "/api/nodes/:id/apply", apiNodesIdApply);
  mountRoute(app, "/api/nodes/:id/stats", apiNodesIdStats);
  mountRoute(app, "/api/nodes/:id/info", apiNodesIdInfo);
  mountRoute(app, "/api/nodes/:id/probe", apiNodesIdProbe);
  mountRoute(app, "/api/nodes/:id", apiNodesId);

  // Agent surface (node mode only) — the routes themselves answer 404
  // when SEPH_NODE_MODE is off, so mounting them unconditionally is safe.
  mountRoute(app, "/api/agent/info", apiAgentInfo);
  mountRoute(app, "/api/agent/inbounds", apiAgentInbounds);
  mountRoute(app, "/api/agent/apply", apiAgentApply);
  mountRoute(app, "/api/agent/traffic", apiAgentTraffic);

  mountRoute(app, "/api/outbounds/traffic-reset", apiOutboundsTrafficReset);
  mountRoute(app, "/api/outbounds", apiOutbounds);
  mountRoute(app, "/api/outbounds/:id/test", apiOutboundsIdTest);
  mountRoute(app, "/api/outbounds/:id", apiOutboundsId);

  mountRoute(app, "/api/profile", apiProfile);

  mountRoute(app, "/api/resellers", apiResellers);
  mountRoute(app, "/api/resellers/:id", apiResellersId);

  mountRoute(app, "/api/routing", apiRouting);

  mountRoute(app, "/api/sale-templates", apiSaleTemplates);
  mountRoute(app, "/api/sale-templates/:id", apiSaleTemplatesId);

  mountRoute(app, "/api/settings/backup", apiSettingsBackup);
  mountRoute(app, "/api/settings/restore", apiSettingsRestore);
  mountRoute(app, "/api/settings/test-core", apiSettingsTestCore);
  mountRoute(app, "/api/settings/test-telegram", apiSettingsTestTelegram);
  mountRoute(app, "/api/settings", apiSettings);

  mountRoute(app, "/api/sub/groups", apiSubGroups);
  mountRoute(app, "/api/sub/groups/:id", apiSubGroupsId);
  mountRoute(app, "/api/sub/:token", apiSubToken);

  mountRoute(app, "/api/system/backups", apiSystemBackups);
  mountRoute(app, "/api/system/core-status", apiSystemCoreStatus);
  mountRoute(app, "/api/system/core-action", apiSystemCoreAction);
  mountRoute(app, "/api/system/core-install", apiSystemCoreInstall);
  mountRoute(app, "/api/system/core-log", apiSystemCoreLog);
  mountRoute(app, "/api/system/doctor", apiSystemDoctor);
  mountRoute(app, "/api/system/restart", apiSystemRestart);
  mountRoute(app, "/api/system/server-info", apiSystemServerInfo);
  mountRoute(app, "/api/system/ssl", apiSystemSsl); // Task 23-f — managed certs
  mountRoute(app, "/api/system/ssl-install-acme", apiSystemSslInstall);
  mountRoute(app, "/api/system/ssl-issue", apiSystemSslIssue);
  mountRoute(app, "/api/system/update-info", apiSystemUpdateInfo);
  mountRoute(app, "/api/system/update-status", apiSystemUpdateStatus);
  mountRoute(app, "/api/system/update", apiSystemUpdate);

  mountRoute(app, "/api/telegram/bot-action", apiTelegramBotAction);
  mountRoute(app, "/api/telegram/bot-status", apiTelegramBotStatus); // Task 23-c
  mountRoute(app, "/api/tunnels", apiTunnels);

  mountRoute(app, "/api/users/bulk", apiUsersBulk);
  mountRoute(app, "/api/users/ip-usage", apiUsersIpUsage); // Task 23-g — BEFORE :id
  mountRoute(app, "/api/users/:id/reset-devices", apiUsersResetDevices); // Task 23-g
  mountRoute(app, "/api/users", apiUsers);
  mountRoute(app, "/api/users/:id", apiUsersId);

  // Reference-panel proxy (Next-style catch-all: /ref/[panel]/[[...path]])
  mountRoute(app, "/ref/:panel", apiRefProxy);
  mountRoute(app, "/ref/:panel/*", apiRefProxy);

  // Attach Socket.IO live core telemetry — simulator (default) or a REAL
  // Xray process (opt-in via settings · core driver). Both implement the
  // same CoreBackend surface, so the io wiring below is driver-agnostic.
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const coreSettings = await getCoreSettings();
  const sim = new CoreSim(`${appVersion()}-sim`);
  const simBackend = new SimBackend(sim, `${appVersion()}-sim`);

  // The simulator answers immediately; if the admin opted into the real
  // Xray core we swap the registry backend once the process is up, falling
  // back to the simulator (with a surfaced reason) on any failure.
  // NOTE: never cache the backend in a local — runtime driver switches via
  // /api/system/core-action swap the REGISTRY, so every loop must re-read it.
  const activeCore = (): CoreBackend => getActiveBackend() ?? simBackend;
  setActiveBackend(simBackend);
  sim.mirrorDb();

  if (coreSettings.driver === "xray") {
    void (async () => {
      try {
        const driver = new XrayDriver({
          binPath: coreSettings.xrayBin,
          versionPin: coreSettings.xrayVersion,
          statsIntervalMs: coreSettings.statsInterval * 1000,
        });
        await driver.start();
        await swapBackend(driver);
        console.log("[core] REAL Xray driver active (v" + driver.status().version + ")");
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[core] Xray driver failed to start — simulator fallback: ${reason}`);
        setActiveBackend(simBackend, { active: true, reason });
      }
    })();
  }

  function emitEvent(event: ActivityEvent): void {
    io.emit("core:event", { event });
  }

  // Task 23-e — hysteria2 sidecar engines. Hysteria2 inbounds can never be
  // served by the Xray core, so they get one real OS process each, managed
  // NEXT TO the backend (works with sim AND xray drivers). The 2s mirror
  // loop hash-diffs the store and reloads only changed sidecars; shutdown
  // tears them down next to the core.
  const sidecarManager = new SidecarManager({
    statsIntervalMs: coreSettings.statsInterval * 1000,
  });
  setSidecarManager(sidecarManager);
  sidecarManager.onEvent = emitEvent;
  setTimeout(() => {
    void sidecarManager
      .start()
      .then(() => {
        const n = getSidecarManager()?.statusList().length ?? 0;
        if (n > 0) {
          console.log(`[sidecars] ${n} hysteria2 engine(s) running (v${sidecarManager.version()})`);
        }
      })
      .catch((err) =>
        console.warn("[sidecars] start failed:", err instanceof Error ? err.message : err)
      );
  }, 2_000);

  io.on("connection", (socket) => {
    socket.emit("core:init", activeCore().snapshot());
  });

  function tickLoop(): void {
    refreshTickMs();
    try {
      io.emit("core:tick", activeCore().tick());
    } catch (err) {
      console.error("[core] tick error:", err);
    }
    setTimeout(tickLoop, getTickMs());
  }
  tickLoop();

  setInterval(() => {
    try {
      io.emit("core:inbounds", activeCore().inboundsPayload());
    } catch (err) {
      console.error("[core] inbounds broadcast error:", err);
    }
  }, 10000);

  setInterval(() => {
    try {
      const events = activeCore().mirrorDb();
      // Task 23-e — sidecars hash-diff the same store changes
      sidecarManager.mirrorDb();
      if (events.length > 0) {
        io.emit("core:inbounds", activeCore().inboundsPayload());
        for (const e of events) emitEvent(e);
      }
    } catch (err) {
      console.error("[core] mirrorDb error:", err);
    }
  }, 2000);

  // Graceful shutdown — never leave the real xray process or the hysteria
  // sidecars orphaned.
  const shutdownCore = (signal: string): void => {
    console.log(`[sephiroth] ${signal} received — stopping core…`);
    salesWorkerShutdown(); // Task 23-c — stop the sales bot long-poll first
    void getSidecarManager()
      ?.dispose()
      .catch(() => undefined);
    const backend = getActiveBackend();
    const finish = (): void => process.exit(0);
    if (!backend) {
      finish();
      return;
    }
    const killer = setTimeout(finish, 6000);
    void backend
      .dispose()
      .catch(() => {
        /* best effort */
      })
      .finally(() => {
        clearTimeout(killer);
        finish();
      });
  };
  process.on("SIGTERM", () => shutdownCore("SIGTERM"));
  process.on("SIGINT", () => shutdownCore("SIGINT"));

  // Periodic user traffic reset & expiry check + daily auto-backup
  setInterval(() => {
    void runPeriodicUserMaintenance();
    void runAutoBackup();
    void runSslRenewalTick(); // Task 23-f — day-rollover ACME renewal check
  }, 60_000);
  // first auto-backup chance shortly after boot (also primes security settings)
  setTimeout(() => {
    void runAutoBackup();
  }, 20_000);

  // Task 23-c — start the Sephiroth Sales Bot worker when settings say
  // botMode=sales + a bot token exists (no-op otherwise; also re-synced on
  // every telegram settings save via the settings API route).
  setTimeout(() => {
    void salesWorkerBoot().catch((err) =>
      console.warn("[sephiroth] sales worker boot failed:", err)
    );
  }, 3_000);

  // Serve static dist in production (or whenever a built dist/ exists),
  // Vite middleware in development. Vite is imported lazily so the
  // production bundle never needs it at runtime.
  const distPath = path.join(process.cwd(), "dist");
  if (process.env.NODE_ENV === "production" || existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  // PORT (generic) / SERVER_PORT (Pterodactyl-style hosts like KataBump)
  const PORT = Number(process.env.PORT) || Number(process.env.SERVER_PORT) || 3000;
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[sephiroth] Full-stack panel + Xray core simulator listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[sephiroth] Failed to start server:", err);
  process.exit(1);
});
