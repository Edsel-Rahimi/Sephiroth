/**
 * Sephiroth core adapter — CoreSim wrapper (server-only).
 *
 * Adapts the existing simulator (mini-services/core-sim/sim.ts, untouched)
 * to the CoreBackend contract so server.ts can treat both drivers the same.
 */

import { CoreSim } from "../../../mini-services/core-sim/sim";
import type { ActivityEvent, CoreBackend, CoreBackendKind, CoreBackendStatus, CoreInboundsPayload, CoreSnapshot, CoreTick } from "@/lib/core/types";

export class SimBackend implements CoreBackend {
  readonly kind: CoreBackendKind = "sim";
  private readonly sim: CoreSim;
  private readonly versionLabel: string;
  private readonly startedAt = Date.now();

  constructor(sim: CoreSim, versionLabel: string) {
    this.sim = sim;
    this.versionLabel = versionLabel;
  }

  get inner(): CoreSim {
    return this.sim;
  }

  tick(): CoreTick {
    return this.sim.tick();
  }

  snapshot(): CoreSnapshot {
    return this.sim.snapshot();
  }

  inboundsPayload(): CoreInboundsPayload {
    return this.sim.inboundsPayload();
  }

  mirrorDb(): ActivityEvent[] {
    return this.sim.mirrorDb();
  }

  status(): CoreBackendStatus {
    return {
      kind: this.kind,
      running: true,
      version: this.versionLabel,
      pid: null,
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      apiPort: null,
      configPath: null,
      lastError: "",
      restarts: 0,
    };
  }

  tailLog(_n: number): string[] {
    return [];
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  restart(): Promise<void> {
    return Promise.resolve();
  }

  reload(): Promise<void> {
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    /* the simulator has no external process */
  }
}
