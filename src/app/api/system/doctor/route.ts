import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/inbounds";
import { parseJsonLoose } from "@/lib/user-types";
import type { DoctorFinding, DoctorReport } from "@/lib/doctor-types";

/* ============================================================
   Sephiroth · v2.3 — CONFIG DOCTOR (unique feature)
   GET /api/system/doctor (admin only)
   Deterministic health scan of the LIVE store. Returns finding
   CODES + meta (client localizes them) + a 0-100 score.

   Checks: open socks/http proxies, TLS/REALITY misconfig, broken
   fallbacks, WireGuard key reuse, dead routing rules,
   expired-but-on users, quota warnings, ghost accounts.
   ============================================================ */

const PENALTY: Record<DoctorFinding["severity"], number> = { danger: 12, warn: 5, info: 1 };

function parseStream(raw: string): Record<string, unknown> {
  return parseJsonLoose<Record<string, unknown>>(raw, {});
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const findings: DoctorFinding[] = [];
  const push = (code: string, severity: DoctorFinding["severity"], meta: Record<string, string> = {}) =>
    findings.push({ code, severity, meta });

  /* ---------- inbounds ---------- */
  const inbounds = await db.inbound.findMany({ orderBy: { port: "asc" } });

  const wgRows: { tag: string; secret: string }[] = [];

  for (const ib of inbounds) {
    const st = parseStream(ib.streamJson);
    const clients = parseJsonLoose<{ email: string; key: string; enabled: boolean }[]>(ib.clientsJson, []);

    // 1. open proxy: socks/http with no auth on a public listen
    if (ib.protocol === "socks" || ib.protocol === "http") {
      const hasAuth = clients.some((c) => c.key && String(c.key).trim());
      const exposed = !ib.listen || ib.listen === "0.0.0.0" || ib.listen === "::";
      if (ib.status === "online" && exposed && !hasAuth) {
        push("socksOpen", "danger", { tag: ib.tag, port: String(ib.port), proto: ib.protocol });
      }
    }

    // 2. TLS without any certificate material
    if (ib.security === "tls") {
      const hasCert =
        Boolean(st.certFile) ||
        Boolean(st.certificate) ||
        (Array.isArray(st.certificates) && st.certificates.length > 0);
      if (!hasCert) {
        push("tlsNoCert", "warn", { tag: ib.tag, port: String(ib.port) });
      }
    }

    // 3. REALITY must have serverNames + shortIds + keys
    if (ib.security === "reality") {
      const missing: string[] = [];
      if (!st.serverNames) missing.push("serverNames");
      if (!st.shortIds) missing.push("shortIds");
      if (!st.privateKey) missing.push("privateKey");
      if (!st.publicKey) missing.push("publicKey");
      if (missing.length > 0) {
        push("realityIncomplete", "warn", { tag: ib.tag, fields: missing.join(", ") });
      }
    }

    // 4. fallbacks sanity (vless/trojan tcp+tls)
    if (Array.isArray(st.fallbacks) && st.fallbacks.length > 0) {
      st.fallbacks.forEach((fb, i) => {
        const f = (fb ?? {}) as Record<string, unknown>;
        const dest = String(f.dest ?? "").trim();
        if (!dest || !dest.includes(":")) {
          push("fallbackBad", "warn", { tag: ib.tag, index: String(i + 1), field: "dest" });
        }
        if (!String(f.alpn ?? "").trim() && !String(f.path ?? "").trim() && !String(f.name ?? "").trim()) {
          push("fallbackBad", "warn", { tag: ib.tag, index: String(i + 1), field: "alpn/path" });
        }
      });
    }

    // 5. WireGuard: reused private key across inbounds
    if (ib.protocol === "wireguard") {
      wgRows.push({ tag: ib.tag, secret: String(st.secretKey ?? "") });
    }

    // 6. expired inbound still online
    if (ib.expiryDays !== null && ib.status === "online") {
      const end = new Date(ib.createdAt).getTime() + ib.expiryDays * 86_400_000;
      if (now.getTime() >= end) {
        push("inboundExpired", "info", { tag: ib.tag, port: String(ib.port) });
      }
    }

    // 7. non-online inbounds
    if (ib.status !== "online") {
      push("inboundOffline", "info", { tag: ib.tag, port: String(ib.port), status: ib.status });
    }

    // 8. privileged port
    if (ib.port < 1024 && ib.status === "online") {
      push("privilegedPort", "warn", { tag: ib.tag, port: String(ib.port) });
    }
  }

  // wireguard cross-inbound secret reuse
  for (let i = 0; i < wgRows.length; i++) {
    for (let j = i + 1; j < wgRows.length; j++) {
      if (wgRows[i].secret && wgRows[i].secret === wgRows[j].secret) {
        push("wgKeyReuse", "danger", { a: wgRows[i].tag, b: wgRows[j].tag });
      }
    }
  }

  /* ---------- users ---------- */
  const users = await db.clientUser.findMany({ include: { accesses: true }, orderBy: { createdAt: "asc" } });
  const inboundById = new Map(inbounds.map((i) => [i.id, i]));

  for (const u of users) {
    if (u.expiryDays !== null) {
      const end = new Date(u.createdAt).getTime() + u.expiryDays * 86_400_000;
      const daysLeft = Math.ceil((end - now.getTime()) / 86_400_000);
      if (daysLeft < 0 && u.enabled) {
        push("userExpiredOn", "warn", { user: u.username, days: String(Math.abs(daysLeft)) });
      } else if (daysLeft >= 0 && daysLeft <= 3 && u.enabled) {
        push("userExpiring", "info", { user: u.username, days: String(daysLeft) });
      }
    }
    if (u.trafficLimitGb !== null && u.trafficLimitGb > 0 && u.enabled) {
      const pct = (u.usedTrafficGb / u.trafficLimitGb) * 100;
      if (pct >= 100) push("userCappedOn", "warn", { user: u.username });
      else if (pct >= 90) {
        push("userNearQuota", "info", { user: u.username, pct: String(Math.round(pct)) });
      }
    }
    if (u.enabled && (u.accesses ?? []).length === 0) {
      push("userNoAccess", "info", { user: u.username });
    }
    // user attached to offline inbound
    if (u.enabled) {
      const offline = (u.accesses ?? [])
        .map((a) => inboundById.get(a.inboundId))
        .filter((ib) => ib && ib.status !== "online");
      if (offline.length > 0 && offline[0]) {
        push("userOfflineInbound", "info", { user: u.username, tag: offline[0].tag });
      }
    }
  }

  /* ---------- routing rules ---------- */
  const rules = await db.routingRule.findMany({ orderBy: { sortOrder: "asc" } });
  const outboundTags = new Set((await db.outbound.findMany()).map((o) => o.tag));
  for (const r of rules) {
    if (!outboundTags.has(r.outboundTag)) {
      push("ruleDead", "danger", { comment: r.comment || `#${r.sortOrder}`, outbound: r.outboundTag });
    }
    const hasMatcher =
      parseJsonLoose<string[]>(r.domainJson, []).length > 0 ||
      parseJsonLoose<string[]>(r.ipJson, []).length > 0 ||
      parseJsonLoose<string[]>(r.protocolJson, []).length > 0 ||
      parseJsonLoose<string[]>(r.inboundTagJson, []).length > 0 ||
      parseJsonLoose<string[]>(r.sourceJson, []).length > 0 ||
      r.port.trim() !== "";
    if (r.enabled && !hasMatcher) {
      push("ruleEmpty", "warn", { comment: r.comment || `#${r.sortOrder}` });
    }
  }

  /* ---------- score ---------- */
  const counts = {
    danger: findings.filter((f) => f.severity === "danger").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
  const penalty =
    counts.danger * PENALTY.danger + counts.warn * PENALTY.warn + counts.info * PENALTY.info;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const grade: DoctorReport["grade"] = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";

  const report: DoctorReport = {
    score,
    grade,
    counts,
    scannedAt: now.toISOString(),
    findings,
  };

  return NextResponse.json(report);
}
