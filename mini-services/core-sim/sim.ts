/**
 * Sephiroth core-sim — Xray-core simulator engine.
 *
 * Owns all mutable simulation state and the tick equations from the Phase 2
 * spec. `index.ts` drives the timers and socket.io; this file stays free of
 * transport concerns. Every payload handed out is a freshly-built plain
 * object (deep-cloned), so emitting never leaks internal references.
 *
 * Phase 3: inbound config is mirrored from the panel's SQLite `Inbound`
 * table (see db.ts) — `mirrorDb()` diffs it and is the ONLY writer of
 * inbound statuses; the weighted generator no longer flips them.
 */
import type {
  ActivityEvent,
  ActivityKind,
  ActivityLevel,
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
import { readInbounds } from './db'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const rand = Math.random

/** Standard normal via Box-Muller. */
function gaussian(): number {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
const round1 = (x: number): number => Math.round(x * 10) / 10
const round2 = (x: number): number => Math.round(x * 100) / 100
const round3 = (x: number): number => Math.round(x * 1000) / 1000
const round4 = (x: number): number => Math.round(x * 10000) / 10000

function pushRing(arr: number[], value: number, cap: number): void {
  arr.push(value)
  if (arr.length > cap) arr.shift()
}

const USER_NAMES: readonly string[] = [
  'Aria',
  'Neo',
  'Kaya',
  'Vega',
  'Orion',
  'Rex',
  'Mira',
  'Jett',
  'Luna',
  'Zephyr',
  'Nima',
  'Sahar',
]

function randomName(): string {
  return USER_NAMES[Math.floor(rand() * USER_NAMES.length)] ?? 'Neo'
}

function randomIp(): string {
  return `${1 + Math.floor(rand() * 223)}.${Math.floor(rand() * 256)}.${Math.floor(rand() * 256)}.${1 + Math.floor(rand() * 254)}`
}

/**
 * 0..1 daily curve: 0.5 + 0.5*sin(2π*secondsIntoLocalDay/86400 - π/2).
 * `fractionOfDay` = secondsIntoLocalDay / 86400 (also used per-hour for hist24).
 */
function dailyCurve(fractionOfDay: number): number {
  return 0.5 + 0.5 * Math.sin(2 * Math.PI * fractionOfDay - Math.PI / 2)
}

function secondsIntoLocalDay(): number {
  const d = new Date()
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000
}

/** Uptime: 42d 6h 18m 44s (+ 0-10 min jitter, set at boot). */
const UPTIME_OFFSET_MS = ((42 * 24 + 6) * 3600 + 18 * 60 + 44) * 1000

const SERIES_LEN = 60
const MAX_EVENTS = 120
const SNAPSHOT_EVENTS = 24

/** Weighted activity kinds (total weight 86; inbound flips come from the DB mirror). */
const EVENT_WEIGHTS: ReadonlyArray<{ kind: ActivityKind; level: ActivityLevel; weight: number }> = [
  { kind: 'user.connected', level: 'info', weight: 22 },
  { kind: 'user.disconnected', level: 'info', weight: 20 },
  { kind: 'sub.fetch', level: 'info', weight: 14 },
  { kind: 'user.created', level: 'success', weight: 6 },
  { kind: 'auth.success', level: 'info', weight: 5 },
  { kind: 'auth.failed', level: 'error', weight: 4 },
  { kind: 'traffic.spike', level: 'warn', weight: 4 },
  { kind: 'core.reload', level: 'info', weight: 1 },
  { kind: 'system.backup', level: 'success', weight: 3 },
  { kind: 'user.expired', level: 'warn', weight: 3 },
  { kind: 'user.limit', level: 'warn', weight: 3 },
  { kind: 'system.cert', level: 'success', weight: 1 },
]

const INBOUND_STATUSES: readonly string[] = ['online', 'maintenance', 'disabled']

/** DB `status` is a free string — clamp it onto the wire union defensively. */
function asInboundStatus(value: string, fallback: InboundStatus = 'online'): InboundStatus {
  return INBOUND_STATUSES.includes(value) ? (value as InboundStatus) : fallback
}

/** Internal top-user row (`positive` = delta sign tendency, never emitted). */
interface SimUser {
  uid: string
  user: string
  proto: string
  gb: number
  delta: number
  positive: boolean
  up: boolean
  spark: number[]
  expiresInH: number | null
  usagePct: number | null
}

function seedSpark(): number[] {
  const out: number[] = []
  let v = 35 + rand() * 30
  for (let i = 0; i < 8; i++) {
    v = clamp(v + (rand() * 30 - 15), 20, 90)
    out.push(Math.round(v))
  }
  return out
}

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------

export class CoreSim {
  // core info
  private readonly core: CoreInfo
  private usersTotal = 435
  private readonly groupsTotal = 12

  // metrics
  private cpu = 34
  private ram = 61
  private readonly ramTotalMb = 8192
  private disk = 27
  private netIn = 128.4
  private netOut = 42.1
  private monthTxTb = 8.42
  private peakToday = 210.2
  private avgToday = 96.7
  private errorsToday = 3
  private saturatedSamples = 300
  private saturatedHits = 6
  private activeUsers = 312
  private sessions = 437

  // goal + distribution
  private readonly goal: CoreGoal = { currentGb: 222.0, targetGb: 540, delivered: 120, inProg: 64, pending: 38 }
  private distribution: CoreDistribution = { connectedPct: 64, idlePct: 26, limitedPct: 10 }

  // traffic burst state
  private burstTicksLeft = 0
  private burstFactor = 1

  // rolling series + pre-aggregated history
  private readonly sCpu: number[] = []
  private readonly sRam: number[] = []
  private readonly sNetIn: number[] = []
  private readonly sNetOut: number[] = []
  private readonly hist24: HistorySet
  private readonly hist7: HistorySet
  private readonly hist30: HistorySet

  // entities
  private readonly topUsers: SimUser[]
  private inbounds: CoreInbound[]

  /** Display labels for the legacy seeds that composeProto cannot reproduce. */
  private readonly protoOverrides = new Map<string, string>([
    ['ss-2022', 'Shadowsocks · 2022'],
    ['hy2-edge', 'Hysteria2 · UDP'],
    ['legacy-ss', 'Shadowsocks · legacy'],
  ])

  // activity events
  private readonly events: ActivityEvent[] = []
  private eventCounter = 0
  private reloadTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.core = {
      version: '1.8.24-sephiroth',
      status: 'running',
      startedAt: Date.now() - UPTIME_OFFSET_MS + Math.floor(rand() * 10 * 60 * 1000),
    }

    this.topUsers = (
      [
        { uid: 'USR-0341', user: 'Aria', proto: 'VLESS · WS', gb: 412.6, delta: 18.4, positive: true, up: true, usagePct: 74, expiresInH: null },
        { uid: 'USR-0287', user: 'Neo', proto: 'VMess · gRPC', gb: 356.1, delta: 9.2, positive: true, up: true, usagePct: 52, expiresInH: 122 },
        { uid: 'USR-0295', user: 'Kaya', proto: 'Trojan · TLS', gb: 287.4, delta: -6.7, positive: false, up: false, usagePct: 95, expiresInH: null },
        { uid: 'USR-0302', user: 'Vega', proto: 'SS · 2022', gb: 198.2, delta: 3.1, positive: true, up: true, usagePct: 41, expiresInH: 12 },
        { uid: 'USR-0276', user: 'Orion', proto: 'Hysteria2', gb: 176.9, delta: 6.4, positive: true, up: true, usagePct: 66, expiresInH: 49 },
      ] as SimUser[]
    ).map((u) => ({ ...u, spark: seedSpark() }))

    this.inbounds = (
      [
        { tag: 'vless-main', proto: 'VLESS · WS · TLS', port: 443, status: 'online', users: 212, txGb: 3110 },
        { tag: 'vmess-grpc', proto: 'VMess · gRPC', port: 8443, status: 'online', users: 96, txGb: 2480 },
        { tag: 'trojan-tls', proto: 'Trojan · TLS', port: 2053, status: 'online', users: 71, txGb: 1875 },
        { tag: 'ss-2022', proto: 'Shadowsocks · 2022', port: 8388, status: 'online', users: 38, txGb: 640 },
        { tag: 'hy2-edge', proto: 'Hysteria2 · UDP', port: 36712, status: 'online', users: 15, txGb: 312 },
        { tag: 'legacy-ss', proto: 'Shadowsocks · legacy', port: 8888, status: 'maintenance', users: 3, txGb: 22 },
      ] as CoreInbound[]
    ).map((ib) => ({ ...ib }))

    this.hist24 = this.genHist24()
    this.hist7 = this.genHistWalk(7)
    this.hist30 = this.genHistWalk(10)

    // Warm up the rolling series (60 samples) so charts are full on first paint.
    for (let i = 0; i < SERIES_LEN; i++) {
      this.tickEquations()
      this.pushSeries()
    }

    this.seedEvents()
  }

  // ------------------------------------------------------------------ public

  /** One simulated second — advance state, return the wire tick. */
  tick(): CoreTick {
    const ts = Date.now()
    this.tickEquations()
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

  /** Generate the next weighted activity event (with side effects). */
  nextEvent(): ActivityEvent {
    const chosen = this.pickKind()
    const event = this.makeEvent(chosen.kind, chosen.level, Date.now())
    this.applySideEffects(event)
    this.pushEvent(event)
    return event
  }

  /** Force a traffic burst (×1.6-2.2 on the netIn target, 4-8 ticks). */
  triggerBurst(): void {
    this.burstTicksLeft = 4 + Math.floor(rand() * 5)
    this.burstFactor = 1.6 + rand() * 0.6
  }

  /**
   * Phase 3 — diff the SQLite `Inbound` table (via db.ts) against the sim
   * state and rebuild `this.inbounds` in DB row order. Status flips come
   * exclusively from here. Returns the emitted events (already pushed into
   * the ring buffer, so snapshot() includes them); a failed read (null)
   * keeps the last known state and emits nothing.
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
        rebuilt.push(existing) // users/txGb untouched
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

  // ------------------------------------------------------------- tick math

  private tickEquations(): void {
    const daily = dailyCurve(secondsIntoLocalDay() / 86400)

    // traffic — bursts multiply the netIn target
    if (this.burstTicksLeft > 0) {
      this.burstTicksLeft--
    } else if (rand() < 0.015) {
      this.triggerBurst()
    }
    const targetIn = (60 + 90 * daily) * (this.burstTicksLeft > 0 ? this.burstFactor : 1)
    this.netIn = round1(clamp(this.netIn + (targetIn - this.netIn) * 0.06 + gaussian() * 6, 18, 240))
    const targetOut = this.netIn * (0.3 + 0.06 * rand())
    this.netOut = round1(clamp(this.netOut + (targetOut - this.netOut) * 0.06 + gaussian() * 2, 4, 96))

    // load
    this.cpu = Math.round(clamp(this.cpu + (28 + 34 * daily - this.cpu) * 0.08 + gaussian() * 3.5, 6, 97))
    this.ram = round1(clamp(this.ram + (58 + 8 * daily - this.ram) * 0.01 + gaussian() * 0.3, 42, 86))
    this.disk = round2(clamp(this.disk + (28 - this.disk) * 0.0005 + gaussian() * 0.02, 24, 34))

    // users drift toward 290 + 60*daily
    const targetUsers = 290 + 60 * daily
    const diff = targetUsers - this.activeUsers
    if (Math.abs(diff) >= 1) {
      const step = Math.min(Math.abs(diff), 1 + Math.floor(rand() * 3))
      this.activeUsers = clamp(this.activeUsers + Math.sign(diff) * step, 240, 400)
    }
    this.sessions = Math.round(this.activeUsers * (1.32 + 0.1 * rand()))

    // derived counters (saturated counters never reset — fine for preview)
    const total = this.netIn + this.netOut
    this.peakToday = round1(Math.max(this.peakToday, total))
    this.avgToday = round1(this.avgToday + (total - this.avgToday) * 0.01)
    this.saturatedSamples++
    if (total > 340) this.saturatedHits++
    this.monthTxTb = round4(this.monthTxTb + total / 8192 / 1024)
    this.goal.currentGb = round3(this.goal.currentGb + total / 8192)

    this.walkDistribution()
    this.tickTopUsers()
    this.tickInbounds(total)
  }

  private tickTopUsers(): void {
    let maxGb = 0
    for (const u of this.topUsers) if (u.gb > maxGb) maxGb = u.gb
    const netShare = clamp(this.netIn / 240, 0, 1)
    for (const u of this.topUsers) {
      u.gb = round2(u.user === 'Kaya' ? u.gb - (0.01 + rand() * 0.02) : u.gb + (0.008 + rand() * 0.05))
      u.delta += (rand() * 2 - 1) * 0.3
      if (u.positive && u.delta < 0) u.delta = Math.abs(u.delta) * 0.5
      if (!u.positive && u.delta > 0) u.delta = -Math.abs(u.delta) * 0.5
      u.delta = round1(u.delta)
      const raw = maxGb > 0 ? clamp((u.gb / maxGb) * netShare, 0, 1) : 0
      pushRing(u.spark, Math.round(clamp(20 + 70 * raw + (rand() * 10 - 5), 20, 90)), 8)
      if (u.usagePct !== null) u.usagePct = round2(Math.min(99, u.usagePct + rand() * 0.01))
      if (u.expiresInH !== null) u.expiresInH = round2(Math.max(0, u.expiresInH - 1 / 3600))
    }
  }

  private tickInbounds(total: number): void {
    let inboundUsers = 0
    for (const ib of this.inbounds) inboundUsers += ib.users
    if (inboundUsers > 0) {
      const gb = total / 8192
      for (const ib of this.inbounds) {
        ib.txGb = round2(ib.txGb + (gb * ib.users) / inboundUsers)
      }
    }
    // users jitter ±1 every few ticks, never below 0
    if (rand() < 0.25) {
      const ib = this.inbounds[Math.floor(rand() * this.inbounds.length)]
      if (ib) ib.users = Math.max(0, ib.users + (rand() < 0.5 ? -1 : 1))
    }
  }

  /** Random-walk ±1, clamp 0-100, renormalize to exactly 100. */
  private walkDistribution(): void {
    if (rand() > 0.3) return
    let connected = clamp(this.distribution.connectedPct + (rand() < 0.5 ? -1 : 1), 0, 100)
    let idle = clamp(this.distribution.idlePct + (rand() < 0.5 ? -1 : 1), 0, 100)
    let limited = 100 - connected - idle
    if (limited < 0) {
      limited = 0
      idle = 100 - connected
    } else if (limited > 100) {
      limited = 100
      connected = Math.max(0, 100 - idle)
    }
    this.distribution = { connectedPct: connected, idlePct: idle, limitedPct: limited }
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
      ramUsedMb: round1((this.ram * this.ramTotalMb) / 100),
      ramTotalMb: this.ramTotalMb,
      disk: this.disk,
      netIn: this.netIn,
      netOut: this.netOut,
      activeUsers: this.activeUsers,
      sessions: this.sessions,
      monthTxTb: this.monthTxTb,
      peakToday: this.peakToday,
      avgToday: this.avgToday,
      errorsToday: this.errorsToday,
      saturatedPct: round1((this.saturatedHits / this.saturatedSamples) * 100),
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

  // ------------------------------------------------------------ history gen

  /** 24h history — dl = 40 + 330*hourlyCurve ± 22, max forced into idx 12-18. */
  private genHist24(): HistorySet {
    const dl: number[] = []
    for (let h = 0; h < 24; h++) {
      dl.push(Math.round(40 + 330 * dailyCurve(h / 24) + (rand() * 44 - 22)))
    }
    const peakIdx = 12 + Math.floor(rand() * 7)
    let currentMax = 0
    for (const v of dl) if (v > currentMax) currentMax = v
    dl[peakIdx] = Math.round(clamp(Math.max(dl[peakIdx] ?? 0, currentMax + 4 + rand() * 8), 0, 400))
    const ul = dl.map((v) => Math.round(clamp(v * 0.33 + (rand() * 16 - 8), 0, 400)))
    return { dl, ul }
  }

  /** Random-ish walk in 150..390 (hist7 → 7 pts, hist30 → 10 pts). */
  private genHistWalk(n: number): HistorySet {
    const dl: number[] = []
    let v = 150 + rand() * 120
    for (let i = 0; i < n; i++) {
      v = clamp(v + (rand() * 120 - 60), 150, 390)
      dl.push(Math.round(v))
    }
    const ul = dl.map((x) => Math.round(clamp(x * 0.33 + (rand() * 16 - 8), 0, 400)))
    return { dl, ul }
  }

  // ------------------------------------------------------------- event gen

  private pickKind(): { kind: ActivityKind; level: ActivityLevel } {
    let total = 0
    for (const w of EVENT_WEIGHTS) total += w.weight
    let roll = rand() * total
    for (const w of EVENT_WEIGHTS) {
      roll -= w.weight
      if (roll <= 0) return { kind: w.kind, level: w.level }
    }
    const last = EVENT_WEIGHTS[EVENT_WEIGHTS.length - 1]
    return last ? { kind: last.kind, level: last.level } : { kind: 'sub.fetch', level: 'info' }
  }

  private makeEvent(
    kind: ActivityKind,
    level: ActivityLevel,
    ts: number,
    paramsOverride?: Record<string, string | number>,
  ): ActivityEvent {
    this.eventCounter++
    return {
      id: `evt-${this.eventCounter}`,
      ts,
      level,
      kind,
      params: paramsOverride ?? this.genParams(kind),
    }
  }

  private genParams(kind: ActivityKind): Record<string, string | number> {
    switch (kind) {
      case 'user.connected':
        return { user: randomName(), inbound: this.tagByStatus('online') ?? this.anyTag() }
      case 'user.disconnected':
      case 'sub.fetch':
      case 'user.created':
      case 'user.expired':
      case 'user.limit':
        return { user: randomName() }
      case 'auth.success':
      case 'auth.failed':
        return { ip: randomIp() }
      case 'traffic.spike':
      case 'inbound.offline':
        return { inbound: this.tagByStatus('online') ?? this.anyTag() }
      case 'inbound.online':
        return { inbound: this.tagByStatus('maintenance') ?? this.anyTag() }
      case 'inbound.created':
      case 'inbound.updated':
      case 'inbound.deleted':
        // unreachable from the weighted pool — mirrorDb() passes explicit params
        return { inbound: this.anyTag(), port: 0 }
      case 'core.reload':
        return { version: this.core.version }
      case 'system.backup':
      case 'system.cert':
        return {}
    }
  }

  private applySideEffects(event: ActivityEvent): void {
    switch (event.kind) {
      case 'user.connected':
        this.activeUsers = Math.min(400, this.activeUsers + 1)
        break
      case 'user.disconnected':
        this.activeUsers = Math.max(240, this.activeUsers - 1)
        break
      case 'user.created':
        this.usersTotal++
        break
      case 'auth.failed':
        this.errorsToday = Math.min(99, this.errorsToday + 1)
        break
      case 'traffic.spike':
        this.triggerBurst()
        break
      case 'core.reload':
        this.core.status = 'reloading'
        if (this.reloadTimer) clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(() => {
          try {
            this.core.status = 'running'
          } catch (err) {
            console.error('[core-sim] reload timer error:', err)
          }
        }, 2000)
        break
      default:
        break
    }
  }

  private pushEvent(event: ActivityEvent): void {
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) this.events.shift()
  }

  /** Seed 8-10 events with ts spread over the last 15 min (no side effects). */
  private seedEvents(): void {
    const count = 8 + Math.floor(rand() * 3)
    const now = Date.now()
    const stamps: number[] = []
    for (let i = 0; i < count; i++) stamps.push(now - Math.floor(rand() * 15 * 60 * 1000))
    stamps.sort((a, b) => a - b)
    for (const ts of stamps) {
      const chosen = this.pickKind()
      this.pushEvent(this.makeEvent(chosen.kind, chosen.level, ts))
    }
  }

  private tagByStatus(status: InboundStatus): string | null {
    const matches = this.inbounds.filter((i) => i.status === status)
    const ib = matches[Math.floor(rand() * matches.length)]
    return ib ? ib.tag : null
  }

  private anyTag(): string {
    const ib = this.inbounds[Math.floor(rand() * this.inbounds.length)]
    return ib ? ib.tag : 'vless-main'
  }
}
