import { NextResponse } from "next/server";
import {
  clientIp,
  clearFailures,
  ensureSeed,
  lockState,
  registerFailure,
  rotateSessionSecret,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export async function POST(req: Request) {
  await ensureSeed();

  const ip = clientIp(req);
  const lock = lockState(ip);
  if (lock.locked) {
    return NextResponse.json(
      { error: "locked", retryAfter: lock.retryAfter },
      { status: 423 }
    );
  }

  let body: { recoveryKey?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const recoveryKey =
    typeof body.recoveryKey === "string" ? body.recoveryKey.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!recoveryKey || !newPassword) {
    return NextResponse.json({ error: "fields" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "weak" }, { status: 400 });
  }

  const admin = await db.adminUser.findUnique({ where: { recoveryKey } });
  if (!admin) {
    const fail = registerFailure(ip);
    if (fail.locked) {
      return NextResponse.json(
        { error: "locked", retryAfter: fail.retryAfter },
        { status: 423 }
      );
    }
    return NextResponse.json(
      { error: "bad_key", attemptsLeft: fail.attemptsLeft },
      { status: 401 }
    );
  }

  await db.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash: hashPassword(newPassword) },
  });

  /* every existing session dies — everyone must sign in again */
  await rotateSessionSecret();
  clearFailures(ip);

  return NextResponse.json({ ok: true });
}
