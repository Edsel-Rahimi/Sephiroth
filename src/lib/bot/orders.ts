import { randomBytes } from "node:crypto";
import { db, type ClientUser, type DiscountCode, type SaleTemplate, type TgOrder } from "@/lib/db";
import { logActivity, type ActivityKind } from "@/lib/activity";
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

/* ============================================================
   Task 2-d — cart + discount math (PURE, exported so the
   logic can be exercised without a running worker)

   Money rules (integer-safe, Toman has no subunit):
   • total    = Σ(unitPrice × qty)            → integer
   • discount = min(total × percentOff / 100, maxOff ?? ∞)
     rounded to 2dp EXACTLY ONCE, then clamped to [0, total]
   • payable  = total − discount              → integer
   ============================================================ */

/** One cart line: template + quantity (1..CART_MAX_QTY). */
export interface CartLine {
  templateId: string;
  qty: number;
}

/** Applied discount stored on the order (discountJson). */
export interface OrderDiscount {
  code: string;
  percentOff: number;
  maxOff: number | null;
  discountToman: number;
}

export const CART_MAX_LINES = 10;
export const CART_MAX_QTY = 10;

/** Why a discount code cannot be applied right now (null = usable). */
export type DiscountProblem = "disabled" | "expired" | "limit" | "used";

/**
 * Pure validation of a code row against "now" and the buyer.
 * `usedBy`/`usedCount` are coerced so malformed rows degrade to sane values.
 */
export function discountProblem(
  row: DiscountCode,
  nowMs: number,
  tgId: string
): DiscountProblem | null {
  if (!row || !row.code) return "disabled";
  if (row.enabled === false) return "disabled";
  const exp = row.expiresAt ? new Date(row.expiresAt).getTime() : null;
  if (exp !== null && Number.isFinite(exp) && nowMs >= exp) return "expired";
  const limit = Number(row.usageLimit) || 0;
  const used = Math.max(0, Math.floor(Number(row.usedCount) || 0));
  if (limit > 0 && used >= limit) return "limit";
  const usedBy = Array.isArray(row.usedBy) ? row.usedBy.map(String) : [];
  if (usedBy.includes(String(tgId))) return "used";
  return null;
}

/** Round to 2 decimal places, once. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Discount for a total — capped by maxOff when set. The percent math is the
 * ONLY float step; it is rounded to 2dp once and the result is clamped into
 * [0, total]. Callers round the FINAL number again into an integer Toman at
 * the payable boundary (Toman has no subunit) — see cartTotals().
 */
export function computeDiscountToman(
  total: number,
  percentOff: number,
  maxOff: number | null
): number {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const p = Math.min(100, Math.max(1, Math.floor(Number(percentOff) || 0)));
  const raw = round2((t * p) / 100);
  const capped = maxOff !== null && maxOff !== undefined ? Math.min(raw, Math.max(0, Math.floor(Number(maxOff) || 0))) : raw;
  return Math.min(t, Math.max(0, round2(capped)));
}

/**
 * Totals for a cart: total = Σ(unit × qty), discount computed once from the
 * (already integer) total, payable = total − discount. All returned as
 * integer Toman (Math.round on the payable boundary only).
 */
export function cartTotals(
  lines: { unitPrice: number; qty: number }[],
  percentOff: number | null,
  maxOff: number | null
): { total: number; discount: number; payable: number } {
  const total = lines.reduce(
    (sum, l) => sum + Math.max(0, Math.floor(Number(l.unitPrice) || 0)) * Math.max(1, Math.floor(Number(l.qty) || 1)),
    0
  );
  const discount = percentOff === null ? 0 : computeDiscountToman(total, percentOff, maxOff);
  const payable = Math.max(0, Math.round(total - discount));
  return { total, discount: Math.round(discount), payable };
}

/**
 * Parse the itemsJson column of an order. BACKWARD COMPATIBLE: absent,
 * empty or unparseable JSON → the legacy single-item shape
 * [{templateId: order.templateId, qty: 1}].
 */
