import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { emailFor, flowFor, genAccessFields, genSubId, projectUserOntoInbound } from "@/lib/users";
import { parseClients, USERNAME_RE } from "@/lib/user-types";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · 26-b — Users JSON import (migration in)
   POST /api/users/import
     body: { users: [...], mode?: "skip" | "rename" }   (default skip)
   → { ok, created, skipped, failed: {username, reason}[] }

   Accepts the Sephiroth export format AND lenient aliases used by
   other panels (username|name|user, traffic_limit_gb|trafficLimitGb|
   limit_gb|quota_gb, expiry_days|expiryDays|days|expire_days,
   ip_limit|ipLimit, reset_period|resetPeriod, on_hold|onHold,
   auto_renew|autoRenew, inbounds|inbound_links|configs). Inbound
   links resolve by TAG against this panel; unknown tags are dropped
   (reported per user). Existing usernames are skipped or renamed
   with a -2 suffix depending on the mode. Admin-only.
   ============================================================ */

interface ImportUser {
  username: string;
  note: string | null;
  enabled: boolean;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  ipLimit: number;
  resetPeriod: string | null;
  onHold: boolean;
  autoRenew: boolean;
  tags: string[];
  /** exact keys from a Sephiroth export (kept when present) */
  accessKeys: { tag: string; email?: string; key?: string; flow?: string }[];
}

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeImportUser(raw: unknown): ImportUser | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const username = String(pick(o, "username", "name", "user") ?? "").trim();
  if (!USERNAME_RE.test(username)) return null;

  const resetRaw = pick(o, "resetPeriod", "reset_period", "reset");
  const resetPeriod =
    typeof resetRaw === "string" && ["none", "daily", "weekly", "monthly"].includes(resetRaw)
      ? resetRaw
      : null;

  /* inbound links: either rich objects or bare tag strings */
  const rawLinks = pick(o, "inbounds", "inbound_links", "configs");
  const tags: string[] = [];
  const accessKeys: ImportUser["accessKeys"] = [];
  if (Array.isArray(rawLinks)) {
    for (const link of rawLinks) {
      if (typeof link === "string") {
        tags.push(link);
        accessKeys.push({ tag: link });
      } else if (typeof link === "object" && link !== null) {
        const lo = link as Record<string, unknown>;
        const tag = String(pick(lo, "tag", "inbound", "inbound_tag") ?? "").trim();
        if (!tag) continue;
        tags.push(tag);
        accessKeys.push({
          tag,
          email: typeof lo.email === "string" ? lo.email : undefined,
          key: typeof pick(lo, "key", "password", "uuid") === "string" ? String(pick(lo, "key", "password", "uuid")) : undefined,
          flow: typeof lo.flow === "string" ? lo.flow : undefined,
        });
      }
    }
  }

  return {
    username,
    note: typeof pick(o, "note", "comment") === "string" ? String(pick(o, "note", "comment")) : null,
    enabled: pick(o, "enabled", "active", "status") !== false,
    trafficLimitGb: numOrNull(pick(o, "trafficLimitGb", "traffic_limit_gb", "limit_gb", "quota_gb", "traffic_limit")),
    expiryDays: numOrNull(pick(o, "expiryDays", "expiry_days", "days", "expire_days")),
    ipLimit: numOrNull(pick(o, "ipLimit", "ip_limit")) ?? 0,
    resetPeriod,
    onHold: pick(o, "onHold", "on_hold") === true,
    autoRenew: pick(o, "autoRenew", "auto_renew") === true,
    tags: [...new Set(tags)],
    accessKeys,
  };
}

