import path from 'node:path'
import { execCapture } from './exec'

/** HEAD commit of the repo at `dir`, or undefined when it is not a git repo
 *  (an agent that is not built yet often is not). */
export async function headSha(dir: string): Promise<string | undefined> {
  const res = await execCapture('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeoutMs: 10_000 })
  const sha = res.stdout.trim()
  return res.code === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined
}

/** True when the working tree has uncommitted changes. */
export async function isDirty(dir: string): Promise<boolean | undefined> {
  const res = await execCapture('git', ['-C', dir, 'status', '--porcelain'], { timeoutMs: 10_000 })
  if (res.code !== 0) return undefined
  return res.stdout.trim().length > 0
}

/** "owner/name" from the origin remote, if there is one. */
export async function originName(dir: string): Promise<string | undefined> {
  const res = await execCapture('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeoutMs: 10_000 })
  if (res.code !== 0) return undefined
  return parseRemoteName(res.stdout.trim())
}

export function parseRemoteName(url: string): string | undefined {
  // git@github.com:owner/name.git | https://host/owner/name(.git) | ssh://git@host/owner/name
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (!m) return undefined
  return `${m[1]}/${m[2]}`
}

export function folderName(dir: string): string {
  return path.basename(path.resolve(dir))
}
