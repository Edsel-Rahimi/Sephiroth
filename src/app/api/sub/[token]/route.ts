import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import {
  groupSubPayload,
  userSubPayload,
  type SubPayload,
} from "@/lib/sub-groups";

/* ============================================================
   Sephiroth · Phase 5 — public subscription endpoint
   GET  /api/sub/[token]            → JSON payload for the page
        /api/sub/[token]?format=raw → text/plain URI list
        /api/sub/[token]?format=b64 → base64-wrapped URI list
        Locked groups: append &pw=<password> to formats.
   POST /api/sub/[token] {password} → unlock a password-protected
        group page (returns the full payload on success).

   Token resolution order: ClientUser.subId → SubGroup.token.
   Disabled groups 404 (indistinguishable from nonexistent).
   ============================================================ */

type Resolved =
  | { type: "user"; payload: SubPayload; disabled: boolean }
  | { type: "group"; payload: SubPayload | null; locked: boolean; disabled: boolean; name?: string };

async function resolveToken(token: string): Promise<Resolved | null> {
  const user = await db.clientUser.findUnique({
    where: { subId: token },
    include: { accesses: { include: { inbound: true } } },
  });
  if (user) {
    return {
      type: "user",
      payload: userSubPayload(user),
      disabled: !user.enabled,
    };
  }

  const group = await db.subGroup.findUnique({
    where: { token },
    include: {
      members: {
        include: {
          user: { include: { accesses: { include: { inbound: true } } } },
        },
      },
    },
  });
  if (!group || !group.enabled) return null;
  if (group.passwordHash) {
    return { type: "group", payload: null, locked: true, disabled: false, name: group.name };
  }
  return { type: "group", payload: groupSubPayload(group), locked: false, disabled: false };
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** URI list (raw body) — text-only configs become comments. */
function payloadToRaw(payload: SubPayload): string {
  const lines: string[] = [];
  for (const c of payload.configs) {
    if (c.link) lines.push(c.link);
    else lines.push(`# ${c.tag} — copy from the sub page (no URI scheme)`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const url = new URL(req.url);
    const format = url.searchParams.get("format");
    const pw = url.searchParams.get("pw") ?? "";

    const found = await resolveToken(token);
    if (!found) return textResponse("not found", 404);

    /* ---------- plain-text subscription formats ---------- */
    if (format === "raw" || format === "b64") {
      if (found.type === "user" && found.disabled) {
        return textResponse("subscription disabled", 410);
      }
      let payload = found.payload;
      if (!payload) {
        // locked group — verify ?pw=
        const group = await db.subGroup.findUnique({ where: { token } });
        if (!group || !group.passwordHash || !verifyPassword(pw, group.passwordHash)) {
          return textResponse("password required", 401);
        }
        const fresh = await db.subGroup.findUnique({
          where: { token },
          include: {
            members: {
              include: { user: { include: { accesses: { include: { inbound: true } } } } },
            },
          },
        });
        if (!fresh) return textResponse("not found", 404);
        payload = groupSubPayload(fresh);
      }

      const raw = payloadToRaw(payload);
      if (format === "b64") {
        return textResponse(Buffer.from(raw, "utf-8").toString("base64"), 200);
      }
      return textResponse(raw, 200);
    }

    /* ---------- JSON for the sub page ---------- */
    if (found.type === "group" && found.locked) {
      return NextResponse.json({ kind: "group", locked: true, token });
    }
    return NextResponse.json(found.payload);
  } catch (err) {
    console.error("[sub:token:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    let body: { password?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }
    const password = typeof body.password === "string" ? body.password : "";

    const group = await db.subGroup.findUnique({ where: { token } });
    if (!group || !group.enabled) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!group.passwordHash || !verifyPassword(password, group.passwordHash)) {
      return NextResponse.json({ error: "wrong_password" }, { status: 401 });
    }

    const fresh = await db.subGroup.findUnique({
      where: { token },
      include: {
        members: {
          include: { user: { include: { accesses: { include: { inbound: true } } } } },
        },
      },
    });
    if (!fresh) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(groupSubPayload(fresh));
  } catch (err) {
    console.error("[sub:token:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
