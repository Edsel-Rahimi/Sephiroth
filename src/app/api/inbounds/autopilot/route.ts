import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  IN_PROTOCOLS,
  requireAdmin,
  toDTO,
  validateInbound,
  type InboundClient,
} from "@/lib/inbounds";
import { genKey, genSubId, makeWgKeypair } from "@/lib/users";
import { buildShareMaterial } from "@/lib/share-links";
import { getGeneralSettings } from "@/lib/settings";
import { MTP_DEFAULT_DOMAIN } from "@/lib/mtp-secret";
import { logActivity } from "@/lib/activity";
import { notifyInboundCreated } from "@/lib/bot/notify";

/* ============================================================
   Sephiroth · Task 25-b — One-Port Autopilot API (atomic)
   Task 4-b — SINGLE-PORT mode (KataBump: exactly ONE public port)

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
     { mode: "single", mainInboundId, protocol? }     → single-port:
         add the ONE complementary protocol (vless↔trojan) NEXT TO the
         main inbound on the SAME public port via Xray fallbacks:
           1. main must be vless|trojan + security tls + transport tcp
              (fallback multiplexing matches INSIDE a terminated TLS
              stream — ws/grpc mains cannot host fallbacks) → else 400
              { error: "single_mode_main_invalid", reason }
           2. a fallback inbound is created on 127.0.0.1:<internal>
              (first free port from 44301), tcp + security none, with
              the MAIN's client emails + subIds (keys re-generated per
              protocol) so identities stay unified
           3. the MAIN's streamJson.fallbacksJson gains
              { dest: "127.0.0.1:<internal>", xver: 0 } — stored in the
              panel-native `fallbacksJson` string form which the core
              config builder expands into streamSettings.fallbacks
           4. ONE Host row (`<mainTag> · single-port`) records the
              public projection (address/port/security/sni) so the
              fallback's share links render address:mainPort+tls
           5. ordering: fallback row FIRST, main activation LAST; if
              the main update fails the fresh row is deleted again
           6. idempotent: an existing `<proto>-fp-<mainPort>` row with
              the matching dest → HTTP 200 + the existing row + a
              warning (chosen over 409 so a retried click is a no-op)

   Semantics:
   - ports are auto-allocated (443 → 8443 → 2053 → 2083 → 2087 →
     portStart/10000+, skipping anything already bound by a row)
   - ONE atomic create pass: any failure rolls the whole plan back
     (no half-built fleets — the v2.2 combo flaw, fixed)
   - response carries ready-to-copy share links per created inbound
   ============================================================ */

/** Protocols that carry raw sockets — no transport/security layer applies. */
const NO_STREAM = new Set(["wireguard", "amnezia-wg", "socks", "http", "dokodemo-door", "mixed", "mtproto"]);
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
  /* Task 4-b — single-port mode */
  mainInboundId?: string;
  protocol?: string;
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
  for (let p = seq.length ? (seq[seq.length - 1]! < 10000 ? 10000 : seq[seq.length - 1]! + 1) : 10000; seq.length < count + 64; p++) {
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
  if (proto === "amnezia-wg") {
    // Phase 27 — real server keypair + AmneziaWG obfuscation defaults
    const kp = makeWgKeypair();
    return {
      wgSecretKey: kp.privateKey,
      wgPublicKey: kp.publicKey,
      wgMtu: 1420,
      awgJc: 4,
      awgJmin: 40,
      awgJmax: 70,
      awgS1: 15,
      awgS2: 60,
    };
  }
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
  const keyFor = (): string => {
    if (proto === "amnezia-wg") {
      // Phase 27 — a REAL peer keypair per client; the public half rides the
      // server conf's [Peer] block, the private half stays client-side
      return makeWgKeypair().publicKey;
    }
    return genKey(proto);
  };
  if (fresh || tplClients.length === 0) {
    return [
      {
        email: `user-${port}`,
        key: keyFor(),
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
    key: keyFor(), // email/subId preserved — key format is per-protocol
    flow: "", // vision flow only makes sense on vless — recomputed by the caller
    enabled: c.enabled,
  }));
}

