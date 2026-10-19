import fs from 'node:fs'
import { getRepo, listRepos, type RepoRow } from '../repos'
import { db } from '../db'
import { listArtifacts, listRuns } from '../runner'
import { scansForRepo, findingsForRun, readJsonArtifact, readTextArtifact, scanJson } from './scans'
import { skillPath, currentRules, forgeGeneratePreview, forgeCheckPreview } from '../actions/forge'
import { formatCommand } from '../../shell'
import { grantSetMembers, toolSetKey } from '../actions/probe'
import {
  diffScans, openCount, otelRuleIds, otelState, rankFindings, readiness, severityCounts, countsAsOpen, type SeverityCounts, type OtelState,
} from '../../findings'
import { outlineSkill, parseStamp, staleReason, type ForgeCheckResult, type ForgeStamp, type OtelInSkill, type SkillOutline } from '../../forge'
import { draftState, parseDraft, probeFlags, sessionExtras, uniqueEgress, cacheState, type DraftState, type FlagHit } from '../../probe'
import type { Endpoint, FindingStatus, ProbeFindings, ProbeProfile, RunRow, ScanResult, StoredFinding } from '../../types'
import { stripAnsi } from '../../text'
import { paths } from '../paths'

// View models for each page. Every value is read from a CLI artifact or the
// Console's own run history.

export interface RunBrief {
  id: string
  tool: RunRow['tool']
  action: string
  status: RunRow['status']
  started_at: number
  finished_at: number | null
  command: string
  commit_sha: string | null
  rules_sha: string | null
  tool_version: string | null
  error: string | null
  summary: Record<string, unknown>
}

export function brief(r: RunRow): RunBrief {
  const { id, tool, action, status, started_at, finished_at, command, commit_sha, rules_sha, tool_version, error, summary } = r
  return { id, tool, action, status, started_at, finished_at, command, commit_sha, rules_sha, tool_version, error, summary }
}

function latest(repoId: string, tool: RunRow['tool'], actions: string[], status?: RunRow['status']): RunRow | undefined {
  return listRuns({ repoId, tool, status, limit: 200 }).find((r) => actions.includes(r.action))
}

function running(repoId: string, tool: RunRow['tool']): RunBrief | null {
  const r = listRuns({ repoId, tool, status: 'running', limit: 1 })[0]
  return r ? brief(r) : null
}

// ───────────────────────────── Analyzer ─────────────────────────────

export interface FindingView extends StoredFinding {
  status: FindingStatus
  repoName: string
  /** For resolved findings: when the fingerprint went away. */
  goneAt?: number
}

export interface ScanPoint {
  runId: string
  at: number
  open: number
  readiness: number | null
  introduced: { rule_id: string; title: string }[]
  resolved: { rule_id: string; title: string }[]
  imported: boolean
}

export interface AnalyzerRepo {
  repo: RepoRow
  agent: string | null
  commitSha: string | null
  lastScan: RunBrief | null
  running: RunBrief | null
  readiness: number | null
  counts: SeverityCounts
  open: number
  firstOpen: number | null
  scans: number
  trend: number[]
  trendLabel: 'rising' | 'declining' | 'flat' | 'clear' | 'first scan' | null
  openFindings: FindingView[]
  resolvedLast: FindingView[]
  history: ScanPoint[]
  otel: OtelState | null
  otelRules: string[]
  testPathHidden: number
  sdks: string[]
  languages: string[]
  lastError: RunBrief | null
}

function scanStats(repo: RepoRow) {
  const scans = scansForRepo(repo.id)
  const history: ScanPoint[] = []
  let prev: StoredFinding[] | null = null
  const all: { run: RunRow; findings: StoredFinding[] }[] = []
  for (const run of scans) {
    const findings = findingsForRun(run.id)
    const d = diffScans(findings.filter((f) => countsAsOpen(f)), prev ? prev.filter((f) => countsAsOpen(f)) : null)
    history.push({
      runId: run.id,
      at: run.started_at,
      open: openCount(findings),
      readiness: (run.summary.readiness as number | null) ?? null,
      introduced: d.introduced.map((f) => ({ rule_id: f.rule_id, title: f.title })),
      resolved: d.resolved.map((f) => ({ rule_id: f.rule_id, title: f.title })),
      imported: run.action === 'import',
    })
    all.push({ run, findings })
    prev = findings
  }
  return { scans, history, all }
}

