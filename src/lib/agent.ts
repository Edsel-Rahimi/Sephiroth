import { timingSafeEqual } from "node:crypto";
import { arch, hostname, platform } from "node:os";
import { db, type Inbound } from "@/lib/db";
import { toDTO, validateInbound, type InboundDTO } from "@/lib/inbounds";
import { getActiveBackend } from "@/lib/core/registry";
import { appVersion } from "@/lib/settings";

/* ============================================================
   Sephiroth · Node mode (agent side) — server-only.

   When the same binary is booted with SEPH_NODE_MODE=1 plus a
   shared SEPH_NODE_SECRET, the panel ALSO exposes a small
   machine-to-machine API under /api/agent/* guarded by the
   `x-node-secret` header. A master panel uses these endpoints
   to push its inbound config and read back status + traffic.

   Contract (all JSON):
     GET  /api/agent/info     → AgentInfo
     GET  /api/agent/inbounds → { inbounds: InboundDTO[] }
     POST /api/agent/apply    → { applied, coreReloaded }
     GET  /api/agent/traffic  → AgentTraffic

   Non-node-mode instances answer 404 for every /api/agent/*
   route (the surface simply does not exist), and a wrong or
   missing secret answers 401 with a constant-time compare.
   ============================================================ */

export const NODE_SECRET_HEADER = "x-node-secret";

