import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashApiToken } from "@/lib/auth";
import { appVersion } from "@/lib/settings";
import { getActiveBackend } from "@/lib/core/registry";

/* ============================================================
   Sephiroth · Task 3-c (item 3.5) — Prometheus metrics endpoint
   GET /api/metrics

   Text exposition format (v0.0.4) for Prometheus / Grafana
   agents. Auth reuses the Phase 27 public-API token mechanism:
   `Authorization: Bearer seph_…` (or `?token=` for agents that
   cannot set headers) validated against the apiToken store —
   exactly the same `seph_` tokens minted in Settings → Public
   API. No valid token → 401. Token material is NEVER echoed.

   Design rules:
   - cheap: store reads + one core snapshot only, no heavy loops;
   - never throws: every metric family is wrapped, failures bump
     `sephiroth_scrape_errors_total` and the exposition stays
     valid with the missing families simply absent.
   ============================================================ */

const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** Extract + validate a public-API token the same way auth.ts's
 *  actorFromBearer does (hash lookup + enabled check). Returns
 *  true when the caller presented a live `seph_` token. */
async function hasValidApiToken(req: Request): Promise<boolean> {
  try {
    let raw = "";
    const header = req.headers.get("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (m) {
      raw = m[1]!.trim();
    } else {
      const q = new URL(req.url).searchParams.get("token");
      if (q) raw = q.trim();
    }
    if (!raw.startsWith("seph_") || raw.length < 12 || raw.length > 128) return false;

    const hash = hashApiToken(raw);
    const row = await db.apiToken.findUnique({ where: { tokenHash: hash } });
    return Boolean(row && row.enabled);
  } catch {
    // store unreadable → we cannot establish a valid token → deny
    return false;
  }
}

/** Expiry semantics copied from runPeriodicUserMaintenance
 *  (server.ts): on-hold users whose clock has not started never
 *  expire; auto-renew users are only "expired" when even the
 *  rolled-forward window has passed. Pure read — no writes. */
function isUserExpired(u: {
  enabled: boolean;
  expiryDays: number | null;
  onHold: boolean;
  startedAt: Date | string | null;
  autoRenew: boolean;
  createdAt: Date | string;
}, nowMs: number): boolean {
  const days = Number(u.expiryDays);
  if (!Number.isFinite(days) || days === null || days <= 0) return false;
  if (u.onHold === true && (u.startedAt === null || u.startedAt === undefined)) return false;
  const anchorMs = new Date(u.startedAt ?? u.createdAt).getTime();
  if (!Number.isFinite(anchorMs)) return false;
  const periodMs = days * 86_400_000;
  let endsAt = anchorMs + periodMs;
  if (u.autoRenew === true && nowMs >= endsAt) {
    const elapsed = Math.floor((nowMs - endsAt) / periodMs) + 1;
    endsAt = endsAt + elapsed * periodMs;
  }
  return nowMs >= endsAt;
}