function trendLabel(values: number[]): AnalyzerRepo['trendLabel'] {
  if (values.length === 0) return null
  if (values[values.length - 1] === 0) return 'clear'
  if (values.length === 1) return 'first scan'
  const a = values[values.length - 2]
  const b = values[values.length - 1]
  return b > a ? 'rising' : b < a ? 'declining' : 'flat'
}

export function analyzerRepo(repo: RepoRow, { includeTests = false } = {}): AnalyzerRepo {
  const { scans, history, all } = scanStats(repo)
  const last = all[all.length - 1]
  const prev = all[all.length - 2]
  // Inventory, OTel and SDKs come from the newest real scan: a SARIF import
  // carries findings only.
  const lastScanRun = [...all].reverse().find((x) => x.run.action === 'scan')?.run
  const scan = lastScanRun ? scanJson(lastScanRun.id) : null
  const visible = (f: StoredFinding) => includeTests || f.origin !== 'test'
  const cur = last ? last.findings : []
  const d = diffScans(cur, prev ? prev.findings : null)
  const introducedFp = new Set(d.introduced.map((f) => f.fingerprint))
  const openFindings = rankFindings(cur.filter(visible)).map((f) => ({
    ...f, repoName: repo.name, status: (introducedFp.has(f.fingerprint) ? 'introduced' : 'open') as FindingStatus,
  }))
  const resolvedLast = d.resolved.filter(visible).map((f) => ({ ...f, repoName: repo.name, status: 'resolved' as FindingStatus, goneAt: last!.run.started_at }))
  const trend = history.slice(-6).map((h) => h.open)
  const failed = listRuns({ repoId: repo.id, tool: 'analyzer', limit: 1 })[0]
  return {
    repo,
    agent: (lastScanRun?.summary.agent as string | null) ?? null,
    commitSha: last?.run.commit_sha ?? null,
    lastScan: last ? brief(last.run) : null,
    running: running(repo.id, 'analyzer'),
    readiness: (last?.run.summary.readiness as number | null) ?? null,
    counts: severityCounts(cur),
    open: openCount(cur),
    firstOpen: history.length ? history[0].open : null,
    scans: scans.length,
    trend,
    trendLabel: trendLabel(trend),
    openFindings,
    resolvedLast,
    history,
    otel: scan ? otelState(scan) : null,
    otelRules: otelRuleIds(cur),
    testPathHidden: includeTests ? 0 : cur.filter((f) => f.origin === 'test').length,
    sdks: scan?.sdks ?? ((last?.run.summary.sdks as string[]) ?? []),
    languages: scan?.languages ?? ((last?.run.summary.languages as string[]) ?? []),
    lastError: failed && failed.status !== 'succeeded' && failed.status !== 'running' ? brief(failed) : null,
  }
}

/** Every finding ever seen per repo with its current status: present in the
 *  latest scan = open (or introduced if new in it); seen before but absent
 *  from the latest scan = resolved. */
export function allFindings({ includeTests = false } = {}): FindingView[] {
  const out: FindingView[] = []
  for (const repo of listRepos()) {
    const { all } = scanStats(repo)
    if (!all.length) continue
    const last = all[all.length - 1]
    const prev = all[all.length - 2]
    const d = diffScans(last.findings, prev?.findings ?? null)
    const introduced = new Set(d.introduced.map((f) => f.fingerprint))
    const present = new Set(last.findings.map((f) => f.fingerprint))
    for (const f of last.findings) out.push({ ...f, repoName: repo.name, status: introduced.has(f.fingerprint) ? 'introduced' : 'open' })
    const seen = new Map<string, { f: StoredFinding; goneAt: number }>()
    for (let i = 0; i < all.length - 1; i++) {
      const next = all[i + 1]
      const nextFp = new Set(next.findings.map((x) => x.fingerprint))
      for (const f of all[i].findings) {
        if (!present.has(f.fingerprint) && !nextFp.has(f.fingerprint)) seen.set(f.fingerprint, { f, goneAt: next.run.started_at })
      }
    }
    for (const { f, goneAt } of seen.values()) out.push({ ...f, repoName: repo.name, status: 'resolved', goneAt })
  }
  return rankFindings(out.filter((f) => includeTests || f.origin !== 'test'))
}