/** True when this instance boots as a fleet node (agent surface on). */
export function isNodeMode(): boolean {
  const v = (process.env.SEPH_NODE_MODE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** The configured shared secret ("" when unset — agent surface stays off). */
export function nodeSecret(): string {
  return (process.env.SEPH_NODE_SECRET ?? "").trim();
}

/**
 * Guard for /api/agent/* routes — constant-time secret compare.
 * Returns false (→ caller answers 401) when node mode is off,
 * no secret is configured, or the header does not match.
 */
export function requireNodeSecret(req: Request): boolean {
  if (!isNodeMode()) return false;
  const expected = nodeSecret();
  if (!expected) return false;
  const provided = req.headers.get(NODE_SECRET_HEADER) ?? "";
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || a.length === 0) {
    // keep the timing curve flat for wrong-length guesses too
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/* ---------- GET /api/agent/info ---------- */

export interface AgentInfo {
  version: string;
  hostname: string;
  platform: string;
  arch: string;
  uptimeMs: number;
  /** which core driver the agent currently runs: sim | xray */
  coreKind: "sim" | "xray";
  coreRunning: boolean;
  /** xray process version label ("sim-<panel>" for the simulator) */
  coreVersion: string;
}

export function agentInfo(): AgentInfo {
  const backend = getActiveBackend();
  const status = backend?.status();
  return {
    version: appVersion(),
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    uptimeMs: Math.round(process.uptime() * 1000),
    coreKind: backend?.kind ?? "sim",
    coreRunning: status?.running ?? false,
    coreVersion: status?.version ?? "",
  };
}

/* ---------- GET /api/agent/inbounds ---------- */

/** Current inbound rows in the exact shape the master panel stores. */
export async function agentInbounds(): Promise<InboundDTO[]> {
  const rows = await db.inbound.findMany({
    orderBy: [{ createdAt: "asc" }, { tag: "asc" }],
  });
  return rows.map(toDTO);
}

/* ---------- POST /api/agent/apply ---------- */

export interface AgentApplyResult {
  applied: number;
  /** true when the active core accepted the reload (xray regen+restart; sim mirrors via its 2s loop) */
  coreReloaded: boolean;
  error?: string;
}

/**
 * Replace the agent's whole inbound table with the pushed set —
 * atomically (single transaction), then nudge the core.
 * Client credentials ride inside each row's clients[] — user
 * projections (panel-level ClientUser rows) are a v2 concern.
 */
export async function applyAgentInbounds(body: unknown): Promise<AgentApplyResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const list = b.inbounds;
  if (!Array.isArray(list)) {
    return { applied: 0, coreReloaded: false, error: "inbounds_required" };
  }
  if (list.length > 500) {
    return { applied: 0, coreReloaded: false, error: "too_many" };
  }

  // Validate every row BEFORE touching the store — one bad row aborts all.
  const writes: Parameters<typeof db.inbound.create>[0]["data"][] = [];
  for (const raw of list) {
    const parsed = validateInbound(raw);
    if (!parsed.ok) {
      const first = Object.entries(parsed.fields)[0];
      return {
        applied: 0,
        coreReloaded: false,
        error: `invalid_inbound${first ? `:${first[0]}:${first[1]}` : ""}`,
      };
    }
    const w = parsed.data;
    writes.push({
      tag: w.tag,
      protocol: w.protocol,
      port: w.port,
      listen: w.listen,
      transport: w.transport,
      security: w.security,
      status: w.status,
      note: w.note,
      trafficLimitGb: w.trafficLimitGb,
      expiryDays: w.expiryDays,
      clientsJson: w.clientsJson,
      sniffingJson: w.sniffingJson,
      streamJson: w.streamJson,
    });
  }

  // Atomic swap: delete-all + insert-all in one transaction.
  await db.$transaction(async (tx) => {
    await tx.inbound.deleteMany({});
    for (const w of writes) {
      await tx.inbound.create({ data: w });
    }
  });

  // Nudge the core: sync the DB mirror immediately (server.ts's 2s
  // mirrorDb loop re-runs it anyway) so /api/agent/traffic reflects the
  // pushed rows right away; reload() makes the xray driver regen +
  // restart at once and keeps the API honest about the outcome.
  let coreReloaded = false;
  const backend = getActiveBackend();
  if (backend) {
    try {
      backend.mirrorDb();
      await backend.reload();
      coreReloaded = true;
    } catch (err) {
      console.error("[agent:apply] core reload failed:", err);
    }
  }

  return { applied: writes.length, coreReloaded };
}

/* ---------- GET /api/agent/traffic ---------- */

export interface AgentTrafficInbound {
  tag: string;
  protocol: string;
  port: number;
  status: string;
  users: number;
  /** GB served through this inbound (sim: 0 — honest zeros; xray: real) */
  txGb: number;
}

export interface AgentTrafficUser {
  username: string;
  enabled: boolean;
  usedTrafficGb: number;
  trafficLimitGb: number | null;
}

export interface AgentTraffic {
  ts: number;
  coreKind: "sim" | "xray";
  coreRunning: boolean;
  /** per-inbound snapshot from the ACTIVE core (sim or xray) */
  inbounds: AgentTrafficInbound[];
  /** per-user accounting — agent-local rows (v1: typically empty on pure nodes) */
  users: AgentTrafficUser[];
}

export async function agentTraffic(): Promise<AgentTraffic> {
  const backend = getActiveBackend();
  const status = backend?.status();
  let inbounds: AgentTrafficInbound[] = [];
  try {
    const payload = backend?.inboundsPayload();
    inbounds = (payload?.inbounds ?? []).map((i) => ({
      tag: i.tag,
      protocol: i.proto,
      port: i.port,
      status: i.status,
      users: i.users,
      txGb: i.txGb,
    }));
  } catch (err) {
    console.error("[agent:traffic] core payload failed:", err);
  }

  const userRows = await db.clientUser.findMany({
    orderBy: [{ createdAt: "asc" }, { username: "asc" }],
  });

  return {
    ts: Date.now(),
    coreKind: backend?.kind ?? "sim",
    coreRunning: status?.running ?? false,
    inbounds,
    users: userRows.map((u) => ({
      username: u.username,
      enabled: u.enabled,
      usedTrafficGb: Number(u.usedTrafficGb) || 0,
      trafficLimitGb: u.trafficLimitGb ?? null,
    })),
  };
}

/* ---------- shared row shape (type helper, unused at runtime) ---------- */
export type AgentInboundRow = Inbound;
