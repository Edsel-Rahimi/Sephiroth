import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import {
  ADMIN_ROLES,
  hashPassword,
  requireOwner,
} from "@/lib/auth";
import { prismaErrorCode } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import { countActiveOwners, toAdminDTO } from "@/lib/admins";

/* ============================================================
   Sephiroth · task 3-b — Admin management (OWNER-ONLY, RBAC)

   GET  /api/admins → { admins: AdminDTO[] }
   POST /api/admins { username, password, role } → { admin } (201)
   Passwords hash with the exact scrypt scheme used by auth.ts
   seeding (hashPassword: "salt:hash"). Creating an admin whose
   username shadows a reseller is rejected — the login path
   resolves the admin table first and would hijack that reseller.

   Protections:
   - cannot delete yourself (400 self_delete)
   - cannot demote/disable/delete the LAST ACTIVE owner
     (400 last_owner) — keeps every deployment owner-recoverable
   - passwords never logged, only hashed
   ============================================================ */

const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

/** Unique recovery key in the preview format: SEPH-XXXX-XXXX-XXXX. */
async function genRecoveryKey(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const hex = randomBytes(6).toString("hex").toUpperCase();
    const key = `SEPH-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
    const taken = await db.adminUser.findUnique({
      where: { recoveryKey: key },
      select: { id: true },
    });
    if (!taken) return key;
  }
  // statistically unreachable — fall back to a long unique suffix
  return `SEPH-${randomBytes(12).toString("hex").toUpperCase()}`;
}

export async function GET(req: Request) {
  try {
    const guard = await requireOwner(req);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
    const rows = await db.adminUser.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({
      admins: rows.map((r) => toAdminDTO(r, guard.username)),
    });
  } catch (err) {
    console.error("[admins:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireOwner(req);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    let body: { username?: unknown; password?: unknown; role?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const fields: { field: string; code: string }[] = [];
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = typeof body.role === "string" ? body.role : "";

    if (
      username.length < USERNAME_MIN ||
      username.length > USERNAME_MAX ||
      !USERNAME_PATTERN.test(username)
    ) {
      fields.push({ field: "username", code: "format" });
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      fields.push({ field: "password", code: "range" });
    }
    if (!ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
      fields.push({ field: "role", code: "format" });
    }
    if (fields.length > 0) {
      return NextResponse.json({ error: "validation", fields }, { status: 400 });
    }

    // username must be free among admins AND resellers (login resolves the
    // admin table first — shadowing would silently hijack the reseller)
    const adminTaken = await db.adminUser.findUnique({
      where: { username },
      select: { id: true },
    });
    const resellerTaken = await db.reseller.findUnique({
      where: { username },
      select: { id: true },
    });
    if (adminTaken || resellerTaken) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "username", code: "taken" }] },
        { status: 409 }
      );
    }

    const created = await db.adminUser.create({
      data: {
        username,
        passwordHash: hashPassword(password),
        recoveryKey: await genRecoveryKey(),
        displayName: null,
        role: role as (typeof ADMIN_ROLES)[number],
        enabled: true,
        lastLoginAt: null,
      },
    });

    await logActivity({
      kind: "admin.created",
      level: "warn",
      actor: guard.username,
      message: `Admin "${created.username}" created with role "${role}"`,
      meta: { adminId: created.id, username: created.username, role },
    });

    return NextResponse.json({ admin: toAdminDTO(created) }, { status: 201 });
  } catch (err) {
    if (prismaErrorCode(err) === "P2002") {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "username", code: "taken" }] },
        { status: 409 }
      );
    }
    console.error("[admins:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
