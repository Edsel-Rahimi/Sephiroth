import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, isReadOnlyActor } from "@/lib/auth"; // task 3-b — viewer read-only
import { emailFor, flowFor, genAccessFields, toUserDTO } from "@/lib/users";
import { parseClients, validateUserPatch } from "@/lib/user-types";
import { stripUserEverywhere, syncUserProjection } from "@/lib/user-sync";
import { logActivity } from "@/lib/activity";
import {
  notifyUserDeleted,
  notifyUserRenewed,
  notifyUserUpdated, // Task 26-b — PATCH now pings the admin chat too
} from "@/lib/bot/notify";

/* ============================================================
   Sephiroth · Phase 4 — Users item API
   Phase 6 — role-scoped: resellers may only touch users they
   own (resellerId mismatch → 404, no existence leak).
   PATCH  /api/users/:id → { user: UserDTO }
     body: { note?, enabled?, trafficLimitGb?, expiryDays?, ipLimit?, hwidLimit?,
             resetPeriod?, inboundIds? (replaces the full link set) }
     TRUE partial merge: only keys present in the body are written;
     username is immutable (it names the entries inside inbounds).
     clientsJson projection is rebuilt after the transaction by
     syncUserProjection (adds new, updates limits, drops removed).
   DELETE /api/users/:id → { ok: true }
   ============================================================ */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (isReadOnlyActor(actor)) {
      // task 3-b — viewer admins are READ-ONLY; mutations reject 403
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateUserPatch(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }
    // sparse patch — only provided keys are written; everything else keeps
    // the currently stored value (true partial merge, no default resets)
    const data = parsed.data;

    const existing = await db.clientUser.findUnique({
      where: { id },
      include: { accesses: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (actor.role === "reseller" && existing.resellerId !== actor.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // resolve the new link set (only when the key was actually sent)
    let nextInboundIds: string[] | null = null;
    if (data.inboundIds !== undefined) {
      nextInboundIds = data.inboundIds;
      const inboundRows = await db.inbound.findMany({
        where: { id: { in: nextInboundIds } },
        select: { id: true },
      });
      if (inboundRows.length !== nextInboundIds.length) {
        return NextResponse.json(
          { error: "validation", fields: [{ field: "inboundIds", code: "unknown" }] },
          { status: 400 }
        );
      }
    }

    // effective limits = patch values when present, otherwise current row
    // (26-a — the manual renew action re-enables, so the projection that runs
    // after the transaction must see enabled:true even when the body omits it)
    const renewing = data.renew === true;
    const nextLimits = {
      ipLimit: data.ipLimit ?? existing.ipLimit,
      trafficLimitGb: data.trafficLimitGb !== undefined ? data.trafficLimitGb : existing.trafficLimitGb,
      expiryDays: data.expiryDays !== undefined ? data.expiryDays : existing.expiryDays,
      enabled: data.enabled ?? (renewing ? true : existing.enabled),
    };

    await db.$transaction(async (tx) => {
      await tx.clientUser.update({
        where: { id },
        data: {
          ...(data.note !== undefined ? { note: data.note } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          ...(data.trafficLimitGb !== undefined ? { trafficLimitGb: data.trafficLimitGb } : {}),
          ...(data.expiryDays !== undefined ? { expiryDays: data.expiryDays } : {}),
          ...(data.ipLimit !== undefined ? { ipLimit: data.ipLimit } : {}),
          ...(data.hwidLimit !== undefined ? { hwidLimit: data.hwidLimit } : {}),
          ...(data.resetPeriod !== undefined ? { resetPeriod: data.resetPeriod } : {}),
          // 26-a — on-hold: re-arming the hold clears the anchor so the clock
          // restarts at the next first-connect; disarming keeps the anchor.
          ...(data.onHold !== undefined
            ? { onHold: data.onHold, startedAt: data.onHold ? null : (existing.startedAt ?? null) }
            : {}),
          ...(data.autoRenew !== undefined ? { autoRenew: data.autoRenew } : {}),
          // 26-a — manual renew: a FULL fresh window starts NOW, usage and
          // warning state reset, the renewal counter bumps and an expired-
          // disabled user comes back to life (explicit admin action).
          // If the same body re-arms the hold, the anchor stays null — an
          // on-hold user's clock only starts at the first connect.
          ...(renewing
            ? {
                startedAt: data.onHold === true ? null : new Date(),
                renewals: (Number(existing.renewals) || 0) + 1,
                usedTrafficGb: 0,
                lastResetAt: new Date(),
                expiryWarnedAt: null,
                enabled: true,
              }
            : {}),
        },
      });

      if (nextInboundIds) {
        const nextIds = new Set(nextInboundIds);

        // removed links → delete access rows (projection cleanup happens
        // in syncUserProjection below, which drops unowned stale entries)
        for (const access of existing.accesses) {
          if (!nextIds.has(access.inboundId)) {
            await tx.userInboundAccess.delete({ where: { id: access.id } });
          }
        }

        // added links → new access rows with fresh material
        for (const inboundId of nextInboundIds) {
          if (existing.accesses.some((a: any) => a.inboundId === inboundId)) continue;
          const inbound = await tx.inbound.findUnique({ where: { id: inboundId } });
          if (!inbound) continue;
          const existingClients = parseClients(inbound.clientsJson);
          const email = emailFor(
            existing.username,
            inbound.tag,
            new Set(existingClients.map((c) => c.email))
          );
          const material = genAccessFields(inbound.protocol);
          await tx.userInboundAccess.create({
            data: {
              userId: id,
              inboundId,
              email,
              key: material.key,
              flow: flowFor(inbound),
              wgPrivateKey: material.wgPrivateKey,
              wgPublicKey: material.wgPublicKey,
            },
          });
        }
      }
    });

    // rebuild every linked inbound's clientsJson with the freshest state
    await syncUserProjection(id, nextLimits);

    const updated = await db.clientUser.findUnique({
      where: { id },
      include: { accesses: { include: { inbound: true } } },
    });
    if (!updated) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await logActivity({
      kind: "user.updated",
      level: "info",
      actor: actor.username,
      message: renewing
        ? `User "${updated.username}" manually renewed (window restarted from now, renewal #${updated.renewals})`
        : `User "${updated.username}" updated`,
      meta: { userId: id, username: updated.username, ...(renewing ? { renew: true, renewals: updated.renewals } : {}) },
    });
    void notifyUserUpdated(updated.username); // 26-b — fire-and-forget Telegram alert
    if (renewing) void notifyUserRenewed(updated.username, Number(updated.renewals) || 0);
    return NextResponse.json({ user: toUserDTO(updated) });
  } catch (err) {
    console.error("[users:PATCH]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (isReadOnlyActor(actor)) {
      // task 3-b — viewer admins are READ-ONLY; mutations reject 403
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.clientUser.findUnique({
      where: { id },
      select: { id: true, resellerId: true, username: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (actor.role === "reseller" && existing.resellerId !== actor.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await stripUserEverywhere(id);
    await db.clientUser.delete({ where: { id } }); // cascades accesses
    await logActivity({
      kind: "user.deleted",
      level: "warn",
      actor: actor.username,
      message: `User deleted (id ${id})`,
      meta: { userId: id },
    });
    void notifyUserDeleted(existing.username); // Task 23-a — Telegram admin alert

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[users:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
