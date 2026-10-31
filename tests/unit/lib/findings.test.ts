import fs from 'node:fs'
import path from 'node:path'
import {
  countsAsOpen, fixPrompt, diffScans, locationOf, openCount, otelState, rankFindings, readiness, rulebookUrl, severityCounts,
} from '@/lib/findings'
import { fingerprint } from '@/lib/server/fingerprint'
import { parseTrustablSarif } from '@/lib/server/sarif'
import type { ScanResult, StoredFinding } from '@/lib/types'

const cli = path.join(__dirname, '..', '..', 'fixtures', 'cli')
const scan: ScanResult = JSON.parse(fs.readFileSync(path.join(cli, 'scan.json'), 'utf8'))
const sarifText = fs.readFileSync(path.join(cli, 'trustabl.sarif'), 'utf8')

function stored(f: ScanResult['findings'] extends (infer T)[] | null ? T : never, run = 'r1'): StoredFinding {
  return {
    run_id: run, repo_id: 'repo', fingerprint: fingerprint(f), rule_id: f.rule_id, category: f.category ?? null, scope: f.scope ?? null,
    severity: f.severity, confidence: f.confidence, title: f.title, explanation: f.explanation ?? null, suggested_fix: f.suggested_fix ?? null,
    tool_name: f.tool_name ?? null, file_path: f.file_path ?? null, start_line: f.start_line ?? null, end_line: f.end_line ?? null, origin: f.origin ?? null,
  }
}

describe('fingerprint', () => {
  it('matches the SARIF primaryLocationLineHash trustabl writes for every finding', () => {
    const sarif = JSON.parse(sarifText)
    const fromSarif = new Set<string>(sarif.runs[0].results.map((r: { partialFingerprints: { primaryLocationLineHash: string } }) => r.partialFingerprints.primaryLocationLineHash))
    const fromJson = new Set(scan.findings!.map((f) => fingerprint(f)))
    expect(fromJson.size).toBeGreaterThan(0)
    expect([...fromJson].sort()).toEqual([...fromSarif].sort())
  })
})

describe('SARIF import', () => {
  it('recovers the same findings as scan.json', () => {
    const imported = parseTrustablSarif(sarifText)
    expect(imported.toolName).toBe('trustabl')
    expect(imported.toolVersion).toBe('0.1.14')
    const key = (f: { rule_id: string; severity: string; file_path?: string; tool_name?: string; confidence: number; title: string }) =>
      [f.rule_id, f.severity, f.file_path ?? '', f.tool_name ?? '', f.confidence, f.title].join('|')
    expect(imported.findings.map(key).sort()).toEqual(scan.findings!.map(key).sort())
  })

  it('rejects SARIF from another tool', () => {
    const other = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'semgrep' } }, results: [] }] })
    expect(() => parseTrustablSarif(other)).toThrow(/not trustabl/)
  })

  it('rejects non-JSON', () => {
    expect(() => parseTrustablSarif('nope')).toThrow(/Not a JSON file/)
  })
})

describe('ranking and counts', () => {
  it('ranks by severity, then confidence', () => {
    const ranked = rankFindings(scan.findings!)
    for (let i = 1; i < ranked.length; i++) {
      const order = ['critical', 'high', 'medium', 'low', 'info']
      const a = order.indexOf(ranked[i - 1].severity)
      const b = order.indexOf(ranked[i].severity)
      expect(a).toBeLessThanOrEqual(b)
      if (a === b) expect(ranked[i - 1].confidence).toBeGreaterThanOrEqual(ranked[i].confidence)
    }
  })

  it('counts open findings by severity from the real scan', () => {
    const c = severityCounts(scan.findings!)
    expect(c).toEqual({ critical: 0, high: 4, medium: 3, low: 6 })
    expect(openCount(scan.findings!)).toBe(13)
  })

  it('the fixture has test-path findings and they never count', () => {
    const tests = scan.findings!.filter((f) => f.origin === 'test')
    expect(tests.length).toBeGreaterThan(0)
    expect(openCount(tests)).toBe(0)
  })

  it('excludes test-path and info findings from counts', () => {
    expect(countsAsOpen({ severity: 'high', origin: 'test' })).toBe(false)
    expect(countsAsOpen({ severity: 'info' })).toBe(false)
    expect(countsAsOpen({ severity: 'low' })).toBe(true)
  })

  it('turns overall_score into readiness', () => {
    expect(readiness(scan.overall_score)).toBe(64)
    expect(readiness(null)).toBeNull()
  })
})

describe('status by fingerprint', () => {
  const current = scan.findings!.map((f) => stored(f, 'r2'))
  it('first scan has no introduced or resolved findings', () => {
    const d = diffScans(current, null)
    expect(d.introduced).toHaveLength(0)
    expect(d.resolved).toHaveLength(0)
    expect(d.open).toHaveLength(current.length)
  })
  it('gone = resolved, new = introduced', () => {
    const previous = current.slice(2).map((f) => ({ ...f, run_id: 'r1' }))
    const extra = { ...current[0], fingerprint: 'gone', run_id: 'r1' }
    const d = diffScans(current, [...previous, extra])
    expect(d.introduced.map((f) => f.fingerprint)).toEqual(current.slice(0, 2).map((f) => f.fingerprint))
    expect(d.resolved.map((f) => f.fingerprint)).toEqual(['gone'])
  })
})

describe('OTel state', () => {
  it('reads the observability signals', () => {
    expect(otelState(scan)).toBe('absent')
    expect(otelState({ observability: [{ vendor: 'otel', kind: 'import', file: 'a.py', start_line: 1 }] })).toBe('imported')
    expect(otelState({ observability: [{ vendor: 'otel', kind: 'init', file: 'a.py', start_line: 2 }] })).toBe('emitting')
  })
})

describe('presentation helpers', () => {
  it('formats locations', () => {
    expect(locationOf({ file_path: 'agent.py', start_line: 12 })).toBe('agent.py:12')
    expect(locationOf({ file_path: '' })).toBe('repo')
  })
  it('links rule IDs to trustabl-rulebook', () => {
    expect(rulebookUrl('openai_sdk', 'OAI-005')).toBe('https://github.com/trustabl/trustabl-rulebook/blob/main/openai_sdk/POLICY_INDEX.md#:~:text=OAI-005')
  })
  it('builds the Copy fix prompt text from CLI text only', () => {
    const f = scan.findings!.find((x) => x.rule_id === 'OAI-005')!
    const text = fixPrompt(f)
    expect(text).toContain('OAI-005')
    expect(text).toContain(`agent.py:${f.start_line}-${f.end_line}`)
    expect(text).toContain(f.suggested_fix!.trim())
  })
})
