import { db } from "@/lib/db";
import { projectUserOntoInbound, stripUserFromInbound } from "@/lib/users";
import { parseClients, type EmbeddedClient } from "@/lib/user-types";

/* ============================================================
   Sephiroth · Phase 4 — projection sync (db-backed)

   Keeps every linked inbound's clientsJson in agreement with the
   ClientUser's accesses + limits. Used by PATCH and bulk routes;
   POST has a transactional inline version.
   ============================================================ */

/** Projection limits carried onto every embedded entry. */
export interface UserLimits {
  ipLimit: number;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  enabled: boolean;
}

export async function syncUserProjection(userId: string, limits: UserLimits): Promise<void> {
  const user = await db.clientUser.findUnique({
    where: { id: userId },
    include: { accesses: true },
  });
  if (!user) return;

  // Walk EVERY inbound: desired entries are empty for inbounds the user no
  // longer links, which strips stale ownerId entries during link removal.
  const inbounds = await db.inbound.findMany({ select: { id: true, clientsJson: true } });
  for (const inbound of inbounds) {
    const desired: EmbeddedClient[] = user.accesses
      .filter((a) => a.inboundId === inbound.id)
      .map((a) => ({
        email: a.email,
        key: a.key,
        subId: user.subId,
        flow: a.flow,
        ipLimit: limits.ipLimit,
        trafficLimitGb: limits.trafficLimitGb,
        expiryDays: limits.expiryDays,
        enabled: limits.enabled,
      }));
    const hadEntry = parseClients(inbound.clientsJson).some((c) => c.ownerId === userId);
    if (desired.length === 0 && !hadEntry) continue; // nothing to do for this inbound
    await db.inbound.update({
      where: { id: inbound.id },
      data: { clientsJson: projectUserOntoInbound(inbound.clientsJson, userId, desired) },
    });
  }
}

/** Removes every embedded entry owned by the user across all inbounds. */
export async function stripUserEverywhere(userId: string): Promise<void> {
  const accesses = await db.userInboundAccess.findMany({
    where: { userId },
    select: { inboundId: true },
  });
  const inboundIds = [...new Set(accesses.map((a) => a.inboundId))];
  for (const inboundId of inboundIds) {
    const inbound = await db.inbound.findUnique({
      where: { id: inboundId },
      select: { clientsJson: true },
    });
    if (!inbound) continue;
    await db.inbound.update({
      where: { id: inboundId },
      data: { clientsJson: stripUserFromInbound(inbound.clientsJson, userId) },
    });
  }
}

/**
 * Re-merges every ClientUser's projected entries into ONE inbound's
 * clientsJson. Called after the Phase-3 inbound editor saves (its
 * payload serializes clients without ownerId, which would otherwise
 * drop user-owned entries).
 */
export async function reprojectInbound(inboundId: string): Promise<void> {
  const inbound = await db.inbound.findUnique({
    where: { id: inboundId },
    select: { clientsJson: true },
  });
  if (!inbound) return;

  const accesses = await db.userInboundAccess.findMany({
    where: { inboundId },
    include: { user: true },
  });
  if (accesses.length === 0) return;

  // group accesses by owner, then merge each owner's projection
  let clientsJson = inbound.clientsJson;
  const byUser = new Map<string, typeof accesses>();
  for (const a of accesses) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }
  for (const [userId, list] of byUser) {
    const owner = list[0].user;
    const desired: EmbeddedClient[] = list.map((a) => ({
      email: a.email,
      key: a.key,
      subId: owner.subId,
      flow: a.flow,
      ipLimit: owner.ipLimit,
      trafficLimitGb: owner.trafficLimitGb,
      expiryDays: owner.expiryDays,
      enabled: owner.enabled,
    }));
    clientsJson = projectUserOntoInbound(clientsJson, userId, desired);
  }
  await db.inbound.update({
    where: { id: inboundId },
    data: { clientsJson },
  });
}
