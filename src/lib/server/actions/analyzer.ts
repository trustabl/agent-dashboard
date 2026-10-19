import fs from 'node:fs'
import path from 'node:path'
import { db } from '../db'
import { binaryPath } from '../tools'
import { fingerprint } from '../fingerprint'
import { recordArtifact, registerFinalizer, type FinalizeContext, type FinalizeResult, type StartRunInput } from '../runner'
import type { RepoRow } from '../repos'
import type { ScanFinding, ScanResult } from '../../types'
import { openCount, otelState, readiness, severityCounts } from '../../findings'
import { parseTrustablSarif } from '../sarif'
import { previousScanFindings } from '../queries/scans'

/** Scan repo → `trustabl scan <repo> --json-out … --sarif-out … --no-color`.
 *  The human report and progress lines stream into the run log; the two
 *  machine artifacts are byte-identical to what the CLI writes for the same
 *  flags (README: "The file bytes are identical to the matching --format stdout"). */
export function scanRun(repo: RepoRow): StartRunInput {
  return {
    tool: 'analyzer',
    action: 'scan',
    repo,
    toolName: 'trustabl',
    options: {},
    build: async ({ dir }) => ({
      bin: binaryPath('trustabl'),
      args: ['scan', repo.path, '--json-out', path.join(dir, 'scan.json'), '--sarif-out', path.join(dir, 'trustabl.sarif'), '--no-color'],
      cwd: repo.path,
    }),
  }
}

export function scanPreview(repo: RepoRow) {
  return {
    bin: binaryPath('trustabl'),
    args: ['scan', repo.path, '--json-out', 'scan.json', '--sarif-out', 'trustabl.sarif', '--no-color'],
    cwd: repo.path,
  }
}

export function insertFindings(runId: string, repoId: string, findings: (ScanFinding & { fingerprint?: string })[]) {
  const stmt = db().prepare(`INSERT OR IGNORE INTO findings
    (run_id, repo_id, fingerprint, rule_id, category, scope, severity, confidence, title, explanation, suggested_fix, tool_name, file_path, start_line, end_line, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  db().exec('BEGIN')
  try {
    for (const f of findings) {
      stmt.run(runId, repoId, f.fingerprint ?? fingerprint(f), f.rule_id, f.category ?? null, f.scope ?? null, f.severity, f.confidence ?? 0,
        f.title, f.explanation ?? null, f.suggested_fix ?? null, f.tool_name ?? null, f.file_path ?? null, f.start_line ?? null,
        f.end_line ?? null, f.origin ?? null)
    }
    db().exec('COMMIT')
  } catch (e) {
    db().exec('ROLLBACK')
    throw e
  }
}

function scanSummary(runId: string, repoId: string, findings: (ScanFinding & { fingerprint?: string })[], scan: ScanResult | null) {
  const prev = previousScanFindings(repoId, runId)
  const cur = new Set(findings.map((f) => f.fingerprint ?? fingerprint(f)))
  const prevSet = new Set((prev ?? []).map((f) => f.fingerprint))
  const counted = findings.filter((f) => f.origin !== 'test')
  return {
    open: openCount(findings),
    severity: severityCounts(findings),
    introduced: prev ? counted.filter((f) => !prevSet.has(f.fingerprint ?? fingerprint(f))).length : 0,
    resolved: prev ? prev.filter((f) => f.origin !== 'test' && !cur.has(f.fingerprint)).length : 0,
    testPathFindings: findings.length - counted.length,
    readiness: scan ? readiness(scan.overall_score) : null,
    otel: scan ? otelState(scan) : null,
    sdks: scan?.sdks ?? [],
    languages: scan?.languages ?? [],
    agent: scan?.agents?.find((a) => a.name)?.name ?? scan?.subagents?.[0]?.name ?? null,
    toolCount: scan?.tools?.length ?? 0,
    firstScan: !prev,
  }
}

async function finalizeScan(ctx: FinalizeContext): Promise<FinalizeResult> {
  // 0 = clean, 1 = findings >= medium (a successful scan), 2 = scanner error.
  if (ctx.exitCode !== 0 && ctx.exitCode !== 1) return { status: 'failed' }
  const jsonPath = path.join(ctx.dir, 'scan.json')
  if (!fs.existsSync(jsonPath)) return { status: 'failed', error: 'trustabl exited without writing scan.json.' }
  const scan = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ScanResult
  recordArtifact(ctx.run.id, 'scan.json', jsonPath)
  recordArtifact(ctx.run.id, 'trustabl.sarif', path.join(ctx.dir, 'trustabl.sarif'))
  const findings = scan.findings ?? []
  insertFindings(ctx.run.id, ctx.run.repo_id!, findings)
  return {
    status: 'succeeded',
    rulesSha: scan.rules_version ?? null,
    summary: { ...scanSummary(ctx.run.id, ctx.run.repo_id!, findings, scan), scanId: scan.scan_id, rulesFromCache: !!scan.rules_from_cache },
  }
}

registerFinalizer('scan', finalizeScan)

/** "Import SARIF": record a `trustabl scan --format sarif` export as a scan. */
export function importSarif(runId: string, repoId: string, dir: string, text: string) {
  const parsed = parseTrustablSarif(text)
  const file = path.join(dir, 'trustabl.sarif')
  fs.writeFileSync(file, text)
  recordArtifact(runId, 'trustabl.sarif', file)
  insertFindings(runId, repoId, parsed.findings)
  return { parsed, summary: { ...scanSummary(runId, repoId, parsed.findings, null), imported: true, scanId: parsed.scanId } }
}
