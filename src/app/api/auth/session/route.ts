import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const actor = await getSession(req);
  if (!actor) {
    return NextResponse.json({ authenticated: false });
  }
  if (actor.role === "admin") {
    return NextResponse.json({
      authenticated: true,
      username: actor.username,
      role: "admin",
    });
  }
  return NextResponse.json({
    authenticated: true,
    username: actor.username,
    role: "reseller",
    resellerId: actor.id,
  });
}
