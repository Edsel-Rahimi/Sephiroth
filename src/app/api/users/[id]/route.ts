import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { emailFor, flowFor, genKey, toUserDTO } from "@/lib/users";
import { parseClients, validateUser } from "@/lib/user-types";
import { stripUserEverywhere, syncUserProjection } from "@/lib/user-sync";

/* ============================================================
   Sephiroth · Phase 4 — Users item API
   PATCH  /api/users/:id → { user: UserDTO }
     body: { note?, enabled?, trafficLimitGb?, expiryDays?, ipLimit?,
             inboundIds? (replaces the full link set) }
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
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const parsed = validateUser(body, { requireInbounds: false, partial: true });
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "validation", fields: parsed.fields },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const existing = await db.clientUser.findUnique({
      where: { id },
      include: { accesses: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // resolve the new link set (default: keep current)
    let nextInboundIds: string[] | null = null;
    if (Array.isArray((body as Record<string, unknown>)?.inboundIds)) {
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

    await db.$transaction(async (tx) => {
      await tx.clientUser.update({
        where: { id },
        data: {
          note: data.note || null,
          enabled: data.enabled,
          trafficLimitGb: data.trafficLimitGb,
          expiryDays: data.expiryDays,
          ipLimit: data.ipLimit,
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
          if (existing.accesses.some((a) => a.inboundId === inboundId)) continue;
          const inbound = await tx.inbound.findUnique({ where: { id: inboundId } });
          if (!inbound) continue;
          const existingClients = parseClients(inbound.clientsJson);
          const email = emailFor(
            existing.username,
            inbound.tag,
            new Set(existingClients.map((c) => c.email))
          );
          await tx.userInboundAccess.create({
            data: {
              userId: id,
              inboundId,
              email,
              key: genKey(inbound.protocol),
              flow: flowFor(inbound),
            },
          });
        }
      }
    });

    // rebuild every linked inbound's clientsJson with the freshest state
    await syncUserProjection(id, {
      ipLimit: data.ipLimit,
      trafficLimitGb: data.trafficLimitGb,
      expiryDays: data.expiryDays,
      enabled: data.enabled,
    });

    const updated = await db.clientUser.findUnique({
      where: { id },
      include: { accesses: { include: { inbound: true } } },
    });
    if (!updated) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
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
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db.clientUser.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await stripUserEverywhere(id);
    await db.clientUser.delete({ where: { id } }); // cascades accesses

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[users:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
