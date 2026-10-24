"use client";

import { create } from "zustand";
import type {
  ActivityEvent,
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
  let c = 34;
  let rm = 61;
  let ni = 128;
  let no = 42;
  for (let i = 0; i < MAX_POINTS; i++) {
    c = clamp(c + (34 - c) * 0.08 + gauss() * 4, 8, 92);
    rm = clamp(rm + (61 - rm) * 0.01 + gauss() * 0.5, 45, 80);
    ni = clamp(ni + (128 - ni) * 0.06 + gauss() * 10, 30, 230);
    no = clamp(no + (ni * 0.33 - no) * 0.1 + gauss() * 4, 8, 80);
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
    /* exact datasets the static dashboard shipped with */
    hist24: { dl: [95, 140, 110, 388, 205, 160, 130, 175], ul: [40, 70, 55, 120, 80, 60, 50, 65] },
    hist7: { dl: [220, 150, 390, 240, 310, 200, 260], ul: [80, 55, 130, 85, 110, 70, 90] },
    hist30: {
      dl: [150, 190, 240, 200, 310, 180, 390, 260, 300, 220],
      ul: [60, 80, 95, 75, 120, 70, 150, 95, 110, 85],
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
      cpu: 34,
      ram: 61,
      ramUsedMb: 4997,
      ramTotalMb: 8192,
      disk: 27,
      netIn: 128.4,
      netOut: 42.1,
      activeUsers: 312,
      sessions: 437,
      monthTxTb: 8.42,
      peakToday: 210.2,
      avgToday: 96.7,
      errorsToday: 3,
      saturatedPct: 2,
    },
    totals: { users: 435, groups: 12 },
    series: seedSeries(),
    topUsers: [
      { uid: "USR-0341", user: "Aria", proto: "VLESS · WS", gb: 412.6, delta: 18.4, up: true, usagePct: 74, expiresInH: null, spark: [30, 42, 38, 55, 48, 66, 60, 78] },
      { uid: "USR-0287", user: "Neo", proto: "VMess · gRPC", gb: 356.1, delta: 9.2, up: true, usagePct: 52, expiresInH: 122, spark: [25, 30, 44, 40, 52, 49, 62, 58] },
      { uid: "USR-0295", user: "Kaya", proto: "Trojan · TLS", gb: 287.4, delta: -6.7, up: false, usagePct: 95, expiresInH: null, spark: [70, 62, 66, 50, 54, 40, 44, 32] },
      { uid: "USR-0302", user: "Vega", proto: "SS · 2022", gb: 198.2, delta: 3.1, up: true, usagePct: 41, expiresInH: 12, spark: [44, 40, 48, 46, 52, 50, 56, 54] },
      { uid: "USR-0276", user: "Orion", proto: "Hysteria2", gb: 176.9, delta: 6.4, up: true, usagePct: 66, expiresInH: 49, spark: [22, 30, 28, 38, 36, 44, 48, 52] },
    ],
    inbounds: [
      { tag: "vless-main", proto: "VLESS · WS · TLS", port: 443, status: "online", users: 212, txGb: 3110 },
      { tag: "vmess-grpc", proto: "VMess · gRPC", port: 8443, status: "online", users: 96, txGb: 2480 },
      { tag: "trojan-tls", proto: "Trojan · TLS", port: 2053, status: "online", users: 71, txGb: 1875 },
      { tag: "ss-2022", proto: "Shadowsocks · 2022", port: 8388, status: "online", users: 38, txGb: 640 },
      { tag: "hy2-edge", proto: "Hysteria2 · UDP", port: 36712, status: "online", users: 15, txGb: 312 },
      { tag: "legacy-ss", proto: "Shadowsocks · legacy", port: 8888, status: "maintenance", users: 3, txGb: 22 },
    ],
    events: [],
    goal: { currentGb: 222, targetGb: 540, delivered: 120, inProg: 64, pending: 38 },
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
}));
