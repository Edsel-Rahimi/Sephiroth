/**
 * Sephiroth — KataBump fixer (Task 16b)
 *  · PATCH the vless-main inbound with stream.path=/vlessws (API form)
 *  · replace the auto-seeded demo node with the REAL edge node
 *    (non-empty table ⇒ ensureNetSeeds stays quiet, demo never returns)
 *
 * All server identity + credentials come from the environment (no hardcoded
 * host/IP/user/password — this file is public):
 *   KATA_BASE       panel base URL, e.g. http://YOUR_SERVER_IP:20364 (required)
 *   KATA_LISTEN     edge node address for the real node row (required)
 *   KATA_USER       proxy client username to look up (required)
 *   KATA_ADMIN_USER panel admin username (default: admin)
 *   KATA_ADMIN_PASS panel admin password (required)
 * Usage:
 *   KATA_BASE=http://<host>:<port> KATA_LISTEN=<public-ip> \
 *   KATA_USER=<proxy-user> KATA_ADMIN_PASS=<admin-password> \
 *   node scripts/vless-katabump-fix.cjs
 */
function requireEnv(name) {
  const v = process.env[name]
  if (!v || !v.trim()) {
    console.error(`${name} required`)
    process.exit(1)
  }
  return v.trim()
}
const BASE = requireEnv('KATA_BASE')
const LISTEN = requireEnv('KATA_LISTEN')
const USERNAME = requireEnv('KATA_USER')
const ADMIN_USER = (process.env.KATA_ADMIN_USER || 'admin').trim()
const ADMIN_PASS = requireEnv('KATA_ADMIN_PASS')

let cookie = ''
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const kv = c.split(';')[0]
    if (kv.startsWith('sephiroth_session=')) cookie = kv
  }
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text }
}

async function main() {
  const login = await api('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS })
  if (login.status !== 200 || !cookie) {
    console.error('login failed', login.status)
    process.exit(1)
  }
  console.log('login ok')

  /* inbound stream patch */
  const inbounds = await api('GET', '/api/inbounds')
  const main = (inbounds.json?.inbounds ?? []).find((i) => i.tag === 'vless-main')
  if (!main) {
    console.error('vless-main missing')
    process.exit(1)
  }
  const patch = await api('PATCH', `/api/inbounds/${main.id}`, {
    stream: { path: '/vlessws' },
    sniffing: { enabled: true, destOverride: ['http', 'tls'], routeOnly: false },
  })
  console.log('inbound patch:', patch.status)

  /* demo node → real node */
  const nodes = await api('GET', '/api/nodes')
  for (const n of nodes.json?.nodes ?? []) {
    const del = await api('DELETE', `/api/nodes/${n.id}`)
    console.log(`node ${n.name} delete →`, del.status)
  }
  const node = await api('POST', '/api/nodes', {
    name: (process.env.KATA_NODE_NAME || 'Edge').trim(),
    scheme: 'http',
    address: LISTEN,
    port: Number(process.env.KATA_PORT || 20364),
    basePath: '/',
    apiToken: '',
    enable: true,
    syncAll: true,
    tlsVerify: 'verify',
  })
  console.log('real node create →', node.status, node.text.slice(0, 160))

  /* final verification */
  const fresh = await api('GET', '/api/inbounds')
  const row = (fresh.json?.inbounds ?? []).find((i) => i.tag === 'vless-main')
  console.log('inbound now:', JSON.stringify({ tag: row.tag, port: row.port, stream: row.stream, sniffing: row.sniffing }))
  const users = await api('GET', '/api/users')
  const me = (users.json?.users ?? []).find((u) => u.username === USERNAME)
  console.log('SUB_TOKEN=' + me.subId)
  const raw = await api('GET', `/api/sub/${me.subId}?format=raw`)
  console.log('RAW SUB →', raw.text.trim())
  const nodesAfter = await api('GET', '/api/nodes')
  console.log('nodes now:', (nodesAfter.json?.nodes ?? []).map((n) => `${n.name}@${n.address}:${n.port}`).join(', '))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
