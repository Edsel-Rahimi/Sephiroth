/**
 * Sephiroth Core Adapter — wire contract.
 *
 * The core driver (mini-services/core-sim today, a real Xray driver later)
 * speaks exactly this contract over socket.io (path "/", port 3003, reached
 * through the Caddy gateway via `?XTransformPort=3003`).
 *
 * Server → client messages:
 *   core:init      CoreSnapshot          (once per connection)
 *   core:tick      CoreTick              (every 1s)
 *   core:event     { event: ActivityEvent }
 *   core:inbounds  CoreInboundsPayload   (every 10s + on config change)
 *
 * Phase 3: the `Inbound` Prisma table is the config source of truth; the
 * driver mirrors it and emits inbound.created/updated/deleted +
 * inbound.online/offline events when the config diff detects changes.
 */

export type CoreStatus = "running" | "reloading" | "stopped";
export type InboundStatus = "online" | "maintenance" | "disabled";
export type ActivityLevel = "info" | "success" | "warn" | "error";

export type ActivityKind =
  | "user.connected"
  | "user.disconnected"
  | "user.created"
  | "user.expired"
  | "user.limit"
  | "auth.success"
  | "auth.failed"
  | "inbound.online"
  | "inbound.offline"
  | "inbound.created"
  | "inbound.updated"
  | "inbound.deleted"
  | "core.reload"
  | "system.backup"
  | "traffic.spike"
  | "system.cert"
  | "sub.fetch";

export interface CoreInfo {
  version: string;
  status: CoreStatus;
  /** epoch ms — core start time (uptime is derived client-side) */
  startedAt: number;
}

export interface CoreMetrics {
  ts: number;
  /** percent 0-100 */
  cpu: number;
  /** percent 0-100 */
  ram: number;
  ramUsedMb: number;
  ramTotalMb: number;
  /** percent 0-100 */
  disk: number;
  /** MB/s served to clients (ingress of the box) */
  netIn: number;
  /** MB/s egress */
  netOut: number;
  activeUsers: number;
  sessions: number;
  /** total egress this month, TB */
  monthTxTb: number;
  /** MB/s — max of (netIn+netOut) today */
  peakToday: number;
  /** MB/s — running average today */
  avgToday: number;
  errorsToday: number;
  /** % of today's samples above the saturation line */
  saturatedPct: number;
}

export interface CoreUserStat {
  uid: string;
  user: string;
  proto: string;
  /** consumed this cycle, GB */
  gb: number;
  /** signed delta vs yesterday, GB */
  delta: number;
  up: boolean;
  /** last 8 normalized samples 0-100 */
  spark: number[];
  /** hours until expiry — null = unlimited */
  expiresInH: number | null;
  /** quota used % — null = unlimited */
  usagePct: number | null;
}

export interface CoreInbound {
  tag: string;
  proto: string;
  port: number;
  status: InboundStatus;
  users: number;
  txGb: number;
}

export interface ActivityEvent {
  id: string;
  ts: number;
  level: ActivityLevel;
  kind: ActivityKind;
  params: Record<string, string | number>;
}

export interface HistorySet {
  /** download-direction series */
  dl: number[];
  /** upload-direction series */
  ul: number[];
}

export interface CoreSeries {
  /** rolling 60 samples @1s */
  cpu: number[];
  ram: number[];
  netIn: number[];
  netOut: number[];
  /** pre-aggregated history for the frequency chart */
  hist24: HistorySet;
  hist7: HistorySet;
  hist30: HistorySet;
}

export interface CoreGoal {
  currentGb: number;
  targetGb: number;
  delivered: number;
  inProg: number;
  pending: number;
}

export interface CoreDistribution {
  connectedPct: number;
  idlePct: number;
  limitedPct: number;
}

export interface CoreSnapshot {
  ts: number;
  core: CoreInfo;
  metrics: CoreMetrics;
  totals: { users: number; groups: number };
  series: CoreSeries;
  topUsers: CoreUserStat[];
  inbounds: CoreInbound[];
  events: ActivityEvent[];
  goal: CoreGoal;
  distribution: CoreDistribution;
}

export interface CoreTick {
  ts: number;
  metrics: CoreMetrics;
  topUsers: CoreUserStat[];
  goal: CoreGoal;
}

export interface CoreInboundsPayload {
  ts: number;
  inbounds: CoreInbound[];
  distribution: CoreDistribution;
}

export interface CoreEventPayload {
  event: ActivityEvent;
}

/** Gateway-routed socket URL — NEVER write a bare port in the client URL. */
export const CORE_SOCKET_URL = "/?XTransformPort=3003";
