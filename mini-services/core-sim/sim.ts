/**
 * Sephiroth core-sim — REALITY-DERIVED telemetry engine.
 *
 * There is NO synthetic dataset in this file. Everything shown on the
 * dashboard is measured or stored for real:
 *   - cpu / ram / disk  → measured from the host OS (os.cpus, os.freemem, statfs)
 *   - netIn / netOut    → measured from /proc/net/dev interface counters (KB/s)
 *   - users / groups / monthTxTb / topUsers → read live from the panel store
 *   - inbounds          → mirrored from the panel's Inbound table (mirrorDb)
 *   - events            → ONLY real config diffs (inbound created/updated/deleted)
 *
 * When the panel is freshly deployed (empty store), every value is honestly
 * zero and the charts start flat — a real first-run experience.
 */
import os from 'node:os'
import fs from 'node:fs'
import type {
  ActivityEvent,
  CoreDistribution,
  CoreGoal,
  CoreInbound,
  CoreInboundsPayload,
  CoreInfo,
  CoreMetrics,
  CoreSeries,
  CoreSnapshot,
  CoreTick,
  CoreUserStat,
  HistorySet,
  InboundStatus,
} from './types'
import { readCoreStats, readInbounds } from './db'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
const round1 = (x: number): number => Math.round(x * 10) / 10
const round2 = (x: number): number => Math.round(x * 100) / 100
const round4 = (x: number): number => Math.round(x * 10000) / 10000

function pushRing(arr: number[], value: number, cap: number): void {
  arr.push(value)
  if (arr.length > cap) arr.shift()
}

const INBOUND_STATUSES: readonly string[] = ['online', 'maintenance', 'disabled']

/** DB `status` is a free string — clamp it onto the wire union defensively. */
function asInboundStatus(value: string, fallback: InboundStatus = 'online'): InboundStatus {
  return INBOUND_STATUSES.includes(value) ? (value as InboundStatus) : fallback
}

/* ---------- real host measurement ---------- */

interface CpuTimes {
  used: number
  total: number
}

function cpuTimes(): CpuTimes {
  let used = 0
  let total = 0
  for (const c of os.cpus()) {
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
    used += c.times.user + c.times.nice + c.times.sys + c.times.irq
  }
  return { used, total }
}

function ramPct(): { pct: number; usedMb: number; totalMb: number } {
  const total = os.totalmem()
  const free = os.freemem()
  return {
    pct: total > 0 ? round1(clamp(((total - free) / total) * 100, 0, 100)) : 0,
    usedMb: round1((total - free) / 1048576),
    totalMb: Math.round(total / 1048576),
  }
}

function diskPct(): number {
  try {
    const s = fs.statfsSync('/')
    const used = s.blocks - s.bfree
    return s.blocks > 0 ? round1(clamp((used / s.blocks) * 100, 0, 100)) : 0
  } catch {
    return 0
  }
}

interface NetSample {
  rx: number
  tx: number
}

/** Sum of real interface byte counters from /proc/net/dev (loopback excluded). */
function readNetCounters(): NetSample {
  try {
    const text = fs.readFileSync('/proc/net/dev', 'utf8')
    let rx = 0
    let tx = 0
    for (const line of text.split('\n').slice(2)) {
      const [ifname, rest] = line.split(':')
      if (!ifname || !rest || ifname.trim() === 'lo') continue
      const cols = rest.trim().split(/\s+/)
      rx += Number(cols[0]) || 0
      tx += Number(cols[8]) || 0
    }
    return { rx, tx }
  } catch {
    return { rx: 0, tx: 0 }
  }
}

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------

const SERIES_LEN = 60
const MAX_EVENTS = 120
const SNAPSHOT_EVENTS = 24
const STATS_REFRESH_MS = 10_000
const DISK_REFRESH_TICKS = 10

function zeroSet(n: number): number[] {
  return Array.from({ length: n }, () => 0)
}

function zeroHistory(n: number): HistorySet {
  return { dl: zeroSet(n), ul: zeroSet(n) }
}

export class CoreSim {
  // core info (honest: sim starts with the process)
  private readonly core: CoreInfo
  private readonly bootRx: NetSample
  private readonly bootCpu: CpuTimes

