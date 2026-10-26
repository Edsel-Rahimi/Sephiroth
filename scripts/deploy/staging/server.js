/**
 * Sephiroth production bootstrap — KataBump deployment.
 *
 * One process on one port:
 *   • Next.js 16 (standalone build output, served programmatically)
 *   • socket.io telemetry endpoint (path /socket.io — same wire contract as
 *     the sandbox core-sim mini-service, so the client code is untouched)
 *   • Xray-core simulator engine (ported from mini-services/core-sim, with
 *     the bun:sqlite mirror replaced by Prisma polling)
 *
 * The Python egg runs `python /home/container/app.py`, app.py execs
 * the portable Node binary with this file.
 */
const path = require('path')
const fs = require('fs')
const { createServer } = require('http')

// ── environment ───────────────────────────────────────────────────────────
process.env.NODE_ENV = 'production'
process.env.NEXT_TELEMETRY_DISABLED = '1'
process.env.PORT = process.env.PORT || process.env.SERVER_PORT || '3000'
process.env.HOSTNAME = process.env.HOSTNAME || '0.0.0.0'
process.env.DATABASE_URL =
  process.env.DATABASE_URL || `file:${path.join(__dirname, 'db', 'custom.db')}`

// Standalone config injection — skips next's config loader (which would
// pull in webpack-lib, not traced into the standalone tree). Same trick as
// the generated .next/standalone/server.js.
try {
  const required = JSON.parse(
    fs.readFileSync(path.join(__dirname, '.next', 'required-server-files.json'), 'utf8'),
  )
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(required.config ?? {})
} catch (err) {
  console.error('[sephiroth] required-server-files.json missing — build output broken?', err)
  process.exit(1)
}

const next = require('next')

const PORT = Number(process.env.PORT)
const HOST = '0.0.0.0'

const log = (...a) => console.log('[sephiroth]', ...a)
const logErr = (...a) => console.error('[sephiroth]', ...a)

// ── realtime telemetry (core-sim port) ────────────────────────────────────
// realtime/sim.js is one bundled CJS file: CoreSim engine + the Prisma
// mirror (poll API). Everything comes from this single module.
const {
  CoreSim,
  pollInbounds,
  pollTickMs,
  getTickMs,
} = require('./realtime/sim.js')

const sim = new CoreSim()
const { Server } = require('socket.io')

// ── next app ──────────────────────────────────────────────────────────────
const app = next({ dev: false, dir: __dirname })
const handle = app.getRequestHandler()

app
  .prepare()
  .then(() => {
    const httpServer = createServer((req, res) => {
      handle(req, res).catch((err) => {
        logErr('request handler error:', err)
        res.statusCode = 500
        res.end('internal error')
      })
    })
    httpServer.keepAliveTimeout = 65000
    httpServer.headersTimeout = 66000

    const io = new Server(httpServer, {
      path: '/socket.io',
      cors: { origin: '*', methods: ['GET', 'POST'] },
      pingTimeout: 60000,
      pingInterval: 25000,
      // small heap on KataBump — keep buffers modest
      maxHttpBufferSize: 1e6,
    })

    io.on('connection', (socket) => {
      log('client connected:', socket.id)
      try {
        socket.emit('core:init', sim.snapshot())
      } catch (err) {
        logErr('snapshot emit failed:', err)
      }
      socket.on('disconnect', (reason) => log('client disconnected:', socket.id, String(reason)))
      socket.on('error', (err) => logErr('socket error:', socket.id, err))
    })

    // tick loop — cadence panel-configurable (ServerSetting, 1-5s)
    function tickLoop() {
      try {
        io.emit('core:tick', sim.tick())
      } catch (err) {
        logErr('tick error:', err)
      }
      setTimeout(tickLoop, getTickMs())
    }

    // inbound table broadcast every 10s
    const inboundsTimer = setInterval(() => {
      try {
        io.emit('core:inbounds', sim.inboundsPayload())
      } catch (err) {
        logErr('inbounds emit failed:', err)
      }
    }, 10000)

    // mirror the SQLite Inbound table every 2s (async poll → sync diff)
    const mirrorTimer = setInterval(() => {
      pollInbounds()
        .catch(() => undefined)
        .then(() => {
          try {
            const events = sim.mirrorDb()
            if (events.length > 0) {
              io.emit('core:inbounds', sim.inboundsPayload())
              for (const event of events) io.emit('core:event', { event })
            }
          } catch (err) {
            logErr('mirror diff failed:', err)
          }
        })
    }, 2000)

    // activity event generator — one weighted event every 2.8-7.5s
    function scheduleNextEvent() {
      setTimeout(() => {
        try {
          io.emit('core:event', { event: sim.nextEvent() })
        } catch (err) {
          logErr('event generator error:', err)
        } finally {
          scheduleNextEvent()
        }
      }, 2800 + Math.random() * 4700)
    }

    // tick seconds mirror (every 3s)
    const tickCfgTimer = setInterval(() => {
      pollTickMs().catch(() => undefined)
    }, 3000)

    pollTickMs()
      .catch(() => undefined)
      .then(() => {
        tickLoop()
        scheduleNextEvent()
      })

    httpServer.listen(PORT, HOST, () => {
      log(`Sephiroth panel listening on http://${HOST}:${PORT}`)
      log(`socket.io path /socket.io · db ${process.env.DATABASE_URL}`)
    })

    const shutdown = (sig) => {
      log(`received ${sig}, shutting down`)
      clearInterval(inboundsTimer)
      clearInterval(mirrorTimer)
      clearInterval(tickCfgTimer)
      io.close()
      httpServer.close(() => process.exit(0))
      setTimeout(() => process.exit(0), 4000).unref()
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  })
  .catch((err) => {
    logErr('next prepare failed:', err)
    process.exit(1)
  })

process.on('uncaughtException', (err) => logErr('uncaught exception:', err))
process.on('unhandledRejection', (reason) => logErr('unhandled rejection:', reason))
