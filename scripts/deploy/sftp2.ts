/**
 * One-off SFTP probe/download for Task 16 (reuses .seph-deploy.json).
 * Usage: bun scripts/deploy/sftp2.ts <ls|exists|download|rmlocal> args...
 *   ls <remoteDir>
 *   exists <remotePath>
 *   download <remotePath> <localPath>
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Client } from 'ssh2'

const cfg = JSON.parse(
  readFileSync(process.env.SEPH_DEPLOY_CFG ?? '/home/z/.seph-deploy.json', 'utf8'),
)
const [, , cmd, ...args] = process.argv

const conn = new Client()
conn
  .on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) {
        console.error('sftp failed', err)
        process.exit(1)
      }
      if (cmd === 'ls') {
        sftp.readdir(args[0] ?? '/', (e, list) => {
          if (e) { console.error('ls failed', e.message); process.exit(1) }
          for (const f of list) console.log(`${f.attrs.size ?? '?'}\t${f.filename}`)
          conn.end()
        })
      } else if (cmd === 'exists') {
        sftp.stat(args[0], (e) => {
          console.log(e ? 'NO' : 'YES')
          conn.end()
        })
      } else if (cmd === 'download') {
        const [remote, local] = args
        mkdirSync(dirname(resolve(local)), { recursive: true })
        sftp.fastGet(remote, resolve(local), (e) => {
          if (e) { console.error('download failed', e.message); process.exit(1) }
          console.log(`downloaded ${remote} → ${local} (${existsSync(local) ? 'ok' : 'missing'})`)
          conn.end()
        })
      } else {
        console.error('unknown command', cmd)
        process.exit(1)
      }
    })
  })
  .on('error', (e) => {
    console.error('ssh failed', e.message)
    process.exit(1)
  })
  .connect({
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password: cfg.password,
    readyTimeout: 20000,
  })
