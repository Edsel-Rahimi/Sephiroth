import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import {
  emailFor,
  flowFor,
  genKey,
  genSubId,
  projectUserOntoInbound,
  toUserDTO,
} from "@/lib/users";
import { parseClients, seededUsage, validateUser } from "@/lib/user-types";

/* ============================================================
   Sephiroth · Phase 4 — Users collection API
   GET  /api/users  → { users: UserDTO[] }
   POST /api/users  → { user: UserDTO } (201)
      body: { username, note?, enabled?, trafficLimitGb?, expiryDays?,
              ipLimit?, inboundIds[] }
   Creates the ClientUser + one access per selected inbound and
   projects each access into the inbound's clientsJson (ownerId).
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const rows = await db.clientUser.findMany({
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
    const admin = await requireAdmin(req);
    if (!admin) {
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

    // friendly uniqueness check before sqlite constraints
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
          usedTrafficGb: 0,
        },
      });
      await tx.clientUser.update({
        where: { id: user.id },
        data: { usedTrafficGb: seededUsage(user.id, data.trafficLimitGb) },
      });

      for (const inbound of inboundRows) {
        const current = await tx.inbound.findUnique({
          where: { id: inbound.id },
          select: { clientsJson: true },
        });
        const existing = parseClients(current?.clientsJson);
        const taken = new Set(existing.map((c) => c.email));
        const email = emailFor(data.username, inbound.tag, taken);
        const key = genKey(inbound.protocol);
        const flow = flowFor(inbound);

        await tx.userInboundAccess.create({
          data: { userId: user.id, inboundId: inbound.id, email, key, flow },
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
    return NextResponse.json({ user: toUserDTO(created) }, { status: 201 });
  } catch (err) {
    console.error("[users:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