export function parseOrderItems(order: TgOrder): CartLine[] {
  const raw = order.itemsJson;
  if (!raw || typeof raw !== "string") {
    return order.templateId ? [{ templateId: order.templateId, qty: 1 }] : [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not-array");
    const lines: CartLine[] = [];
    for (const item of parsed) {
      const tplId = typeof (item as { templateId?: unknown })?.templateId === "string"
        ? (item as { templateId: string }).templateId
        : "";
      const qty = Math.min(
        CART_MAX_QTY,
        Math.max(1, Math.floor(Number((item as { qty?: unknown })?.qty) || 1))
      );
      if (tplId) lines.push({ templateId: tplId, qty });
    }
    if (lines.length === 0) {
      return order.templateId ? [{ templateId: order.templateId, qty: 1 }] : [];
    }
    return lines;
  } catch {
    return order.templateId ? [{ templateId: order.templateId, qty: 1 }] : [];
  }
}

/** Parse the discountJson column (null when absent/unparseable). */
export function parseOrderDiscount(order: TgOrder): OrderDiscount | null {
  const raw = order.discountJson;
  if (!raw || typeof raw !== "string") return null;
  try {
    const d = JSON.parse(raw) as Partial<OrderDiscount>;
    if (typeof d?.code !== "string" || !d.code) return null;
    return {
      code: d.code,
      percentOff: Math.min(100, Math.max(1, Math.floor(Number(d.percentOff) || 1))),
      maxOff: d.maxOff === null || d.maxOff === undefined ? null : Math.max(0, Math.floor(Number(d.maxOff) || 0)),
      discountToman: Math.max(0, Math.round(Number(d.discountToman) || 0)),
    };
  } catch {
    return null;
  }
}

/**
 * Consume a discount at COMPLETION time (Task 2-d). The findUnique read is
 * the LAST await before the update write — same no-yield discipline as
 * payWithWallet — so two concurrent completions can never both consume the
 * last remaining usage. Returns false when the code vanished or the
 * usage/user limit tripped between checkout and completion (the order is
 * still delivered — it already carries its discounted price — but the code
 * counter stays honest and a warn is written to the activity log).
 */
export async function consumeDiscountForOrder(order: TgOrder): Promise<boolean> {
  const discount = parseOrderDiscount(order);
  if (!discount) return true; // no discount on this order → nothing to consume
  const tgId = String(order.tgId);
  // READ — last await before the write below
  const row = await db.discountCode.findUnique({ where: { code: discount.code } });
  if (!row) {
    await logActivity({
      kind: "discount.deleted" as unknown as ActivityKind,
      level: "warn",
      actor: "telegram-bot",
      message: `Order ${order.id.slice(-6)} completed with discount ${discount.code} which no longer exists — counter not consumed`,
      meta: { orderId: order.id, code: discount.code },
    });
    return false;
  }
  const problem = discountProblem(row, Date.now(), tgId);
  if (problem && problem !== "expired") {
    // limit reached / already used by this user / disabled meanwhile
    await logActivity({
      kind: "discount.updated" as unknown as ActivityKind,
      level: "warn",
      actor: "telegram-bot",
      message: `Order ${order.id.slice(-6)} completed but discount ${discount.code} is ${problem} — counter not consumed`,
      meta: { orderId: order.id, code: discount.code, problem },
    });
    return false;
  }
  // ---- critical section: NO await between the read above and this write ----
  const usedBy = Array.isArray(row.usedBy) ? row.usedBy.map(String) : [];
  if (!usedBy.includes(tgId)) usedBy.push(tgId);
  await db.discountCode.update({
    where: { code: discount.code },
    data: {
      usedCount: Math.max(0, Math.floor(Number(row.usedCount) || 0)) + 1,
      usedBy,
    },
  });
  return true;
}
