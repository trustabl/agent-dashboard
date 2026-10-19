import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { db } from './db'
import { paths, ensureDir } from './paths'
import { headSha } from './git'
import { toolInfo, type ToolName } from './tools'
import type { RepoRow } from './repos'
import { formatCommand, type CommandSpec } from '../shell'
import { stripAnsi, tailLines } from '../text'
import type { RunRow, RunStatus, ConsoleTool } from '../types'

/**
 * Runs every CLI as a detached subprocess owned by the server, never by the
 * browser: closing the tab does not touch it, and any tab can re-attach to
 * its log through /api/runs/<id>/stream.
 */

export interface StartRunInput {
  tool: ConsoleTool
  action: string
  repo: RepoRow | null
  toolName: ToolName
  options: Record<string, unknown>
  /** Builds the command once the run dir exists (so it can write class.yaml,
   *  allow lists, … into it). */
  build: (ctx: { id: string; dir: string }) => Promise<CommandSpec & { env?: Record<string, string> }>
}

export interface FinalizeContext {
  run: RunRow
  dir: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  cancelled: boolean
  stdout: string
  stderr: string
}

export interface FinalizeResult {
  status?: RunStatus
  summary?: Record<string, unknown>
  rulesSha?: string | null
  error?: string | null
}

type Finalizer = (ctx: FinalizeContext) => Promise<FinalizeResult>

interface Live {
  pid: number
  cancelRequested: boolean
}

type AfterRun = (run: RunRow) => Promise<void>
type G = typeof globalThis & {
  __trustablFinalizers?: Map<string, Finalizer>
  __trustablLive?: Map<string, Live>
  __trustablAfterRun?: Map<string, AfterRun>
}
const g = globalThis as G
const finalizers = (g.__trustablFinalizers ??= new Map())
const live = (g.__trustablLive ??= new Map())
const afterRunHooks = (g.__trustablAfterRun ??= new Map())

export function registerFinalizer(action: string, fn: Finalizer) {
  finalizers.set(action, fn)
}

export class ConflictError extends Error {
  status = 409
}

function rowToRun(row: Record<string, unknown>): RunRow {
  return {
    ...(row as unknown as RunRow),
    argv: JSON.parse(row.argv as string),
    options: JSON.parse((row.options as string) || '{}'),
    summary: JSON.parse((row.summary as string) || '{}'),
  }
}

export function getRun(id: string): RunRow | undefined {
  const row = db().prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToRun(row) : undefined
}

export function listRuns(filter: { repoId?: string; tool?: string; action?: string; limit?: number; status?: string } = {}): RunRow[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (filter.repoId) { where.push('repo_id = ?'); params.push(filter.repoId) }
  if (filter.tool) { where.push('tool = ?'); params.push(filter.tool) }
  if (filter.action) { where.push('action = ?'); params.push(filter.action) }
  if (filter.status) { where.push('status = ?'); params.push(filter.status) }
  const sql = `SELECT * FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC LIMIT ?`
  params.push(filter.limit ?? 200)
  return (db().prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToRun)
}

export function activeRun(repoId: string | null, tool: ConsoleTool): RunRow | undefined {
  const row = db()
    .prepare(`SELECT * FROM runs WHERE status = 'running' AND tool = ? AND repo_id IS ? ORDER BY started_at DESC LIMIT 1`)
    .get(tool, repoId) as Record<string, unknown> | undefined
  return row ? rowToRun(row) : undefined
}

export function recordArtifact(runId: string, kind: string, file: string): void {
  if (!fs.existsSync(file)) return
  const buf = fs.readFileSync(file)
  db()
    .prepare(`INSERT INTO artifacts (run_id, kind, path, bytes, sha256) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(run_id, kind) DO UPDATE SET path = excluded.path, bytes = excluded.bytes, sha256 = excluded.sha256`)
    .run(runId, kind, file, buf.length, createHash('sha256').update(buf).digest('hex'))
}

export function listArtifacts(runId: string): { kind: string; path: string; bytes: number; sha256: string }[] {
  return db().prepare('SELECT kind, path, bytes, sha256 FROM artifacts WHERE run_id = ? ORDER BY id').all(runId) as never
}

export function updateRunSummary(runId: string, patch: Record<string, unknown>): void {
  const run = getRun(runId)
  if (!run) return
  db().prepare('UPDATE runs SET summary = ? WHERE id = ?').run(JSON.stringify({ ...run.summary, ...patch }), runId)
}