/** Escape per the exposition format (label values). */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export async function GET(req: Request) {
  // ---- auth: same seph_ tokens as the rest of the public API ----
  if (!(await hasValidApiToken(req))) {
    // no token material is ever echoed back
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const lines: string[] = [];
  const failed: string[] = [];
  // process-wide counter — bumps once per failed family per scrape
  const g = globalThis as unknown as { __sephMetricsScrapeErrors?: number };
  const bump = () => {
    g.__sephMetricsScrapeErrors = (g.__sephMetricsScrapeErrors ?? 0) + 1;
  };

  const family = (
    name: string,
    help: string,
    type: "gauge" | "counter",
    samples: string[],
  ): void => {
    lines.push(`# HELP ${name} ${esc(help)}`);
    lines.push(`# TYPE ${name} ${type}`);
    for (const s of samples) lines.push(s);
  };

  try {
    family(
      "sephiroth_panel_info",
      "Panel build information (version). Machine-readable API docs: /api/openapi.json",
      "gauge",
      [`sephiroth_panel_info{version="${esc(appVersion())}"} 1`],
    );
  } catch {
    failed.push("sephiroth_panel_info");
    bump();
  }

  try {
    family(
      "sephiroth_uptime_seconds",
      "Panel process uptime in seconds.",
      "gauge",
      [`sephiroth_uptime_seconds ${Math.max(0, process.uptime()).toFixed(3)}`],
    );
  } catch {
    failed.push("sephiroth_uptime_seconds");
    bump();
  }

  // ---- inbounds (store rows: status "online" vs everything else) ----
  try {
    const inbounds = await db.inbound.findMany();
    let online = 0;
    for (const ib of inbounds) {
      if (String(ib.status) === "online") online++;
    }
    family(
      "sephiroth_inbounds_total",
      "Number of inbounds configured in the panel.",
      "gauge",
      [`sephiroth_inbounds_total ${inbounds.length}`],
    );
    family(
      "sephiroth_inbounds_online",
      "Inbounds currently marked online.",
      "gauge",
      [`sephiroth_inbounds_online ${online}`],
    );
  } catch {
    failed.push("sephiroth_inbounds_total", "sephiroth_inbounds_online");
    bump();
  }

  // ---- users (store rows; expired derived with maintenance-job semantics) ----
  try {
    const users = await db.clientUser.findMany();
    const nowMs = Date.now();
    let enabled = 0;
    let expired = 0;
    for (const u of users) {
      if (u.enabled === true) enabled++;
      if (isUserExpired(u, nowMs)) expired++;
    }
    family(
      "sephiroth_users_total",
      "Number of client users in the panel.",
      "gauge",
      [`sephiroth_users_total ${users.length}`],
    );
    family(
      "sephiroth_users_enabled",
      "Client users currently enabled.",
      "gauge",
      [`sephiroth_users_enabled ${enabled}`],
    );
    family(
      "sephiroth_users_expired",
      "Client users whose subscription window has passed (same semantics as the expiry maintenance job; auto-renew windows are rolled forward first).",
      "gauge",
      [`sephiroth_users_expired ${expired}`],
    );
  } catch {
    failed.push("sephiroth_users_total", "sephiroth_users_enabled", "sephiroth_users_expired");
    bump();
  }

  // ---- traffic (active core snapshot — the same totals the dashboard header shows) ----
  try {
    const backend = getActiveBackend();
    const kind = backend?.status().kind ?? "none";
    let bytes = 0;
    if (backend && kind === "xray") {
      // CoreMetrics.monthTxTb = total egress this month, in TB
      const tb = Number(backend.snapshot()?.metrics?.monthTxTb ?? 0);
      if (Number.isFinite(tb) && tb > 0) bytes = Math.round(tb * 1024 ** 4);
    }
    family(
      "sephiroth_traffic_total_bytes",
      "Total egress bytes this month reported by the active core (same figure the dashboard header shows).",
      "gauge",
      [
        ...(kind !== "xray"
          ? [`# core is in simulator mode — the simulator generates no real traffic, value stays 0 until the Xray driver is active`]
          : []),
        `sephiroth_traffic_total_bytes ${bytes}`,
      ],
    );
  } catch {
    failed.push("sephiroth_traffic_total_bytes");
    bump();
  }

  // ---- bot orders (tgOrder rows) ----
  try {
    const orders = await db.tgOrder.findMany();
    let completed = 0;
    for (const o of orders) {
      if (String(o.status) === "completed") completed++;
    }
    family(
      "sephiroth_tg_orders_total",
      "Total bot shop orders recorded.",
      "gauge",
      [`sephiroth_tg_orders_total ${orders.length}`],
    );
    family(
      "sephiroth_tg_orders_completed",
      "Bot shop orders that reached the completed state.",
      "gauge",
      [`sephiroth_tg_orders_completed ${completed}`],
    );
  } catch {
    failed.push("sephiroth_tg_orders_total", "sephiroth_tg_orders_completed");
    bump();
  }

  // ---- webhook dead letters (Task 2-a queue) ----
  try {
    const dead = await db.webhookDead.count();
    family(
      "sephiroth_webhook_dead_letters",
      "Webhook deliveries currently parked in the dead-letter queue (non-zero = attention needed).",
      "gauge",
      [`sephiroth_webhook_dead_letters ${dead}`],
    );
  } catch {
    failed.push("sephiroth_webhook_dead_letters");
    bump();
  }

  // ---- scrape health ----
  family(
    "sephiroth_scrape_errors_total",
    "Metric-family reads that failed since process start. A value above 0 means this exposition is PARTIAL (failed families are absent above).",
    "counter",
    [`sephiroth_scrape_errors_total ${g.__sephMetricsScrapeErrors ?? 0}`],
  );
  if (failed.length > 0) {
    lines.push(`# scrape partial — failed families: ${failed.join(",")}`);
  }

  return new NextResponse(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "content-type": METRICS_CONTENT_TYPE,
      "cache-control": "no-store",
    },
  });
}
