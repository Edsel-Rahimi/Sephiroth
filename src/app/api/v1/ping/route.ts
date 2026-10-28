import { NextResponse } from "next/server";

/* ============================================================
   Sephiroth · Phase 28 — /api/v1 public namespace
   GET /api/v1/ping — the ONLY unauthenticated /api/v1 endpoint.
   Zero secrets, zero state: a health probe for uptime monitors
   and SDK connectivity checks. Every other /api/v1/* route is a
   curated alias of the dashboard REST API and requires a valid
   `seph_…` bearer token (Settings → Public API).
   ============================================================ */

export const API_V1_VERSION = "27.1.0";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "sephiroth-panel",
      version: API_V1_VERSION,
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