/** Create a run row for work that does not spawn a CLI (e.g. a SARIF import). */
export function recordRun(input: {
  tool: ConsoleTool
  action: string
  repo: RepoRow | null
  command: string
  status: RunStatus
  options?: Record<string, unknown>
  summary?: Record<string, unknown>
  toolVersion?: string | null
  commitSha?: string | null
  rulesSha?: string | null
  error?: string | null
}): RunRow {
  const id = newRunId()
  ensureDir(paths.run(id))
  const now = Date.now()
  db()
    .prepare(`INSERT INTO runs (id, repo_id, tool, action, status, argv, command, cwd, tool_version, commit_sha, rules_sha, exit_code, error, options, summary, started_at, finished_at)
              VALUES (?, ?, ?, ?, ?, '[]', ?, '', ?, ?, ?, NULL, ?, ?, ?, ?, ?)`)
    .run(id, input.repo?.id ?? null, input.tool, input.action, input.status, input.command, input.toolVersion ?? null,
      input.commitSha ?? null, input.rulesSha ?? null, input.error ?? null, JSON.stringify(input.options ?? {}),
      JSON.stringify(input.summary ?? {}), now, now)
  return getRun(id)!
}

function newRunId(): string {
  // Sortable and readable in folder listings: 20261019T031522-1a2b3c4d
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
  return `${ts}-${randomUUID().slice(0, 8)}`
}

