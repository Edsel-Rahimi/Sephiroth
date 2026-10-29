/**
 * Sephiroth — one-shot provisioning (Task 16, legacy Prisma/SQLite era)
 * 1. Wipe ALL demo data (inbounds/users/groups/hosts/nodes/outbounds/
 *    routing/resellers/templates/activity) — AdminUser + ServerSetting stay,
 *    the inbound seed flag stays "1" so demo never re-seeds.
 * 2. Create the single production VLESS inbound + owner user + access.
 *
 * Server identity + the proxy username come from the environment (no
 * hardcoded IP/user — this file is public):
 *   VLESS_LISTEN    listen IP for the VLESS inbound (required)
 *   VLESS_USERNAME  proxy client username to create (required)
 *
 * Idempotent: upserts by tag/username. Run with:
 *   DATABASE_URL="file:<path-to-sqlite-db>" VLESS_LISTEN=<public-ip> \
 *   VLESS_USERNAME=<proxy-user> node scripts/vless-provision.cjs
 */
const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const db = new PrismaClient()

function requireEnv(name) {
  const v = process.env[name]
  if (!v || !v.trim()) {
    console.error(`${name} required`)
    process.exit(1)
  }
  return v.trim()
}

const INBOUND = {
  tag: 'vless-main',
  protocol: 'vless',
  port: Number(process.env.VLESS_PORT || 20364),
  listen: requireEnv('VLESS_LISTEN'),
  transport: 'ws',
  security: 'none',
  status: 'online',
  note: 'Sephiroth production edge · VLESS over WebSocket at /vlessws',
  trafficLimitGb: null,
  expiryDays: null,
  sniffingJson: JSON.stringify({ enabled: true, destOverride: ['http', 'tls'], routeOnly: false }),
  streamJson: JSON.stringify({ path: '/vlessws' }),
}

const USERNAME = requireEnv('VLESS_USERNAME')

async function main() {
  /* ---------- 1 · wipe demo data (FK-safe order) ---------- */
  const wipe = [
    ['hosts', () => db.host.deleteMany({})],
    ['nodes', () => db.node.deleteMany({})],
    ['subGroupMembers', () => db.subGroupMember.deleteMany({})],
    ['subGroups', () => db.subGroup.deleteMany({})],
    ['userInboundAccess', () => db.userInboundAccess.deleteMany({})],
    ['clientUsers', () => db.clientUser.deleteMany({})],
    ['inbounds', () => db.inbound.deleteMany({})],
    ['outbounds', () => db.outbound.deleteMany({})],
    ['routingRules', () => db.routingRule.deleteMany({})],
    ['resellers', () => db.reseller.deleteMany({})],
    ['saleTemplates', () => db.saleTemplate.deleteMany({})],
    ['activityLogs', () => db.activityLog.deleteMany({})],
  ]
  for (const [name, run] of wipe) {
    const r = await run()
    console.log(`wipe ${name}: -${r.count}`)
  }

  /* ---------- 2 · production VLESS inbound ---------- */
  await db.inbound.upsert({
    where: { tag: INBOUND.tag },
    update: { ...INBOUND },
    create: { ...INBOUND, clientsJson: '[]' },
  })
  const inbound = await db.inbound.findUnique({ where: { tag: INBOUND.tag } })
  console.log('inbound ready:', inbound.tag, inbound.port)

  /* ---------- 3 · owner user + access ---------- */
  const uuid = crypto.randomUUID()
  const email = `${USERNAME}@${INBOUND.tag}`
  await db.clientUser.upsert({
    where: { username: USERNAME },
    update: {},
    create: {
      username: USERNAME,
      subId: crypto.randomBytes(8).toString('hex'),
      note: 'Sephiroth creator — first live client',
      enabled: true,
    },
  })
  const user = await db.clientUser.findUnique({
    where: { username: USERNAME },
    include: { accesses: true },
  })

  let access = user.accesses.find((a) => a.inboundId === inbound.id)
  if (!access) {
    access = await db.userInboundAccess.create({
      data: { userId: user.id, inboundId: inbound.id, email, key: uuid, flow: '' },
    })
  }

  /* project access into the inbound's clientsJson (same shape the API writes) */
  const clients = [
    {
      email: access.email,
      key: access.key,
      subId: user.subId,
      flow: access.flow,
      ipLimit: user.ipLimit,
      trafficLimitGb: user.trafficLimitGb,
      expiryDays: user.expiryDays,
      enabled: user.enabled,
      ownerId: user.id,
    },
  ]
  await db.inbound.update({
    where: { id: inbound.id },
    data: { clientsJson: JSON.stringify(clients) },
  })

  /* ---------- 4 · summary ---------- */
  const counts = {
    inbounds: await db.inbound.count(),
    users: await db.clientUser.count(),
    accesses: await db.userInboundAccess.count(),
    groups: await db.subGroup.count(),
    hosts: await db.host.count(),
    nodes: await db.node.count(),
    outbounds: await db.outbound.count(),
    rules: await db.routingRule.count(),
    resellers: await db.reseller.count(),
    templates: await db.saleTemplate.count(),
    logs: await db.activityLog.count(),
    admins: await db.adminUser.count(),
  }
  console.log('FINAL COUNTS', JSON.stringify(counts))
  console.log('SUB_TOKEN=' + user.subId)
  console.log('UUID=' + access.key)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
