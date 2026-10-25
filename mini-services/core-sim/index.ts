/**
 * Sephiroth core-sim — socket.io mini-service.
 *
 * Streams simulated Xray-core telemetry to the panel:
 *   core:init      CoreSnapshot        (once per connection)
 *   core:tick      CoreTick            (every 1s)
 *   core:event     { event }           (weighted generator, ~every 2.8-7.5s)
 *   core:inbounds  { inbounds, ... }   (every 10s + on SQLite config diff)
 *
 * Hard-coded port 3003, socket.io path "/" — the Caddy gateway routes
 * `?XTransformPort=3003` here. DO NOT change the path.
 */
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { CoreSim } from './sim'
import { getTickMs, refreshTickMs } from './db'
import type { ActivityEvent } from './types'

const PORT = 3003

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

const sim = new CoreSim()

function safeInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
  return setInterval(() => {
    try {
      fn()
    } catch (err) {
      console.error('[core-sim] interval error:', err)
    }
  }, ms)
}

function emitEvent(event: ActivityEvent): void {
  io.emit('core:event', { event })
  console.log(`[core-sim] event ${event.kind} (${event.level}) ${JSON.stringify(event.params)}`)
}

io.on('connection', (socket) => {
  console.log(`[core-sim] client connected: ${socket.id}`)
  socket.emit('core:init', sim.snapshot())
  socket.on('disconnect', (reason: unknown) => {
    console.log(`[core-sim] client disconnected: ${socket.id} (${String(reason)})`)
  })
  socket.on('error', (err: unknown) => {
    console.error(`[core-sim] socket error (${socket.id}):`, err)
  })
})

// live telemetry — panel-configurable tick (1-5s via ServerSetting,
// re-read every loop; ticks emit the same shape regardless of cadence)
function tickLoop(): void {
  refreshTickMs()
  try {
    io.emit('core:tick', sim.tick())
  } catch (err) {
    console.error('[core-sim] tick error:', err)
  }
  setTimeout(tickLoop, getTickMs())
}
tickLoop()
safeInterval(() => {
  io.emit('core:inbounds', sim.inboundsPayload())
}, 10000)

// Phase 3 — mirror the SQLite Inbound table every 2s; emit only when the
// diff produced events (config created/updated/deleted or a status flip)
safeInterval(() => {
  const events = sim.mirrorDb()
  if (events.length > 0) {
    io.emit('core:inbounds', sim.inboundsPayload())
    for (const e of events) emitEvent(e)
  }
}, 2000)

// activity event generator — one weighted event every 2800-7500ms
function scheduleNextEvent(): void {
  setTimeout(() => {
    try {
      emitEvent(sim.nextEvent())
    } catch (err) {
      console.error('[core-sim] event generator error:', err)
    } finally {
      scheduleNextEvent()
    }
  }, 2800 + Math.random() * 4700)
}
scheduleNextEvent()

process.on('uncaughtException', (err) => {
  console.error('[core-sim] uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[core-sim] unhandled rejection:', reason)
})

process.on('SIGTERM', () => {
  console.log('[core-sim] received SIGTERM, shutting down...')
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  console.log('[core-sim] received SIGINT, shutting down...')
  httpServer.close(() => process.exit(0))
})

httpServer.listen(PORT, () => {
  console.log(`[core-sim] Xray simulator (socket.io) listening on port ${PORT}, path "/"`)
})
