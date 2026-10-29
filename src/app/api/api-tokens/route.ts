import { NextResponse } from "next/server";
import { db, type ApiToken } from "@/lib/db";
import { getSession, genApiToken, isReadOnlyActor } from "@/lib/auth"; // task 3-b — viewer read-only
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Phase 27 — Public API token management
   The REST API doubles as the public API: any session-authed
   route also accepts `Authorization: Bearer seph_…`. Tokens are
   minted here (admin only) and shown ONCE; the store keeps only
   the sha256 hash + a 12-char display prefix.

   GET  /api/api-tokens → { tokens: [...] }   (hash never leaves)
   POST /api/api-tokens { name } → { token: <raw>, tokenRow } (201)
   ============================================================ */

const NAME_MAX = 48;

function toTokenDTO(row: ApiToken) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    enabled: row.enabled,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    lastUsedIp: row.lastUsedIp,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const rows = await db.apiToken.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ tokens: rows.map(toTokenDTO) });
  } catch (err) {
    console.error("[api-tokens:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getSession(req);
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (isReadOnlyActor(actor)) {
      // task 3-b — viewers cannot mint API credentials (read-only role)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    let body: { name?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }
    const name = String(body.name ?? "").trim();
    if (!name || name.length > NAME_MAX) {
      return NextResponse.json({ error: "validation" }, { status: 400 });
    }

    const minted = genApiToken();
    const row = await db.apiToken.create({
      data: {
        name,
        tokenHash: minted.hash,
        prefix: minted.prefix,
        actorUsername: actor.username,
      },
    });

    await logActivity({
      kind: "settings.updated",
      level: "warn",
      actor: actor.username,
      message: `Public API token "${name}" minted (${row.prefix})`,
      meta: { tokenId: row.id, name, prefix: row.prefix },
    });

    // the raw secret is returned exactly once — it is never retrievable again
    return NextResponse.json(
      { token: minted.raw, tokenRow: toTokenDTO(row) },
      { status: 201 }
    );
  } catch (err) {
    console.error("[api-tokens:POST]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