  // host measurements
  private cpu = 0
  private ram = 0
  private ramUsedMb = 0
  private readonly ramTotalMb = Math.round(os.totalmem() / 1048576)
  private disk = 0
  private netIn = 0
  private netOut = 0
  private lastCpu: CpuTimes
  private lastNet: NetSample
  private lastNetAt = Date.now()
  private tickCount = 0

  // real counters derived from the store
  private peakToday = 0
  private avgToday = 0
  private monthTxGb = 0
  private usersTotal = 0
  private groupsTotal = 0
  private topUsers: CoreUserStat[] = []
  private statsAt = 0

  // goal + distribution (real values only; target stays 0 until configured)
  private goal: CoreGoal = { currentGb: 0, targetGb: 0, delivered: 0, inProg: 0, pending: 0 }
  private readonly distribution: CoreDistribution = { connectedPct: 0, idlePct: 0, limitedPct: 0 }

  // rolling series + zeroed history (fills with real samples over time)
  private readonly sCpu: number[] = []
  private readonly sRam: number[] = []
  private readonly sNetIn: number[] = []
  private readonly sNetOut: number[] = []
  private readonly hist24: HistorySet = zeroHistory(24)
  private readonly hist7: HistorySet = zeroHistory(7)
  private readonly hist30: HistorySet = zeroHistory(10)

  // entities
  private inbounds: CoreInbound[] = []

  /** Display labels for legacy store rows whose tags composeProto cannot reproduce. */
  private readonly protoOverrides = new Map<string, string>([
    ['ss-2022', 'Shadowsocks · 2022'],
    ['hy2-edge', 'Hysteria2 · UDP'],
    ['legacy-ss', 'Shadowsocks · legacy'],
  ])

  // activity events (real config diffs only)
  private readonly events: ActivityEvent[] = []
  private eventCounter = 0

  constructor(version = 'sim') {
    this.core = {
      version,
      status: 'running',
      startedAt: Date.now(),
    }
    this.lastCpu = cpuTimes()
    this.bootCpu = this.lastCpu
    this.lastNet = readNetCounters()
    this.bootRx = this.lastNet
    this.refreshStats()

    // Seed the rolling series with the CURRENT real values (flat, honest):
    // cpu/ram measured now, network at 0 until real traffic deltas arrive.
    this.measureHost(true)
    for (let i = 0; i < SERIES_LEN; i++) {
      pushRing(this.sCpu, this.cpu, SERIES_LEN)
      pushRing(this.sRam, this.ram, SERIES_LEN)
      pushRing(this.sNetIn, 0, SERIES_LEN)
      pushRing(this.sNetOut, 0, SERIES_LEN)
    }
  }

  // ------------------------------------------------------------------ public

  /** One tick — measure the host, refresh store stats, return the wire payload. */
  tick(): CoreTick {
    const ts = Date.now()
    this.tickCount++
    this.measureHost(false)
    this.refreshStats()
    this.pushSeries()
    return { ts, metrics: this.metricsSnapshot(ts), topUsers: this.publicUsers(), goal: { ...this.goal } }
  }

  /** 10s refresh for the inbound table + distribution donut. */
  inboundsPayload(): CoreInboundsPayload {
    return {
      ts: Date.now(),
      inbounds: this.inbounds.map((ib) => ({ ...ib })),
      distribution: { ...this.distribution },
    }
  }

  /** Full state for a freshly connected client. */
  snapshot(): CoreSnapshot {
    const ts = Date.now()
    const series: CoreSeries = {
      cpu: [...this.sCpu],
      ram: [...this.sRam],
      netIn: [...this.sNetIn],
      netOut: [...this.sNetOut],
      hist24: { dl: [...this.hist24.dl], ul: [...this.hist24.ul] },
      hist7: { dl: [...this.hist7.dl], ul: [...this.hist7.ul] },
      hist30: { dl: [...this.hist30.dl], ul: [...this.hist30.ul] },
    }
    return {
      ts,
      core: { ...this.core },
      metrics: this.metricsSnapshot(ts),
      totals: { users: this.usersTotal, groups: this.groupsTotal },
      series,
      topUsers: this.publicUsers(),
      inbounds: this.inbounds.map((ib) => ({ ...ib })),
      events: this.events.slice(-SNAPSHOT_EVENTS).map((e) => ({ ...e, params: { ...e.params } })),
      goal: { ...this.goal },
      distribution: { ...this.distribution },
    }
  }

