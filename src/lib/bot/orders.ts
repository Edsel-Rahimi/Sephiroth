import { randomBytes } from "node:crypto";
import { db, type ClientUser, type SaleTemplate, type TgOrder } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { genAccessFields } from "@/lib/users";
import { syncUserProjection } from "@/lib/user-sync";

/* ============================================================
   Sephiroth · Task 23-c — Sales-bot order store (server-only)

   All tgOrder mutations go through transitionOrder() — the single
   transactional path for the status machine:

     awaiting_payment → completed | canceled
     pending_manual   → completed | rejected
     completed / rejected / canceled = terminal

   Completing an order atomically claims provisioning by setting
   provisionedUserId = "provisioning" BEFORE any await — so even if
   two paths (admin approve + zarinpal poll) race, only one wins
   and provisioning fires exactly once per order.
   ============================================================ */

export type TgOrderStatus = "awaiting_payment" | "pending_manual" | "completed" | "rejected" | "canceled";

const ALLOWED_TRANSITIONS: Record<TgOrderStatus, TgOrderStatus[]> = {
  awaiting_payment: ["completed", "canceled"],
  pending_manual: ["completed", "rejected"],
  completed: [],
  rejected: [],
  canceled: [],
};

export type TransitionResult =
  | { ok: true; order: TgOrder }
  | { ok: false; reason: "not_found" | "invalid" | "terminal"; order?: TgOrder };

/**
 * Idempotent status transition. When `to` is "completed" the
 * provisioning claim is taken in the same synchronous critical
 * section (no await between the status read and the claim write).
 */
export async function transitionOrder(
  orderId: string,
  to: TgOrderStatus
): Promise<TransitionResult> {
  // findUnique returns a hydrated CLONE — mutations on it would not persist,
  // so re-fetch a live reference via findIndex on the delegate result.
  const current = await db.tgOrder.findUnique({ where: { id: orderId } });
  if (!current) return { ok: false, reason: "not_found" };

  const from = current.status as TgOrderStatus;
  if (!(from in ALLOWED_TRANSITIONS)) return { ok: false, reason: "invalid", order: current };
  if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) {
    // terminal / already moved — a no-op, NOT an error (idempotency)
    return { ok: false, reason: "terminal", order: current };
  }

  const data: Record<string, unknown> = { status: to };
  if (to === "completed" && !current.provisionedUserId) {
    data.provisionedUserId = "provisioning"; // claim before any await
  }
  const order = await db.tgOrder.update({ where: { id: orderId }, data });
  return { ok: true, order };
}

/** A completed order whose provisioning claim is still pending. */
export function isProvisioningClaim(order: TgOrder): boolean {
  return order.status === "completed" && order.provisionedUserId === "provisioning";
}

export function isProvisioned(order: TgOrder): boolean {
  return Boolean(order.provisionedUserId) && order.provisionedUserId !== "provisioning";
}

/* ---------- provisioning ---------- */

/**
 * Create the ClientUser for a completed order — the same shape the
 * console route (/create_trial) and POST /api/users produce:
 * genAccessFields for the first inbound + syncUserProjection, and
 * the tgId link so "my subscriptions" finds it later.
 */
export async function provisionOrderUser(
  order: TgOrder,
  template: SaleTemplate | null
): Promise<ClientUser> {
  const inbounds = await db.inbound.findMany();
  const firstInbound = inbounds[0];

  const baseName = `tg_${randomBytes(3).toString("hex")}`;
  let username = baseName;
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await db.clientUser.findUnique({ where: { username } , select: { id: true }});
    if (!clash) break;
    username = `${baseName}${randomBytes(2).toString("hex")}`;
  }

  const user = await db.clientUser.create({
    data: {
      username,
      subId: randomBytes(8).toString("hex"),
      note: `Bot sale · ${order.templateName} · order ${order.id.slice(-6)}`,
      enabled: true,
      trafficLimitGb: template?.trafficLimitGb ?? null,
      expiryDays: template?.expiryDays ?? null,
      ipLimit: template?.ipLimit ?? 0,
      usedTrafficGb: 0,
      tgId: order.tgId,
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

  await syncUserProjection(user.id, {
    ipLimit: template?.ipLimit ?? 0,
    trafficLimitGb: template?.trafficLimitGb ?? null,
    expiryDays: template?.expiryDays ?? null,
    enabled: true,
  });

  await db.tgOrder.update({
    where: { id: order.id },
    data: { provisionedUserId: user.id },
  });

  await logActivity({
    kind: "user.created",
    level: "success",
    actor: "telegram-bot",
    message: `Telegram sales bot provisioned user "${user.username}" (${order.templateName}, ${order.amountToman} Toman, ${order.method})`,
    meta: { orderId: order.id, tgId: order.tgId, userId: user.id },
  });

  return user;
}

/** Audit rows for order events (actor "telegram-bot"). */
export async function logOrderEvent(
  order: TgOrder,
  event: "created" | "receipt" | "completed" | "rejected" | "canceled" | "zarinpal_paid",
  detail?: string
): Promise<void> {
  const kindMap = {
    created: "user.created",
    receipt: "user.updated",
    completed: "user.created",
    rejected: "user.updated",
    canceled: "user.updated",
    zarinpal_paid: "user.created",
  } as const;
  const levelMap = {
    created: "info",
    receipt: "info",
    completed: "success",
    rejected: "warn",
    canceled: "warn",
    zarinpal_paid: "success",
  } as const;
  await logActivity({
    kind: kindMap[event],
    level: levelMap[event],
    actor: "telegram-bot",
    message: `Sales order ${order.id.slice(-6)} (${order.templateName}, ${order.amountToman} Toman, ${order.method}) → ${order.status}${detail ? ` · ${detail}` : ""}`,
    meta: { orderId: order.id, tgId: order.tgId, status: order.status, method: order.method },
  });
}
