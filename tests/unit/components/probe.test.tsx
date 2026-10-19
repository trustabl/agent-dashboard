// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ProbeTable, DraftPill } from '@/app/(console)/probe/ProbeClient'
import { ToastProvider } from '@/components/ui/ToastContext'
import { draftState, evaluateEgress, parseDraft, probeFlags, sessionExtras, uniqueEgress, cacheState } from '@/lib/probe'
import type { ProbeRepo } from '@/lib/server/queries/views'
import type { ProbeFindings, ProbeProfile } from '@/lib/types'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

// View rows built from recorded real `autofix fix` output (tests/fixtures/cli).
const cli = path.join(__dirname, '..', '..', 'fixtures', 'cli')
const ROOT = '/tmp/trustabl-fixtures/research-tools'

function fromRecorded(dir: string, extra: Partial<ProbeRepo> = {}): ProbeRepo {
  const read = (f: string) => fs.readFileSync(path.join(cli, dir, f), 'utf8')
  const profile = JSON.parse(read('probe.profile.json')) as ProbeProfile
  const findings = JSON.parse(read('probe.findings.json')) as ProbeFindings
  const yaml = read('network_policies.draft.yaml')
  const draft = parseDraft(yaml)
  const flags = probeFlags(findings, read('stderr.txt'))
  const egress = uniqueEgress(profile)
  const rel = (p: string) => p.slice(ROOT.length + 1)
  return {
    repo: { id: dir, name: 'research-tools', path: ROOT, created_at: 0 },
    lastRun: {
      id: `run-${dir}`, tool: 'probe', action: 'probe', status: 'succeeded', started_at: Date.parse(profile.generated_at), finished_at: null,
      command: `cd ${ROOT} && printf '%s\\n' q | autofix fix --class /runs/${dir}/class.yaml --sandbox --runner docker`, commit_sha: null, rules_sha: null, tool_version: '0.2.2', error: null, summary: {},
    },
    running: null,
    lastError: null,
    className: profile.class ?? null,
    grantSetHash: profile.grant_set_hash ?? null,
    grantSet: (profile.grant_set ?? []).map((p) => ({ path: p, label: rel(p) })),
    egress,
    perTool: (profile.tools ?? []).map((t) => ({ path: t.path, label: rel(t.path), cacheHit: t.cache_hit, harnessId: t.harness_id, egress: t.egress, findings: t.findings_count, skipped: /refund/.test(t.path) })),
    draft: draftState(draft, flags, egress),
    draftYaml: yaml,
    flags,
    extras: sessionExtras(findings),
    cache: cacheState(profile),
    runner: 'docker',
    grantSetMode: 'draft',
    inputs: { allowList: true, platformAllowList: false, denyList: false, envFixtures: false, allowWriteTools: false, noCache: false },
    lists: { allow: read('allow.txt').split('\n').filter((l) => l && !l.startsWith('#')), platform: [], deny: [] },
    evaluation: evaluateEgress(profile, draft, flags),
    observedFlagged: flags.flatMap((f) => f.details),
    skippedWriteTools: ['refund-tool/tool.py'],
    analyzerTools: 0,
    analyzerGrantSet: [],
    hasScan: true,
    untested: false,
    artifacts: ['probe.profile.json', 'probe.findings.json', 'network_policies.draft.yaml', 'autofix-attestation.json'],
    nextCommand: 'cd /x && autofix fix --class "$D/class.yaml"',
    ...extra,
  }
}

function untestedRepo(): ProbeRepo {
  const base = fromRecorded('probe-strict')
  return {
    ...base,
    repo: { id: 'acme', name: 'acme-support', path: '/w/acme-support', created_at: 0 },
    lastRun: null, className: null, grantSetHash: null, grantSet: [], egress: [], perTool: [], draft: { kind: 'none' }, draftYaml: null,
    flags: [], extras: [], cache: null, runner: null, grantSetMode: null, evaluation: [], skippedWriteTools: [], artifacts: [],
    analyzerTools: 2,
    analyzerGrantSet: [{ label: 'agent.py', tools: ['fetch'] }, { label: 'hosted_and_mcp.py', tools: ['lookup'] }],
    untested: true,
    nextCommand: 'cd /w/acme-support && D="$(mktemp -d)" && printf \'q\\n\' | autofix fix --class "$D/class.yaml" --sandbox',
  }
}

