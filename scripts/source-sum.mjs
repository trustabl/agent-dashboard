// Hash of everything that goes into `next build`, so run.sh rebuilds only when it changed.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const roots = ['src', 'package-lock.json', 'next.config.ts', 'tailwind.config.mts', 'postcss.config.mjs', 'tools.lock.json', 'tsconfig.json']
const h = createHash('sha256')
function walk(p) {
  if (!fs.existsSync(p)) return
  const st = fs.statSync(p)
  if (st.isDirectory()) for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e))
  else h.update(p).update(fs.readFileSync(p))
}
roots.forEach(walk)
process.stdout.write(h.digest('hex'))
