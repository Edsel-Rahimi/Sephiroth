import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ADMIN_ROLES, hashPassword, normalizeAdminRole, requireOwner } from "@/lib/auth";
import { prismaErrorCode } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import { countActiveOwners, toAdminDTO } from "@/lib/admins";

/* ============================================================
   Sephiroth · task 3-b — Admin item API (OWNER-ONLY, RBAC)
   PATCH  /api/admins/[id] { role?, password?, enabled? }
   DELETE /api/admins/[id]

   Protections (both → 400):
   - last_owner: the last ACTIVE owner can never be demoted,
     disabled or removed — every deployment stays owner-recoverable
     (recovery-key flow still resets the owner password as before)
   - self_delete: an owner cannot delete their own account
   Passwords are hashed with the auth.ts scrypt scheme and never
   logged; PATCH with an empty body → 400 validation.
   ============================================================ */

const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const guard = await requireOwner(req);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    const { id } = await ctx.params;
    const existing = await db.adminUser.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    let body: { role?: unknown; password?: unknown; enabled?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const fields: { field: string; code: string }[] = [];
    const hasRole = body.role !== undefined;
    const hasPassword = body.password !== undefined;
    const hasEnabled = body.enabled !== undefined;
    if (!hasRole && !hasPassword && !hasEnabled) {
      return NextResponse.json({ error: "validation", fields: [] }, { status: 400 });
    }

    let role: (typeof ADMIN_ROLES)[number] | undefined;
    if (hasRole) {
      if (typeof body.role === "string" && ADMIN_ROLES.includes(body.role as never)) {
        role = body.role as (typeof ADMIN_ROLES)[number];
      } else {
        fields.push({ field: "role", code: "format" });
      }
    }
    let password: string | undefined;
    if (hasPassword) {
      if (
        typeof body.password === "string" &&
        body.password.length >= PASSWORD_MIN &&
        body.password.length <= PASSWORD_MAX
      ) {
        password = body.password;
      } else {
        fields.push({ field: "password", code: "range" });
      }
    }
    let enabled: boolean | undefined;
    if (hasEnabled) {
      if (typeof body.enabled === "boolean") {
        enabled = body.enabled;
      } else {
        fields.push({ field: "enabled", code: "format" });
      }
    }
    if (fields.length > 0) {
      return NextResponse.json({ error: "validation", fields }, { status: 400 });
    }

    // last ACTIVE owner can never lose owner status or get disabled
    const isTargetActiveOwner =
      normalizeAdminRole(existing.role) === "owner" && existing.enabled !== false;
    const losesOwnership =
      (role !== undefined && role !== "owner") || enabled === false;
    if (isTargetActiveOwner && losesOwnership && (await countActiveOwners()) <= 1) {
      return NextResponse.json({ error: "last_owner" }, { status: 400 });
    }

    const updated = await db.adminUser.update({
      where: { id },
      data: {
        ...(role !== undefined ? { role } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(password !== undefined ? { passwordHash: hashPassword(password) } : {}),
      },
    });

    await logActivity({
      kind: "admin.updated",
      level: "warn",
      actor: guard.username,
      message: `Admin "${updated.username}" updated (${[
        role !== undefined ? `role=${role}` : null,
        enabled !== undefined ? `enabled=${enabled}` : null,
        password !== undefined ? "password-reset" : null,
      ]
        .filter(Boolean)
        .join(", ")})`,
      meta: { adminId: id, username: updated.username }, // password never logged
    });

    return NextResponse.json({ admin: toAdminDTO(updated, guard.username) });
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[admins:PATCH]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const guard = await requireOwner(req);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    const { id } = await ctx.params;
    const existing = await db.adminUser.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (existing.username === guard.username) {
      // an owner cannot delete their own account (use PATCH to disable others)
      return NextResponse.json({ error: "self_delete" }, { status: 400 });
    }
    const isTargetActiveOwner =
      normalizeAdminRole(existing.role) === "owner" && existing.enabled !== false;
    if (isTargetActiveOwner && (await countActiveOwners()) <= 1) {
      return NextResponse.json({ error: "last_owner" }, { status: 400 });
    }

    await db.adminUser.delete({ where: { id } });
    await logActivity({
      kind: "admin.deleted",
      level: "warn",
      actor: guard.username,
      message: `Admin "${existing.username}" removed`,
      meta: { adminId: id, username: existing.username },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[admins:DELETE]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