export async function POST(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const list = Array.isArray(b.users) ? b.users : [];
    if (list.length === 0) {
      return NextResponse.json({ error: "validation", fields: [{ field: "username", code: "bulk_count" }] }, { status: 400 });
    }
    if (list.length > 500) {
      return NextResponse.json({ error: "too_many" }, { status: 400 });
    }
    const rename = b.mode === "rename";

    const allInbounds = await db.inbound.findMany({ orderBy: { createdAt: "asc" } });
    const byTag = new Map(allInbounds.map((i) => [i.tag, i]));
    const takenNames = new Set(
      (await db.clientUser.findMany({ select: { username: true } })).map((u) => u.username)
    );

    const created: string[] = [];
    const skipped: string[] = [];
    const failed: { username: string; reason: string }[] = [];

    for (const raw of list.slice(0, 500)) {
      const item = normalizeImportUser(raw);
      if (!item) {
        failed.push({ username: "?", reason: "format" });
        continue;
      }
      if (item.tags.length === 0) {
        failed.push({ username: item.username, reason: "no_inbounds" });
        continue;
      }
      let username = item.username;
      if (takenNames.has(username)) {
        if (!rename) {
          skipped.push(username);
          continue;
        }
        let n = 2;
        while (takenNames.has(`${username}-${n}`) && n < 100) n++;
        username = `${username}-${n}`;
      }

      const linked = item.tags.map((tag) => byTag.get(tag)).filter((i) => i !== undefined);
      if (linked.length === 0) {
        failed.push({ username: item.username, reason: "unknown_tags" });
        continue;
      }
      const droppedTags = item.tags.filter((tag) => !byTag.has(tag));

      try {
        await db.$transaction(async (tx) => {
          const row = await tx.clientUser.create({
            data: {
              username,
              subId: genSubId(),
              note: item.note,
              enabled: item.enabled,
              trafficLimitGb: item.trafficLimitGb,
              expiryDays: item.expiryDays === null ? null : Math.min(3650, Math.round(item.expiryDays)),
              ipLimit: Math.min(1000, Math.round(item.ipLimit)),
              resetPeriod: item.resetPeriod,
              usedTrafficGb: 0,
              resellerId: null,
              onHold: item.onHold,
              startedAt: null,
              autoRenew: item.autoRenew,
              renewals: 0,
            },
          });
          for (const inbound of linked) {
            const spec = item.accessKeys.find((k) => k.tag === inbound.tag);
            const current = await tx.inbound.findUnique({
              where: { id: inbound.id },
              select: { clientsJson: true },
            });
            const existing = parseClients(current?.clientsJson);
            const email =
              (spec?.email && !existing.some((c) => c.email === spec.email) && /^[a-zA-Z0-9._-]{1,64}$/.test(spec.email)
                ? spec.email
                : emailFor(username, inbound.tag, new Set(existing.map((c) => c.email))));
            /* reuse the exported key when it fits the protocol shape, else mint one */
            const material = genAccessFields(inbound.protocol);
            const key =
              typeof spec?.key === "string" && spec.key.length >= 8 && spec.key.length <= 200
                ? spec.key
                : material.key;
            const flow = spec?.flow ?? flowFor(inbound);

            await tx.userInboundAccess.create({
              data: {
                userId: row.id,
                inboundId: inbound.id,
                email,
                key,
                flow,
                wgPrivateKey: material.wgPrivateKey,
                wgPublicKey: material.wgPublicKey,
              },
            });
            const nextJson = projectUserOntoInbound(current?.clientsJson ?? "[]", row.id, [
              {
                email,
                key,
                subId: row.subId,
                flow,
                ipLimit: Math.min(1000, Math.round(item.ipLimit)),
                trafficLimitGb: item.trafficLimitGb,
                expiryDays: item.expiryDays === null ? null : Math.min(3650, Math.round(item.expiryDays)),
                enabled: item.enabled,
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
        created.push(username);
        if (droppedTags.length > 0) {
          failed.push({ username, reason: `dropped_tags:${droppedTags.join(",")}` });
        }
      } catch (err) {
        failed.push({ username, reason: err instanceof Error ? err.message : "error" });
      }
    }

    await logActivity({
      kind: "user.created",
      level: "info",
      actor: actor.username,
      message: `Imported ${created.length} user(s) from JSON (${skipped.length} skipped, ${failed.length} issue(s))`,
      meta: { created: created.length, skipped: skipped.length, failed: failed.length },
    });

    return NextResponse.json({ ok: true, created, skipped, failed });
  } catch (err) {
    console.error("[users:import]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
