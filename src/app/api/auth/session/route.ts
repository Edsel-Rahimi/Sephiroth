import { NextResponse } from "next/server";
import { parseSessionCookie, verifyToken } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const username = await verifyToken(parseSessionCookie(req));
  if (!username) {
    return NextResponse.json({ authenticated: false });
  }
  const admin = await db.adminUser.findUnique({ where: { username } });
  if (!admin) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({ authenticated: true, username: admin.username });
}
