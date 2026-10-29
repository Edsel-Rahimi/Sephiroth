// verbose SSH/SFTP debug probe (run from /tmp/sftp-work where ssh2 lives)
// Connection settings come from the environment (no hardcoded credentials —
// this file is public):
//   KATA_SFTP_HOST  SFTP host (required)
//   KATA_SFTP_PORT  SFTP port (default: 2022)
//   KATA_SFTP_USER  SFTP username (required)
//   KATA_SFTP_PASS  SFTP password (required)
const { Client } = require('ssh2')
function requireEnv(name) {
  const v = process.env[name]
  if (!v || !v.trim()) {
    console.error(`${name} required`)
    process.exit(1)
  }
  return v.trim()
}
const cfg = {
  host: requireEnv('KATA_SFTP_HOST'),
  port: Number(process.env.KATA_SFTP_PORT || 2022),
  username: requireEnv('KATA_SFTP_USER'),
  password: requireEnv('KATA_SFTP_PASS'),
  readyTimeout: 30000,
  debug: (s) => process.env.VERBOSE && console.log('[ssh2]', s),
}
const conn = new Client()
conn
  .on('ready', () => {
    console.log('✓ SSH ready')
    conn.sftp((err, sftp) => {
      if (err) {
        console.error('sftp err:', JSON.stringify(err, null, 2))
        conn.end()
        return
      }
      console.log('✓ sftp channel ready')
      sftp.realpath('.', (e, abs) => {
        console.log('realpath . =', e ? `ERR ${e.message}` : abs)
        sftp.readdir('/', (e2, list) => {
          if (e2) {
            console.error('readdir err:', JSON.stringify(e2, null, 2))
            conn.end()
            return
          }
          console.log(`✓ / (jail root) (${list.length}):`)
          for (const f of list) console.log(`  ${f.longname.slice(0, 1)} ${String(f.size).padStart(10)} ${f.name}`)
          conn.end()
        })
      })
    })
  })
  .on('error', (err) => {
    console.error('✗ SSH error:', err.level ?? '', err.message, err.description ?? '')
    process.exit(1)
  })
  .on('banner', (b) => console.log('banner:', b))
  .connect(cfg)