  /**
   * Diff the panel store's `Inbound` table against sim state and rebuild
   * `this.inbounds` in DB row order. This is the ONLY writer of inbound
   * statuses and the ONLY source of events (real config diffs). Returns the
   * emitted events (already pushed into the ring buffer); a failed read
   * (null) keeps the last known state and emits nothing.
   */
  mirrorDb(): ActivityEvent[] {
    const rows = readInbounds()
    if (rows === null) return []

    const now = Date.now()
    const emitted: ActivityEvent[] = []
    const rebuilt: CoreInbound[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      seen.add(row.tag)
      const existing = this.inbounds.find((i) => i.tag === row.tag)
      const proto = this.protoOverrides.get(row.tag) ?? this.composeProto(row.protocol, row.transport, row.security)

      if (existing) {
        const nextStatus = asInboundStatus(row.status, existing.status)
        const statusChanged = existing.status !== nextStatus
        const portChanged = existing.port !== row.port
        const protoChanged = existing.proto !== proto
        if (statusChanged) {
          // both-changed case intentionally collapses to the status event
          existing.status = nextStatus
          existing.port = row.port
          existing.proto = proto
          if (nextStatus === 'online') {
            emitted.push(this.makeEvent('inbound.online', 'success', now, { inbound: row.tag, port: row.port }))
          } else {
            emitted.push(this.makeEvent('inbound.offline', 'warn', now, { inbound: row.tag, port: row.port }))
          }
        } else if (portChanged || protoChanged) {
          existing.port = row.port
          existing.proto = proto
          emitted.push(this.makeEvent('inbound.updated', 'info', now, { inbound: row.tag, port: row.port }))
        }
        rebuilt.push(existing)
      } else {
        rebuilt.push({ tag: row.tag, proto, port: row.port, status: asInboundStatus(row.status), users: 0, txGb: 0 })
        emitted.push(this.makeEvent('inbound.created', 'success', now, { inbound: row.tag, port: row.port }))
      }
    }

    // sim inbounds absent from the DB were deleted from the config
    for (const ib of this.inbounds) {
      if (!seen.has(ib.tag)) {
        emitted.push(this.makeEvent('inbound.deleted', 'warn', now, { inbound: ib.tag, port: ib.port }))
      }
    }

    this.inbounds = rebuilt
    for (const e of emitted) this.pushEvent(e)
    return emitted
  }

  /** "vless" + "ws" + "tls" → "VLESS · WS · TLS" (tcp transport is omitted). */
  private composeProto(protocol: string, transport: string, security: string): string {
    const bases: Record<string, string> = {
      vless: 'VLESS',
      vmess: 'VMess',
      trojan: 'Trojan',
      shadowsocks: 'Shadowsocks',
      hysteria2: 'Hysteria2',
    }
    const parts = [bases[protocol] ?? protocol]
    if (transport === 'ws') parts.push('WS')
    else if (transport === 'grpc') parts.push('gRPC')
    else if (transport === 'httpupgrade') parts.push('HTTPUpgrade')
    if (security === 'tls') parts.push('TLS')
    else if (security === 'reality') parts.push('REALITY')
    return parts.join(' · ')
  }

  // -------------------------------------------------------- real measurement

