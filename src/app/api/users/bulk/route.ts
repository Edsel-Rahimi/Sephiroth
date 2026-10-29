import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, isReadOnlyActor } from "@/lib/auth"; // task 3-b — viewer read-only
import { stripUserEverywhere, syncUserProjection } from "@/lib/user-sync";
import { validateUserPatch } from "@/lib/user-types";
import { logActivity } from "@/lib/activity";
import { notifyTrafficReset, notifyUserRenewed } from "@/lib/bot/notify"; // Task 23-a + 26-a

/* ============================================================
   Sephiroth · Phase 4 — Users bulk API
   Phase 6 — role-scoped: resellers may only bulk-act on their
   own users (id set is intersected with resellerId).
   Task 1-c — the action set mirrors the single-user routes:
     renew            → PATCH /api/users/:id renew (fresh window
                        from now, usage + warning state reset,
                        counter bump, re-enable, renewed notify)
     holdOn/holdOff   → PATCH on-hold arm/disarm (arming clears
                        the startedAt anchor, disarming keeps it)
     autoRenewOn/Off  → PATCH autoRenew bool (projection re-synced
                        exactly like the unconditional single PATCH)
     resetDevices     → POST /api/users/:id/reset-devices (devices: "[]")
     adjust           → PATCH sparse merge of expiryDays /
                        trafficLimitGb / ipLimit, validated with the
                        same validateUserPatch checks; the expiry
                        window keeps its own per-user anchor
   POST /api/users/bulk
     body: { action, ids: string[],
             adjust?: { expiryDays?, trafficLimitGb?, ipLimit? } }
   → { ok: true, affected: number }
   ============================================================ */

const ACTIONS = new Set([
  "enable",
  "disable",
  "delete",
  "resetTraffic",
  "renew",
  "holdOn",
  "holdOff",
  "autoRenewOn",
  "autoRenewOff",
  "resetDevices",
  "adjust",
]);