const renderTable = (repos: ProbeRepo[], onRun = vi.fn(), onView = vi.fn()) => {
  render(<ToastProvider><ProbeTable repos={repos} onRun={onRun} onView={onView} /></ToastProvider>)
  return { onRun, onView }
}

describe('Probe table', () => {
  it('has the design columns', () => {
    renderTable([fromRecorded('probe-strict')])
    for (const h of ['Repo / class', 'Grant set', 'Last run', 'Egress', 'Draft', 'Flags']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument()
  })

  it('shows class + grant-set hash, cache/runner, egress, draft and flags from real output', () => {
    renderTable([fromRecorded('probe-strict')])
    const row = screen.getByTestId('probe-row-research-tools')
    expect(row).toHaveTextContent('class research-tools · 47fd7b0')
    expect(row).toHaveTextContent('partial cache · Docker')
    expect(row).toHaveTextContent('1 destination')
    expect(row).toHaveTextContent('unsigned draft')
    expect(row).toHaveTextContent('not_in_org_allow')
  })

  it('withholds the draft of a broad allow-list run and says why', () => {
    renderTable([fromRecorded('probe-research')])
    const row = screen.getByTestId('probe-row-research-tools')
    expect(row).toHaveTextContent('withheld')
    expect(row).toHaveTextContent('broad_cidr')
    fireEvent.click(within(row).getByRole('button', { name: 'Expand row' }))
    expect(screen.getAllByText(/Draft withheld: the allow list you supplied has broad entries \(\*\.com\)/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Draft network policy')).not.toBeInTheDocument()
  })

  it('expands into per-tool egress, list evaluation, artifacts and separate session extras', () => {
    const { onView } = renderTable([fromRecorded('probe-strict')])
    fireEvent.click(screen.getByRole('button', { name: 'Expand row' }))
    expect(screen.getByText('Per-tool egress')).toBeInTheDocument()
    expect(screen.getByText('model client host n/a')).toBeInTheDocument()
    expect(screen.getByText('Observed ∩ declared-allow → draft')).toBeInTheDocument()
    const dest = screen.getByRole('list', { name: 'Destinations' })
    expect(dest).toHaveTextContent('api.perplexity.ai:443')
    expect(dest).toHaveTextContent('api.stripe.com:443')
    expect(screen.getByLabelText('Draft network policy')).toHaveTextContent('# unsigned')
    expect(screen.getByText('Session extras (not the lead)')).toBeInTheDocument()
    expect(screen.getByText('No error handling — tool crashes agent')).toBeInTheDocument()
    // Egress findings are not repeated as session extras.
    expect(screen.queryByText('Observed egress not on the declared allow list')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View network_policies.draft.yaml' }))
    expect(onView).toHaveBeenCalledWith('run-probe-strict', 'network_policies.draft.yaml', 'research-tools')
    expect(screen.queryByRole('button', { name: /\b(sign|bind|push)\b/i })).not.toBeInTheDocument()
  })

  it('offers Run Probe and Copy CLI on an untested Analyzer grant set', () => {
    const { onRun } = renderTable([untestedRepo()])
    const row = screen.getByTestId('probe-row-acme-support')
    expect(row).toHaveTextContent('fetch, lookup')
    expect(row).toHaveTextContent('untested')
    expect(row).toHaveTextContent('no profile')
    fireEvent.click(within(row).getByRole('button', { name: 'Expand row' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run Probe on this grant set' }))
    expect(onRun).toHaveBeenCalledWith({ repoId: 'acme', grantSet: 'analyzer' })
    expect(screen.getByRole('button', { name: /Copy CLI: cd \/w\/acme-support/ })).toBeEnabled()
  })
})

describe('draft pill', () => {
  it('labels each draft state', () => {
    render(<><DraftPill draft={{ kind: 'drafted', count: 2 }} /><DraftPill draft={{ kind: 'empty', reason: 'r' }} /><DraftPill draft={{ kind: 'none' }} /></>)
    expect(screen.getByText('unsigned draft')).toBeInTheDocument()
    expect(screen.getByText('not drafted')).toHaveAttribute('title', 'r')
    expect(screen.getByText('no profile')).toBeInTheDocument()
  })
})
