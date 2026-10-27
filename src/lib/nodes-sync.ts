import http from "node:http";
import https from "node:https";
import { db } from "@/lib/db";
import { toDTO } from "@/lib/inbounds";
import { logActivity } from "@/lib/activity";
import { appVersion } from "@/lib/settings";

/* ============================================================
   Sephiroth · Multi-node v1 — master side (server-only).

   Pushes this panel's inbound config to remote nodes running
   the same binary in node mode (SEPH_NODE_MODE=1) and reads
   back status + traffic. Every helper returns plain result
   objects — network failures NEVER throw into the UI.

   v1 honesty limits:
     - pushes STATIC inbound config (incl. client keys);
     - user traffic accounting stays per-node local;
     - the agent's core driver is whatever the AGENT's own
       settings enable (sim default) — not the master's;
     - no auto-failover / load-balancing yet.
   ============================================================ */

/** Structural subset of the Node store row (kept local to avoid import cycles). */
export interface NodeRow {
  id: string;
  name: string;
  scheme: string; // http | https
  address: string;
  port: number;
  basePath: string;
  apiToken: string;
  enable: boolean;
  syncAll: boolean;
  inboundTags: string; // JSON string[]
  outboundTag: string;
  tlsVerify: string; // verify | skip
  status: string;
  latencyMs: number;
  xrayVersion: string;
  lastSeen: Date | null;
  coreKind?: string;
  lastSyncAt?: Date | null;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const INFO_TIMEOUT_MS = 5_000;
const APPLY_TIMEOUT_MS = 20_000;
const TRAFFIC_TIMEOUT_MS = 10_000;
const MAX_AGENT_PAYLOAD = 8 * 1024 * 1024;

/** http(s)://host:port[/basePath] with exactly one trailing slash handling. */
export function agentBase(node: Pick<NodeRow, "scheme" | "address" | "port" | "basePath">): string {
  const scheme = node.scheme === "https" ? "https" : "http";
  const path = node.basePath.trim() || "/";
  return `${scheme}://${node.address}:${node.port}${path.replace(/\/+$/, "")}`;
}

interface AgentResponse {
  ok: boolean; // transport-level ok (got a response)
  status: number;
  body: string;
  latencyMs: number;
  error?: string;
}

/**
 * Raw agent HTTP call with hard timeout and optional TLS-skip.
 * Uses node:http/https directly so `rejectUnauthorized` follows
 * the node's tlsVerify setting without global TLS flags.
 */
function agentRequest(
  node: Pick<NodeRow, "scheme" | "address" | "port" | "basePath" | "apiToken" | "tlsVerify">,
  method: "GET" | "POST",
  apiPath: string,
  body?: unknown,
  timeoutMs = INFO_TIMEOUT_MS
): Promise<AgentResponse> {
  return new Promise((resolve) => {
    const started = Date.now();
    const url = `${agentBase(node)}/api/agent/${apiPath.replace(/^\/+/, "")}`;
    let mod: typeof http | typeof https;
    try {
      mod = url.startsWith("https:") ? https : http;
    } catch {
      resolve({ ok: false, status: 0, body: "", latencyMs: 0, error: "bad_url" });
      return;
    }

    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
    const headers: Record<string, string> = {
      "x-node-secret": node.apiToken ?? "",
      accept: "application/json",
    };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(payload.length);
    }

    let settled = false;
    const done = (res: AgentResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => {
      req.destroy();
      done({ ok: false, status: 0, body: "", latencyMs: Date.now() - started, error: "timeout" });
    }, timeoutMs);

    let req: http.ClientRequest;
    try {
      req = mod.request(
        url,
        {
          method,
          headers,
          // https only — verify per the node's setting
          rejectUnauthorized: node.tlsVerify !== "skip",
        } as https.RequestOptions,
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size <= MAX_AGENT_PAYLOAD) chunks.push(c);
          });
          res.on("end", () => {
            done({
              ok: true,
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              latencyMs: Date.now() - started,
            });
          });
          res.on("error", (err) => {
            done({
              ok: false,
              status: 0,
              body: "",
              latencyMs: Date.now() - started,
              error: err.message || "response_error",
            });
          });
        }
      );
    } catch (err) {
      done({
        ok: false,
        status: 0,
        body: "",
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : "request_error",
      });
      return;
    }

    req.on("error", (err) => {
      done({
        ok: false,
        status: 0,
        body: "",
        latencyMs: Date.now() - started,
        error: err.message || "connect_error",
      });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function parseJsonBody(res: AgentResponse): { json: unknown; parseError?: string } {
  if (!res.body) return { json: null, parseError: "empty_body" };
  try {
    return { json: JSON.parse(res.body) };
  } catch {
    return { json: null, parseError: "bad_json" };
  }
}

function errorOf(res: AgentResponse, fallback: string): string {
  if (res.error) return res.error;
  if (res.status === 401) return "unauthorized";
  if (res.status === 404) return "not_node_mode";
  if (res.status >= 500) return `agent_error_${res.status}`;
  return fallback;
}

/* ---------- GET /api/agent/info (upgrade probe) ---------- */

export interface AgentInfoPayload {
  version: string;
  hostname: string;
  platform: string;
  arch: string;
  uptimeMs: number;
  coreKind: "sim" | "xray";
  coreRunning: boolean;
  coreVersion: string;
}

export type NodeInfoResult =
  | { ok: true; info: AgentInfoPayload; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

/**
 * Real agent info probe — fetches /api/agent/info and persists
 * version/coreKind/status on the node row. Network failures come
 * back as {ok:false,error} — never thrown.
 */
export async function nodeInfo(node: NodeRow): Promise<NodeInfoResult> {
  const res = await agentRequest(node, "GET", "info", undefined, INFO_TIMEOUT_MS);
  if (!res.ok || res.status !== 200) {
    const error = errorOf(res, `agent_status_${res.status}`);
    await db.node.update({
      where: { id: node.id },
      data: { status: "offline", lastError: error, lastSeen: new Date() },
    });
    return { ok: false, error, latencyMs: res.latencyMs };
  }
  const { json, parseError } = parseJsonBody(res);
  if (!json || typeof json !== "object") {
    await db.node.update({
      where: { id: node.id },
      data: { status: "offline", lastError: parseError ?? "bad_json", lastSeen: new Date() },
    });
    return { ok: false, error: parseError ?? "bad_json", latencyMs: res.latencyMs };
  }
  const raw = json as Record<string, unknown>;
  const info: AgentInfoPayload = {
    version: typeof raw.version === "string" ? raw.version : "",
    hostname: typeof raw.hostname === "string" ? raw.hostname : "",
    platform: typeof raw.platform === "string" ? raw.platform : "",
    arch: typeof raw.arch === "string" ? raw.arch : "",
    uptimeMs: Number.isFinite(Number(raw.uptimeMs)) ? Number(raw.uptimeMs) : 0,
    coreKind: raw.coreKind === "xray" ? "xray" : "sim",
    coreRunning: raw.coreRunning === true,
    coreVersion: typeof raw.coreVersion === "string" ? raw.coreVersion : "",
  };
  await db.node.update({
    where: { id: node.id },
    data: {
      status: "online",
      latencyMs: res.latencyMs,
      xrayVersion: info.coreVersion,
      coreKind: info.coreKind,
      lastError: "",
      lastSeen: new Date(),
    },
  });
  return { ok: true, info, latencyMs: res.latencyMs };
}

/* ---------- POST /api/agent/apply ---------- */

export interface NodeApplyResult {
  ok: boolean;
  applied: number;
  coreReloaded: boolean;
  error?: string;
}

/**
 * Push this panel's inbound config (scoped by the node's syncAll /
 * inboundTags setting) to the agent, replacing the agent's inbounds.
 */
export async function applyToNode(node: NodeRow): Promise<NodeApplyResult> {
  // scope: all inbounds, or only the tags selected on the node
  const rows = await db.inbound.findMany({
    orderBy: [{ createdAt: "asc" }, { tag: "asc" }],
  });
  const scoped = node.syncAll
    ? rows
    : rows.filter((r) => {
        let tags: string[] = [];
        try {
          tags = JSON.parse(node.inboundTags) as string[];
        } catch {
          tags = [];
        }
        return tags.includes(r.tag);
      });
  const payloadInbounds = scoped.map(toDTO);

  const res = await agentRequest(
    node,
    "POST",
    "apply",
    { inbounds: payloadInbounds },
    APPLY_TIMEOUT_MS
  );

  if (!res.ok || res.status !== 200) {
    const error = errorOf(res, `agent_status_${res.status}`);
    await db.node.update({
      where: { id: node.id },
      data: { status: res.status === 0 ? "offline" : "online", lastError: error, lastSeen: new Date() },
    });
    void logActivity({
      kind: "settings.updated",
      level: "error",
      actor: "master",
      message: `Config push to node "${node.name}" failed: ${error}`,
      meta: { nodeId: node.id, nodeName: node.name, error },
    });
    return { ok: false, applied: 0, coreReloaded: false, error };
  }

  const { json } = parseJsonBody(res);
  const rec = (json ?? {}) as Record<string, unknown>;
  const applied = Number.isInteger(Number(rec.applied)) ? Number(rec.applied) : 0;
  const coreReloaded = rec.coreReloaded === true;

  await db.node.update({
    where: { id: node.id },
    data: {
      status: "online",
      latencyMs: res.latencyMs,
      lastSyncAt: new Date(),
      lastError: "",
      lastSeen: new Date(),
    },
  });
  void logActivity({
    kind: "settings.updated",
    level: "success",
    actor: "master",
    message: `Config pushed to node "${node.name}" — ${applied} inbound(s) applied`,
    meta: { nodeId: node.id, nodeName: node.name, applied, coreReloaded },
  });
  return { ok: true, applied, coreReloaded };
}

/* ---------- GET /api/agent/traffic ---------- */

export interface NodeTrafficInbound {
  tag: string;
  protocol: string;
  port: number;
  status: string;
  users: number;
  txGb: number;
}

export interface NodeTrafficUser {
  username: string;
  enabled: boolean;
  usedTrafficGb: number;
  trafficLimitGb: number | null;
}

export interface NodeTrafficSnapshot {
  ts: number;
  coreKind: "sim" | "xray";
  coreRunning: boolean;
  inbounds: NodeTrafficInbound[];
  users: NodeTrafficUser[];
}

export type NodeTrafficResult =
  | { ok: true; traffic: NodeTrafficSnapshot; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

/** Pull the node's traffic snapshot (per-inbound + per-user). */
export async function pullNodeTraffic(node: NodeRow): Promise<NodeTrafficResult> {
  const res = await agentRequest(node, "GET", "traffic", undefined, TRAFFIC_TIMEOUT_MS);
  if (!res.ok || res.status !== 200) {
    const error = errorOf(res, `agent_status_${res.status}`);
    await db.node.update({
      where: { id: node.id },
      data: { lastError: error },
    });
    void logActivity({
      kind: "settings.updated",
      level: "warn",
      actor: "master",
      message: `Traffic pull from node "${node.name}" failed: ${error}`,
      meta: { nodeId: node.id, nodeName: node.name, error },
    });
    return { ok: false, error, latencyMs: res.latencyMs };
  }

  const { json, parseError } = parseJsonBody(res);
  if (!json || typeof json !== "object") {
    return { ok: false, error: parseError ?? "bad_json", latencyMs: res.latencyMs };
  }
  const raw = json as Record<string, unknown>;
  const inbounds = Array.isArray(raw.inbounds) ? raw.inbounds : [];
  const users = Array.isArray(raw.users) ? raw.users : [];
  const traffic: NodeTrafficSnapshot = {
    ts: Number(raw.ts) || Date.now(),
    coreKind: raw.coreKind === "xray" ? "xray" : "sim",
    coreRunning: raw.coreRunning === true,
    inbounds: inbounds.map((i) => {
      const r = (i ?? {}) as Record<string, unknown>;
      return {
        tag: String(r.tag ?? ""),
        protocol: String(r.protocol ?? ""),
        port: Number(r.port) || 0,
        status: String(r.status ?? "unknown"),
        users: Number(r.users) || 0,
        txGb: Number(r.txGb) || 0,
      };
    }),
    users: users.map((u) => {
      const r = (u ?? {}) as Record<string, unknown>;
      return {
        username: String(r.username ?? ""),
        enabled: r.enabled === true,
        usedTrafficGb: Number(r.usedTrafficGb) || 0,
        trafficLimitGb: r.trafficLimitGb === null || r.trafficLimitGb === undefined ? null : Number(r.trafficLimitGb),
      };
    }),
  };

  await db.node.update({
    where: { id: node.id },
    data: {
      status: "online",
      latencyMs: res.latencyMs,
      coreKind: traffic.coreKind,
      lastError: "",
      lastSeen: new Date(),
    },
  });
  void logActivity({
    kind: "settings.updated",
    level: "info",
    actor: "master",
    message: `Traffic pulled from node "${node.name}" — ${traffic.inbounds.length} inbound(s)`,
    meta: { nodeId: node.id, nodeName: node.name, inbounds: traffic.inbounds.length },
  });
  return { ok: true, traffic, latencyMs: res.latencyMs };
}

/** Version label used in the panel footer/debug — re-exported for convenience. */
export { appVersion as masterVersion };
