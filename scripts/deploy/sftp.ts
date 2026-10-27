/**
 * Sephiroth → KataBump SFTP tool.
 *
 * Reads connection settings from SEPH_DEPLOY_CFG (default /home/z/.seph-deploy.json).
 * Usage: bun scripts/deploy/sftp.ts <command> [args]
 *   ls [remoteDir]                 list a directory
 *   tree <remoteDir> [depth]       shallow tree
 *   rm <remotePath>                recursive delete (file or dir)
 *   upload <localPath> <remote>    single file upload with progress
 */
import { createReadStream, statSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { Client } from 'ssh2'

interface DeployCfg {
  host: string
  port: number
  username: string
  password: string
  remoteRoot: string
}

const cfg: DeployCfg = JSON.parse(
  readFileSync(process.env.SEPH_DEPLOY_CFG ?? '/home/z/.seph-deploy.json', 'utf8'),
)

const [, , cmd, ...args] = process.argv

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${n}B`
}

const conn = new Client()
const die = (msg: string, err: unknown): never => {
  console.error(`✗ ${msg}`, err instanceof Error ? err.message : err)
  process.exit(1)
}

conn
  .on('ready', () => {
    conn.sftp((sftpErr, sftp) => {
      if (sftpErr) return die('SFTP session failed', sftpErr)

      // KataBump SFTP jails us inside the container — the jail root IS '/'.
      const norm = (p: string): string => {
        const abs = p.startsWith('/') ? p : `/${p}`
        return abs.replace(/\/+$/, '') || '/'
      }

      // NOTE: the KataBump Go SFTP server reports broken attrs (isDirectory()
      // unreliable) and its rmdir is RECURSIVE (removes non-empty trees).
      // Strategy: try unlink; on failure fall back to (recursive) rmdir.
      const rmrf = (path: string): Promise<void> =>
        new Promise((res, rej) => {
          sftp.unlink(path, (ue) => {
            if (!ue) return res()
            sftp.rmdir(path, (de) => (de ? rej(de) : res()))
          })
        })

      const upload = (local: string, remote: string): Promise<void> =>
        new Promise((res, rej) => {
          const total = statSync(local).size
          const t0 = Date.now()
          const read = createReadStream(local)
          const write = sftp.createWriteStream(remote, { highWaterMark: 64 * 1024 * 1024 })
          write.on('error', rej)
          read.on('error', rej)
          let lastPct = -10
          read.on('data', (chunk: Buffer) => {
            const done = read.bytesRead
            const pct = Math.floor(((done / total) * 100) / 5) * 5
            if (pct > lastPct) {
              lastPct = pct
              const mbps = done / 1024 / 1024 / ((Date.now() - t0) / 1000 || 1)
              process.stdout.write(`  ${pct}%  ${fmtSize(done)}/${fmtSize(total)}  ${mbps.toFixed(1)}MB/s\r`)
            }
          })
          write.on('close', () => {
            const secs = (Date.now() - t0) / 1000
            console.log(`\n✓ uploaded ${basename(local)} → ${remote} in ${secs.toFixed(1)}s`)
            res()
          })
          read.pipe(write)
        })

      const run = async (): Promise<void> => {
        switch (cmd) {
          case 'ls': {
            const dir = norm(args[0] ?? '')
            const list = await new Promise<Array<{ filename: string; longname: string; attrs: { size: number; mode: number } }>>(
              (res, rej) => sftp.readdir(dir, (e, l) => (e ? rej(e) : res(l as never))),
            )
            console.log(`=== ${dir} (${list.length} entries) ===`)
            for (const f of list) {
              console.log(`${f.longname.slice(0, 1)}  ${fmtSize(f.attrs.size).padStart(9)}  ${f.filename}`)
            }
            break
          }
          case 'tree': {
            const dir = norm(args[0] ?? '')
            const maxDepth = Number(args[1] ?? 1)
            const walk = async (d: string, depth: number): Promise<void> => {
              const list = await new Promise<Array<{ filename: string; longname: string; attrs: { size: number; mode: number } }>>(
                (res, rej) => sftp.readdir(d, (e, l) => (e ? rej(e) : res(l as never))),
              )
              for (const f of list) {
                console.log(
                  `${'  '.repeat(depth)}${f.longname.slice(0, 1)} ${fmtSize(f.attrs.size).padStart(9)}  ${d}/${f.filename}`,
                )
                if (f.longname.startsWith('d') && depth < maxDepth) await walk(`${d}/${f.filename}`, depth + 1)
              }
            }
            await walk(dir, 0)
            break
          }
          case 'rm': {
            const target = norm(args[0] ?? '')
            if (target === '/' || target === cfg.remoteRoot) throw new Error('refusing to rm the container root')
            console.log(`removing ${target} ...`)
            await rmrf(target)
            console.log(`✓ removed ${target}`)
            break
          }
          case 'upload': {
            if (!args[0] || !args[1]) throw new Error('upload <local> <remote>')
            await upload(resolve(args[0]), norm(args[1]))
            break
          }
          default:
            throw new Error(`unknown command: ${cmd}`)
        }
        conn.end()
        process.exit(0)
      }

      run().catch((e) => {
        die(cmd ?? 'sftp', e)
      })
    })
  })
  .on('error', (err) => die('SSH connect', err))
  .connect({ host: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password, readyTimeout: 30000 })
