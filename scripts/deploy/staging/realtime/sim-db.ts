/**
 * Sephiroth deploy mirror — Prisma-backed replacement for the core-sim
 * `bun:sqlite` reader (Node runtime has no bun:sqlite).
 *
 * Prisma queries are async while sim.mirrorDb() consumes rows synchronously,
 * so this module caches: the server.js driver polls (`pollInbounds`,
 * `pollTickMs`) and the sim reads the cache through the original sync API
 * (`readInbounds`, `getTickMs`). Any failed poll keeps the previous cache —
 * a broken mirror never wipes sim state.
 */
import { PrismaClient } from '@prisma/client'

/** One row of the `Inbound` table (config view, no runtime state). */
export interface DbInboundRow {
  tag: string
  protocol: string
  port: number
  transport: string
  security: string
  status: string
}

const globalForSim = globalThis as unknown as {
  __sephirothSimPrisma?: PrismaClient
}

const prisma =
  globalForSim.__sephirothSimPrisma ??
  new PrismaClient({
    log: [{ emit: 'stdout', level: 'error' }],
  })

if (process.env.NODE_ENV !== 'test') globalForSim.__sephirothSimPrisma = prisma

// ── inbound rows ──────────────────────────────────────────────────────────

let cachedRows: DbInboundRow[] | null = null

/** Poll the Inbound table into the sync cache (DB order = createdAt, tag). */
export async function pollInbounds(): Promise<void> {
  try {
    const rows = await prisma.inbound.findMany({
      orderBy: [{ createdAt: 'asc' }, { tag: 'asc' }],
      select: {
        tag: true,
        protocol: true,
        port: true,
        transport: true,
        security: true,
        status: true,
      },
    })
    cachedRows = rows.map((r) => ({
      tag: r.tag,
      protocol: r.protocol,
      port: Number(r.port),
      transport: r.transport,
      security: r.security,
      status: r.status,
    }))
  } catch (err) {
    console.error('[sim-db] pollInbounds failed (keeping last cache):', err)
  }
}

/** Sync reader consumed by CoreSim.mirrorDb() — returns the cached rows. */
export function readInbounds(): DbInboundRow[] | null {
  return cachedRows
}

// ── live tick seconds (ServerSetting.set_core_tick_seconds, 1-5) ──────────

const TICK_DEFAULT_SECONDS = 1
let cachedTickSeconds = TICK_DEFAULT_SECONDS

export async function pollTickMs(): Promise<void> {
  try {
    const row = await prisma.serverSetting.findUnique({
      where: { key: 'set_core_tick_seconds' },
      select: { value: true },
    })
    const sec = Number(row?.value)
    cachedTickSeconds =
      Number.isInteger(sec) && sec >= 1 && sec <= 5 ? sec : TICK_DEFAULT_SECONDS
  } catch (err) {
    console.error('[sim-db] pollTickMs failed (keeping current):', err)
  }
}

export function getTickMs(): number {
  return cachedTickSeconds * 1000
}

/** Compat no-op — the original sync reader; polling replaces it. */
export function refreshTickMs(): void {
  /* async polling replaces the original sync read */
}
