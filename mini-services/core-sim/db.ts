/**
 * Sephiroth core-sim — SQLite config mirror reader.
 *
 * Phase 3: the `Inbound` table in the panel's Prisma SQLite DB is the config
 * source of truth. This module opens that file read-only-ish (WAL allows a
 * concurrent writer) and exposes `readInbounds()` for the simulator's diff
 * loop. Any read failure (missing table, locked file, DB absent) is logged
 * at most once every few seconds and surfaces as `null` — the caller keeps
 * its last known state, so a broken mirror never wipes the sim.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Database } from 'bun:sqlite'

/** One row of the Prisma `Inbound` table (config view, no runtime state). */
export interface DbInboundRow {
  tag: string
  protocol: string
  port: number
  transport: string
  security: string
  status: string
}

// ---------------------------------------------------------------------------
// path resolution (once at import)
// ---------------------------------------------------------------------------

function resolveDbPath(): string | null {
  const envPath = process.env.CORE_DB_PATH
  if (envPath && envPath.length > 0) return envPath

  // import.meta.dir = mini-services/core-sim → repo root is two levels up
  const candidates = ['../../db/custom.db', '../db/custom.db']
  for (const rel of candidates) {
    const abs = resolve(import.meta.dir, rel)
    if (existsSync(abs)) return abs
  }
  return null
}

const DB_PATH = resolveDbPath()

let db: Database | null = null
if (DB_PATH) {
  try {
    db = new Database(DB_PATH)
    // WAL is already set on the file; re-asserting is harmless and keeps the
    // mirror on the same concurrency contract as the Prisma writer.
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA busy_timeout=3000')
  } catch (err) {
    console.error('[core-sim/db] failed to open SQLite mirror:', err)
    db = null
  }
} else {
  console.error('[core-sim/db] no SQLite DB found (looked for ../../db/custom.db and ../db/custom.db; set CORE_DB_PATH to override)')
}

console.log(`[core-sim/db] inbound mirror DB: ${DB_PATH ?? 'NOT FOUND (mirror disabled)'}`)

// ---------------------------------------------------------------------------
// error-throttled logging
// ---------------------------------------------------------------------------

const LOG_THROTTLE_MS = 4000
let lastErrorLog = 0

function logErrorThrottled(message: string, err: unknown): void {
  const now = Date.now()
  if (now - lastErrorLog < LOG_THROTTLE_MS) return
  lastErrorLog = now
  console.error(message, err)
}

// ---------------------------------------------------------------------------
// reader
// ---------------------------------------------------------------------------

/** Read the mirrored inbounds, DB order = createdAt ASC, tag ASC. */
export function readInbounds(): DbInboundRow[] | null {
  if (!db) return null
  try {
    const rows = db
      .prepare(
        'SELECT tag, protocol, port, transport, security, status FROM Inbound ORDER BY createdAt ASC, tag ASC',
      )
      .all() as Array<{ tag: string; protocol: string; port: number | bigint; transport: string; security: string; status: string }>
    return rows.map((r) => ({ ...r, port: Number(r.port) }))
  } catch (err) {
    logErrorThrottled('[core-sim/db] readInbounds failed (keeping last state):', err)
    return null
  }
}