export async function startRun(input: StartRunInput): Promise<RunRow> {
  const busy = activeRun(input.repo?.id ?? null, input.tool)
  if (busy && input.repo) {
    throw new ConflictError(`A ${input.tool} run is already in progress for ${input.repo.name}. Cancel it or wait for it to finish.`)
  }
  const info = await toolInfo(input.toolName)
  if (!info.installed) throw new Error(`${input.toolName} ${info.pinned} is not installed. ${info.error ?? ''}`.trim())

  const id = newRunId()
  const dir = ensureDir(paths.run(id))
  const spec = await input.build({ id, dir })
  const commitSha = input.repo ? (await headSha(input.repo.path)) ?? null : null
  const command = formatCommand(spec)
  const startedAt = Date.now()
  db()
    .prepare(`INSERT INTO runs (id, repo_id, tool, action, status, argv, command, cwd, tool_version, commit_sha, options, summary, started_at)
              VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, '{}', ?)`)
    .run(id, input.repo?.id ?? null, input.tool, input.action, JSON.stringify([spec.bin, ...spec.args]), command,
      spec.cwd ?? '', info.reported ?? info.pinned, commitSha, JSON.stringify(input.options), startedAt)
  fs.writeFileSync(path.join(dir, 'command.sh'), `#!/bin/sh\n# Reproduces Console run ${id}\n${command}\n`, { mode: 0o600 })

  const out = fs.openSync(path.join(dir, 'stdout.log'), 'a')
  const err = fs.openSync(path.join(dir, 'stderr.log'), 'a')
  const combined = fs.openSync(path.join(dir, 'output.log'), 'a')

  ensureDir(paths.cliCache())
  const child = spawn(spec.bin, spec.args, {
    cwd: spec.cwd,
    env: {
      ...process.env,
      // The CLIs keep their caches (rules, probe results) under the Console
      // home on Linux/WSL so `make wipe` removes them too.
      XDG_CACHE_HOME: paths.cliCache(),
      NO_COLOR: '1',
      ...spec.env,
    },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const pump = (fd: number) => (chunk: Buffer) => {
    fs.writeSync(fd, chunk)
    fs.writeSync(combined, chunk)
  }
  child.stdout.on('data', pump(out))
  child.stderr.on('data', pump(err))
  child.stdin.on('error', () => {})
  if (spec.stdin !== undefined) child.stdin.end(spec.stdin)
  else child.stdin.end()

  if (child.pid) {
    live.set(id, { pid: child.pid, cancelRequested: false })
    db().prepare('UPDATE runs SET pid = ? WHERE id = ?').run(child.pid, id)
  }

  let finished = false
  const finish = async (code: number | null, signal: NodeJS.Signals | null, spawnError?: string) => {
    if (finished) return
    finished = true
    for (const fd of [out, err, combined]) {
      try { fs.closeSync(fd) } catch { /* already closed */ }
    }
    const l = live.get(id)
    live.delete(id)
    const run = getRun(id)!
    const stdout = readText(path.join(dir, 'stdout.log'))
    const stderr = readText(path.join(dir, 'stderr.log'))
    const ctx: FinalizeContext = { run, dir, exitCode: code, signal, cancelled: !!l?.cancelRequested, stdout, stderr }
    let result: FinalizeResult = {}
    if (spawnError) {
      result = { status: 'failed', error: spawnError }
    } else if (ctx.cancelled) {
      result = { status: 'cancelled', error: 'Cancelled from the Console.' }
    } else {
      const fin = finalizers.get(input.action)
      try {
        result = fin ? await fin(ctx) : { status: code === 0 ? 'succeeded' : 'failed' }
      } catch (e) {
        result = { status: 'failed', error: `Could not read the ${input.tool} output: ${(e as Error).message}` }
      }
    }
    const status: RunStatus = result.status ?? (code === 0 ? 'succeeded' : 'failed')
    let error = result.error ?? null
    if (status === 'failed' && !error) error = failureText(stdout, stderr, code, signal)
    const merged = { ...getRun(id)!.summary, ...(result.summary ?? {}) }
    db()
      .prepare('UPDATE runs SET status = ?, exit_code = ?, error = ?, summary = ?, rules_sha = COALESCE(?, rules_sha), finished_at = ?, pid = NULL WHERE id = ?')
      .run(status, code, error, JSON.stringify(merged), result.rulesSha ?? null, Date.now(), id)
    for (const cb of afterRunHooks.values()) {
      try { await cb(getRun(id)!) } catch { /* hooks never fail a run */ }
    }
  }
  child.on('error', (e) => void finish(null, null, `Could not start ${spec.bin}: ${e.message}`))
  child.on('close', (code, signal) => void finish(code, signal))

  return getRun(id)!
}

/** Named so a dev-server reload replaces a hook instead of adding a copy. */
export function onRunFinished(name: string, cb: AfterRun) {
  afterRunHooks.set(name, cb)
}

export function cancelRun(id: string): boolean {
  const l = live.get(id)
  if (!l) return false
  l.cancelRequested = true
  killGroup(l.pid, 'SIGTERM')
  setTimeout(() => {
    if (live.has(id)) killGroup(l.pid, 'SIGKILL')
  }, 5000).unref()
  return true
}

function killGroup(pid: number, sig: NodeJS.Signals) {
  try {
    process.kill(-pid, sig)
  } catch {
    try { process.kill(pid, sig) } catch { /* gone */ }
  }
}

/** On boot: a run still marked running has lost its owner (the server
 *  restarted). Stop what is left of it and say so. */
export function reapOrphans(): number {
  const rows = db().prepare(`SELECT id, pid FROM runs WHERE status = 'running'`).all() as { id: string; pid: number | null }[]
  for (const r of rows) {
    if (live.has(r.id)) continue
    if (r.pid) killGroup(r.pid, 'SIGKILL')
    db()
      .prepare(`UPDATE runs SET status = 'interrupted', error = ?, finished_at = ?, pid = NULL WHERE id = ?`)
      .run('The Console stopped while this run was in progress. Start it again; the command below reproduces it.', Date.now(), r.id)
  }
  return rows.length
}

export function isLive(id: string): boolean {
  return live.has(id)
}

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

export function failureText(stdout: string, stderr: string, code: number | null, signal: NodeJS.Signals | null): string {
  const source = stripAnsi(stderr).trim() ? stderr : stdout
  const tail = tailLines(stripAnsi(source), 15).trim()
  const head = signal ? `Exited on ${signal}.` : `Exited with code ${code}.`
  return tail ? `${head}\n${tail}` : head
}

/** Close a run created with recordRun (no subprocess). */
export function finishRecordedRun(id: string, status: RunStatus, patch: { summary?: Record<string, unknown>; error?: string | null; rulesSha?: string | null; toolVersion?: string | null }) {
  const run = getRun(id)
  if (!run) return
  db()
    .prepare('UPDATE runs SET status = ?, error = ?, summary = ?, rules_sha = COALESCE(?, rules_sha), tool_version = COALESCE(?, tool_version), finished_at = ? WHERE id = ?')
    .run(status, patch.error ?? null, JSON.stringify({ ...run.summary, ...(patch.summary ?? {}) }), patch.rulesSha ?? null, patch.toolVersion ?? null, Date.now(), id)
}
