import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { getCoreSettings, getGeneralSettings, getTelegramSettings, getTelegramToken } from "@/lib/settings";
import { buildBackupPayload } from "@/app/api/settings/backup/route";
import { syncUserProjection } from "@/lib/user-sync";
import { logActivity } from "@/lib/activity";
import { genAccessFields } from "@/lib/users";

const COMMAND_LIST = [
  "Sephiroth Orbit Bot commands:",
  "/status — real system telemetry",
  "/users — top users by consumption",
  "/create_trial — create a 5GB / 7-day trial user",
  "/backup_now — send a real snapshot to the Telegram admin chat",
].join("\n");

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { command?: string };
    const cmd = String(body.command || "/status").trim();

    const [inbounds, users, nodes, tunnels, resellers] = await Promise.all([
      db.inbound.findMany(),
      db.clientUser.findMany(),
      db.node.findMany(),
      db.relayTunnel.findMany(),
      db.reseller.findMany(),
    ]);

    if (cmd === "/status") {
      // REAL counts from the store + process uptime — no fabricated version
      const [core, general] = await Promise.all([getCoreSettings(), getGeneralSettings()]);
      const onlineInbounds = inbounds.filter((i) => i.status === "online").length;
      const enabledUsers = users.filter((u) => u.enabled).length;
      const totalTrafficGb = users.reduce((acc, u) => acc + (Number(u.usedTrafficGb) || 0), 0);
      const coreLine =
        core.driver === "simulator"
          ? `• Core Engine: built-in simulator (tick ${core.tickSeconds}s)`
          : `• Core Engine: Xray API ${core.apiHost}:${core.apiPort}`;
      const warp = await db.outbound.findFirst({ where: { tag: "warp" } });
      return NextResponse.json({
        ok: true,
        command: cmd,
        reply: [
          "🛰 **Sephiroth Orbit Bot · System Telemetry**",
          coreLine,
          `• Active Inbounds: ${onlineInbounds} / ${inbounds.length}`,
          `• Users: ${enabledUsers} enabled / ${users.length} total`,
          `• Fleet Nodes: ${nodes.length} (${tunnels.length} Relay Tunnels)`,
          `• Resellers: ${resellers.length}`,
          `• Total Consumed Traffic: ${totalTrafficGb.toFixed(2)} GB`,
          `• WARP+ Outbound: ${warp ? "configured (engage.cloudflareclient.com)" : "not configured"}`,
          `• Panel Uptime: ${formatUptime(process.uptime())}`,
          general.publicHost ? `• Public Host: ${general.publicHost}` : null,
        ].filter((line): line is string => typeof line === "string").join("\n"),
      });
    }

    if (cmd === "/users") {
      const top = [...users]
        .sort((a, b) => (Number(b.usedTrafficGb) || 0) - (Number(a.usedTrafficGb) || 0))
        .slice(0, 5);
      return NextResponse.json({
        ok: true,
        command: cmd,
        reply: [
          "👥 **Top Users & Quota Report**",
          ...(top.length
            ? top.map(
                (u, idx) =>
                  `${idx + 1}. \`${u.username}\` — ${Number(u.usedTrafficGb || 0).toFixed(1)} / ${
                    u.trafficLimitGb ?? "∞"
                  } GB (${u.enabled ? "Active" : "Disabled"})`
              )
            : ["No users created yet."]),
        ].join("\n"),
      });
    }

    if (cmd === "/create_trial") {
      const suffix = randomBytes(2).toString("hex");
      const username = `tg_trial_${suffix}`;
      const subId = randomBytes(8).toString("hex");
      const firstInbound = inbounds[0];

      const user = await db.clientUser.create({
        data: {
          username,
          subId,
          note: "Created via Telegram Bot (/create_trial)",
          enabled: true,
          trafficLimitGb: 5,
          expiryDays: 7,
          ipLimit: 2,
          usedTrafficGb: 0,
          ...(firstInbound
            ? (() => {
                const material = genAccessFields(firstInbound.protocol);
                return {
                  accesses: {
                    create: [
                      {
                        inboundId: firstInbound.id,
                        email: `${username}@sephiroth`,
                        key: material.key,
                        flow: firstInbound.security === "reality" ? "xtls-rprx-vision" : "",
                        wgPrivateKey: material.wgPrivateKey,
                        wgPublicKey: material.wgPublicKey,
                      },
                    ],
                  },
                };
              })()
            : {}),
        },
      });

      // project the trial into inbound.clientsJson so the core-facing
      // config matches what POST /api/users produces
      await syncUserProjection(user.id, {
        ipLimit: 2,
        trafficLimitGb: 5,
        expiryDays: 7,
        enabled: true,
      });

      await logActivity({
        kind: "user.created",
        level: "success",
        actor: "telegram-bot",
        message: `Telegram Bot created 5GB/7d trial user "${user.username}"`,
      });

      return NextResponse.json({
        ok: true,
        command: cmd,
        subUrl: `/sub/${subId}`,
        reply: [
          "✅ **Trial User Created Successfully!**",
          `• Username: \`${username}\``,
          `• Traffic Limit: 5 GB · Expiry: 7 Days (2 IPs)`,
          `• Subscription Link: \`/sub/${subId}\``,
          `• Clash Meta URL: \`/api/sub/${subId}?format=clash\``,
          `• Sing-Box URL: \`/api/sub/${subId}?format=singbox\``,
        ].join("\n"),
      });
    }

    if (cmd === "/backup_now") {
      // Build the REAL backup payload (same as GET /api/settings/backup)
      const payload = await buildBackupPayload();
      const json = JSON.stringify(payload, null, 2);
      const sha = createHash("sha256").update(json).digest("hex");
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `sephiroth-backup-${stamp}.json`;
      const countsLine = `• Contains: ${payload.counts.inbounds} inbounds, ${payload.counts.users} users, ${payload.counts.nodes} nodes, ${payload.counts.relayTunnels} tunnels, ${payload.counts.outbounds} outbounds`;

      const [token, tg] = await Promise.all([getTelegramToken(), getTelegramSettings()]);
      const chatId = tg.chatId;

      let delivered = false;
      let failure = "";
      if (token && chatId) {
        try {
          const form = new FormData();
          form.append("chat_id", chatId);
          form.append("caption", `Sephiroth backup ${stamp} · sha256:${sha.slice(0, 16)}…`);
          form.append("document", new Blob([json], { type: "application/json" }), filename);
          const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
            method: "POST",
            body: form,
          });
          delivered = res.ok;
          if (!res.ok) failure = `Telegram API HTTP ${res.status}`;
        } catch (err) {
          failure = err instanceof Error ? err.message : "network error";
        }
      }

      await logActivity({
        kind: "backup.exported",
        level: delivered ? "success" : "warn",
        actor: "telegram-bot",
        message: delivered
          ? `Backup snapshot ${filename} delivered to Telegram chat`
          : `Backup snapshot built (delivery not completed: ${failure || "no bot token configured"})`,
        meta: { sha256: sha, delivered },
      });

      if (delivered) {
        return NextResponse.json({
          ok: true,
          command: cmd,
          reply: [
            "📦 **Backup Snapshot Delivered**",
            `• File: \`${filename}\` sent to the configured admin chat`,
            countsLine,
            `• SHA-256: \`${sha}\``,
          ].join("\n"),
        });
      }

      // honest failure reply — payload really exists, delivery did not happen
      return NextResponse.json({
        ok: true,
        command: cmd,
        reply: [
          "📦 **Backup Snapshot Built (NOT delivered)**",
          token ? `• Delivery failed: ${failure || "chat id missing"}` : "• No Telegram bot token/chat configured in settings",
          countsLine,
          `• Payload SHA-256: \`${sha}\``,
          "• Configure the bot token + chat id in Settings → Telegram to enable delivery.",
        ].join("\n"),
      });
    }

    // unknown command — real command list, no fake "Executed" confirmation
    return NextResponse.json({
      ok: true,
      command: cmd,
      reply: `❓ Unknown command \`${cmd}\`.\n\n${COMMAND_LIST}`,
    });
  } catch (err) {
    console.error("[telegram:bot-action]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
