import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth"; // task 3-b — restore is an owner-only wipe

/* ============================================================
   Sephiroth · Phase 7 — Backup restore (admin, destructive)
   POST /api/settings/restore  { confirm: "RESTORE", backup: <json> }
   Validates a Sephiroth backup file, then replaces ALL panel
   data inside one transaction (inbounds, users+accesses, sub
   groups+members, resellers, sale templates, hosts, nodes,
   outbounds, routing rules, relay tunnels, settings — the
   session secret is preserved, never overwritten). IDs from
   the backup are kept so cross-references survive. Network
   tables (hosts/nodes/outbounds/rules/tunnels) are OPTIONAL —
   older v1 backups without them still restore.
   ============================================================ */

interface BackupUserAccess {
  id: string;
  userId: string;
  inboundId: string;
  email: string;
  key: string;
  flow?: string;
}

interface BackupUser {
  id: string;
  username: string;
  subId: string;
  note?: string | null;
  enabled?: boolean;
  trafficLimitGb?: number | null;
  expiryDays?: number | null;
  ipLimit?: number;
  usedTrafficGb?: number;
  resellerId?: string | null;
  createdAt?: string;
  accessList?: BackupUserAccess[];
}

interface BackupPayload {
  app?: string;
  version?: number;
  data?: {
    inbounds?: Record<string, unknown>[];
    users?: BackupUser[];
    subGroups?: (Record<string, unknown> & { memberUserIds?: string[] })[];
    resellers?: Record<string, unknown>[];
    saleTemplates?: Record<string, unknown>[];
    hosts?: Record<string, unknown>[];
    nodes?: Record<string, unknown>[];
    outbounds?: Record<string, unknown>[];
    routingRules?: Record<string, unknown>[];
    relayTunnels?: Record<string, unknown>[];
    settings?: Record<string, string>;
  };
}

