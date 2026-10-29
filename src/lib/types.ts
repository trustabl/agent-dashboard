// Shared types between the server and the browser. CLI output shapes mirror
// trustabl 0.1.15 (internal/models) and autofix 0.2.2 (internal/profile,
// internal/findings) — only the fields the Console reads are typed.

export type ConsoleTool = 'forge' | 'analyzer' | 'probe'
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export interface RunRow {
  id: string
  repo_id: string | null
  tool: ConsoleTool
  action: string
  status: RunStatus
  argv: string[]
  command: string
  cwd: string
  tool_version: string | null
  commit_sha: string | null
  rules_sha: string | null
  exit_code: number | null
  pid: number | null
  error: string | null
  options: Record<string, unknown>
  summary: Record<string, unknown>
  started_at: number
  finished_at: number | null
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** One `findings[]` entry of `trustabl scan --format json`. */
export interface ScanFinding {
  rule_id: string
  category?: string
  scope?: string
  severity: Severity
  tool_name?: string
  file_path?: string
  start_line?: number
  end_line?: number
  title: string
  explanation?: string
  suggested_fix?: string
  confidence: number
  origin?: string
}

export interface ObservabilitySignal {
  vendor: string
  kind: string
  detail?: string
  file: string
  start_line: number
}

/** The subset of the ScanResult the Console reads. */
export interface ScanResult {
  scan_id: string
  repo: string
  languages: string[] | null
  sdks: string[] | null
  tools: { name: string; kind?: string; language?: string; file_path: string; start_line?: number }[] | null
  agents: { name?: string; sdk?: string; class?: string; file_path?: string }[] | null
  hosted_tools: unknown[] | null
  mcp_servers: unknown[] | null
  subagents: { name: string; file_path?: string }[] | null
  skills: { name?: string }[] | null
  observability?: ObservabilitySignal[]
  findings: ScanFinding[] | null
  surfaces: { kind: string; name: string; file_path: string; score: number; finding_count: number }[] | null
  overall_score: number
  projected_scores?: { fix_critical: number; fix_high: number; fix_medium: number; fix_low: number; fix_all: number }
  rules_source?: string
  rules_version?: string
  rules_from_cache?: boolean
  no_agent_surfaces?: boolean
}

/** A finding as stored by the Console (one row per finding per scan). */
export interface StoredFinding {
  run_id: string
  repo_id: string
  fingerprint: string
  rule_id: string
  category: string | null
  scope: string | null
  severity: Severity
  confidence: number
  title: string
  explanation: string | null
  suggested_fix: string | null
  tool_name: string | null
  file_path: string | null
  start_line: number | null
  end_line: number | null
  origin: string | null
}

export type FindingStatus = 'open' | 'introduced' | 'resolved'

export interface Endpoint {
  host: string
  port: number
  protocol: string
  source?: string
}

/** probe.profile.json */
export interface ProbeProfile {
  schema_version: string
  generated_at: string
  class?: string
  source: string
  grant_set: string[] | null
  grant_set_hash?: string
  tools: { path: string; language?: string; harness_id?: string; cache_hit: boolean; egress: Endpoint[]; findings_count: number }[] | null
}

export interface ProbeEvidence {
  label?: string
  detail?: string
  raw_line?: string
  source?: string
}

/** probe.findings.json */
export interface ProbeFindings {
  schema_version: string
  generated_at: string
  class?: string
  source: string
  findings: {
    file?: string
    title: string
    description?: string
    severity: string
    score_impact?: number
    evidence?: ProbeEvidence[] | null
    fix_hint?: string
  }[]
}
