import fs from 'node:fs'
import path from 'node:path'
import lock from '../../../tools.lock.json'
import { installTool, latestVersion } from '../../../scripts/lib/install-tool.mjs'
import { paths } from './paths'
import { execCapture } from './exec'
import { deleteSetting, getSetting, setSetting } from './db'
import { compareVersions } from '../tool-versions'
import type { HashSource, ToolInfo, ToolName } from '../types'

export type { ToolInfo, ToolName } from '../types'

const VERSION_RE = /^\d+\.\d+\.\d+$/

/**
 * Each CLI has an active version: the pinned one (tools.lock.json) unless the
 * user switched to another installed version. A version that is not on disk
 * is installed on demand, by the first run that needs it or from the versions
 * dialog; one install job per tool@version, shared by everyone waiting on it.
 */

interface Job {
  name: ToolName
  version: string
  lines: string[]
  listeners: Set<(line: string) => void>
  /** Make the version active when the install succeeds (before the hooks run). */
  activate: boolean
  promise: Promise<void>
}

type Installed = (name: ToolName, version: string) => void
type G = typeof globalThis & {
  __trustablInstallJobs?: Map<string, Job>
  __trustablLastInstall?: Map<ToolName, NonNullable<ToolInfo['lastInstall']>>
  __trustablInstalledHooks?: Map<string, Installed>
  __trustablVersionCache?: Map<string, { reported?: string; error?: string }>
}
const g = globalThis as G
const jobs = (g.__trustablInstallJobs ??= new Map())
const lastInstalls = (g.__trustablLastInstall ??= new Map())
const installedHooks = (g.__trustablInstalledHooks ??= new Map())
const versionCache = (g.__trustablVersionCache ??= new Map())

let installImpl: typeof installTool = installTool
let latestImpl: (repo: string) => Promise<string> = (repo) => latestVersion(repo)

/** Test hooks: replace the installer / the latest-release lookup (null restores). */
export function __setInstallToolForTests(fn: typeof installTool | null): void {
  installImpl = fn ?? installTool
}
export function __setLatestVersionForTests(fn: ((repo: string) => Promise<string>) | null): void {
  latestImpl = fn ?? ((repo) => latestVersion(repo))
}

function httpError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

function overrideVar(name: ToolName): 'TRUSTABL_BIN' | 'AUTOFIX_BIN' {
  return name === 'trustabl' ? 'TRUSTABL_BIN' : 'AUTOFIX_BIN'
}

function override(name: ToolName): string | undefined {
  const v = process.env[overrideVar(name)]
  return v ? path.resolve(v) : undefined
}

/** A route's `<name>` segment, or a 404. */
export function toolNameParam(value: string): ToolName {
  if (value === 'trustabl' || value === 'autofix') return value
  throw httpError('Unknown tool', 404)
}

export function pinnedVersion(name: ToolName): string {
  return lock.tools[name].version
}

export function activeVersion(name: ToolName): string {
  const v = getSetting<string>(`tool.${name}.active`)
  return v && VERSION_RE.test(v) ? v : pinnedVersion(name)
}

/** Any installed version, or the pinned one (installed on the next run).
 *  Choosing the pinned version clears the setting, so a later pin bump is
 *  followed instead of staying on today's number. */
export function setActiveVersion(name: ToolName, version: string): void {
  if (version === pinnedVersion(name)) {
    deleteSetting(`tool.${name}.active`)
    return
  }
  if (!installedVersions(name).some((v) => v.version === version)) {
    throw httpError(`${name} ${version} is not installed.`, 400)
  }
  setSetting(`tool.${name}.active`, version)
}

/** Absolute path of a version's binary (the active one by default).
 *  TRUSTABL_BIN / AUTOFIX_BIN override it for development only; the dashboard
 *  flags a version mismatch either way. */
export function binaryPath(name: ToolName, version: string = activeVersion(name)): string {
  return override(name) ?? path.join(paths.bin(), `${name}-${version}`, lock.tools[name].binary)
}

function readHashSource(dir: string): HashSource | null {
  let text: string
  try {
    text = fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, 'SHA256'), 'utf8')
  } catch {
    return null
  }
  const fields = text.trim().split(/\s+/)
  if (fields[2] === 'lock' || fields[2] === 'upstream') return fields[2]
  // Written by fetch-tools.mjs before hash sources existed: pinned versions only.
  return fields.length === 2 ? 'lock' : null
}

export function installedVersions(name: ToolName): ToolInfo['installedVersions'] {
  let entries: string[]
  try {
    entries = fs.readdirSync(/*turbopackIgnore: true*/ paths.bin())
  } catch {
    return []
  }
  const prefix = `${name}-`
  return entries
    .filter((e) => e.startsWith(prefix) && VERSION_RE.test(e.slice(prefix.length)))
    .map((e) => ({ dir: path.join(paths.bin(), e), version: e.slice(prefix.length) }))
    .filter(({ dir }) => fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, lock.tools[name].binary)))
    .sort((a, b) => compareVersions(b.version, a.version))
    .map(({ dir, version }) => ({ version, hashSource: readHashSource(dir) }))
}