/* ============================================================
   Task 4-b — SINGLE-PORT MODE
   ============================================================ */

/** protocols allowed to host a fallback chain (the MAIN inbound). */
const SINGLE_MAIN_OK = new Set(["vless", "trojan"]);
/** loopback / wildcard listens never make a public address. */
const NON_PUBLIC_LISTEN = new Set(["", "0.0.0.0", "::", "127.0.0.1", "localhost"]);
/** internal fallback listeners start here — the public range belongs to
 *  the host's ONE exposed port, the fallbacks live on loopback only. */
const FALLBACK_PORT_BASE = 44301;

function looseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw || "");
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parses the main inbound's stored fallback entries (the panel-native
 * `fallbacksJson` string form). Returns null when the stored string is
 * present but unparseable — the caller must refuse instead of silently
 * dropping the admin's hand-tuned fallbacks.
 */
function parseFallbackEntries(mainStream: Record<string, unknown>): Record<string, unknown>[] | null {
  const raw = typeof mainStream.fallbacksJson === "string" ? mainStream.fallbacksJson : "";
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter(
    (e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e)
  );
}

/** The public-facing share link for the fallback inbound, built THROUGH
 *  buildShareMaterial on a projected row (public address + main port +
 *  tls) so it renders `address:mainPort + tls` like the main's own link. */
function buildSingleLinks(
  fbRow: Awaited<ReturnType<typeof db.inbound.create>>,
  main: { port: number },
  mainStream: Record<string, unknown>,
  address: string,
  sni: string,
  warnings: string[]
): { tag: string; protocol: string; port: number; link: string | null; text: string; extra: string | null } {
  const fbDto = toDTO(fbRow);
  const first = fbDto.clients.find((c) => c.enabled) ?? fbDto.clients[0];
  if (!address) {
    warnings.push(
      `no public address could be resolved for "${fbDto.tag}" — create a Host row for it (address = your public host, port ${main.port}, security tls) in the Hosts view; the link is left empty instead of wrong`
    );
    return { tag: fbDto.tag, protocol: fbDto.protocol, port: main.port, link: null, text: "", extra: null };
  }
  const fingerprint =
    typeof mainStream.fingerprint === "string" && mainStream.fingerprint
      ? mainStream.fingerprint
      : "chrome";
  const publicStream: Record<string, string> = { fingerprint };
  if (sni) publicStream.sni = sni;
  const alpn = typeof mainStream.alpn === "string" ? mainStream.alpn.trim() : "";
  if (alpn) publicStream.alpn = alpn;
  const mat = buildShareMaterial(
    { ...fbDto, listen: address, port: main.port, security: "tls", transport: "tcp", stream: publicStream },
    first
  );
  return { tag: fbDto.tag, protocol: fbDto.protocol, port: main.port, link: mat.link, text: mat.text, extra: mat.extra ?? null };
}

/**
 * Task 4-b — single-port autopilot. Exactly ONE extra TCP protocol rides
 * the main inbound's public port via Xray fallbacks.
 *
 * WHY only one fallback inbound (MVP): Xray fallbacks match on alpn/path
 * INSIDE the already-terminated TLS stream — they do NOT protocol-sniff.
 * The main protocol handles its own traffic and the dest-only entry is
 * the catch-all; a second non-main TCP protocol would need a
 * distinguishing alpn/path that plain trojan/vless clients don't send,
 * so exactly one non-main protocol can fall through reliably.
 */