export function analyzerView({ includeTests = false } = {}) {
  const repos = listRepos().map((r) => analyzerRepo(r, { includeTests }))
  const scanned = repos.filter((r) => r.lastScan)
  const open = scanned.reduce((n, r) => n + r.open, 0)
  const lastHist = (r: AnalyzerRepo) => r.history[r.history.length - 1]
  const resolved = scanned.reduce((n, r) => n + (lastHist(r)?.resolved.length ?? 0), 0)
  const introducedRepos = scanned.filter((r) => (lastHist(r)?.introduced.length ?? 0) > 0)
  const introduced = introducedRepos.reduce((n, r) => n + lastHist(r).introduced.length, 0)
  const otelGaps = scanned.filter((r) => r.otel && r.otel !== 'emitting')
  const best = [...scanned].filter((r) => r.readiness !== null).sort((a, b) => (b.readiness ?? 0) - (a.readiness ?? 0))[0]
  return {
    kpis: {
      open,
      resolved,
      introduced,
      introducedRepos: introducedRepos.map((r) => r.repo.name),
      otelGaps: otelGaps.length,
      otelRules: [...new Set(otelGaps.flatMap((r) => r.otelRules))],
      bestReadiness: best?.readiness ?? null,
      bestRepo: best?.repo.name ?? null,
      scannedRepos: scanned.length,
    },
    repos,
  }
}

// ───────────────────────────── Forge ─────────────────────────────

export interface ForgeRepo {
  repo: RepoRow
  agent: string | null
  skillPath: string
  exists: boolean
  stamp: ForgeStamp | null
  outline: SkillOutline | null
  otel: OtelInSkill | null
  check: ForgeCheckResult | null
  checkRun: RunBrief | null
  staleReason: string | null
  pending: RunBrief | null
  running: RunBrief | null
  lastGenerate: RunBrief | null
  lastError: RunBrief | null
  analyzerSdks: string[]
  skillMtime: number | null
  commands: { generate: string; check: string }
}

export function forgeRepo(repo: RepoRow): ForgeRepo {
  const p = skillPath(repo)
  const exists = fs.existsSync(p)
  const text = exists ? fs.readFileSync(p, 'utf8') : null
  const stamp = text ? parseStamp(text) : null
  const outline = text ? outlineSkill(text) : null
  const row = db().prepare('SELECT * FROM skills WHERE repo_id = ?').get(repo.id) as { check_detail: string; check_run_id: string; checked_at: number } | undefined
  const checkRun = row ? listRuns({ repoId: repo.id, tool: 'forge', limit: 100 }).find((r) => r.id === row.check_run_id) : undefined
  // A check older than the file on disk says nothing about the current file.
  const mtime = exists ? fs.statSync(p).mtimeMs : null
  const fresh = row && mtime !== null && row.checked_at >= mtime
  const check = fresh ? (JSON.parse(row!.check_detail) as ForgeCheckResult) : null
  const gens = listRuns({ repoId: repo.id, tool: 'forge', limit: 50 }).filter((r) => r.action === 'generate')
  const pending = gens.find((r) => r.status === 'succeeded' && r.summary.pending === true)
  const lastGen = gens[0]
  const scanRun = scansForRepo(repo.id).filter((r) => r.action === 'scan').pop()
  return {
    repo,
    agent: (scanRun?.summary.agent as string | null) ?? null,
    skillPath: p,
    exists,
    stamp,
    outline,
    otel: outline?.otel ?? null,
    check,
    checkRun: checkRun ? brief(checkRun) : null,
    staleReason: check && check.status !== 'pass' ? staleReason(check) : null,
    pending: pending ? brief(pending) : null,
    running: running(repo.id, 'forge'),
    lastGenerate: lastGen ? brief(lastGen) : null,
    lastError: lastGen && (lastGen.status === 'failed' || lastGen.status === 'interrupted') ? brief(lastGen) : null,
    analyzerSdks: (scanRun?.summary.sdks as string[]) ?? [],
    skillMtime: mtime,
    commands: {
      generate: formatCommand(forgeGeneratePreview(repo, {})),
      check: formatCommand(forgeCheckPreview(repo, {})),
    },
  }
}

