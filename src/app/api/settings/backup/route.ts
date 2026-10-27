import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";

/* ============================================================
   Sephiroth · Phase 7 — Backup export (admin)
   GET /api/settings/backup → downloadable JSON snapshot of the
   WHOLE panel: inbounds (with embedded client projections),
   users (+ per-inbound accesses), sub groups (+ members),
   resellers, sale templates, hosts, nodes, outbounds (incl.
   WARP), routing rules, relay tunnels and panel settings.
   Secrets: password hashes are included so a restore is faithful;
   the session secret AND the Telegram bot token are NEVER exported.
   ============================================================ */

export async function buildBackupPayload() {
  const [
    inbounds,
    users,
    subGroups,
    resellers,
    saleTemplates,
    hosts,
    nodes,
    outbounds,
    routingRules,
    relayTunnels,
    settingsRows,
  ] = await Promise.all([
    db.inbound.findMany({ orderBy: { createdAt: "asc" } }),
    db.clientUser.findMany({
      orderBy: { createdAt: "asc" },
      include: { accesses: true },
    }),
    db.subGroup.findMany({ orderBy: { createdAt: "asc" } }),
    db.reseller.findMany({ orderBy: { createdAt: "asc" } }),
    db.saleTemplate.findMany({ orderBy: { createdAt: "asc" } }),
    db.host.findMany({ orderBy: { createdAt: "asc" } }),
    db.node.findMany({ orderBy: { createdAt: "asc" } }),
    db.outbound.findMany({ orderBy: { sortOrder: "asc" } }),
    db.routingRule.findMany({ orderBy: { sortOrder: "asc" } }),
    db.relayTunnel.findMany({ orderBy: { createdAt: "asc" } }),
    db.serverSetting.findMany(),
  ]);

  const members = await db.subGroupMember.findMany();
  const membersByGroup = new Map<string, string[]>();
  for (const m of members) {
    const list = membersByGroup.get(m.groupId) ?? [];
    list.push(m.userId);
    membersByGroup.set(m.groupId, list);
  }

  const settings: Record<string, string> = {};
  for (const row of settingsRows) {
    if (row.key === "session_secret") continue; // never exported
    if (row.key === "set_tg_token") continue; // Task 23-c: the bot token must NEVER leave the panel via backups
    settings[row.key] = row.value;
  }

  return {
    app: "sephiroth" as const,
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: {
      inbounds: inbounds.length,
      users: users.length,
      subGroups: subGroups.length,
      resellers: resellers.length,
      saleTemplates: saleTemplates.length,
      hosts: hosts.length,
      nodes: nodes.length,
      outbounds: outbounds.length,
      routingRules: routingRules.length,
      relayTunnels: relayTunnels.length,
    },
    data: {
      inbounds,
      users: users.map((u) => ({ ...u, accesses: undefined, accessList: u.accesses })),
      subGroups: subGroups.map((g) => ({
        ...g,
        memberUserIds: membersByGroup.get(g.id) ?? [],
      })),
      resellers,
      saleTemplates,
      hosts,
      nodes,
      outbounds,
      routingRules,
      relayTunnels,
      settings,
    },
  };
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const payload = await buildBackupPayload();

    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14);
    const body = JSON.stringify(payload, null, 2);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="sephiroth-backup-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[settings:backup]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