export function latestKnown(name: ToolName): ToolInfo['latest'] {
  return getSetting<NonNullable<ToolInfo['latest']>>(`tool.${name}.latest`)
}

/** Looks up the latest release on GitHub. Only ever called on request. */
export async function checkLatest(name: ToolName): Promise<NonNullable<ToolInfo['latest']>> {
  let version: string
  try {
    version = await latestImpl(lock.tools[name].repo)
  } catch (e) {
    const err = e as Error
    if (err.name === 'InstallError') throw httpError(err.message, 502)
    throw httpError(`Could not reach github.com: ${err.message}`, 502)
  }
  const latest = { version, checkedAt: Date.now() }
  setSetting(`tool.${name}.latest`, latest)
  return latest
}

/** Called after every successful install (named so a dev reload replaces it). */
export function onToolInstalled(key: string, cb: Installed): void {
  installedHooks.set(key, cb)
}

export function installJobs(name: ToolName): ToolInfo['installing'] {
  return [...jobs.values()].filter((j) => j.name === name).map((j) => ({ version: j.version, lines: [...j.lines] }))
}

/** Resolves once `name@version` is on disk, installing it if needed. A caller
 *  that arrives while the same install runs joins it and gets its lines.
 *  `activate` makes the version active once installed (the versions dialog). */
export function ensureInstalled(name: ToolName, version: string, onProgress?: (line: string) => void, { activate = false } = {}): Promise<void> {
  const ov = override(name)
  if (ov) {
    if (fs.existsSync(/*turbopackIgnore: true*/ ov)) return Promise.resolve()
    return Promise.reject(httpError(`${overrideVar(name)} points to ${ov}, which does not exist.`, 400))
  }
  if (!VERSION_RE.test(version)) return Promise.reject(httpError(`"${version}" is not a plain X.Y.Z version.`, 400))
  if (fs.existsSync(/*turbopackIgnore: true*/ binaryPath(name, version))) {
    if (activate) setActiveVersion(name, version)
    return Promise.resolve()
  }

  const key = `${name}@${version}`
  const running = jobs.get(key)
  if (running) {
    if (activate) running.activate = true
    if (onProgress) {
      running.lines.forEach(onProgress)
      running.listeners.add(onProgress)
    }
    return running.promise
  }

  const job: Job = { name, version, lines: [], listeners: new Set(onProgress ? [onProgress] : []), activate, promise: Promise.resolve() }
  jobs.set(key, job)
  const progress = (line: string) => {
    job.lines.push(line)
    for (const l of job.listeners) l(line)
  }
  job.promise = (async () => {
    try {
      await installImpl({
        name,
        entry: lock.tools[name],
        version,
        home: paths.home(),
        hashSource: version === pinnedVersion(name) ? 'lock' : 'upstream',
        onProgress: progress,
      })
      lastInstalls.set(name, { version, ok: true, finishedAt: Date.now() })
      if (job.activate) setActiveVersion(name, version)
    } catch (e) {
      lastInstalls.set(name, { version, ok: false, error: (e as Error).message, finishedAt: Date.now() })
      throw e
    } finally {
      jobs.delete(key)
    }
    for (const cb of installedHooks.values()) {
      try { cb(name, version) } catch { /* hooks never fail an install */ }
    }
  })()
  return job.promise
}

/** Temp folders left by an install the server did not finish (a restart). */
export function cleanupInstallTemp(): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(/*turbopackIgnore: true*/ paths.bin())
  } catch {
    return
  }
  for (const e of entries) {
    if (e.startsWith('.tmp-')) fs.rmSync(/*turbopackIgnore: true*/ path.join(paths.bin(), e), { recursive: true, force: true })
  }
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

/** What a binary says its version is (`<bin> version`), cached per path. */
export async function reportedVersion(name: ToolName, bin: string, { fresh = false } = {}): Promise<{ reported?: string; error?: string }> {
  let ver = versionCache.get(bin)
  if (!ver || fresh) {
    const res = await execCapture(bin, ['version'], { timeoutMs: 15_000 })
    ver = res.code === 0
      ? { reported: parseReportedVersion(name, res.stdout) }
      : { error: (res.stderr || res.stdout).trim().slice(0, 500) || `exit ${res.code}` }
    versionCache.set(bin, ver)
  }
  return ver
}

export async function toolInfo(name: ToolName, { fresh = false } = {}): Promise<ToolInfo> {
  const p = binaryPath(name)
  const base = {
    name,
    pinned: pinnedVersion(name),
    active: activeVersion(name),
    path: p,
    override: !!override(name),
    installedVersions: installedVersions(name),
    latest: latestKnown(name),
    installing: installJobs(name),
    lastInstall: lastInstalls.get(name),
  }
  // A missing binary is not an error any more: the next run installs it.
  if (!fs.existsSync(/*turbopackIgnore: true*/ p)) return { ...base, installed: false }
  return { ...base, installed: true, ...(await reportedVersion(name, p, { fresh })) }
}
