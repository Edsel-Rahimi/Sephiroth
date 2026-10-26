import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const actor = await getSession(req);
  // Login-scene preview hints (seed credentials panel) are opt-in via env
  // so production boots with a clean, hint-free login.
  const showPreviewHints = process.env.SEPH_PREVIEW_AUTH === "1";
  if (!actor) {
    return NextResponse.json({ authenticated: false, showPreviewHints });
  }
  if (actor.role === "admin") {
    return NextResponse.json({
      authenticated: true,
      username: actor.username,
      role: "admin",
      showPreviewHints,
    });
  }
  return NextResponse.json({
    authenticated: true,
    username: actor.username,
    role: "reseller",
    resellerId: actor.id,
    showPreviewHints,
  });
}
