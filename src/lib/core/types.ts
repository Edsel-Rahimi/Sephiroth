/**
 * Sephiroth core adapter — backend contract (server-only).
 *
 * Both backends the panel can drive implement this surface, matching the
 * public API of mini-services/core-sim's CoreSim so server.ts wiring stays
 * minimal:
 *
 *   tick()            → CoreTick            (dashboard poll every ~1s)
 *   snapshot()        → CoreSnapshot        (fresh socket.io clients)
 *   inboundsPayload() → CoreInboundsPayload (10s table refresh)
 *   mirrorDb()        → ActivityEvent[]     (2s config diff)
 *
 * Wire types are re-exported from src/lib/realtime/core-types.ts — the
 * single source of truth shared with the client store (core-store.ts).
 */

import type {
  ActivityEvent,
  CoreInboundsPayload,
  CoreSnapshot,
  CoreTick,
} from "@/lib/realtime/core-types";

export type {
  ActivityEvent,
  CoreDistribution,
  CoreGoal,
  CoreInbound,
  CoreInboundsPayload,
  CoreInfo,
  CoreMetrics,
  CoreSeries,
  CoreSnapshot,
  CoreStatus,
  CoreTick,
  CoreUserStat,
  HistorySet,
  InboundStatus,
} from "@/lib/realtime/core-types";

/** Which engine is currently wired behind the panel's telemetry. */
export type CoreBackendKind = "sim" | "xray";

/** Operational status of the core backend (superset of the wire CoreInfo). */
export interface CoreBackendStatus {
  kind: CoreBackendKind;
  /** xray process alive (sim is always "running" once constructed). */
  running: boolean;
  /** Xray binary version ("sim-<panelVersion>" for the simulator). */
  version: string;
  /** OS pid of the xray process (null in sim mode). */
  pid: number | null;
  /** epoch ms — when the backend became the active one. */
  startedAt: number;
  /** ms since startedAt (0 before first start). */
  uptimeMs: number;
  /** Local stats-API port used by the xray driver (null in sim mode). */
  apiPort: number | null;
  /** Absolute path of the generated xray config (null in sim mode). */
  configPath: string | null;
  /** Last fatal error message ("" = none). */
  lastError: string;
  /** How many times the driver auto-restarted the process. */
  restarts: number;
}

/** Interface both CoreSim (wrapped) and XrayDriver implement. */
export interface CoreBackend {
  readonly kind: CoreBackendKind;
  tick(): CoreTick;
  snapshot(): CoreSnapshot;
  inboundsPayload(): CoreInboundsPayload;
  mirrorDb(): ActivityEvent[];
  status(): CoreBackendStatus;
  /** Last n merged stdout/stderr lines (sim returns []). */
  tailLog(n: number): string[];
  /** Bring the core up (no-op resolving promise for the simulator). */
  start(): Promise<void>;
  /** SIGTERM/SIGKILL the process (no-op for the simulator). */
  stop(): Promise<void>;
  /** stop + start. */
  restart(): Promise<void>;
  /** Regen config from the store; restart only when it changed. */
  reload(): Promise<void>;
  /** Best-effort stop + cleanup (no-op for the simulator). */
  dispose(): Promise<void>;
}

/** Status payload served by GET /api/system/core-status. */
export interface CoreStatusPayload extends CoreBackendStatus {
  /** True when the xray driver was requested but fell back to the simulator. */
  fallbackActive: boolean;
  /** Human-readable reason for the fallback ("" = none). */
  fallbackReason: string;
  /**
   * Sidecar engines (v2.5) — one real process per served hysteria2 inbound,
   * OUTSIDE the Xray core. Additive field: absent when no manager is wired.
   */
  sidecars?: SidecarStatus[];
}

/** One sidecar engine process (hysteria2 inbound served outside Xray). */
export interface SidecarStatus {
  tag: string;
  protocol: "hysteria2";
  running: boolean;
  pid: number | null;
  /** sidecar binary version ("" before first resolve) */
  version: string;
  port: number;
  lastError: string;
  restarts: number;
  logTail: string[];
  /** session counters from the trafficStats API (deltas accumulated) */
  rxBytes: number;
  txBytes: number;
  /** number of enabled clients served by this sidecar */
  users: number;
  lastStatsAt: number;
  configPath: string;
  certPath: string;
  certSource: "managed" | "self-signed";
}
