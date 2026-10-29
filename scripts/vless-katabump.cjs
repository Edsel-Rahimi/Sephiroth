/**
 * Sephiroth — KataBump remote provisioning (Task 16)
 * Talks to a LIVE Sephiroth panel deployment with its own API:
 *  1. login (admin) → cookie
 *  2. wipe every demo object (inbounds, users, groups, hosts, nodes,
 *     outbounds, routing rules, resellers, templates, activity)
 *  3. create the production VLESS inbound + owner user
 *
 * All server identity + credentials come from the environment (no hardcoded
 * host/IP/user/password — this file is public):
 *   KATA_BASE       panel base URL, e.g. http://YOUR_SERVER_IP:20364 (required)
 *   KATA_LISTEN     listen IP for the VLESS inbound (required; the server's
 *                   public IPv4 — use 0.0.0.0 only if you know what you're doing)
 *   KATA_USER       proxy client username to create/link (required)
 *   KATA_ADMIN_USER panel admin username (default: admin)
 *   KATA_ADMIN_PASS panel admin password (required)
 * Usage:
 *   KATA_BASE=http://<host>:<port> KATA_LISTEN=<public-ip> \
 *   KATA_USER=<proxy-user> KATA_ADMIN_PASS=<admin-password> \
 *   node scripts/vless-katabump.cjs
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
const INBOUND = {
  tag: 'vless-main',
  protocol: 'vless',
  port: Number(process.env.KATA_PORT || 20364),
  listen: LISTEN,
  transport: 'ws',
  security: 'none',
  status: 'online',
  note: 'Sephiroth production edge · VLESS over WebSocket at /vlessws',
  trafficLimitGb: null,
  expiryDays: null,
  sniffingJson: JSON.stringify({ enabled: true, destOverride: ['http', 'tls'], routeOnly: false }),
  streamJson: JSON.stringify({ path: '/vlessws' }),
  clientsJson: '[]',
}
let cookie = ''

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  for (const c of setCookie) {
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

async function listIds(key, path) {
  const r = await api('GET', path)
  const rows = r.json?.[key] ?? []
  return rows.map((row) => row.id).filter(Boolean)
}

async function wipeList(label, key, path) {
  const ids = await listIds(key, path)
  for (const id of ids) {
    const r = await api('DELETE', `${path}/${id}`)
    if (r.status >= 300) console.log(`  ✗ ${label} ${id} → ${r.status}`)
  }
  console.log(`wipe ${label}: -${ids.length}`)
}

async function main() {
  /* ---------- 1 · login ---------- */
  const login = await api('POST', '/api/auth/login', {
    username: ADMIN_USER,
    password: ADMIN_PASS,
  })
  if (login.status !== 200 || !cookie) {
    console.error('login failed', login.status, login.text.slice(0, 200))
    process.exit(1)
  }
  console.log('login ok')

  /* ---------- 2 · wipe demo data ---------- */
  await wipeList('hosts', 'hosts', '/api/hosts')
  await wipeList('nodes', 'nodes', '/api/nodes')
  await wipeList('sub-groups', 'groups', '/api/sub/groups')
  await wipeList('users', 'users', '/api/users')
  await wipeList('inbounds', 'inbounds', '/api/inbounds')
  await wipeList('outbounds', 'outbounds', '/api/outbounds')
  await wipeList('resellers', 'resellers', '/api/resellers')
  await wipeList('sale-templates', 'templates', '/api/sale-templates')

  const routing = await api('PUT', '/api/routing', { rules: [] })
  console.log('wipe routing rules:', routing.status)

  const activity = await api('DELETE', '/api/activity')
  console.log('wipe activity:', activity.status)

  /* ---------- 3 · production VLESS inbound ---------- */
  const inb = await api('POST', '/api/inbounds', INBOUND)
  if (inb.status === 409) {
    console.log('inbound already exists — continuing')
  } else if (inb.status !== 201) {
    console.error('inbound create failed', inb.status, inb.text.slice(0, 300))
    process.exit(1)
  } else {
    console.log('inbound created: vless-main @20364')
  }
  const inbounds = await api('GET', '/api/inbounds')
  const main = (inbounds.json?.inbounds ?? []).find((i) => i.tag === 'vless-main')
  if (!main) {
    console.error('vless-main missing after create')
    process.exit(1)
  }

  /* ---------- 4 · owner user ---------- */
  const users = await api('GET', '/api/users')
  const owner = (users.json?.users ?? []).find((u) => u.username === USERNAME)
  if (!owner) {
    const usr = await api('POST', '/api/users', {
      username: USERNAME,
      note: 'Sephiroth creator — first live client',
      enabled: true,
      trafficLimitGb: null,
      expiryDays: null,
      ipLimit: 0,
      inboundIds: [main.id],
    })
    if (usr.status !== 201) {
      console.error('user create failed', usr.status, usr.text.slice(0, 300))
      process.exit(1)
    }
    console.log('user created + linked')
  } else if (!owner.accesses?.some((a) => a.inbound?.tag === 'vless-main')) {
    const patch = await api('PATCH', `/api/users/${owner.id}`, {
      inboundIds: [main.id],
    })
    console.log('user linked to inbound:', patch.status)
  } else {
    console.log('user already linked')
  }
  console.log('user ready:', USERNAME)

  /* ---------- 5 · summary ---------- */
  const fin = await api('GET', '/api/sub/groups')
  const fresh = await api('GET', '/api/users')
  const me = (fresh.json?.users ?? []).find((u) => u.username === USERNAME)
  const counts = {
    inbounds: (await api('GET', '/api/inbounds')).json?.inbounds?.length,
    users: (fresh.json?.users ?? []).length,
    groups: (fin.json?.groups ?? []).length,
  }
  console.log('FINAL COUNTS', JSON.stringify(counts))
  console.log('SUB_TOKEN=' + me.subId)
  const raw = await api('GET', `/api/sub/${me.subId}?format=raw`)
  console.log('RAW SUB →', raw.text.trim())
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
