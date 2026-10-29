import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { recentWebhookDeliveries } from "@/lib/webhooks";

/* ============================================================
   Sephiroth · v2.7 — Recent webhook deliveries (admin)
   GET /api/webhooks/deliveries → { deliveries: [...] }
   Backs the "recent activity" strip in the Webhooks settings card.
   ============================================================ */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const deliveries = await recentWebhookDeliveries(12);
    return NextResponse.json({ deliveries });
  } catch (err) {
    console.error("[webhooks:deliveries]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
