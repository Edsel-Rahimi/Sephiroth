import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  emailFor,
  flowFor,
  genAccessFields,
  genSubId,
  projectUserOntoInbound,
  toUserDTO,
} from "@/lib/users";
import { parseClients, validateUser } from "@/lib/user-types";
import { resellerQuota } from "@/lib/resellers";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Phase 4 — Users collection API
   Phase 6 — role-scoped: resellers only see/manage their own
   users (ClientUser.resellerId) and are gated by quotas
   (maxUsers / trafficQuotaGb; unlimited traffic is forbidden
   while a traffic quota is set).
   GET  /api/users  → { users: UserDTO[] }
   POST /api/users  → { user: UserDTO } (201)
      body: { username, note?, enabled?, trafficLimitGb?, expiryDays?,
              ipLimit?, inboundIds[] }
   Creates the ClientUser + one access per selected inbound and
   projects each access into the inbound's clientsJson (ownerId).
   ============================================================ */

export async function GET(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const userCount = await db.clientUser.count();
    if (userCount === 0 && process.env.SEPH_PREVIEW_AUTH === "1") {
      // preview-only demo population — production boots with a clean store
      const { ensureInboundSeed } = await import("@/lib/inbounds");
      await ensureInboundSeed();
      const inbounds = await db.inbound.findMany({ orderBy: { createdAt: "asc" } });
      const topInbounds = inbounds.slice(0, 3);
      const demoUsers = [
        { username: "aria_vip", note: "VIP Multi-Device · Tehran", trafficLimitGb: 100, expiryDays: 30, ipLimit: 3, usedTrafficGb: 24.6, enabled: true },
        { username: "kourosh_pro", note: "Gamer Low-Ping · Frankfurt", trafficLimitGb: 50, expiryDays: 30, ipLimit: 2, usedTrafficGb: 14.2, enabled: true },
        { username: "negar_stream", note: "Streaming & AI · WARP+", trafficLimitGb: 250, expiryDays: 60, ipLimit: 5, usedTrafficGb: 68.9, enabled: true },
        { username: "soren_gamer", note: "Esports Direct Tunnel", trafficLimitGb: 30, expiryDays: 30, ipLimit: 2, usedTrafficGb: 30.0, enabled: true },
      ];
      for (const du of demoUsers) {
        const subId = genSubId();
        await db.clientUser.create({
          data: {
            ...du,
            subId,
            accesses: {
              create: topInbounds.map((inb: any) => {
                const material = genAccessFields(inb.protocol);
                return {
                  inboundId: inb.id,
                  email: emailFor(du.username, inb.tag, new Set()),
                  key: material.key,
                  flow: flowFor(inb),
                  wgPrivateKey: material.wgPrivateKey,
                  wgPublicKey: material.wgPublicKey,
                };
              }),
            },
          },
        });
      }
    }

    const rows = await db.clientUser.findMany({
      where: actor.role === "reseller" ? { resellerId: actor.id } : {},
      orderBy: [{ createdAt: "desc" }, { username: "asc" }],
      include: { accesses: { include: { inbound: true } } },
    });
    return NextResponse.json({ users: rows.map((r) => toUserDTO(r)) });
  } catch (err) {
    console.error("[users:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateUser(body, { requireInbounds: true });
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }
    const data = parsed.data;

    /* Phase 6 — reseller ownership + quota gates */
    let resellerId: string | null = null;
    if (actor.role === "reseller") {
      resellerId = actor.id;
      const quota = await resellerQuota(actor.id);
      if (quota.maxUsers !== null && quota.usersCount >= quota.maxUsers) {
        return NextResponse.json({ error: "quota_users" }, { status: 403 });
      }
      if (quota.trafficQuotaGb !== null) {
        if (data.trafficLimitGb === null) {
          return NextResponse.json({ error: "quota_unlimited" }, { status: 403 });
        }
        const nextAllocated =
          Math.round((quota.allocatedGb + (data.trafficLimitGb ?? 0)) * 10) / 10;
        if (nextAllocated > quota.trafficQuotaGb) {
          return NextResponse.json({ error: "quota_traffic" }, { status: 403 });
        }
      }
    }
    const nameOwner = await db.clientUser.findUnique({
      where: { username: data.username },
      select: { id: true },
    });
    if (nameOwner) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "username", code: "taken" }] },
        { status: 409 }
      );
    }

    const inboundRows = await db.inbound.findMany({
      where: { id: { in: data.inboundIds } },
      orderBy: { createdAt: "asc" },
    });
    if (inboundRows.length !== data.inboundIds.length) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "inboundIds", code: "unknown" }] },
        { status: 400 }
      );
    }

    const created = await db.$transaction(async (tx) => {
      const user = await tx.clientUser.create({
        data: {
          username: data.username,
          subId: genSubId(),
          note: data.note || null,
          enabled: data.enabled,
          trafficLimitGb: data.trafficLimitGb,
          expiryDays: data.expiryDays,
          ipLimit: data.ipLimit,
          resetPeriod: data.resetPeriod,
          usedTrafficGb: 0,
          resellerId,
        },
      });

      for (const inbound of inboundRows) {
        const current = await tx.inbound.findUnique({
          where: { id: inbound.id },
          select: { clientsJson: true },
        });
        const existing = parseClients(current?.clientsJson);
        const taken = new Set(existing.map((c) => c.email));
        const email = emailFor(data.username, inbound.tag, taken);
        const material = genAccessFields(inbound.protocol);
        const key = material.key;
        const flow = flowFor(inbound);

        await tx.userInboundAccess.create({
          data: {
            userId: user.id,
            inboundId: inbound.id,
            email,
            key,
            flow,
            wgPrivateKey: material.wgPrivateKey,
            wgPublicKey: material.wgPublicKey,
          },
        });

        const nextJson = projectUserOntoInbound(
          current?.clientsJson ?? "[]",
          user.id,
          [
            {
              email,
              key,
              subId: user.subId,
              flow,
              ipLimit: data.ipLimit,
              trafficLimitGb: data.trafficLimitGb,
              expiryDays: data.expiryDays,
              enabled: data.enabled,
            },
          ]
        );
        await tx.inbound.update({
          where: { id: inbound.id },
          data: { clientsJson: nextJson },
        });
      }

      return tx.clientUser.findUnique({
        where: { id: user.id },
        include: { accesses: { include: { inbound: true } } },
      });
    });

    if (!created) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
    await logActivity({
      kind: "user.created",
      level: "success",
      actor: actor.username,
      message: `User "${created.username}" created on ${created.accesses.length} inbound(s)`,
      meta: { userId: created.id, username: created.username },
    });
    return NextResponse.json({ user: toUserDTO(created) }, { status: 201 });
  } catch (err) {
    console.error("[users:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