export function forgeView() {
  return { rules: currentRules() ?? null, repos: listRepos().map(forgeRepo) }
}

// ───────────────────────────── Probe ─────────────────────────────

export interface ProbeRepo {
  repo: RepoRow
  lastRun: RunBrief | null
  running: RunBrief | null
  lastError: RunBrief | null
  className: string | null
  grantSetHash: string | null
  grantSet: { path: string; label: string }[]
  egress: Endpoint[]
  perTool: { path: string; label: string; cacheHit: boolean; harnessId?: string; egress: Endpoint[]; findings: number }[]
  draft: DraftState
  draftYaml: string | null
  flags: FlagHit[]
  extras: ProbeFindings['findings']
  cache: string | null
  runner: string | null
  inputs: { allowList: boolean; platformAllowList: boolean; denyList: boolean; envFixtures: boolean; allowWriteTools: boolean; noCache: boolean }
  observedFlagged: string[]
  analyzerTools: number
  untested: boolean
  artifacts: string[]
}

function toolLabel(file: string, repo: RepoRow, members: { path: string; entrypoint?: string; tools?: string[] }[]): string {
  const m = members.find((x) => x.entrypoint && `${x.path}/${x.entrypoint}` === file)
  const rel = file.startsWith(repo.path + '/') ? file.slice(repo.path.length + 1) : file
  return m?.tools?.length ? `${m.tools.join(', ')} (${rel})` : rel
}

export function probeRepo(repo: RepoRow): ProbeRepo {
  const run = latest(repo.id, 'probe', ['probe'], 'succeeded')
  const lastAny = listRuns({ repoId: repo.id, tool: 'probe', limit: 1 })[0]
  const profile = run ? readJsonArtifact<ProbeProfile>(run.id, 'probe.profile.json') : null
  const findings = run ? readJsonArtifact<ProbeFindings>(run.id, 'probe.findings.json') : null
  const yamlText = run ? readTextArtifact(run.id, 'network_policies.draft.yaml') : null
  const draft = parseDraft(yamlText)
  const stderr = run ? stripAnsi(readRunFile(run.id, 'stderr.log')) : ''
  const flags = probeFlags(findings, stderr)
  const egress = uniqueEgress(profile)
  const members = (run?.options.members as { path: string; entrypoint?: string; tools?: string[] }[]) ?? []
  let analyzerTools = 0
  let untested = false
  try {
    const cur = grantSetMembers(repo, 'analyzer').members
    analyzerTools = cur.reduce((n, m) => n + (m.tools?.length ?? 0), 0)
    const key = toolSetKey(cur)
    untested = !listRuns({ repoId: repo.id, tool: 'probe', status: 'succeeded', limit: 100 }).some((r) => r.options.toolSetKey === key)
  } catch {
    /* no Analyzer grant set */
  }
  const o = (run?.options ?? {}) as Record<string, unknown>
  return {
    repo,
    lastRun: run ? brief(run) : null,
    running: running(repo.id, 'probe'),
    lastError: lastAny && (lastAny.status === 'failed' || lastAny.status === 'interrupted') ? brief(lastAny) : null,
    className: profile?.class ?? null,
    grantSetHash: profile?.grant_set_hash ?? null,
    grantSet: (profile?.grant_set ?? []).map((p) => ({ path: p, label: toolLabel(p, repo, members) })),
    egress,
    perTool: (profile?.tools ?? []).map((t) => ({
      path: t.path, label: toolLabel(t.path, repo, members), cacheHit: t.cache_hit, harnessId: t.harness_id, egress: t.egress ?? [], findings: t.findings_count,
    })),
    draft: run ? draftState(draft, flags, egress) : { kind: 'none' },
    draftYaml: yamlText,
    flags,
    extras: sessionExtras(findings),
    cache: cacheState(profile),
    runner: (o.runner as string) ?? null,
    inputs: {
      allowList: !!(o.allowList as string)?.trim(),
      platformAllowList: !!(o.platformAllowList as string)?.trim(),
      denyList: !!(o.denyList as string)?.trim(),
      envFixtures: !!o.envFixtures,
      allowWriteTools: !!o.allowWriteTools,
      noCache: !!o.noCache,
    },
    observedFlagged: flags.flatMap((f) => f.details),
    analyzerTools,
    untested,
    artifacts: run ? listArtifacts(run.id).map((a) => a.kind) : [],
  }
}