function toRows<T>(rows: unknown): T[] {
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function asDate(raw: unknown): Date {
  const d = new Date(String(raw ?? ""));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function asNum<T>(raw: unknown, fallback: T): number | T {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(req: Request) {
  try {
    // task 3-b — restore replaces the whole store: owner-only dangerous wipe
    const guard = await requireOwner(req);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
    const admin = guard.username;

    let body: { confirm?: string; backup?: BackupPayload };
    try {
      body = (await req.json()) as { confirm?: string; backup?: BackupPayload };
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    if (body.confirm !== "RESTORE") {
      return NextResponse.json({ error: "confirm_required" }, { status: 400 });
    }

    const backup = body.backup;
    if (
      !backup ||
      backup.app !== "sephiroth" ||
      backup.version !== 1 ||
      !backup.data ||
      typeof backup.data !== "object"
    ) {
      return NextResponse.json({ error: "invalid_backup" }, { status: 400 });
    }

    const d = backup.data;
    const inbounds = toRows<Record<string, unknown>>(d.inbounds);
    const users = toRows<BackupUser>(d.users);
    const subGroups = toRows<Record<string, unknown> & { memberUserIds?: string[] }>(d.subGroups);
    const resellers = toRows<Record<string, unknown>>(d.resellers);
    const saleTemplates = toRows<Record<string, unknown>>(d.saleTemplates);
    const hosts = toRows<Record<string, unknown>>(d.hosts);
    const nodes = toRows<Record<string, unknown>>(d.nodes);
    const outbounds = toRows<Record<string, unknown>>(d.outbounds);
    const routingRules = toRows<Record<string, unknown>>(d.routingRules);
    const relayTunnels = toRows<Record<string, unknown>>(d.relayTunnels);
    const settings = (d.settings && typeof d.settings === "object" ? d.settings : {}) as Record<string, string>;

    // structural sanity — every user access must reference a known user
    for (const u of users) {
      if (!u.id || !u.username || !u.subId) {
        return NextResponse.json({ error: "invalid_backup" }, { status: 400 });
      }
      for (const a of u.accessList ?? []) {
        if (!a.inboundId || !a.email || !a.key) {
          return NextResponse.json({ error: "invalid_backup" }, { status: 400 });
        }
      }
    }
    for (const inb of inbounds) {
      if (!inb.id || !inb.tag || !inb.protocol) {
        return NextResponse.json({ error: "invalid_backup" }, { status: 400 });
      }
    }

    try {
      const result = await db.$transaction(
        async (tx) => {
        // wipe in FK-safe order
        await tx.subGroupMember.deleteMany();
        await tx.subGroup.deleteMany();
        await tx.userInboundAccess.deleteMany();
        await tx.host.deleteMany();
        await tx.inbound.deleteMany();
        await tx.clientUser.deleteMany();
        await tx.saleTemplate.deleteMany();
        await tx.reseller.deleteMany();
        await tx.node.deleteMany();
        await tx.outbound.deleteMany();
        await tx.routingRule.deleteMany();
        await tx.relayTunnel.deleteMany();

        for (const b of inbounds) {
          await tx.inbound.create({
            data: {
              id: String(b.id),
              tag: String(b.tag),
              protocol: String(b.protocol),
              port: asNum(b.port, 0) as number,
              listen: String(b.listen ?? ""),
              transport: String(b.transport ?? "tcp"),
              security: String(b.security ?? "none"),
              status: String(b.status ?? "online"),
              note: (b.note as string | null) ?? null,
              trafficLimitGb: (b.trafficLimitGb as number | null) ?? null,
              expiryDays: (b.expiryDays as number | null | undefined) ?? null,
              clientsJson: String(b.clientsJson ?? "[]"),
              sniffingJson: String(b.sniffingJson ?? "{}"),
              streamJson: String(b.streamJson ?? "{}"),
              createdAt: asDate(b.createdAt),
              updatedAt: asDate(b.updatedAt),
            },
          });
        }

        for (const r of resellers) {
          await tx.reseller.create({
            data: {
              id: String(r.id),
              username: String(r.username),
              passwordHash: String(r.passwordHash ?? ""),
              note: (r.note as string | null) ?? null,
              enabled: r.enabled !== false,
              maxUsers: (r.maxUsers as number | null | undefined) ?? null,
              trafficQuotaGb: (r.trafficQuotaGb as number | null | undefined) ?? null,
              createdAt: asDate(r.createdAt),
              updatedAt: asDate(r.updatedAt),
            },
          });
        }

        for (const u of users) {
          await tx.clientUser.create({
            data: {
              id: u.id,
              username: u.username,
              subId: u.subId,
              note: u.note ?? null,
              enabled: u.enabled !== false,
              trafficLimitGb: u.trafficLimitGb ?? null,
              expiryDays: u.expiryDays ?? null,
              ipLimit: asNum(u.ipLimit, 0) as number,
              usedTrafficGb: asNum(u.usedTrafficGb, 0) as number,
              resellerId: u.resellerId ?? null,
              createdAt: u.createdAt ? asDate(u.createdAt) : new Date(),
              updatedAt: new Date(),
            },
          });
          for (const a of u.accessList ?? []) {
            await tx.userInboundAccess.create({
              data: {
                id: a.id,
                userId: u.id,
                inboundId: a.inboundId,
                email: a.email,
                key: a.key,
                flow: a.flow ?? "",
              },
            });
          }
        }

        for (const g of subGroups) {
          await tx.subGroup.create({
            data: {
              id: String(g.id),
              name: String(g.name ?? "Group"),
              token: String(g.token),
              passwordHash: (g.passwordHash as string | null) ?? null,
              infoLine: (g.infoLine as string | null) ?? null,
              enabled: g.enabled !== false,
              createdAt: asDate(g.createdAt),
              updatedAt: asDate(g.updatedAt),
            },
          });
          for (const userId of Array.isArray(g.memberUserIds) ? g.memberUserIds : []) {
            await tx.subGroupMember.create({
              data: { groupId: String(g.id), userId },
            });
          }
        }

        for (const t of saleTemplates) {
          await tx.saleTemplate.create({
            data: {
              id: String(t.id),
              name: String(t.name ?? "Template"),
              trafficLimitGb: (t.trafficLimitGb as number | null | undefined) ?? null,
              expiryDays: (t.expiryDays as number | null | undefined) ?? null,
              ipLimit: asNum(t.ipLimit, 0) as number,
              enabled: t.enabled !== false,
              createdAt: asDate(t.createdAt),
              updatedAt: asDate(t.updatedAt),
            },
          });
        }

        for (const h of hosts) {
          await tx.host.create({
            data: {
              id: String(h.id),
              inboundId: String(h.inboundId ?? ""),
              remark: String(h.remark ?? ""),
              address: String(h.address ?? ""),
              port: asNum(h.port, 0) as number,
              security: String(h.security ?? "same"),
              sni: String(h.sni ?? ""),
              hostHeader: String(h.hostHeader ?? ""),
              path: String(h.path ?? ""),
              alpn: String(h.alpn ?? ""),
              fingerprint: String(h.fingerprint ?? ""),
              enable: h.enable !== false,
              sortOrder: asNum(h.sortOrder, 0) as number,
              createdAt: asDate(h.createdAt),
              updatedAt: asDate(h.updatedAt),
            },
          });
        }

        for (const n of nodes) {
          await tx.node.create({
            data: {
              id: String(n.id),
              name: String(n.name ?? "Node"),
              scheme: String(n.scheme ?? "https"),
              address: String(n.address ?? ""),
              port: asNum(n.port, 443) as number,
              basePath: String(n.basePath ?? "/"),
              apiToken: String(n.apiToken ?? ""),
              enable: n.enable !== false,
              syncAll: n.syncAll !== false,
              inboundTags: String(n.inboundTags ?? "[]"),
              outboundTag: String(n.outboundTag ?? ""),
              tlsVerify: String(n.tlsVerify ?? "verify"),
              status: String(n.status ?? "online"),
              latencyMs: asNum(n.latencyMs, 0) as number,
              xrayVersion: String(n.xrayVersion ?? ""),
              lastSeen: n.lastSeen ? asDate(n.lastSeen) : null,
              createdAt: asDate(n.createdAt),
              updatedAt: asDate(n.updatedAt),
            },
          });
        }

        for (const o of outbounds) {
          await tx.outbound.create({
            data: {
              id: String(o.id),
              tag: String(o.tag ?? "outbound"),
              protocol: String(o.protocol ?? "freedom"),
              sendThrough: String(o.sendThrough ?? ""),
              domainStrategy: String(o.domainStrategy ?? "AsIs"),
              settingsJson: String(o.settingsJson ?? "{}"),
              streamJson: String(o.streamJson ?? "{}"),
              muxEnabled: o.muxEnabled === true,
              muxConcurrency: asNum(o.muxConcurrency, 8) as number,
              sortOrder: asNum(o.sortOrder, 0) as number,
              upBytes: asNum(o.upBytes, 0) as number,
              downBytes: asNum(o.downBytes, 0) as number,
              createdAt: asDate(o.createdAt),
              updatedAt: asDate(o.updatedAt),
            },
          });
        }

        for (const r of routingRules) {
          await tx.routingRule.create({
            data: {
              id: String(r.id),
              enabled: r.enabled !== false,
              comment: String(r.comment ?? ""),
              outboundTag: String(r.outboundTag ?? "direct"),
              domainJson: String(r.domainJson ?? "[]"),
              ipJson: String(r.ipJson ?? "[]"),
              port: String(r.port ?? ""),
              network: String(r.network ?? ""),
              protocolJson: String(r.protocolJson ?? "[]"),
              inboundTagJson: String(r.inboundTagJson ?? "[]"),
              sourceJson: String(r.sourceJson ?? "[]"),
              sortOrder: asNum(r.sortOrder, 0) as number,
              createdAt: asDate(r.createdAt),
              updatedAt: asDate(r.updatedAt),
            },
          });
        }

        for (const t of relayTunnels) {
          await tx.relayTunnel.create({
            data: {
              id: String(t.id),
              name: String(t.name ?? "Tunnel"),
              mode: String(t.mode ?? "tcp-relay"),
              entryNode: String(t.entryNode ?? ""),
              entryAddress: String(t.entryAddress ?? ""),
              entryPort: asNum(t.entryPort, 443) as number,
              exitNode: String(t.exitNode ?? ""),
              exitAddress: String(t.exitAddress ?? ""),
              exitPort: asNum(t.exitPort, 443) as number,
              inboundTag: String(t.inboundTag ?? ""),
              lbStrategy: String(t.lbStrategy ?? "least-ping"),
              enabled: t.enabled !== false,
              latencyMs: asNum(t.latencyMs, 0) as number,
              upBytes: asNum(t.upBytes, 0) as number,
              downBytes: asNum(t.downBytes, 0) as number,
              status: String(t.status ?? "active"),
              createdAt: asDate(t.createdAt),
              updatedAt: asDate(t.updatedAt),
            },
          });
        }

        // restore settings — never touch the session secret
        for (const [key, value] of Object.entries(settings)) {
          if (key === "session_secret") continue;
          await tx.serverSetting.upsert({
            where: { key },
            update: { value: String(value) },
            create: { key, value: String(value) },
          });
        }

        return {
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
        };
      },
      { timeout: 30000, maxWait: 10000 }
      );

      return NextResponse.json({ ok: true, restored: result });
    } catch (txErr) {
      console.error("[settings:restore] transaction failed:", txErr);
      return NextResponse.json({ error: "restore_failed" }, { status: 400 });
    }
  } catch (err) {
    console.error("[settings:restore]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
