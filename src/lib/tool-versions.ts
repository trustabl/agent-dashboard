import type { ToolInfo } from './types'

/** Compares plain X.Y.Z versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** "Install and use <latest>" is offered only when the checked latest release
 *  is newer than every installed version. */
export function canInstallLatest(info: ToolInfo): boolean {
  const latest = info.latest?.version
  if (!latest || info.override) return false
  return info.installedVersions.every((v) => compareVersions(latest, v.version) > 0)
}

/** Header banner text, or null. A missing CLI is not flagged (the next run
 *  installs it); a binary that reports another version than the active one is. */
export function toolBanner(tools: ToolInfo[]): string | null {
  const msgs = tools
    .filter((t) => t.installed && t.reported && t.reported !== t.active)
    .map((t) => `A CLI reports ${t.reported} but ${t.active} is active.`)
  return msgs.length ? msgs.join(' ') : null
}