function readRunFile(runId: string, name: string): string {
  const p = `${paths.run(runId)}/${name}`
  try { return fs.readFileSync(p, 'utf8') } catch { return '' }
}

export function probeView() {
  return { repos: listRepos().map(probeRepo) }
}

// ───────────────────────────── Overview ─────────────────────────────

export interface OverviewRow {
  repo: RepoRow
  analyzer: AnalyzerRepo
  forge: ForgeRepo
  probe: ProbeRepo
  className: string | null
  tags: { open: boolean; stale: boolean; otel: boolean }
  inventory: { agents: number; tools: number; mcp: number; subagents: number; skills: number } | null
  latestRuns: { forge: RunBrief | null; analyzer: RunBrief | null; probe: RunBrief | null }
  artifacts: { runId: string; kind: string }[]
  next: { text: string; action: 'forge' | 'analyzer' | 'probe' | 'forge-check' | null }
  otelSignals: { vendor: string; kind: string; file: string; start_line: number }[]
}

function inventory(scan: ScanResult | null) {
  if (!scan) return null
  return {
    agents: scan.agents?.length ?? 0,
    tools: scan.tools?.length ?? 0,
    mcp: scan.mcp_servers?.length ?? 0,
    subagents: scan.subagents?.length ?? 0,
    skills: scan.skills?.length ?? 0,
  }
}

function nextStep(a: AnalyzerRepo, f: ForgeRepo, p: ProbeRepo): OverviewRow['next'] {
  if (!f.exists) return { text: 'No pre-coding skill yet. Generate one so the next generation pass follows the rules and emits the OTel profile.', action: 'forge' }
  if (f.check && f.check.status !== 'pass') return { text: `${f.staleReason ?? 'Skill is stale.'} Regenerate it.`, action: 'forge' }
  if (!f.check) return { text: 'Skill not checked against the current rules yet. Run forge check.', action: 'forge-check' }
  if (!a.lastScan) return { text: 'Never scanned. Run Analyzer to get findings and the grant set Probe needs.', action: 'analyzer' }
  if (a.counts.critical + a.counts.high > 0) return { text: `${a.counts.critical + a.counts.high} critical/high finding(s) open. Fix them, then rescan.`, action: 'analyzer' }
  if (p.untested) return { text: 'Analyzer grant set is ready to harness — no Probe run for it yet.', action: 'probe' }
  if (!p.lastRun) return { text: 'No Probe profile yet.', action: 'probe' }
  if (a.otel && a.otel !== 'emitting') return { text: 'OTel profile not emitting. The skill tells the model how; rescan after the next pass.', action: 'analyzer' }
  return { text: 'Nothing pending. Rescan after the next change.', action: null }
}

