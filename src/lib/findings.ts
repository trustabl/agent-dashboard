import type { FindingStatus, ScanResult, Severity, StoredFinding } from './types'

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
export const SCORED_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

export function severityRank(s: string): number {
  const i = SEVERITY_ORDER.indexOf(s as Severity)
  return i === -1 ? SEVERITY_ORDER.length : i
}

/** Severity first, then confidence (highest first), then rule ID for a stable order. */
export function rankFindings<T extends { severity: string; confidence: number; rule_id: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.confidence - a.confidence || a.rule_id.localeCompare(b.rule_id),
  )
}

export function isTestPath(f: { origin?: string | null }): boolean {
  return f.origin === 'test'
}

/** Findings that count: not test-path (the CLI excludes those from score and
 *  exit code by default) and not info-level META signals. */
export function countsAsOpen(f: { origin?: string | null; severity: string }): boolean {
  return !isTestPath(f) && SCORED_SEVERITIES.includes(f.severity as Severity)
}

export interface SeverityCounts { critical: number; high: number; medium: number; low: number }

export function severityCounts(list: { severity: string; origin?: string | null }[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of list) {
    if (!countsAsOpen(f)) continue
    c[f.severity as keyof SeverityCounts]++
  }
  return c
}

export function openCount(list: { severity: string; origin?: string | null }[]): number {
  const c = severityCounts(list)
  return c.critical + c.high + c.medium + c.low
}

export function readiness(score: number | null | undefined): number | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null
  return Math.round(score * 100)
}

export type ReadyTone = 'success' | 'warning' | 'danger'
export function readinessTone(r: number): ReadyTone {
  return r >= 80 ? 'success' : r >= 50 ? 'warning' : 'danger'
}

export type OtelState = 'emitting' | 'imported' | 'absent'

/** "Emitting" means the scan saw instrumentation *initialized* in code — the
 *  CLI's own line between "the package is present" and "traces have somewhere
 *  to go". Static only: trustabl does not ingest runtime traces. */
export function otelState(scan: Pick<ScanResult, 'observability'>): OtelState {
  const signals = scan.observability ?? []
  if (signals.some((s) => s.kind === 'init')) return 'emitting'
  if (signals.length > 0) return 'imported'
  return 'absent'
}

export function otelRuleIds(findings: { rule_id: string; origin?: string | null }[]): string[] {
  return [...new Set(findings.filter((f) => f.rule_id.startsWith('OBS-') && !isTestPath(f)).map((f) => f.rule_id))].sort()
}

export interface ScanDiff {
  open: StoredFinding[]
  introduced: StoredFinding[]
  resolved: StoredFinding[]
}

/** Status by fingerprint: present in this scan = open; present now but not in
 *  the previous scan = introduced; in the previous scan but gone now = resolved.
 *  A repo's first scan has nothing to compare with, so nothing is "introduced". */
export function diffScans(current: StoredFinding[], previous: StoredFinding[] | null): ScanDiff {
  const prev = new Set((previous ?? []).map((f) => f.fingerprint))
  const cur = new Set(current.map((f) => f.fingerprint))
  return {
    open: current,
    introduced: previous ? current.filter((f) => !prev.has(f.fingerprint)) : [],
    resolved: (previous ?? []).filter((f) => !cur.has(f.fingerprint)),
  }
}

export function statusOf(fp: string, diff: ScanDiff): FindingStatus {
  if (diff.introduced.some((f) => f.fingerprint === fp)) return 'introduced'
  if (diff.resolved.some((f) => f.fingerprint === fp)) return 'resolved'
  return 'open'
}

export function locationOf(f: { file_path?: string | null; start_line?: number | null }): string {
  if (!f.file_path) return 'repo'
  return f.start_line ? `${f.file_path}:${f.start_line}` : f.file_path
}

export function rulebookUrl(category: string | null | undefined, ruleId: string): string {
  const base = 'https://github.com/trustabl/trustabl-rulebook'
  if (!category) return `${base}/search?q=${encodeURIComponent(ruleId)}`
  return `${base}/blob/main/${encodeURIComponent(category)}/POLICY_INDEX.md#:~:text=${encodeURIComponent(ruleId)}`
}

/** The text "Copy fix prompt" puts on the clipboard for any coding agent
 *  (Cursor, Claude Code, Copilot, Codex…): everything the CLI said
 *  about the finding, nothing invented. */
export function fixPrompt(f: {
  rule_id: string
  title: string
  file_path?: string | null
  start_line?: number | null
  end_line?: number | null
  tool_name?: string | null
  explanation?: string | null
  suggested_fix?: string | null
}): string {
  const where = f.file_path
    ? `${f.file_path}${f.start_line ? `:${f.start_line}${f.end_line && f.end_line !== f.start_line ? `-${f.end_line}` : ''}` : ''}`
    : 'the repository root'
  const lines = [
    `Fix Trustabl finding ${f.rule_id} — ${f.title}`,
    `Location: ${where}${f.tool_name ? ` (${f.tool_name})` : ''}`,
  ]
  if (f.explanation) lines.push('', `Why: ${f.explanation.trim()}`)
  if (f.suggested_fix) lines.push('', `Suggested fix: ${f.suggested_fix.trim()}`)
  lines.push('', `Then re-run: trustabl scan .`)
  return lines.join('\n')
}

export function prettySdk(sdk: string): string {
  const map: Record<string, string> = {
    claude_agent_sdk: 'Claude Agent SDK',
    claude_sdk: 'Claude Agent SDK',
    openai_agents: 'OpenAI Agents SDK',
    openai_sdk: 'OpenAI Agents SDK',
    google_adk: 'Google ADK',
    mcp: 'MCP',
    langchain: 'LangChain',
    langgraph: 'LangGraph',
    crewai: 'CrewAI',
    pydantic_ai: 'Pydantic AI',
    vercel_ai: 'Vercel AI SDK',
    autogen: 'AutoGen',
    claude_skill: 'Claude skills',
    raw_llm_sdk: 'Raw LLM SDK',
    agent_config: 'Agent config',
    openshell: 'OpenShell',
  }
  return map[sdk] ?? sdk
}
