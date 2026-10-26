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
const net = require('net')
const dns = require('dns')
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
      // /vlessws upgrades are handled by our own listener below —
      // engine.io must never destroy unhandled upgrades (default true)
      destroyUpgrade: false,
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

    // ── VLESS over WebSocket (real proxy, path-multiplexed) ────────────
    // Same allocated port as the panel: WS upgrades at VLESS_PATH speak the
    // real VLESS protocol and TCP-proxy the target. Allow-list = every
    // enabled client key on a vless inbound (Prisma, 30s refresh).
    const VLESS_PATH = process.env.VLESS_PATH || '/vlessws'
    let vlessKeys = new Set()
    let vlessWss = null
    let sephPrisma = null
    try {
      const { WebSocketServer } = require('ws')
      vlessWss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 })
    } catch (err) {
      logErr('ws module unavailable — VLESS-over-WS disabled:', err.message)
    }
    try {
      const { PrismaClient } = require('@prisma/client')
      sephPrisma = new PrismaClient()
      async function refreshVlessKeys() {
        const rows = await sephPrisma.userInboundAccess.findMany({
          where: { inbound: { protocol: 'vless' }, user: { enabled: true } },
          select: { key: true },
        })
        vlessKeys = new Set(rows.map((r) => String(r.key).replace(/-/g, '').toLowerCase()))
      }
      refreshVlessKeys()
        .then(() => log(`vless allow-list loaded: ${vlessKeys.size} key(s)`))
        .catch((err) => logErr('vless allow-list load failed:', err.message))
      setInterval(() => refreshVlessKeys().catch(() => undefined), 30000).unref()
    } catch (err) {
      logErr('prisma unavailable — vless allow-list empty:', err.message)
    }

    function vlessFail(ws, why) {
      log('vless reject:', why)
      try { ws.close(1008, 'vless rejected') } catch {}
    }

    if (vlessWss) {
      vlessWss.on('connection', (ws) => {
        let buffered = Buffer.alloc(0)
        let headerDone = false
        let upstream = null
        const teardown = () => {
          if (upstream) upstream.destroy()
        }
        ws.on('message', (data, isBinary) => {
          if (upstream && upstream.destroyed) return
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data)
          if (headerDone) {
            if (upstream && upstream.writable) upstream.write(chunk)
            return
          }
          if (!isBinary) return vlessFail(ws, 'text frame')
          buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk
          if (buffered.length < 18) return // ver + uuid + addonsLen
          if (buffered[0] !== 0) return vlessFail(ws, 'bad version')
          const uuidHex = buffered.subarray(1, 17).toString('hex')
          if (vlessKeys.size === 0) return vlessFail(ws, 'allow-list empty')
          if (!vlessKeys.has(uuidHex)) return vlessFail(ws, 'unknown uuid')
          const addLen = buffered[17]
          const cmdOff = 18 + addLen
          if (buffered.length < cmdOff + 4) return
          const cmd = buffered[cmdOff]
          if (cmd !== 1) return vlessFail(ws, `unsupported command ${cmd}`)
          const port = buffered.readUInt16BE(cmdOff + 1)
          const atyp = buffered[cmdOff + 3]
          let addr
          let payloadAt
          if (atyp === 1) {
            if (buffered.length < cmdOff + 8) return
            addr = Array.from(buffered.subarray(cmdOff + 4, cmdOff + 8)).join('.')
            payloadAt = cmdOff + 8
          } else if (atyp === 2) {
            const len = buffered[cmdOff + 4]
            if (buffered.length < cmdOff + 5 + len) return
            addr = buffered.subarray(cmdOff + 5, cmdOff + 5 + len).toString('latin1')
            payloadAt = cmdOff + 5 + len
          } else if (atyp === 3) {
            if (buffered.length < cmdOff + 20) return
            const b = buffered.subarray(cmdOff + 4, cmdOff + 20)
            const parts = []
            for (let i = 0; i < 16; i += 2) parts.push(b.readUInt16BE(i).toString(16))
            addr = parts.join(':')
            payloadAt = cmdOff + 20
          } else {
            return vlessFail(ws, `bad address type ${atyp}`)
          }

          headerDone = true
          const firstPayload = buffered.subarray(payloadAt)
          buffered = null
          upstream = net.connect({ host: addr, port }, () => {
            log(`vless open ${addr}:${port}`)
            try { ws.send(Buffer.from([0, 0])) } catch {}
            if (firstPayload.length) upstream.write(firstPayload)
          })
          upstream.setNoDelay(true)
          upstream.setTimeout(300000, () => teardown())
          let resuming = false
          upstream.on('data', (buf) => {
            if (ws.readyState !== 1) return teardown()
            // gentle backpressure: pause TCP when the WS lags, resume on drain
            if (!resuming && ws.bufferedAmount > 2 * 1024 * 1024) {
              resuming = true
              upstream.pause()
              const t = setInterval(() => {
                if (ws.readyState !== 1) {
                  clearInterval(t)
                  return teardown()
                }
                if (ws.bufferedAmount < 512 * 1024) {
                  clearInterval(t)
                  resuming = false
                  if (upstream && upstream.writable) upstream.resume()
                }
              }, 50)
            }
            ws.send(buf)
          })
          upstream.on('error', (err) => {
            logErr(`vless upstream ${addr}:${port} error:`, err.message)
            try { ws.close(1011, 'upstream error') } catch {}
            teardown()
          })
          upstream.on('close', () => {
            try { ws.close() } catch {}
          })
        })
        ws.on('close', teardown)
        ws.on('error', teardown)
      })

      httpServer.on('upgrade', (req, socket, head) => {
        let pathname = ''
        try {
          pathname = new URL(req.url, 'http://localhost').pathname
        } catch {}
        if (pathname !== VLESS_PATH) return // socket.io / next own the rest
        vlessWss.handleUpgrade(req, socket, head, (ws) =>
          vlessWss.emit('connection', ws, req),
        )
      })
      log(`vless-over-ws armed at ${VLESS_PATH} (TCP command only)`)
    }

    // ── startup egress probe (visible in node.log) ───────────────────
    setTimeout(() => {
      const t0 = Date.now()
      const probe = net.connect({ host: '1.1.1.1', port: 443 }, () => {
        log(`egress probe: TCP 1.1.1.1:443 OK in ${Date.now() - t0}ms`)
        probe.destroy()
      })
      probe.setTimeout(6000, () => {
        logErr('egress probe: TCP 1.1.1.1:443 TIMEOUT')
        probe.destroy()
      })
      probe.on('error', (err) => logErr('egress probe: TCP failed:', err.message))
      dns.resolve4('cloudflare.com', (err, addrs) => {
        if (err) logErr('egress probe: DNS failed:', err.message)
        else log('egress probe: DNS OK →', (addrs || []).join(', '))
      })
    }, 2500)

    httpServer.listen(PORT, HOST, () => {
      log(`Sephiroth panel listening on http://${HOST}:${PORT}`)
      log(`socket.io path /socket.io · vless path ${VLESS_PATH} · db ${process.env.DATABASE_URL}`)
    })

    const shutdown = (sig) => {
      log(`received ${sig}, shutting down`)
      clearInterval(inboundsTimer)
      clearInterval(mirrorTimer)
      clearInterval(tickCfgTimer)
      if (sephPrisma) sephPrisma.$disconnect().catch(() => undefined)
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