export function overviewRow(repo: RepoRow): OverviewRow {
  const a = analyzerRepo(repo)
  const f = forgeRepo(repo)
  const p = probeRepo(repo)
  const scanRun = scansForRepo(repo.id).filter((r) => r.action === 'scan').pop()
  const scan = scanRun ? scanJson(scanRun.id) : null
  const latestRuns = {
    forge: (() => { const r = listRuns({ repoId: repo.id, tool: 'forge', limit: 1 })[0]; return r ? brief(r) : null })(),
    analyzer: (() => { const r = listRuns({ repoId: repo.id, tool: 'analyzer', limit: 1 })[0]; return r ? brief(r) : null })(),
    probe: (() => { const r = listRuns({ repoId: repo.id, tool: 'probe', limit: 1 })[0]; return r ? brief(r) : null })(),
  }
  const artifacts: { runId: string; kind: string }[] = []
  if (a.lastScan) for (const k of listArtifacts(a.lastScan.id).map((x) => x.kind)) artifacts.push({ runId: a.lastScan.id, kind: k })
  if (p.lastRun) for (const k of p.artifacts) if (k !== 'autofix-attestation.json') artifacts.push({ runId: p.lastRun.id, kind: k })
  const stale = !f.exists || (f.check !== null && f.check.status !== 'pass') || !a.lastScan || !p.lastRun || p.untested
  return {
    repo,
    analyzer: a,
    forge: f,
    probe: p,
    className: p.className ?? a.agent,
    tags: { open: a.open > 0, stale, otel: !!a.otel && a.otel !== 'emitting' },
    inventory: inventory(scan),
    latestRuns,
    artifacts,
    next: nextStep(a, f, p),
    otelSignals: (scan?.observability ?? []).map((s) => ({ vendor: s.vendor, kind: s.kind, file: s.file, start_line: s.start_line })),
  }
}

const WEEK = 7 * 24 * 60 * 60 * 1000

export function overviewView(now = Date.now()) {
  const rows = listRepos().map(overviewRow)
  const scanned = rows.filter((r) => r.analyzer.lastScan)
  const open = scanned.reduce((n, r) => n + r.analyzer.open, 0)
  // "Change since the previous week's scans": each repo's newest scan older
  // than 7 days, summed. Repos with no such scan are left out of the base.
  const weekAgo = scanned
    .map((r) => [...r.analyzer.history].reverse().find((h) => h.at <= now - WEEK))
    .filter((h): h is ScanPoint => !!h)
  const emitting = scanned.filter((r) => r.analyzer.otel === 'emitting').length
  const drafts = rows.filter((r) => r.probe.draft.kind === 'drafted').length
  const untested = rows.filter((r) => r.probe.untested).length
  return {
    rules: currentRules() ?? null,
    kpis: {
      repos: rows.length,
      notForged: rows.filter((r) => !r.forge.exists).length,
      open,
      openRepos: scanned.filter((r) => r.analyzer.open > 0).length,
      lastWeekOpen: weekAgo.length ? weekAgo.reduce((n, h) => n + h.open, 0) : null,
      emitting,
      scanned: scanned.length,
      notEmitting: scanned.filter((r) => r.analyzer.otel !== 'emitting').map((r) => r.repo.name),
      drafts,
      untested,
    },
    filters: {
      all: rows.length,
      open: rows.filter((r) => r.tags.open).length,
      stale: rows.filter((r) => r.tags.stale).length,
      otel: rows.filter((r) => r.tags.otel).length,
    },
    rows,
  }
}

// ───────────────────────────── Repo detail ─────────────────────────────

export async function repoDetail(id: string) {
  const repo = getRepo(id)
  if (!repo) return null
  const row = overviewRow(repo)
  const scanRun = scansForRepo(repo.id).filter((r) => r.action === 'scan').pop()
  const scan = scanRun ? scanJson(scanRun.id) : null
  return {
    ...row,
    projected: scan?.projected_scores ? { fixMedium: readiness(scan.projected_scores.fix_medium), fixHigh: readiness(scan.projected_scores.fix_high), fixAll: readiness(scan.projected_scores.fix_all) } : null,
    runs: listRuns({ repoId: repo.id, limit: 200 }).map((r) => ({ ...brief(r), artifacts: listArtifacts(r.id).map((a) => a.kind) })),
  }
}

export function reposWithFlags() {
  return listRepos().map((r) => {
    let scanTools: number | null = null
    try {
      scanTools = grantSetMembers(r, 'analyzer').members.length
    } catch {
      scanTools = null
    }
    return { ...r, hasSkill: fs.existsSync(skillPath(r)), scanTools }
  })
}
