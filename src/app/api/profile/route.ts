import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Profile API (any signed-in role)
   GET /api/profile → { profile: { username, displayName, role,
                                    createdAt, recoveryConfigured } }
   PUT /api/profile → body { displayName } (admin only)
   ============================================================ */

export async function GET(req: Request) {
  try {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    if (session.role === "admin") {
      const admin = await db.adminUser.findUnique({
        where: { username: session.username },
      });
      if (!admin) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      return NextResponse.json({
        profile: {
          username: admin.username,
          displayName: admin.displayName ?? "",
          role: "admin",
          createdAt: admin.createdAt.toISOString(),
          recoveryConfigured: Boolean(admin.recoveryKey),
        },
      });
    }

    /* reseller */
    const reseller = await db.reseller.findUnique({
      where: { username: session.username },
    });
    if (!reseller) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({
      profile: {
        username: reseller.username,
        displayName: reseller.note ?? "",
        role: "reseller",
        createdAt: reseller.createdAt.toISOString(),
        recoveryConfigured: false,
      },
    });
  } catch (err) {
    console.error("[profile:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const { displayName } = (body ?? {}) as { displayName?: unknown };
    const name = typeof displayName === "string" ? displayName.trim() : "";
    if (name.length > 48) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "displayName", code: "range" }] },
        { status: 400 }
      );
    }

    const admin = await db.adminUser.update({
      where: { username: session.username },
      data: { displayName: name || null },
    });

    await logActivity({
      kind: "settings.updated",
      level: "info",
      actor: admin.username,
      message: "Profile display name updated",
      meta: { displayName: name },
    });

    return NextResponse.json({
      profile: {
        username: admin.username,
        displayName: admin.displayName ?? "",
        role: "admin",
        createdAt: admin.createdAt.toISOString(),
        recoveryConfigured: Boolean(admin.recoveryKey),
      },
    });
  } catch (err) {
    console.error("[profile:PUT]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
