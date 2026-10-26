import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import {
  getRoutingState,
  saveRoutingState,
  validateRule,
  type RuleInput,
} from "@/lib/net-objects";
import { logActivity } from "@/lib/activity";

/* ============================================================
   Sephiroth · Routing API (admin only) — ordered xray rules
   GET /api/routing → { domainStrategy, rules: RoutingRuleDTO[] }
   PUT /api/routing → body { domainStrategy, rules: RuleInput[] }
                      (bulk save — order = evaluation order)
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const state = await getRoutingState();
    return NextResponse.json(state);
  } catch (err) {
    console.error("[routing:GET]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
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

    const b = (body ?? {}) as Record<string, unknown>;
    const domainStrategy =
      typeof b.domainStrategy === "string" &&
      ["AsIs", "IPIfNonMatch", "IPOnDemand"].includes(b.domainStrategy)
        ? b.domainStrategy
        : "AsIs";

    if (!Array.isArray(b.rules) || b.rules.length > 64) {
      return NextResponse.json(
        { error: "validation", fields: [{ field: "rules", code: "range" }] },
        { status: 400 }
      );
    }

    const validated: RuleInput[] = [];
    for (const raw of b.rules) {
      const parsed = validateRule(raw);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "validation", fields: parsed.fields },
          { status: 400 }
        );
      }
      validated.push(parsed.data);
    }

    await saveRoutingState(domainStrategy, validated);
    await logActivity({
      kind: "settings.updated",
      level: "warn",
      actor: admin,
      message: `Routing rules saved (${validated.length} rules, strategy: ${domainStrategy})`,
      meta: { count: validated.length, domainStrategy },
    });

    const state = await getRoutingState();
    return NextResponse.json(state);
  } catch (err) {
    console.error("[routing:PUT]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
