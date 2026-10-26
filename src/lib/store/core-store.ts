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
 * Live core state. Seeded with honest zeros — no synthetic dataset.
 * Before (or without) a socket connection the dashboard shows a clean
 * empty state and transitions to live values once `core:init` arrives.
 */

type ConnStatus = "connecting" | "live" | "offline";

const MAX_POINTS = 60;
const MAX_EVENTS = 80;

function zeroSet(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

function seedSnapshot(): CoreSnapshot {
  const t = Date.now();
  return {
    ts: t,
    core: { version: "\u2014", status: "stopped", startedAt: t },
    metrics: {
      ts: t,
      cpu: 0,
      ram: 0,
      ramUsedMb: 0,
      ramTotalMb: 0,
      disk: 0,
      netIn: 0,
      netOut: 0,
      activeUsers: 0,
      sessions: 0,
      monthTxTb: 0,
      peakToday: 0,
      avgToday: 0,
      errorsToday: 0,
      saturatedPct: 0,
    },
    totals: { users: 0, groups: 0 },
    series: {
      cpu: zeroSet(MAX_POINTS),
      ram: zeroSet(MAX_POINTS),
      netIn: zeroSet(MAX_POINTS),
      netOut: zeroSet(MAX_POINTS),
      hist24: { dl: zeroSet(24), ul: zeroSet(24) },
      hist7: { dl: zeroSet(7), ul: zeroSet(7) },
      hist30: { dl: zeroSet(10), ul: zeroSet(10) },
    },
    topUsers: [],
    inbounds: [],
    events: [],
    goal: { currentGb: 0, targetGb: 0, delivered: 0, inProg: 0, pending: 0 },
    distribution: { connectedPct: 0, idlePct: 0, limitedPct: 0 },
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
