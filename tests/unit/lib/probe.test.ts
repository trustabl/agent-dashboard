import fs from 'node:fs'
import path from 'node:path'
import { cacheState, draftState, draftViolations, evaluateEgress, forbiddenDraftEntry, parseDraft, probeFlags, sessionExtras, uniqueEgress } from '@/lib/probe'
import type { ProbeFindings, ProbeProfile } from '@/lib/types'

const cli = path.join(__dirname, '..', '..', 'fixtures', 'cli')
const load = (dir: string) => ({
  profile: JSON.parse(fs.readFileSync(path.join(cli, dir, 'probe.profile.json'), 'utf8')) as ProbeProfile,
  findings: JSON.parse(fs.readFileSync(path.join(cli, dir, 'probe.findings.json'), 'utf8')) as ProbeFindings,
  draft: parseDraft(fs.readFileSync(path.join(cli, dir, 'network_policies.draft.yaml'), 'utf8')),
  stderr: fs.readFileSync(path.join(cli, dir, 'stderr.txt'), 'utf8'),
})

describe('probe output (broad allow list run)', () => {
  const r = load('probe-research')
  it('unions egress across tools', () => {
    expect(uniqueEgress(r.profile).map((e) => `${e.host}:${e.port}`)).toEqual(['api.perplexity.ai:443', 'api.stripe.com:443'])
  })
  it('reports broad_cidr from the CLI warning', () => {
    const flags = probeFlags(r.findings, r.stderr)
    expect(flags.map((f) => f.flag)).toEqual(['egress.broad_cidr'])
    expect(flags[0].details).toEqual(['*.com'])
  })
  it('reads the draft', () => {
    expect(r.draft!.outbound.map((e) => e.host)).toEqual(['api.stripe.com', 'api.perplexity.ai'])
    expect(draftState(r.draft, [], uniqueEgress(r.profile))).toEqual({ kind: 'drafted', count: 2 })
  })
  it('withholds a draft built from a broad allow list, and says why', () => {
    const s = draftState(r.draft, probeFlags(r.findings, r.stderr), uniqueEgress(r.profile))
    expect(s.kind).toBe('withheld')
    expect(s.kind === 'withheld' && s.reason).toMatch(/broad entries \(\*\.com\)/)
  })
  it('reports cache state per run', () => {
    expect(cacheState(r.profile)).toBe('partial cache')
  })
})

describe('probe output (strict allow list run)', () => {
  const r = load('probe-strict')
  it('flags a destination that is not on the allow list', () => {
    const flags = probeFlags(r.findings, r.stderr)
    expect(flags.map((f) => f.flag)).toEqual(['egress.not_in_org_allow'])
    expect(flags[0].details[0]).toMatch(/^api\.stripe\.com:443/)
  })
  it('drafts only what was observed and allowed', () => {
    const s = draftState(r.draft, probeFlags(r.findings, r.stderr), uniqueEgress(r.profile))
    expect(s).toEqual({ kind: 'drafted', count: 1 })
    expect(r.draft!.outbound.map((e) => e.host)).toEqual(['api.perplexity.ai'])
  })
  it('evaluates each destination: observed ∩ allow → draft, the rest flagged', () => {
    const ev = evaluateEgress(r.profile, r.draft, probeFlags(r.findings, r.stderr))
    expect(ev.map((e) => [e.host, e.outcome])).toEqual([['api.perplexity.ai', 'drafted'], ['api.stripe.com', 'flagged']])
    expect(ev[1].flags).toEqual(['egress.not_in_org_allow'])
  })
  it('keeps session extras separate from egress findings', () => {
    const extras = sessionExtras(r.findings).map((f) => f.title)
    expect(extras).toContain('No error handling — tool crashes agent')
    expect(extras).not.toContain('Observed egress not on the declared allow list')
    expect(extras).not.toContain("Class union grants some tools network access they don't individually need")
  })
})

describe('draft guard', () => {
  it('never accepts metadata, link-local or any-address entries', () => {
    for (const h of ['169.254.169.254', 'metadata.google.internal', '169.254.10.1', 'fe80::1', '0.0.0.0', '::', '0.0.0.0/0', '10.0.0.0/8']) {
      expect(forbiddenDraftEntry(h)).not.toBeNull()
    }
    expect(forbiddenDraftEntry('api.stripe.com')).toBeNull()
    expect(forbiddenDraftEntry('10.1.0.0/16')).toBeNull()
  })
  it('withholds a draft that contains one', () => {
    const draft = parseDraft('network_policies:\n  outbound:\n    - host: 0.0.0.0\n      port: 443\n      protocol: tcp\n')
    expect(draftViolations(draft)).toHaveLength(1)
    expect(draftState(draft, [], []).kind).toBe('withheld')
  })
  it('explains an empty draft blocked by flags', () => {
    const draft = parseDraft('network_policies:\n  outbound: []\n')
    const s = draftState(draft, [{ flag: 'egress.not_in_org_allow', details: ['x'], source: 's' }], [{ host: 'x', port: 443, protocol: 'tcp' }])
    expect(s.kind).toBe('empty')
    expect(s.kind === 'empty' && s.reason).toMatch(/flagged/)
  })
})
