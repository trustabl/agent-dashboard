import fs from 'node:fs'
import path from 'node:path'
import { outlineSkill, parseForgeCheck, parseNoSdk, parseStamp, staleReason } from '@/lib/forge'

const cli = path.join(__dirname, '..', '..', 'fixtures', 'cli')
const read = (f: string) => fs.readFileSync(path.join(cli, f), 'utf8')
const skill = read('SKILL.md')

describe('forge stamp', () => {
  it('parses the stamp trustabl forge writes', () => {
    const s = parseStamp(skill)!
    expect(s.raw).toMatch(/^<!-- generated: /)
    expect(s.rules).toMatch(/^[0-9a-f]{40}$/)
    expect(s.schema).toBe('23')
    expect(s.template).toBe('3')
    expect(s.sdks).toEqual(['openai_sdk'])
  })
  it('returns null without a stamp', () => {
    expect(parseStamp('# hello')).toBeNull()
  })
})

describe('skill outline', () => {
  it('reads what the skill instructs from its headings', () => {
    const o = outlineSkill(skill)
    expect(o.hasApplyLoop).toBe(true)
    expect(o.otel).toBe('encoded')
    expect(o.tracingLanguages).toEqual(['Python'])
    expect(o.sections.length).toBeGreaterThan(0)
    const scopes = o.sections.flatMap((s) => s.scopes.map((x) => x.scope))
    expect(scopes).toContain('Tool')
    expect(o.sections.flatMap((s) => s.scopes.flatMap((x) => x.rules))).toContain('OAI-005')
  })
  it('grades OTel', () => {
    expect(outlineSkill('## Runtime Tracing\n### Step 1 — Emit spans\n').otel).toBe('partial')
    expect(outlineSkill('## Something\n').otel).toBe('none')
  })
})

describe('forge check', () => {
  it('pass', () => {
    const r = parseForgeCheck(0, read('forge-check.pass.txt'), '')
    expect(r.status).toBe('pass')
    expect(r.currentRules).toMatch(/^[0-9a-f]{7}$/)
  })
  it('stale rules', () => {
    const r = parseForgeCheck(1, read('forge-check.stale-rules.txt'), '')
    expect(r).toMatchObject({ status: 'stale', cause: 'rules', stampRules: '0123456' })
    expect(staleReason(r)).toMatch(/stamp rules 0123456 ≠ current [0-9a-f]{7}/)
  })
  it('stale template', () => {
    const r = parseForgeCheck(1, read('forge-check.stale-template.txt'), '')
    expect(r).toMatchObject({ status: 'stale', cause: 'template', stampTemplate: '2', currentTemplate: '3' })
  })
  it('stale both', () => {
    const r = parseForgeCheck(1, read('forge-check.stale-both.txt'), '')
    expect(r).toMatchObject({ status: 'stale', cause: 'rules+template', stampRules: '0123456', stampTemplate: '2', currentTemplate: '3' })
  })
  it('unstamped and missing', () => {
    expect(parseForgeCheck(1, '', read('forge-check.unstamped.txt')).status).toBe('unstamped')
    expect(parseForgeCheck(1, '', read('forge-check.missing.txt')).status).toBe('missing')
  })
  it('environment error', () => {
    expect(parseForgeCheck(2, '', 'boom').status).toBe('error')
  })
})

describe('no SDK detected', () => {
  it('reads the accepted --policy categories from the CLI error', () => {
    const r = parseNoSdk(read('forge.nosdk.stderr.txt'))
    expect(r.noSdk).toBe(true)
    expect(r.categories).toContain('claude_sdk')
    expect(r.categories).toContain('agent_config')
  })
})