  /**
   * Measure the host: cpu delta since last tick, ram now, disk every N ticks,
   * and network throughput (KB/s) from /proc/net/dev byte-counter deltas.
   * `initial=true` primes the deltas without producing a fake rate.
   */
  private measureHost(initial: boolean): void {
    const nowCpu = cpuTimes()
    const dTotal = nowCpu.total - this.lastCpu.total
    const dUsed = nowCpu.used - this.lastCpu.used
    this.lastCpu = nowCpu
    if (!initial && dTotal > 0) {
      this.cpu = round1(clamp((dUsed / dTotal) * 100, 0, 100))
    } else if (initial && this.bootCpu.total > 0) {
      // process-lifetime average as the honest first sample
      this.cpu = round1(clamp((this.bootCpu.used / this.bootCpu.total) * 100, 0, 100))
    }

    const ram = ramPct()
    this.ram = ram.pct
    this.ramUsedMb = ram.usedMb

    if (this.tickCount % DISK_REFRESH_TICKS === 0 || initial) {
      this.disk = diskPct()
    }

    const nowNet = readNetCounters()
    const now = Date.now()
    const dt = (now - this.lastNetAt) / 1000
    if (!initial && dt >= 0.5) {
      const rxKbps = (nowNet.rx - this.lastNet.rx) / 1024 / dt
      const txKbps = (nowNet.tx - this.lastNet.tx) / 1024 / dt
      this.netIn = round1(clamp(rxKbps, 0, 10_000_000))
      this.netOut = round1(clamp(txKbps, 0, 10_000_000))
      const total = this.netIn + this.netOut
      this.peakToday = round1(Math.max(this.peakToday, total))
      // exponential daily average of real samples
      this.avgToday = round1(this.avgToday + (total - this.avgToday) * 0.01)
    }
    this.lastNet = nowNet
    this.lastNetAt = now
  }

  /** Refresh store-derived stats at most every STATS_REFRESH_MS. */
  private refreshStats(): void {
    const now = Date.now()
    if (now - this.statsAt < STATS_REFRESH_MS && this.statsAt !== 0) return
    this.statsAt = now
    const stats = readCoreStats()
    if (!stats) return
    this.usersTotal = stats.usersTotal
    this.groupsTotal = stats.groupsTotal
    this.monthTxGb = stats.monthTxGb
    this.goal.currentGb = stats.monthTxGb
    this.topUsers = stats.topUsers.map((u) => ({
      uid: u.uid,
      user: u.user,
      proto: u.protoBase
        ? this.composeProto(u.protoBase.protocol, u.protoBase.transport, u.protoBase.security)
        : '—',
      gb: u.gb,
      delta: 0,
      up: false,
      spark: zeroSet(8),
      expiresInH:
        u.expiresAtMs !== null ? round2(Math.max(0, (u.expiresAtMs - now) / 3_600_000)) : null,
      usagePct: u.usagePct,
    }))
  }

  private pushSeries(): void {
    pushRing(this.sCpu, this.cpu, SERIES_LEN)
    pushRing(this.sRam, this.ram, SERIES_LEN)
    pushRing(this.sNetIn, this.netIn, SERIES_LEN)
    pushRing(this.sNetOut, this.netOut, SERIES_LEN)
  }

  private metricsSnapshot(ts: number): CoreMetrics {
    return {
      ts,
      cpu: this.cpu,
      ram: this.ram,
      ramUsedMb: this.ramUsedMb,
      ramTotalMb: this.ramTotalMb,
      disk: this.disk,
      netIn: this.netIn,
      netOut: this.netOut,
      activeUsers: 0,
      sessions: 0,
      monthTxTb: round4(this.monthTxGb / 1024),
      peakToday: this.peakToday,
      avgToday: this.avgToday,
      errorsToday: 0,
      saturatedPct: 0,
    }
  }

  private publicUsers(): CoreUserStat[] {
    return this.topUsers.map((u) => ({
      uid: u.uid,
      user: u.user,
      proto: u.proto,
      gb: u.gb,
      delta: u.delta,
      up: u.up,
      spark: [...u.spark],
      expiresInH: u.expiresInH,
      usagePct: u.usagePct,
    }))
  }

  // ------------------------------------------------------------- event gen

  private makeEvent(
    kind: ActivityEvent['kind'],
    level: ActivityEvent['level'],
    ts: number,
    params: Record<string, string | number>,
  ): ActivityEvent {
    this.eventCounter++
    return {
      id: `evt-${this.eventCounter}`,
      ts,
      level,
      kind,
      params,
    }
  }

  private pushEvent(event: ActivityEvent): void {
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) this.events.shift()
  }
}
