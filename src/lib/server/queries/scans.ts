import fs from 'node:fs'
import { db } from '../db'
import type { RunRow, ScanResult, StoredFinding } from '../../types'
import { listRuns } from '../runner'

/** Successful Analyzer runs (scans and SARIF imports), oldest first. */
export function scansForRepo(repoId: string): RunRow[] {
  return listRuns({ repoId, tool: 'analyzer', status: 'succeeded', limit: 1000 })
    .filter((r) => r.action === 'scan' || r.action === 'import')
    .reverse()
}

export function findingsForRun(runId: string): StoredFinding[] {
  return db().prepare('SELECT * FROM findings WHERE run_id = ?').all(runId) as unknown as StoredFinding[]
}

/** Findings of the newest successful scan of `repoId` other than `runId`. */
export function previousScanFindings(repoId: string, excludeRunId: string): StoredFinding[] | null {
  const prev = scansForRepo(repoId).filter((r) => r.id !== excludeRunId).pop()
  return prev ? findingsForRun(prev.id) : null
}

export function artifactPath(runId: string, kind: string): string | undefined {
  const row = db().prepare('SELECT path FROM artifacts WHERE run_id = ? AND kind = ?').get(runId, kind) as { path: string } | undefined
  return row?.path
}

const jsonCache = new Map<string, { mtime: number; value: unknown }>()

export function readJsonArtifact<T>(runId: string, kind: string): T | null {
  const p = artifactPath(runId, kind)
  if (!p || !fs.existsSync(p)) return null
  const mtime = fs.statSync(p).mtimeMs
  const hit = jsonCache.get(p)
  if (hit && hit.mtime === mtime) return hit.value as T
  const value = JSON.parse(fs.readFileSync(p, 'utf8')) as T
  jsonCache.set(p, { mtime, value })
  return value
}

export function readTextArtifact(runId: string, kind: string): string | null {
  const p = artifactPath(runId, kind)
  if (!p || !fs.existsSync(p)) return null
  return fs.readFileSync(p, 'utf8')
}

export function scanJson(runId: string): ScanResult | null {
  return readJsonArtifact<ScanResult>(runId, 'scan.json')
}