export async function POST(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (isReadOnlyActor(actor)) {
      // task 3-b — viewer admins are READ-ONLY; mutations reject 403
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const action = typeof b.action === "string" ? b.action : "";
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [];

    if (!ACTIONS.has(action) || ids.length === 0) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    // scoped fetch — resellers only ever see their own users; the extra
    // columns feed the per-action mirrors of the single-user routes
    // (renewals counter, hold anchor, username for logs/notifications)
    const rows = await db.clientUser.findMany({
      where: {
        id: { in: ids },
        ...(actor.role === "reseller" ? { resellerId: actor.id } : {}),
      },
      select: {
        id: true,
        username: true,
        enabled: true,
        trafficLimitGb: true,
        expiryDays: true,
        ipLimit: true,
        onHold: true,
        startedAt: true,
        renewals: true,
      },
    });

    let affected = 0;

    if (action === "delete") {
      for (const row of rows) {
        await stripUserEverywhere(row.id);
        await db.clientUser.delete({ where: { id: row.id } });
        affected++;
      }
    } else if (action === "resetTraffic") {
      await db.clientUser.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { usedTrafficGb: 0 } });
      affected = rows.length;
      // Task 23-a — one deduped bot alert per reset user (bulk storm-safe)
      for (const n of rows.slice(0, 10)) {
        void notifyTrafficReset(n.username, "manual");
      }
    } else if (action === "renew") {
      // 26-a mirror of the single PATCH renew — a FULL fresh window starts
      // NOW: usage and warning state reset, the renewal counter bumps and
      // an expired-disabled user comes back to life (explicit admin action).
      for (const row of rows) {
        const nextRenewals = (Number(row.renewals) || 0) + 1;
        await db.$transaction(async (tx) => {
          await tx.clientUser.update({
            where: { id: row.id },
            data: {
              startedAt: new Date(),
              // plain value — the JSON store facade has no Prisma-style
              // `{ increment }` support (mirrors the single PATCH renew)
              renewals: nextRenewals,
              usedTrafficGb: 0,
              lastResetAt: new Date(),
              expiryWarnedAt: null,
              enabled: true,
            },
          });
        });
        // same limits semantics as enable/disable — renew re-enables, so the
        // projection must see enabled:true even though the action never
        // touches the stored limits (mirrors PATCH nextLimits)
        await syncUserProjection(row.id, {
          ipLimit: row.ipLimit,
          trafficLimitGb: row.trafficLimitGb,
          expiryDays: row.expiryDays,
          enabled: true,
        });
        await logActivity({
          kind: "user.updated",
          level: "info",
          actor: actor.username,
          message: `User "${row.username}" manually renewed (window restarted from now, renewal #${nextRenewals})`,
          meta: { userId: row.id, username: row.username, renew: true, renewals: nextRenewals },
        });
        affected++;
      }
      // Task 23-a dedupe pattern — one bot alert per renewed user, first 10
      for (const row of rows.slice(0, 10)) {
        void notifyUserRenewed(row.username, (Number(row.renewals) || 0) + 1);
      }
    } else if (action === "holdOn" || action === "holdOff") {
      const holding = action === "holdOn";
      for (const row of rows) {
        // mirror PATCH on-hold semantics: re-arming the hold clears the
        // anchor so the clock restarts at the next first-connect; disarming
        // keeps the anchor exactly as stored
        await db.$transaction(async (tx) => {
          await tx.clientUser.update({
            where: { id: row.id },
            data: { onHold: holding, startedAt: holding ? null : (row.startedAt ?? null) },
          });
        });
        await syncUserProjection(row.id, {
          ipLimit: row.ipLimit,
          trafficLimitGb: row.trafficLimitGb,
          expiryDays: row.expiryDays,
          enabled: row.enabled,
        });
        await logActivity({
          kind: "user.updated",
          level: "info",
          actor: actor.username,
          message: holding
            ? `User "${row.username}" put on hold (expiry anchor cleared, clock restarts at first connect)`
            : `User "${row.username}" taken off hold`,
          meta: { userId: row.id, username: row.username, onHold: holding },
        });
        affected++;
      }
    } else if (action === "autoRenewOn" || action === "autoRenewOff") {
      const autoRenew = action === "autoRenewOn";
      await db.clientUser.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { autoRenew },
      });
      // the single PATCH re-syncs the projection after EVERY patch (no field
      // filter) — mirror that here, even though autoRenew itself is not part
      // of the projected clientsJson entry
      for (const row of rows) {
        await syncUserProjection(row.id, {
          ipLimit: row.ipLimit,
          trafficLimitGb: row.trafficLimitGb,
          expiryDays: row.expiryDays,
          enabled: row.enabled,
        });
      }
      await logActivity({
        kind: "user.updated",
        level: "info",
        actor: actor.username,
        message: `Auto-renew ${autoRenew ? "enabled" : "disabled"} for ${rows.length} user(s)`,
        meta: { action, count: rows.length, userIds: rows.map((r) => r.id) },
      });
      affected = rows.length;
    } else if (action === "resetDevices") {
      // Task 23-g mirror — clear the HWID device list so every client must
      // re-register (the first hwidLimit devices to fetch the subscription win)
      for (const row of rows) {
        await db.clientUser.update({ where: { id: row.id }, data: { devices: "[]" } });
        await syncUserProjection(row.id, {
          ipLimit: row.ipLimit,
          trafficLimitGb: row.trafficLimitGb,
          expiryDays: row.expiryDays,
          enabled: row.enabled,
        });
        await logActivity({
          kind: "user.updated",
          level: "info",
          actor: actor.username,
          message: `Device registrations reset for "${row.username}"`,
          meta: { userId: row.id, username: row.username, reason: "devices_reset" },
        });
        affected++;
      }
    } else if (action === "adjust") {
      // Task 1-c — validate with the EXACT checks validateUserPatch applies
      // to PATCH /api/users/:id (ranges, integer rounding, null = unlimited).
      // The payload may arrive nested under `adjust` or merged at the top
      // level (the UI merges it into the POST body); only these three keys
      // are ever applied.
      let src: Record<string, unknown> = b;
      if (b.adjust !== undefined) {
        if (b.adjust === null || typeof b.adjust !== "object" || Array.isArray(b.adjust)) {
          return NextResponse.json({ error: "bad_request" }, { status: 400 });
        }
        src = b.adjust as Record<string, unknown>;
      }
      const candidate: Record<string, unknown> = {};
      if ("expiryDays" in src) candidate.expiryDays = src.expiryDays;
      if ("trafficLimitGb" in src) candidate.trafficLimitGb = src.trafficLimitGb;
      if ("ipLimit" in src) candidate.ipLimit = src.ipLimit;

      const parsed = validateUserPatch(candidate);
      if (!parsed.ok) {
        return NextResponse.json({ error: "validation", fields: parsed.fields }, { status: 400 });
      }
      const adjExpiry = parsed.data.expiryDays;
      const adjTraffic = parsed.data.trafficLimitGb;
      const adjIp = parsed.data.ipLimit;
      if (adjExpiry === undefined && adjTraffic === undefined && adjIp === undefined) {
        return NextResponse.json({ error: "bad_request" }, { status: 400 });
      }

      for (const row of rows) {
        // TRUE partial merge — only the provided keys are written per user.
        // expiryDays semantics are identical to PATCH: the window keeps its
        // own anchor (startedAt ?? createdAt) and is NOT re-anchored; a
        // waiting on-hold user keeps the null anchor and simply carries the
        // new window until the first connect.
        await db.$transaction(async (tx) => {
          await tx.clientUser.update({
            where: { id: row.id },
            data: {
              ...(adjExpiry !== undefined ? { expiryDays: adjExpiry } : {}),
              ...(adjTraffic !== undefined ? { trafficLimitGb: adjTraffic } : {}),
              ...(adjIp !== undefined ? { ipLimit: adjIp } : {}),
            },
          });
        });
        await syncUserProjection(row.id, {
          ipLimit: adjIp !== undefined ? adjIp : row.ipLimit,
          trafficLimitGb: adjTraffic !== undefined ? adjTraffic : row.trafficLimitGb,
          expiryDays: adjExpiry !== undefined ? adjExpiry : row.expiryDays,
          enabled: row.enabled,
        });
        affected++;
      }
      const parts: string[] = [];
      if (adjExpiry !== undefined) parts.push(`expiryDays=${String(adjExpiry)}`);
      if (adjTraffic !== undefined) parts.push(`trafficLimitGb=${String(adjTraffic)}`);
      if (adjIp !== undefined) parts.push(`ipLimit=${String(adjIp)}`);
      await logActivity({
        kind: "user.updated",
        level: "info",
        actor: actor.username,
        message: `Bulk adjust (${parts.join(", ")}) applied to ${rows.length} user(s)`,
        meta: {
          action: "adjust",
          count: rows.length,
          userIds: rows.map((r) => r.id),
          fields: {
            ...(adjExpiry !== undefined ? { expiryDays: adjExpiry } : {}),
            ...(adjTraffic !== undefined ? { trafficLimitGb: adjTraffic } : {}),
            ...(adjIp !== undefined ? { ipLimit: adjIp } : {}),
          },
        },
      });
    } else {
      // enable / disable
      const enabled = action === "enable";
      for (const row of rows) {
        if (row.enabled !== enabled) {
          await db.clientUser.update({ where: { id: row.id }, data: { enabled } });
        }
        await syncUserProjection(row.id, {
          ipLimit: row.ipLimit,
          trafficLimitGb: row.trafficLimitGb,
          expiryDays: row.expiryDays,
          enabled,
        });
        affected++;
      }
    }

    return NextResponse.json({ ok: true, affected });
  } catch (err) {
    console.error("[users:bulk]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
