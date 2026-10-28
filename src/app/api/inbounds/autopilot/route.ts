import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  IN_PROTOCOLS,
  requireAdmin,
  toDTO,
  validateInbound,
  type InboundClient,
} from "@/lib/inbounds";
import { genKey, genSubId } from "@/lib/users";
import { buildShareMaterial } from "@/lib/share-links";
import { MTP_DEFAULT_DOMAIN } from "@/lib/mtp-secret";
import { logActivity } from "@/lib/activity";
import { notifyInboundCreated } from "@/lib/bot/notify";

/* ============================================================
   Sephiroth · Task 25-b — One-Port Autopilot API (atomic)

   POST /api/inbounds/autopilot
     { mode: "clone", templateId, protocols, tls? }   → clone mode:
         recreate each requested protocol with the TEMPLATE's
         characteristics (transport/security when the target supports
         them, same client emails + subIds so existing subscriptions
         pick the new protocols up; key material re-generated when the
         wire format differs).
     { mode: "multi", protocols, portStart?, tls?, shareUsers? }
                                                      → multi-select:
         fresh inbounds per protocol, one fresh client each.
         shareUsers: true reuses the newest inbound's client emails +
         subIds instead (one identity across all protocols).

   Semantics:
   - ports are auto-allocated (443 → 8443 → 2053 → 2083 → 2087 →
     portStart/10000+, skipping anything already bound by a row)
   - ONE atomic create pass: any failure rolls the whole plan back
     (no half-built fleets — the v2.2 combo flaw, fixed)
   - response carries ready-to-copy share links per created inbound
   ============================================================ */

/** Protocols that carry raw sockets — no transport/security layer applies. */
const NO_STREAM = new Set(["wireguard", "socks", "http", "dokodemo-door", "mixed", "mtproto"]);
/** Protocols that can sit behind TLS stream settings. */
const STREAM_TLS_OK = new Set(["vless", "vmess", "trojan", "shadowsocks"]);
/** reality is only sane for these. */
const REALITY_OK = new Set(["vless", "vmess", "trojan"]);

interface AutopilotBody {
  mode?: string;
  templateId?: string;
  protocols?: unknown;
  portStart?: number;
  shareUsers?: boolean;
  tls?: boolean;
}

/** Preferred public ports, then a generic high-range scan. */
const PREFERRED_PORTS = [443, 8443, 2053, 2083, 2087];

function allocatePorts(count: number, used: Set<number>, portStart?: number): number[] {
  const taken = new Set(used);
  const out: number[] = [];
  // explicit start → contiguous scan from there (30000 → 30000, 30001, …);
  // otherwise walk the preferred public ports, then the 10000+ range
  const seq: number[] = [];
  if (portStart && Number.isInteger(portStart) && portStart >= 1 && portStart <= 65535) {
    seq.push(portStart);
  } else {
    seq.push(...PREFERRED_PORTS);
  }
  for (let p = seq.length ? (seq[seq.length - 1]! < 10000 ? 10000 : seq[seq.length - 1]! + 1) : 10000; seq.length < count + 16; p++) {
    seq.push(p);
  }
  for (const p of seq) {
    if (out.length >= count) break;
    if (!taken.has(p) && !out.includes(p)) out.push(p);
  }
  return out.slice(0, count);
}

/** Target stream settings for a protocol (clone inheritance handled by caller). */
function defaultStreamFor(
  proto: string,
  tplStream: Record<string, unknown>
): Record<string, unknown> {
  if (proto === "mtproto") return { mtpDomain: MTP_DEFAULT_DOMAIN };
  if (proto === "shadowsocks") {
    // keep the template cipher when cloning from another ss inbound
    const m =
      typeof tplStream.method === "string" && tplStream.method
        ? tplStream.method
        : "2022-blake3-aes-128-gcm";
    return { method: m };
  }
  if (proto === "socks") return { socksUdp: true };
  if (proto === "dokodemo-door")
    return { dokoAddress: "one.one.one.one", dokoPort: 53, dokoNetwork: "tcp,udp" };
  return {};
}

/**
 * Map template clients onto a target protocol: same emails + subIds (so
 * subscriptions stay unified), key material re-generated when the wire
 * format differs. `fresh` skips the template entirely.
 */
