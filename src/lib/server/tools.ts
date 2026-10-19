import fs from 'node:fs'
import path from 'node:path'
import lock from '../../../tools.lock.json'
import { paths } from './paths'
import { execCapture } from './exec'

export type ToolName = 'trustabl' | 'autofix'

export interface ToolInfo {
  name: ToolName
  pinned: string
  path: string
  installed: boolean
  /** Version the binary reports (`trustabl version` / `autofix version`). */
  reported?: string
  error?: string
}

export function pinnedVersion(name: ToolName): string {
  return lock.tools[name].version
}

/** Absolute path of the pinned binary. TRUSTABL_BIN / AUTOFIX_BIN override it
 *  for development only; the Console flags a version mismatch either way. */
export function binaryPath(name: ToolName): string {
  const override = name === 'trustabl' ? process.env.TRUSTABL_BIN : process.env.AUTOFIX_BIN
  if (override) return path.resolve(override)
  const tool = lock.tools[name]
  return path.join(paths.bin(), `${name}-${tool.version}`, tool.binary)
}

export function parseReportedVersion(name: ToolName, stdout: string): string | undefined {
  if (name === 'trustabl') {
    const m = stdout.match(/Trustabl\s+v?(\d+\.\d+\.\d+[\w.-]*)/)
    return m?.[1]
  }
  // autofix prints a banner, then the bare version on its own line.
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.reverse().find((l) => /^\d+\.\d+\.\d+[\w.-]*$/.test(l))
}

const versionCache = new Map<string, ToolInfo>()

export async function toolInfo(name: ToolName, { fresh = false } = {}): Promise<ToolInfo> {
  const p = binaryPath(name)
  const cacheKey = `${name}:${p}`
  if (!fresh && versionCache.has(cacheKey)) return versionCache.get(cacheKey)!
  const info: ToolInfo = { name, pinned: pinnedVersion(name), path: p, installed: fs.existsSync(/*turbopackIgnore: true*/ p) }
  if (info.installed) {
    const res = await execCapture(p, ['version'], { timeoutMs: 15_000 })
    if (res.code === 0) info.reported = parseReportedVersion(name, res.stdout)
    else info.error = (res.stderr || res.stdout).trim().slice(0, 500) || `exit ${res.code}`
  } else {
    info.error = `Not installed. Run "make tools" (or "node scripts/fetch-tools.mjs").`
  }
  versionCache.set(cacheKey, info)
  return info
}

export async function requireTool(name: ToolName): Promise<ToolInfo> {
  const info = await toolInfo(name)
  if (!info.installed) throw new Error(`${name} ${info.pinned} is not installed. ${info.error ?? ''}`.trim())
  return info
}
