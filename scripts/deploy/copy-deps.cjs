/**
 * Copy a package and its whole production dependency tree from one
 * node_modules to another (standalone bundles miss packages that only
 * server.js requires — like socket.io).
 *
 * Usage: node copy-deps.cjs <srcNodeModules> <dstNodeModules> <rootPkg...>
 */
const fs = require('node:fs')
const path = require('node:path')

const [srcNM, dstNM, ...roots] = process.argv.slice(2)
if (!srcNM || !dstNM || roots.length === 0) {
  console.error('usage: copy-deps.cjs <srcNM> <dstNM> <rootPkg...>')
  process.exit(1)
}

const seen = new Set()
const copied = []
let totalBytes = 0

function readPkg(dir) {
  const p = path.join(dir, 'package.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function copyDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.cpSync(from, to, { recursive: true, force: true })
}

function walk(name) {
  if (seen.has(name)) return
  seen.add(name)
  // scoped packages: resolve <scope>/<pkg> dir
  const dir = path.join(srcNM, name)
  const pkg = readPkg(dir)
  if (!pkg) {
    console.warn('  ! missing (skipped):', name)
    return
  }

  copyDir(dir, path.join(dstNM, name))
  const size = dirSize(dir)
  totalBytes += size
  copied.push(`${name} (${fmt(size)})`)

  const deps = { ...(pkg.dependencies ?? {}) }
  for (const dep of Object.keys(deps)) {
    if (deps[dep] && (deps[dep].startsWith('npm:') || deps[dep].includes('://'))) {
      console.warn('  ! non-registry dep skipped:', dep, deps[dep])
      continue
    }
    walk(dep)
  }
}

function dirSize(dir) {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) n += dirSize(p)
    else n += fs.statSync(p).size
  }
  return n
}

function fmt(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${n}B`
}

for (const root of roots) walk(root)
console.log(`copied ${copied.length} packages, ${fmt(totalBytes)}:`)
console.log(copied.map((c) => '  • ' + c).join('\n'))