function mapClients(
  proto: string,
  tplClients: InboundClient[],
  fresh: boolean,
  port: number
): InboundClient[] {
  if (fresh || tplClients.length === 0) {
    return [
      {
        email: `user-${port}`,
        key: genKey(proto),
        subId: genSubId(),
        flow: "",
        ipLimit: 0,
        trafficLimitGb: null,
        expiryDays: null,
        enabled: true,
      },
    ];
  }
  return tplClients.slice(0, 100).map((c) => ({
    ...c,
    key: genKey(proto), // email/subId preserved — key format is per-protocol
    flow: "", // vision flow only makes sense on vless — recomputed by the caller
    enabled: c.enabled,
  }));
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let body: AutopilotBody;
    try {
      body = (await req.json()) as AutopilotBody;
    } catch {
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const mode = body.mode === "clone" ? "clone" : "multi";
    const protocols = Array.isArray(body.protocols)
      ? body.protocols
          .map(String)
          .filter((p) => (IN_PROTOCOLS as readonly string[]).includes(p))
          .slice(0, 12)
      : [];
    if (protocols.length === 0) {
      return NextResponse.json({ error: "no_protocols" }, { status: 400 });
    }

    const rows = await db.inbound.findMany({
      orderBy: [{ createdAt: "asc" }, { tag: "asc" }],
    });

    /* ---------- resolve the template (clone / shared identity) ---------- */
    const tpl =
      mode === "clone" && body.templateId
        ? rows.find((r) => r.id === body.templateId) ?? null
        : null;
    if (mode === "clone" && !tpl) {
      return NextResponse.json({ error: "template_not_found" }, { status: 404 });
    }
    // multi + shareUsers → borrow the identity (emails/subIds) of the newest
    // inbound. The API list is createdAt-asc with a TAG tiebreak, so the last
    // element is not necessarily the newest — sort by timestamp explicitly.
    const identitySource =
      tpl ??
      (body.shareUsers && rows.length > 0
        ? rows
            .slice()
            .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]!
        : null);
    const tplClients: InboundClient[] = identitySource
      ? (() => {
          try {
            const parsed = JSON.parse(identitySource.clientsJson);
            return Array.isArray(parsed) ? (parsed as InboundClient[]) : [];
          } catch {
            return [];
          }
        })()
      : [];
    const tplStream: Record<string, unknown> = identitySource
      ? (() => {
          try {
            return JSON.parse(identitySource.streamJson) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : {};

    /* ---------- plan ---------- */
    const used = new Set(rows.map((r) => r.port));
    const warnings: string[] = [];
    const wanted = protocols.filter((p) => {
      if (tpl && p === tpl.protocol) {
        warnings.push(`${p}: same as the template protocol — skipped`);
        return false;
      }
      return true;
    });
    if (wanted.length === 0) {
      return NextResponse.json({ error: "no_protocols", warnings }, { status: 400 });
    }
    const ports = allocatePorts(wanted.length, used, body.portStart);
    if (ports.length < wanted.length) {
      return NextResponse.json({ error: "no_free_ports" }, { status: 409 });
    }

    const data = wanted.map((proto, i) => {
      const port = ports[i]!;
      const noStream = NO_STREAM.has(proto);
      // stream characteristics inherit from the template where meaningful
      let transport = noStream ? "tcp" : tpl?.transport || "tcp";
      let security = noStream ? "none" : tpl?.security || "none";
      if (security === "reality" && !REALITY_OK.has(proto)) security = "tls";
      if (security === "tls" && !STREAM_TLS_OK.has(proto)) security = "none";
      // TLS is opt-in for fresh fleets (no cert assumptions) — clone keeps
      // the template's choice because the admin already runs that setup
      if (security === "tls" && !body.tls && mode !== "clone") security = "none";

      const clients = mapClients(
        proto,
        tplClients,
        !identitySource, // fresh identity when no template & not sharing
        port
      );
      // vless + (tls|reality) → vision flow (Forge parity)
      if (proto === "vless" && (security === "tls" || security === "reality")) {
        for (const c of clients) if (c.enabled) c.flow = "xtls-rprx-vision";
      }
      // mtproto keys must carry the fake-TLS domain (sidecar enforces it)
      const stream = defaultStreamFor(proto, tplStream);
      if (proto === "mtproto") {
        const dom = String(stream.mtpDomain ?? "");
        for (const c of clients) {
          if (c.enabled && !c.key.includes(".") && dom) c.key = `${c.key}${dom}`;
        }
      }
      const tag = `${proto}-${port}`;
      return {
        tag,
        protocol: proto,
        port,
        listen: "",
        transport,
        security,
        status: "online",
        note: mode === "clone" ? `autopilot · clone of ${tpl!.tag}` : "autopilot",
        trafficLimitGb: null,
        expiryDays: null,
        clientsJson: JSON.stringify(clients),
        sniffingJson: JSON.stringify({
          enabled: !noStream,
          destOverride: ["http", "tls"],
          routeOnly: false,
        }),
        streamJson: JSON.stringify({
          ...stream,
          ...(security !== "none" ? { fingerprint: "chrome" } : {}),
        }),
      };
    });

    /* ---------- pre-validate everything before touching the DB ---------- */
    for (const payload of data) {
      const parsed = validateInbound(payload);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "validation", fields: parsed.fields, tag: payload.tag },
          { status: 400 }
        );
      }
    }

    /* ---------- atomic create (rollback on any failure) ---------- */
    type CreatedRow = Awaited<ReturnType<typeof db.inbound.create>>;
    const created: CreatedRow[] = [];
    try {
      for (const payload of data) {
        created.push(await db.inbound.create({ data: payload }));
      }
    } catch (err) {
      // rollback — never leave a half-built fleet behind
      for (const row of created) {
        try {
          await db.inbound.delete({ where: { id: row.id } });
        } catch {
          /* best-effort rollback cleanup */
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (/Unique constraint|P2002/i.test(msg)) {
        return NextResponse.json({ error: "duplicate_port", warnings }, { status: 409 });
      }
      throw err;
    }

    /* ---------- share links + activity + bot notify ---------- */
    const links = created.map((row) => {
      const dto = toDTO(row);
      const first = dto.clients.find((c) => c.enabled) ?? dto.clients[0];
      const mat = buildShareMaterial(dto, first);
      return {
        tag: dto.tag,
        protocol: dto.protocol,
        port: dto.port,
        link: mat.link,
        text: mat.text,
        extra: mat.extra ?? null,
      };
    });

    for (const row of created) {
      await logActivity({
        kind: "inbound.created",
        level: "success",
        actor: admin,
        message: `Autopilot created "${row.tag}" (${row.protocol} :${row.port})`,
        meta: { inboundId: row.id, tag: row.tag, autopilot: true },
      });
      void notifyInboundCreated(row.tag, row.protocol, row.port);
    }

    return NextResponse.json({ created: created.map(toDTO), links, warnings }, { status: 201 });
  } catch (err) {
    console.error("[inbounds:autopilot]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
