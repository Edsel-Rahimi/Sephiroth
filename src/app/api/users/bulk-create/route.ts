import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { emailFor, flowFor, genAccessFields, genSubId, projectUserOntoInbound } from "@/lib/users";
import { parseClients, validateUser } from "@/lib/user-types";
import { resellerQuota } from "@/lib/resellers";
import { logActivity } from "@/lib/activity";
import { notifyUserCreated } from "@/lib/bot/notify";

/* ============================================================
   Sephiroth · 26-b — Bulk user creation
   POST /api/users/bulk-create
     body: { prefix, count, note?, trafficLimitGb?, expiryDays?,
             ipLimit?, resetPeriod?, onHold?, autoRenew?, inboundIds[] }
   → 201 { ok: true, created: {id,username}[], failed: {username,reason}[] }

   Creates up to 100 users named `<prefix>-01 … <prefix>-NN` (a name
   that already exists is skipped — never overwritten). Every user
   gets the same limits + inbound links; keys/subIds are freshly
   generated per user. Reseller callers stay inside their quota gates.
   ============================================================ */

const MAX_BULK = 100;

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

    const b = (body ?? {}) as Record<string, unknown>;
    const prefix = typeof b.prefix === "string" ? b.prefix.trim() : "";
    const count = Math.floor(Number(b.count));
    if (!/^[a-zA-Z0-9_-]{2,24}$/.test(prefix)) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "username", code: "format" }] },
        { status: 400 }
      );
    }
    if (!Number.isFinite(count) || count < 1 || count > MAX_BULK) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "username", code: "bulk_count" }] },
        { status: 400 }
      );
    }

    /* one representative body → shared validation (per-user username patched below) */
    const template = {
      username: prefix,
      note: typeof b.note === "string" ? b.note : "",
      enabled: true,
      trafficLimitGb: b.trafficLimitGb,
      expiryDays: b.expiryDays,
      ipLimit: b.ipLimit ?? 0,
      hwidLimit: b.hwidLimit,
      resetPeriod: b.resetPeriod,
      onHold: b.onHold === true,
      autoRenew: b.autoRenew === true,
      inboundIds: Array.isArray(b.inboundIds) ? b.inboundIds : [],
    };
    const parsed = validateUser(template, { requireInbounds: true });
    if (!parsed.ok) {
      return NextResponse.json({ error: "validation", fields: parsed.fields }, { status: 400 });
    }
    const data = parsed.data;

    /* reseller gates: total allocation must fit the remaining quota */
    let resellerId: string | null = null;
    if (actor.role === "reseller") {
      resellerId = actor.id;
      const quota = await resellerQuota(actor.id);
      if (quota.maxUsers !== null && quota.usersCount + count > quota.maxUsers) {
        return NextResponse.json({ error: "quota_users" }, { status: 403 });
      }
      if (quota.trafficQuotaGb !== null) {
        if (data.trafficLimitGb === null) {
          return NextResponse.json({ error: "quota_unlimited" }, { status: 403 });
        }
        const nextAllocated =
          Math.round((quota.allocatedGb + (data.trafficLimitGb ?? 0) * count) * 10) / 10;
        if (nextAllocated > quota.trafficQuotaGb) {
          return NextResponse.json({ error: "quota_traffic" }, { status: 403 });
        }
      }
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

    const takenNames = new Set(
      (await db.clientUser.findMany({ select: { username: true } })).map((u) => u.username)
    );

    const width = count >= 100 ? 3 : count >= 10 ? 2 : 1;
    const created: { id: string; username: string }[] = [];
    const failed: { username: string; reason: string }[] = [];

    for (let i = 1; i <= count; i++) {
      const username = `${prefix}-${String(i).padStart(width, "0")}`;
      if (takenNames.has(username)) {
        failed.push({ username, reason: "taken" });
        continue;
      }
      try {
        const user = await db.$transaction(async (tx) => {
          const row = await tx.clientUser.create({
            data: {
              username,
              subId: genSubId(),
              note: data.note || null,
              enabled: true,
              trafficLimitGb: data.trafficLimitGb,
              expiryDays: data.expiryDays,
              ipLimit: data.ipLimit,
              hwidLimit: data.hwidLimit,
              resetPeriod: data.resetPeriod,
              usedTrafficGb: 0,
              resellerId,
              onHold: data.onHold,
              startedAt: null,
              autoRenew: data.autoRenew,
              renewals: 0,
            },
          });
          for (const inbound of inboundRows) {
            const current = await tx.inbound.findUnique({
              where: { id: inbound.id },
              select: { clientsJson: true },
            });
            const existing = parseClients(current?.clientsJson);
            const email = emailFor(username, inbound.tag, new Set(existing.map((c) => c.email)));
            const material = genAccessFields(inbound.protocol);
            const flow = flowFor(inbound);

            await tx.userInboundAccess.create({
              data: {
                userId: row.id,
                inboundId: inbound.id,
                email,
                key: material.key,
                flow,
                wgPrivateKey: material.wgPrivateKey,
                wgPublicKey: material.wgPublicKey,
              },
            });

            const nextJson = projectUserOntoInbound(current?.clientsJson ?? "[]", row.id, [
              {
                email,
                key: material.key,
                subId: row.subId,
                flow,
                ipLimit: data.ipLimit,
                trafficLimitGb: data.trafficLimitGb,
                expiryDays: data.expiryDays,
                enabled: true,
              },
            ]);
            await tx.inbound.update({
              where: { id: inbound.id },
              data: { clientsJson: nextJson },
            });
          }
          return row;
        });
        takenNames.add(username);
        created.push({ id: user.id, username });
        void notifyUserCreated({
          username,
          trafficLimitGb: data.trafficLimitGb,
          expiryDays: data.expiryDays,
        });
      } catch (err) {
        failed.push({ username, reason: err instanceof Error ? err.message : "error" });
      }
    }

    await logActivity({
      kind: "user.created",
      level: "info",
      actor: actor.username,
      message: `Bulk created ${created.length} user(s) with prefix "${prefix}" (${failed.length} skipped)`,
      meta: { prefix, requested: count, created: created.length, failed: failed.length },
    });

    return NextResponse.json({ ok: true, created, failed }, { status: 201 });
  } catch (err) {
    console.error("[users:bulk-create]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