async function singlePortAutopilot(body: AutopilotBody, admin: string): Promise<NextResponse> {
  const mainId = typeof body.mainInboundId === "string" ? body.mainInboundId.trim() : "";
  if (!mainId) {
    return NextResponse.json(
      { error: "single_mode_main_invalid", reason: "mainInboundId is required" },
      { status: 400 }
    );
  }

  const rows = await db.inbound.findMany({ orderBy: [{ createdAt: "asc" }, { tag: "asc" }] });
  const main = rows.find((r) => r.id === mainId) ?? null;
  if (!main) {
    return NextResponse.json({ error: "main_not_found" }, { status: 404 });
  }

  /* ---------- honest pre-validation of the main (no writes yet) ---------- */
  if (!SINGLE_MAIN_OK.has(main.protocol)) {
    return NextResponse.json(
      {
        error: "single_mode_main_invalid",
        reason: `protocol "${main.protocol}" cannot host fallbacks — the main inbound must be vless or trojan`,
      },
      { status: 400 }
    );
  }
  if (main.security !== "tls") {
    return NextResponse.json(
      {
        error: "single_mode_main_invalid",
        reason: `security "${main.security}" — fallback multiplexing needs a TLS-terminated main inbound (the TLS layer is what demultiplexes the port)`,
      },
      { status: 400 }
    );
  }
  if (main.transport !== "tcp") {
    return NextResponse.json(
      {
        error: "single_mode_main_invalid",
        reason: `transport "${main.transport}" — fallback multiplexing needs a TCP main inbound (fallbacks match inside a raw TCP+TLS stream)`,
      },
      { status: 400 }
    );
  }

  const warnings: string[] = [];
  // the extra protocol is the COMPLEMENT — vless↔trojan. Anything else
  // requested is warned about and skipped (one fallback protocol, see above).
  const complement = main.protocol === "vless" ? "trojan" : "vless";
  if (typeof body.protocol === "string" && body.protocol && body.protocol !== complement) {
    warnings.push(
      `${body.protocol}: not the complement of ${main.protocol} — skipped (single-port mode adds exactly one fallback protocol)`
    );
  }

  const mainStream = looseJson<Record<string, unknown>>(main.streamJson, {});
  const existingEntries = parseFallbackEntries(mainStream);
  if (existingEntries === null) {
    return NextResponse.json(
      {
        error: "single_mode_main_invalid",
        reason: `main inbound "${main.tag}" has an unparseable fallbacksJson — fix or clear it in the Forge first (refusing to overwrite hand-tuned fallbacks)`,
      },
      { status: 400 }
    );
  }
  const destOf = (p: number) => `127.0.0.1:${p}`;
  const hasDest = (p: number) => existingEntries.some((e) => String(e.dest ?? "") === destOf(p));

  /* ---------- idempotency: `<proto>-fp-<mainPort>` already there? ---------- */
  const fbTag = `${complement}-fp-${main.port}`;
  const existingFb = rows.find((r) => r.tag === fbTag) ?? null;
  if (existingFb && (existingFb.protocol !== complement || existingFb.listen !== "127.0.0.1")) {
    return NextResponse.json(
      { error: "fallback_tag_conflict", reason: `tag "${fbTag}" is taken by a non-fallback inbound` },
      { status: 409 }
    );
  }
  if (existingFb) {
    if (hasDest(existingFb.port)) {
      // documented choice: idempotent replay → 200 + the existing row +
      // warning (NOT 409) so a double-click / retried request is a no-op
      warnings.push(`already_fallbacked: "${fbTag}" already rides ${main.tag}'s port ${main.port} — returned as-is`);
      const [addr, sniResolved] = await resolvePublicAddress(main, mainStream);
      const links = buildSingleLinks(existingFb, main, mainStream, addr, sniResolved, warnings);
      const mainAfter = await db.inbound.findUnique({ where: { id: main.id } });
      return NextResponse.json(
        { created: [toDTO(existingFb)], main: toDTO(mainAfter ?? main), links, warnings },
        { status: 200 }
      );
    }
    // half-applied state (row exists, activation missing) → repair quietly
    warnings.push(`repaired: fallback row "${fbTag}" existed without its activation entry on ${main.tag} — dest appended now`);
    try {
      await db.inbound.update({
        where: { id: main.id },
        data: {
          streamJson: JSON.stringify({
            ...mainStream,
            fallbacksJson: JSON.stringify([...existingEntries, { dest: destOf(existingFb.port), xver: 0 }]),
          }),
        },
      });
    } catch {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
    await logActivity({
      kind: "inbound.updated",
      level: "success",
      actor: admin,
      message: `Autopilot repaired the fallback dest on "${main.tag}" → 127.0.0.1:${existingFb.port}`,
      meta: { inboundId: main.id, tag: main.tag, autopilot: true, singlePort: true },
    });
    const [addr, sniResolved] = await resolvePublicAddress(main, mainStream);
    const links = buildSingleLinks(existingFb, main, mainStream, addr, sniResolved, warnings);
    const mainAfter = await db.inbound.findUnique({ where: { id: main.id } });
    return NextResponse.json(
      { created: [toDTO(existingFb)], main: toDTO(mainAfter ?? main), links, warnings },
      { status: 200 }
    );
  }

  /* ---------- plan: internal loopback port + client identity ---------- */
  const usedPorts = new Set(rows.map((r) => r.port));
  const referencedDests = new Set(
    existingEntries
      .map((e) => Number(String(e.dest ?? "").split(":")[1]))
      .filter((n) => Number.isInteger(n) && (n as number) > 0)
  );
  let fbPort = 0;
  for (let p = FALLBACK_PORT_BASE; p <= 65535; p++) {
    if (!usedPorts.has(p) && !referencedDests.has(p)) {
      fbPort = p;
      break;
    }
  }
  if (!fbPort) {
    return NextResponse.json({ error: "no_free_ports" }, { status: 409 });
  }

  // mapClients parity: SAME emails + subIds so identities stay unified;
  // keys are re-generated (wire format is per-protocol) and flow is ""
  // (vision needs tls/reality — the fallback is deliberately plain).
  const mainClients = looseJson<InboundClient[]>(main.clientsJson, []).filter(
    (c) => typeof c === "object" && c !== null
  );
  const clients: InboundClient[] = (
    mainClients.length > 0
      ? mainClients
      : [
          {
            email: `user-${fbPort}`,
            key: genKey(complement),
            subId: genSubId(),
            flow: "",
            ipLimit: 0,
            trafficLimitGb: null,
            expiryDays: null,
            enabled: true,
          },
        ]
  )
    .slice(0, 100)
    .map((c) => ({
      email: String(c.email ?? ""),
      key: genKey(complement),
      subId: String(c.subId ?? ""),
      flow: "",
      ipLimit: Number(c.ipLimit ?? 0) || 0,
      trafficLimitGb: c.trafficLimitGb ?? null,
      expiryDays: c.expiryDays ?? null,
      enabled: c.enabled !== false,
    }));

  const payload = {
    tag: fbTag,
    protocol: complement,
    port: fbPort,
    listen: "127.0.0.1",
    transport: "tcp",
    security: "none",
    status: "online",
    note: `autopilot · single-port fallback of ${main.tag}`,
    trafficLimitGb: null,
    expiryDays: null,
    clientsJson: JSON.stringify(clients),
    sniffingJson: JSON.stringify({ enabled: true, destOverride: ["http", "tls"], routeOnly: false }),
    streamJson: JSON.stringify({}),
  };

  /* ---------- pre-validate before ANY write (same discipline) ---------- */
  const parsed = validateInbound(payload);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "validation", fields: parsed.fields, tag: payload.tag },
      { status: 400 }
    );
  }

  /* ---------- atomic write: fallback row FIRST, activation LAST ---------- */
  let fbRow: Awaited<ReturnType<typeof db.inbound.create>>;
  try {
    fbRow = await db.inbound.create({ data: payload });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Unique constraint|P2002/i.test(msg)) {
      return NextResponse.json({ error: "duplicate_port", warnings }, { status: 409 });
    }
    throw err;
  }

  // ACTIVATION — merge { dest, xver: 0 } into the MAIN's fallbacksJson,
  // preserving every other streamJson field (sni/certs/alpn/fingerprint…).
  // Never duplicates an existing dest. If this fails, the fresh fallback
  // row is deleted again — no half-built state.
  let activated = false;
  if (!hasDest(fbPort)) {
    try {
      await db.inbound.update({
        where: { id: main.id },
        data: {
          streamJson: JSON.stringify({
            ...mainStream,
            fallbacksJson: JSON.stringify([...existingEntries, { dest: destOf(fbPort), xver: 0 }]),
          }),
        },
      });
      activated = true;
    } catch (err) {
      try {
        await db.inbound.delete({ where: { id: fbRow.id } });
      } catch {
        /* best-effort rollback cleanup */
      }
      throw err;
    }
  } else {
    warnings.push(`main already had a fallback dest ${destOf(fbPort)} — entry reused, not duplicated`);
  }

  /* ---------- Host row + share link (public projection) ---------- */
  const [address, sni] = await resolvePublicAddress(main, mainStream);
  if (address) {
    try {
      await db.host.create({
        data: {
          inboundId: fbRow.id,
          remark: `${main.tag} · single-port`.slice(0, 64),
          address,
          port: main.port,
          security: "tls",
          sni,
          hostHeader: "",
          path: "",
          alpn: "",
          fingerprint:
            typeof mainStream.fingerprint === "string" && mainStream.fingerprint
              ? mainStream.fingerprint
              : "chrome",
          enable: true,
          sortOrder: 0,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`host override row could not be created (${msg}) — links below are still correct`);
    }
  }

  const links = [buildSingleLinks(fbRow, main, mainStream, address, sni, warnings)];

  /* ---------- activity + bot notify (mirrors clone/multi) ---------- */
  await logActivity({
    kind: "inbound.created",
    level: "success",
    actor: admin,
    message: `Autopilot single-port created "${fbRow.tag}" (${complement} @127.0.0.1:${fbPort} behind ${main.tag} :${main.port})`,
    meta: { inboundId: fbRow.id, tag: fbRow.tag, autopilot: true, singlePort: true, mainInboundId: main.id },
  });
  if (activated) {
    await logActivity({
      kind: "inbound.updated",
      level: "success",
      actor: admin,
      message: `Autopilot added a fallback dest to "${main.tag}" → 127.0.0.1:${fbPort}`,
      meta: { inboundId: main.id, tag: main.tag, autopilot: true, singlePort: true },
    });
  }
  void notifyInboundCreated(fbRow.tag, fbRow.protocol, fbRow.port);

  const mainAfter = await db.inbound.findUnique({ where: { id: main.id } });
  return NextResponse.json(
    { created: [toDTO(fbRow)], main: toDTO(mainAfter ?? main), links, warnings },
    { status: 201 }
  );
}

/**
 * Public address resolution for the fallback's Host row + share link.
 * Mirrors the panel's own hostOf() precedence (share-links.ts):
 * Host override → public listen → stream sni (the TLS serverName usually
 * IS the domain users dial) → the admin's public-host setting. Empty
 * string = nothing reliable — the caller warns instead of guessing.
 */
async function resolvePublicAddress(
  main: { id: string; listen: string },
  mainStream: Record<string, unknown>
): Promise<[string, string]> {
  const mainSni = typeof mainStream.sni === "string" ? mainStream.sni.trim() : "";
  const mainHosts = await db.host.findMany({
    where: { inboundId: main.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const hostOverride = mainHosts.find(
    (h) => h.enable && typeof h.address === "string" && h.address.trim()
  );
  if (hostOverride) {
    return [hostOverride.address.trim(), (hostOverride.sni || "").trim() || mainSni];
  }
  const listen = (main.listen || "").trim();
  if (!NON_PUBLIC_LISTEN.has(listen)) {
    return [listen, mainSni];
  }
  if (mainSni) {
    return [mainSni, mainSni];
  }
  const general = await getGeneralSettings();
  return [general.publicHost.trim(), mainSni];
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

    const mode = body.mode === "clone" ? "clone" : body.mode === "single" ? "single" : "multi";

    // Task 4-b — single-port mode runs its own plan/validate/write pipeline
    // (one main inbound + one complement fallback; no `protocols` array)
    if (mode === "single") {
      return await singlePortAutopilot(body, admin);
    }

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
