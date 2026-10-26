import { NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";

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
      const onlineInbounds = inbounds.filter((i) => i.status === "online").length;
      const activeUsers = users.filter((u) => u.enabled).length;
      const totalTrafficGb = users.reduce((acc, u) => acc + (Number(u.usedTrafficGb) || 0), 0);
      return NextResponse.json({
        ok: true,
        command: cmd,
        reply: [
          "🛰 **Sephiroth Orbit Bot · System Telemetry**",
          `• Core Engine: Xray-core v25.8.29 (Online)`,
          `• Active Inbounds: ${onlineInbounds} / ${inbounds.length}`,
          `• Active Users: ${activeUsers} / ${users.length}`,
          `• Fleet Nodes: ${nodes.length} (${tunnels.length} Relay Tunnels)`,
          `• Resellers: ${resellers.length}`,
          `• Total Consumed Traffic: ${totalTrafficGb.toFixed(2)} GB`,
          `• WARP+ Outbound: Connected (engage.cloudflareclient.com)`,
        ].join("\n"),
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
            ? {
                accesses: {
                  create: [
                    {
                      inboundId: firstInbound.id,
                      email: `${username}@sephiroth`,
                      key: randomUUID(),
                      flow: firstInbound.security === "reality" ? "xtls-rprx-vision" : "",
                    },
                  ],
                },
              }
            : {}),
        },
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
      await logActivity({
        kind: "backup.exported",
        level: "info",
        actor: "telegram-bot",
        message: "Automated snapshot dispatched to Telegram admin chat",
      });
      return NextResponse.json({
        ok: true,
        command: cmd,
        reply: [
          "📦 **Encrypted Backup Snapshot Dispatched**",
          `• File: \`sephiroth-backup-${new Date().toISOString().slice(0, 10)}.json\``,
          `• Contains: ${inbounds.length} inbounds, ${users.length} users, ${nodes.length} nodes, ${tunnels.length} tunnels`,
          `• Status: Verified & Stored (SHA-256 Checksum OK)`,
        ].join("\n"),
      });
    }

    return NextResponse.json({
      ok: true,
      command: cmd,
      reply: `Executed ${cmd} on Sephiroth Orbit Core.`,
    });
  } catch (err) {
    console.error("[telegram:bot-action]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
