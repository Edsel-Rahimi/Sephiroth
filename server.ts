import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import { Server as SocketIOServer } from "socket.io";

import { CoreSim } from "./mini-services/core-sim/sim";
import { getTickMs, refreshTickMs } from "./mini-services/core-sim/db";
import type { ActivityEvent } from "./mini-services/core-sim/types";
import { ensureSeed } from "./src/lib/auth";
import { ensureNetSeeds } from "./src/lib/net-objects";
import { runAutoBackup } from "./src/lib/backup-job";
import { db } from "./src/lib/db";
import { logActivity } from "./src/lib/activity";
import { appVersion } from "./src/lib/settings";

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
import * as apiNodesIdProbe from "./src/app/api/nodes/[id]/probe/route";
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
import * as apiSystemDoctor from "./src/app/api/system/doctor/route";
import * as apiSystemRestart from "./src/app/api/system/restart/route";
import * as apiSystemUpdate from "./src/app/api/system/update/route";
import * as apiSystemUpdateInfo from "./src/app/api/system/update-info/route";
import * as apiSystemUpdateStatus from "./src/app/api/system/update-status/route";
import * as apiTelegramBotAction from "./src/app/api/telegram/bot-action/route";
import * as apiTunnels from "./src/app/api/tunnels/route";
import * as apiUsers from "./src/app/api/users/route";
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
  mountRoute(app, "/api/nodes/:id/probe", apiNodesIdProbe);
  mountRoute(app, "/api/nodes/:id", apiNodesId);

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
  mountRoute(app, "/api/system/doctor", apiSystemDoctor);
  mountRoute(app, "/api/system/restart", apiSystemRestart);
  mountRoute(app, "/api/system/update-info", apiSystemUpdateInfo);
  mountRoute(app, "/api/system/update-status", apiSystemUpdateStatus);
  mountRoute(app, "/api/system/update", apiSystemUpdate);

  mountRoute(app, "/api/telegram/bot-action", apiTelegramBotAction);
  mountRoute(app, "/api/tunnels", apiTunnels);

  mountRoute(app, "/api/users/bulk", apiUsersBulk);
  mountRoute(app, "/api/users", apiUsers);
  mountRoute(app, "/api/users/:id", apiUsersId);

  // Reference-panel proxy (Next-style catch-all: /ref/[panel]/[[...path]])
  mountRoute(app, "/ref/:panel", apiRefProxy);
  mountRoute(app, "/ref/:panel/*", apiRefProxy);

  // Attach Socket.IO live Xray-core telemetry simulator
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const sim = new CoreSim(`${appVersion()}-sim`);
  // Mirror initial DB state into simulator
  sim.mirrorDb();

  function emitEvent(event: ActivityEvent): void {
    io.emit("core:event", { event });
  }

  io.on("connection", (socket) => {
    socket.emit("core:init", sim.snapshot());
  });

  function tickLoop(): void {
    refreshTickMs();
    try {
      io.emit("core:tick", sim.tick());
    } catch (err) {
      console.error("[core-sim] tick error:", err);
    }
    setTimeout(tickLoop, getTickMs());
  }
  tickLoop();

  setInterval(() => {
    try {
      io.emit("core:inbounds", sim.inboundsPayload());
    } catch (err) {
      console.error("[core-sim] inbounds broadcast error:", err);
    }
  }, 10000);

  setInterval(() => {
    try {
      const events = sim.mirrorDb();
      if (events.length > 0) {
        io.emit("core:inbounds", sim.inboundsPayload());
        for (const e of events) emitEvent(e);
      }
    } catch (err) {
      console.error("[core-sim] mirrorDb error:", err);
    }
  }, 2000);

  // Periodic user traffic reset & expiry check + daily auto-backup
  setInterval(() => {
    void runPeriodicUserMaintenance();
    void runAutoBackup();
  }, 60_000);
  // first auto-backup chance shortly after boot (also primes security settings)
  setTimeout(() => {
    void runAutoBackup();
  }, 20_000);

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
