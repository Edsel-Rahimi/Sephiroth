"use client";

import { create } from "zustand";
import type {
  ActivityEvent,
  CoreInbound,
  CoreInboundsPayload,
  CoreSnapshot,
  CoreTick,
} from "@/lib/realtime/core-types";

/**
 * Live core state. Seeded with the same numbers the static dashboard used,
 * so the panel renders identically before (or without) a socket connection
 * and seamlessly transitions to live values once `core:init` arrives.
 */

type ConnStatus = "connecting" | "live" | "offline";

const MAX_POINTS = 60;
const MAX_EVENTS = 80;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

/* deterministic PRNG — stable seed arrays, no hydration surprises */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedSeries(): CoreSnapshot["series"] {
  const rnd = mulberry32(0x5ef10d5);
  const gauss = () => rnd() + rnd() + rnd() - 1.5;
  const cpu: number[] = [];
  const ram: number[] = [];
  const netIn: number[] = [];
  const netOut: number[] = [];
  let c = 14;
  let rm = 32;
  let ni = 4.2;
  let no = 1.3;
  for (let i = 0; i < MAX_POINTS; i++) {
    c = clamp(c + (14 - c) * 0.08 + gauss() * 1.6, 3, 55);
    rm = clamp(rm + (32 - rm) * 0.01 + gauss() * 0.3, 18, 55);
    ni = clamp(ni + (4.2 - ni) * 0.06 + gauss() * 0.35, 0.3, 9.5);
    no = clamp(no + (ni * 0.33 - no) * 0.1 + gauss() * 0.15, 0.1, 3.4);
    cpu.push(Math.round(c));
    ram.push(r1(rm));
    netIn.push(r1(ni));
    netOut.push(r1(no));
  }
  return {
    cpu,
    ram,
    netIn,
    netOut,
    /* small-panel plausible placeholder history (sim history replaces it on connect) */
    hist24: { dl: [6, 9, 7, 21, 12, 9, 8, 10], ul: [2, 3, 2, 7, 4, 3, 3, 3] },
    hist7: { dl: [12, 9, 18, 11, 14, 10, 13], ul: [4, 3, 6, 4, 5, 3, 4] },
    hist30: {
      dl: [8, 10, 12, 10, 14, 9, 18, 12, 13, 11],
      ul: [3, 3, 4, 3, 5, 3, 6, 4, 4, 4],
    },
  };
}

function seedSnapshot(): CoreSnapshot {
  const startedAt = Date.now() - (42 * 86400 + 6 * 3600 + 18 * 60 + 44) * 1000;
  const t = Date.now();
  return {
    ts: t,
    core: { version: "1.8.24-sephiroth", status: "running", startedAt },
    metrics: {
      ts: t,
      cpu: 14,
      ram: 32,
      ramUsedMb: 655,
      ramTotalMb: 2048,
      disk: 14,
      netIn: 4.2,
      netOut: 1.3,
      activeUsers: 0,
      sessions: 0,
      monthTxTb: 0.08,
      peakToday: 5.4,
      avgToday: 2.2,
      errorsToday: 0,
      saturatedPct: 0,
    },
    totals: { users: 0, groups: 0 },
    series: seedSeries(),
    topUsers: [],
    inbounds: [],
    events: [],
    goal: { currentGb: 11.8, targetGb: 64, delivered: 7.2, inProg: 2.1, pending: 0 },
    distribution: { connectedPct: 64, idlePct: 26, limitedPct: 10 },
  };
}

interface CoreState {
  status: ConnStatus;
  snapshot: CoreSnapshot;
  /** newest first */
  events: ActivityEvent[];
  setStatus: (s: ConnStatus) => void;
  applyInit: (snap: CoreSnapshot) => void;
  applyTick: (t: CoreTick) => void;
  applyEvent: (e: ActivityEvent) => void;
  applyInbounds: (p: CoreInboundsPayload) => void;
  /** Phase 3 — optimistic CRUD helpers; the next core:inbounds broadcast reconciles */
  upsertInboundLocal: (ib: CoreInbound) => void;
  removeInboundLocal: (tag: string) => void;
}

export const useCoreStore = create<CoreState>()((set) => ({
  status: "connecting",
  snapshot: seedSnapshot(),
  events: [],

  setStatus: (status) => set({ status }),

  applyInit: (snap) =>
    set({
      status: "live",
      snapshot: snap,
      /* wire order = oldest first → feed wants newest first */
      events: [...snap.events].slice().reverse().slice(0, MAX_EVENTS),
    }),

  applyTick: (t) =>
    set((st) => {
      const s = st.snapshot;
      const push = (arr: number[], v: number) => [...arr.slice(-(MAX_POINTS - 1)), v];
      return {
        snapshot: {
          ...s,
          ts: t.ts,
          metrics: t.metrics,
          topUsers: t.topUsers,
          goal: t.goal,
          series: {
            ...s.series,
            cpu: push(s.series.cpu, t.metrics.cpu),
            ram: push(s.series.ram, t.metrics.ram),
            netIn: push(s.series.netIn, t.metrics.netIn),
            netOut: push(s.series.netOut, t.metrics.netOut),
          },
        },
      };
    }),

  applyEvent: (e) =>
    set((st) => ({ events: [e, ...st.events].slice(0, MAX_EVENTS) })),

  applyInbounds: (p) =>
    set((st) => ({
      snapshot: { ...st.snapshot, inbounds: p.inbounds, distribution: p.distribution },
    })),

  upsertInboundLocal: (ib) =>
    set((st) => {
      const list = st.snapshot.inbounds;
      const idx = list.findIndex((x) => x.tag === ib.tag);
      const next =
        idx === -1
          ? [...list, ib]
          : list.map((x) => (x.tag === ib.tag ? { ...x, ...ib } : x));
      return { snapshot: { ...st.snapshot, inbounds: next } };
    }),

  removeInboundLocal: (tag) =>
    set((st) => ({
      snapshot: {
        ...st.snapshot,
        inbounds: st.snapshot.inbounds.filter((x) => x.tag !== tag),
      },
    })),
}));
