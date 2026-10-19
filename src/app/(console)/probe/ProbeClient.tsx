'use client'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui'
import { EmptyState } from '@/components/patterns/EmptyState'
import { AccGrid, ErrorBox, Kv, Mono, Note, PageHeader, Panel, Pill, RelTime, Subtext, Toolbar, ToolbarActions, Unavailable, type Tone } from '@/components/console/primitives'
import { AccRow, DataTable, SearchField, SkeletonRows, Td } from '@/components/console/table'
import { useRunDialog, type OpenRunArgs } from '@/components/console/RunDialog'
import { CopyCli } from '@/components/console/CopyCli'
import { RunStatusPill } from '@/components/console/RunLog'
import { ArtifactLinks, ArtifactViewer } from '@/components/console/ArtifactViewer'
import { useApi } from '@/lib/client/api'
import { shortDateTime } from '@/lib/time'
import { plural, shortSha } from '@/lib/text'
import type { DraftState, ProbeFlag } from '@/lib/probe'
import type { ProbeRepo } from '@/lib/server/queries/views'

interface View {
  repos: ProbeRepo[]
}

interface RunnerCheck {
  runner: { runner: 'docker' | 'openshell'; ok: boolean; detail: string; fix?: string; command: string }
  llmKeyEnv: string[]
}

const RUNNER_LABEL: Record<string, string> = { docker: 'Docker', openshell: 'OpenShell' }

export function ProbeClient() {
  const params = useSearchParams()
  const focusRepo = params.get('repo')
  const { openRun } = useRunDialog()
  const { data, error, isLoading } = useApi<View>('/api/probe')
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<{ runId: string; kind: string; repo: string } | null>(null)

  const repos = useMemo(() => {
    const s = search.trim().toLowerCase()
    const list = data?.repos ?? []
    return s ? list.filter((r) => `${r.repo.name} ${r.className ?? ''} ${r.grantSet.map((g) => g.label).join(' ')} ${r.analyzerGrantSet.map((g) => g.tools.join(' ')).join(' ')}`.toLowerCase().includes(s)) : list
  }, [data, search])

  return (
    <>
      <PageHeader
        title="Probe"
        badge={<Pill>was autofix</Pill>}
        lead={<>Harness-run the grant set, record network egress, emit an unsigned OpenShell <Mono>network_policies.draft.yaml</Mono>. Secondary session findings stay on the report; they are not the product sentence.</>}
      />
      <Toolbar>
        <p className="m-0 text-base text-(--color-text-secondary)">Works on a grant set Analyzer already extracted, or on a repo whose agent is still a draft.</p>
        <ToolbarActions>
          <RunnerStatus />
          <Button onClick={() => openRun({ tool: 'probe' })}>Run Probe</Button>
        </ToolbarActions>
      </Toolbar>
      {error && <ErrorBox title="Could not load Probe runs">{(error as Error).message}</ErrorBox>}
      {data && data.repos.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No repos yet"
          description="Run Probe on a folder on this machine — scan it with Analyzer first to probe exactly the tools it extracts, or probe it as a draft agent."
          action={{ label: 'Run Probe', onClick: () => openRun({ tool: 'probe' }) }}
        />
      ) : (
        <>
          {data && data.repos.length > 0 && (
            <div className="mb-2"><SearchField value={search} onChange={setSearch} placeholder="Search repos, classes, tools…" label="Search Probe runs" /></div>
          )}
          <ProbeTable
            repos={repos}
            loading={isLoading}
            focusRepo={focusRepo}
            emptyText={data && data.repos.length > 0 ? `No repo matches “${search}”.` : null}
            onRun={(a) => openRun({ tool: 'probe', ...a })}
            onView={(runId, kind, repo) => setViewing({ runId, kind, repo })}
          />
        </>
      )}
      <p className="text-sm text-(--color-text-secondary) mt-1.5">
        Every run is <Mono>autofix fix --class … --sandbox --no-sign</Mono> into the run folder: your repo is never written to and no generated fix is applied.
        Drafts stay unsigned — there is no sign, bind or push here.
      </p>
      {viewing && <ArtifactViewer runId={viewing.runId} kind={viewing.kind} title={`${viewing.kind} · ${viewing.repo}`} onClose={() => setViewing(null)} />}
    </>
  )
}

/** Both sandbox runners, checked on load (the run dialog checks the chosen one again before Start). */
function RunnerStatus() {
  const { data: docker } = useApi<RunnerCheck>('/api/preflight?runner=docker', { refreshInterval: 60_000 })
  const { data: openshell } = useApi<RunnerCheck>('/api/preflight?runner=openshell', { refreshInterval: 60_000 })
  const one = (label: string, c?: RunnerCheck) => (
    <span title={c ? (c.runner.ok ? c.runner.detail : `${c.runner.detail} Fix: ${c.runner.fix ?? ''}`) : 'Checking…'}>
      <Pill tone={!c ? 'neutral' : c.runner.ok ? 'success' : 'danger'}>
        {label} {!c ? '…' : c.runner.ok ? 'ready' : 'unreachable'}
      </Pill>
    </span>
  )
  const neither = docker && openshell && !docker.runner.ok && !openshell.runner.ok
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-sm text-(--color-text-secondary)" data-testid="probe-runners">
      Runner {one('Docker', docker)} {one('OpenShell', openshell)}
      {neither && <span className="sr-only">No sandbox runner is reachable. {docker.runner.fix} {openshell.runner.fix}</span>}
    </span>
  )
}

export function ProbeTable({ repos, loading, focusRepo, emptyText, onRun, onView }: {
  repos: ProbeRepo[]
  loading?: boolean
  focusRepo?: string | null
  emptyText?: string | null
  onRun: (a: OpenRunArgs) => void
  onView: (runId: string, kind: string, repo: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const isOpen = (id: string) => (id in expanded ? expanded[id] : focusRepo === id)
  return (
    <DataTable label="Probe runs by repo" head={['', 'Repo / class', 'Grant set', 'Last run', 'Egress', 'Draft', 'Flags']} widths={['36px', '21%', '20%', '13%', '15%', '13%', '18%']}>
      {loading && <SkeletonRows cols={7} />}
      {repos.map((r) => (
        <AccRow
          key={r.repo.id}
          id={`pb-${r.repo.id}`}
          testId={`probe-row-${r.repo.name}`}
          open={isOpen(r.repo.id)}
          highlight={focusRepo === r.repo.id}
          onToggle={() => setExpanded((e) => ({ ...e, [r.repo.id]: !isOpen(r.repo.id) }))}
          colSpan={7}
          cells={[
            <Td key="repo">
              <b className="block truncate font-semibold">{r.repo.name}</b>
              <div className="font-mono text-sm text-(--color-text-secondary) truncate" title={r.grantSetHash ?? undefined}>{classLine(r)}</div>
            </Td>,
            <Td key="gs"><GrantSetCell r={r} /></Td>,
            <Td key="last">
              {r.running ? (
                <RunStatusPill status="running" />
              ) : r.lastRun ? (
                <>
                  <Mono>{shortDateTime(r.lastRun.started_at)}</Mono>
                  <Subtext>{[r.cache, r.runner ? RUNNER_LABEL[r.runner] ?? r.runner : null].filter(Boolean).join(' · ')}</Subtext>
                </>
              ) : (
                <span className="text-(--color-text-tertiary)">never</span>
              )}
              {r.lastError && !r.running && <div><Pill tone="danger" title={r.lastError.error ?? undefined}>last run {r.lastError.status}</Pill></div>}
            </Td>,
            <Td key="egress">
              {r.lastRun ? (
                <>
                  <span>{plural(r.egress.length, 'destination')}</span>
                  <Subtext>{r.egress.length ? r.egress.map((e) => e.host).join(', ') : 'no egress observed'}</Subtext>
                </>
              ) : (
                <span className="text-(--color-text-tertiary)">—</span>
              )}
            </Td>,
            <Td key="draft"><DraftPill draft={r.draft} /></Td>,
            <Td key="flags"><FlagsCell r={r} /></Td>,
          ]}
          detail={<ProbeDetail r={r} onRun={onRun} onView={(kind) => r.lastRun && onView(r.lastRun.id, kind, r.repo.name)} />}
        />
      ))}
      {emptyText && repos.length === 0 && (
        <tr><Td colSpan={7} className="text-center text-(--color-text-tertiary) py-7">{emptyText}</Td></tr>
      )}
    </DataTable>
  )
}

function classLine(r: ProbeRepo): string {
  if (r.lastRun) return `class ${r.className ?? 'n/a'}${r.grantSetHash ? ` · ${shortSha(r.grantSetHash)}` : ''}`
  if (r.analyzerTools) return 'not probed · Analyzer grant set ready'
  return r.hasScan ? 'not probed · no tools extracted' : 'not probed · not scanned'
}

function toolNames(labels: string[]): string {
  return labels.join(', ')
}

function GrantSetCell({ r }: { r: ProbeRepo }) {
  if (r.lastRun && r.grantSet.length) {
    const text = toolNames(r.grantSet.map((g) => g.label))
    return (
      <>
        <span className="block truncate" title={text}>{text}</span>
        <Subtext>{r.grantSetMode === 'draft' ? 'draft agent' : 'Analyzer grant set'} · {plural(r.grantSet.length, 'file')}</Subtext>
      </>
    )
  }
  if (r.analyzerGrantSet.length) {
    const text = r.analyzerGrantSet.flatMap((g) => g.tools).join(', ')
    return (
      <>
        <span className="block truncate" title={text}>{text}</span>
        <Subtext>from Analyzer · {plural(r.analyzerTools, 'tool')}</Subtext>
      </>
    )
  }
  return <span className="text-(--color-text-tertiary)">{r.hasScan ? 'no tools found' : 'draft agent'}</span>
}

const DRAFT_TONE: Record<DraftState['kind'], Tone> = { drafted: 'success', empty: 'danger', withheld: 'danger', none: 'neutral' }

export function DraftPill({ draft }: { draft: DraftState }) {
  const label = draft.kind === 'drafted' ? 'unsigned draft' : draft.kind === 'empty' ? 'not drafted' : draft.kind === 'withheld' ? 'withheld' : 'no profile'
  const title = draft.kind === 'drafted' ? `${plural(draft.count, 'outbound entry', 'outbound entries')} · unsigned` : draft.kind === 'none' ? undefined : draft.reason
  // Nothing reached the network: an empty draft is the right answer, not a risk.
  const tone = draft.kind === 'empty' && draft.noEgress ? 'neutral' : DRAFT_TONE[draft.kind]
  return <Pill tone={tone} title={title}>{label}</Pill>
}

const FLAG_TONE: Record<ProbeFlag, Tone> = {
  'egress.denied_class': 'danger',
  'egress.broad_cidr': 'warning',
  'egress.not_in_org_allow': 'warning',
}

function FlagsCell({ r }: { r: ProbeRepo }) {
  const pills = r.flags.map((f) => <Pill key={f.flag} tone={FLAG_TONE[f.flag]} title={f.details.join('\n')}>{f.flag.replace(/^egress\./, '')}</Pill>)
  return (
    <>
      <span className="inline-flex flex-wrap gap-1">
        {pills}
        {r.untested && <Pill tone="warning" title="The Analyzer grant set has no Probe run yet">untested</Pill>}
        {r.lastRun && !r.flags.length && !r.untested && <Pill tone="success">clean</Pill>}
        {!r.lastRun && !r.untested && <span className="text-(--color-text-tertiary)">—</span>}
      </span>
      {r.lastRun && r.extras.length > 0 && <Subtext>{plural(r.extras.length, 'session finding')}</Subtext>}
    </>
  )
}

function ProbeDetail({ r, onRun, onView }: { r: ProbeRepo; onRun: (a: OpenRunArgs) => void; onView: (kind: string) => void }) {
  const errorBox = r.lastError && (
    <ErrorBox title={`Last Probe run ${r.lastError.status}`}>
      <pre className="run-log m-0 whitespace-pre-wrap">{r.lastError.error}</pre>
      <div className="mt-2"><CopyCli command={r.lastError.command} label="Copy CLI to reproduce" /></div>
    </ErrorBox>
  )
  if (!r.lastRun) {
    return (
      <Panel>
        {errorBox}
        {r.running && <Kv>A Probe run is in progress — it keeps going if you leave this page.</Kv>}
        {r.analyzerTools > 0 ? (
          <>
            <Kv>
              Analyzer already extracted the grant set ({r.analyzerGrantSet.flatMap((g) => g.tools).join(', ')}). Run Probe against that set with staging or
              test-mode credentials — do not point the harness at production keys.
            </Kv>
            <div className="flex flex-wrap gap-2 mt-2.5">
              <Button size="sm" onClick={() => onRun({ repoId: r.repo.id, grantSet: 'analyzer' })} disabled={!!r.running}>Run Probe on this grant set</Button>
              <CopyCli command={r.nextCommand} />
            </div>
          </>
        ) : (
          <>
            <Kv>
              {r.hasScan ? 'The latest Analyzer scan extracted no tools.' : 'Not scanned by Analyzer yet.'} Probe can still run it as a draft agent and find
              entrypoints itself{r.hasScan ? '' : ', or scan it first to probe exactly the tools Analyzer finds'}.
            </Kv>
            <div className="flex flex-wrap gap-2 mt-2.5">
              <Button size="sm" onClick={() => onRun({ repoId: r.repo.id, grantSet: 'draft' })} disabled={!!r.running}>Run Probe as a draft agent</Button>
              {!r.hasScan && <Link href={`/analyzer?repo=${r.repo.id}`} className="inline-flex items-center h-8 px-2.5 rounded-(--radius-sharp) border border-(--color-border-muted) text-sm font-medium">Scan in Analyzer</Link>}
              <CopyCli command={r.nextCommand} />
            </div>
          </>
        )}
      </Panel>
    )
  }
  const shown = r.artifacts.filter((k) => k !== 'autofix-attestation.json')
  return (
    <>
      {errorBox}
      <AccGrid>
        <Panel title="Per-tool egress">
          <ul className="list-none m-0 p-0">
            {r.perTool.map((t) => (
              <li key={t.path} className="py-1.5 border-t border-(--color-border-muted) first:border-t-0">
                <div className="text-base font-semibold text-(--color-text-primary) break-words">{t.label}</div>
                <div className="font-mono text-sm text-(--color-text-secondary) break-words">
                  {t.skipped
                    ? 'not executed — side-effect tool (re-run with --allow-write-tools and staging keys)'
                    : t.egress.length
                      ? t.egress.map((e) => `${e.host}:${e.port} ${e.protocol}${e.source ? ` (${e.source})` : ''}`).join(' · ')
                      : 'network none observed'}
                </div>
                <Subtext>{t.cacheHit ? 'cache hit' : 'fresh'}{t.harnessId ? ` · ${t.harnessId}` : ''} · {plural(t.findings, 'finding')}</Subtext>
              </li>
            ))}
            <li className="py-1.5 border-t border-(--color-border-muted)">
              <div className="text-base font-semibold text-(--color-text-primary)">model client</div>
              <div className="text-sm"><Unavailable what="model client host" /></div>
            </li>
          </ul>
        </Panel>
        <ListEvaluation r={r} />
        <Panel title="Draft and artifacts">
          <Kv><DraftPill draft={r.draft} /></Kv>
          {(r.draft.kind === 'empty' || r.draft.kind === 'withheld') && <Kv>{r.draft.reason}</Kv>}
          {r.draft.kind === 'drafted' && r.draftYaml && (
            <pre className="run-log m-0 mt-2 max-h-56 overflow-auto rounded-(--radius-sharp) border border-(--color-border-muted) bg-(--color-bg-page) p-2.5 text-sm" aria-label="Draft network policy">
              {draftExcerpt(r.draftYaml)}
            </pre>
          )}
          {r.draft.kind === 'withheld' && <Note>The file Probe wrote stays downloadable below, byte for byte; it is not offered as a draft.</Note>}
          <div className="mt-2.5">
            <ArtifactLinks runId={r.lastRun.id} kinds={shown} onView={onView} />
          </div>
          <div className="flex flex-wrap gap-2 mt-2.5">
            <Button size="sm" variant="secondary" onClick={() => onRun({ repoId: r.repo.id, grantSet: r.grantSetMode ?? undefined })} disabled={!!r.running}>Re-probe</Button>
            <CopyCli command={r.lastRun.command} />
          </div>
        </Panel>
      </AccGrid>
      <SessionExtras r={r} />
      {r.untested && (
        <Panel>
          <Kv>The Analyzer grant set changed since this run ({r.analyzerGrantSet.flatMap((g) => g.tools).join(', ')}) and has not been probed yet.</Kv>
          <div className="flex flex-wrap gap-2 mt-2.5">
            <Button size="sm" onClick={() => onRun({ repoId: r.repo.id, grantSet: 'analyzer' })} disabled={!!r.running}>Run Probe on this grant set</Button>
            <CopyCli command={r.nextCommand} />
          </div>
        </Panel>
      )}
    </>
  )
}

/** The `network_policies` block of the draft, plus the unsigned marker. */
function draftExcerpt(yaml: string): string {
  const i = yaml.indexOf('network_policies:')
  return `${i >= 0 ? yaml.slice(i).trimEnd() : yaml.trimEnd()}\n# unsigned — written by Probe, not signed or pushed by the Console`
}

const OUTCOME_TONE = { drafted: 'success', flagged: 'warning', excluded: 'neutral' } as const

function ListEvaluation({ r }: { r: ProbeRepo }) {
  const denied = r.flags.find((f) => f.flag === 'egress.denied_class')
  const broad = r.flags.find((f) => f.flag === 'egress.broad_cidr')
  const list = (name: string, entries: string[], none: string) => (
    <Kv>
      {name} {entries.length ? <Mono title={entries.join('\n')}>{entries.slice(0, 4).join(', ')}{entries.length > 4 ? ` +${entries.length - 4}` : ''}</Mono> : <span className="text-(--color-text-tertiary)">{none}</span>}
    </Kv>
  )
  return (
    <Panel title="List evaluation">
      <Kv>Observed ∩ declared-allow → draft</Kv>
      {list('Allow list', r.lists.allow, 'not supplied — every observed destination may be drafted')}
      {list('Platform allow list', r.lists.platform, 'not supplied')}
      {list('Deny list', r.lists.deny, 'none of yours (Console adds 0.0.0.0 and ::)')}
      <Kv>Env fixtures {r.inputs.envFixtures ? 'supplied (values never stored)' : 'not supplied'} · write tools {r.inputs.allowWriteTools ? <b>allowed</b> : 'skipped'} · cache {r.inputs.noCache ? 'off' : 'on'}</Kv>
      <Kv>Built-in deny (metadata / link-local) · {denied ? <Pill tone="danger">hit</Pill> : 'none hit'}</Kv>
      <Kv>{broad ? <>Broad allow-list entries: <Mono>{broad.details.join(', ')}</Mono></> : 'No broad CIDR'}</Kv>
      {r.evaluation.length > 0 && (
        <ul className="list-none m-0 mt-2 p-0" aria-label="Destinations">
          {r.evaluation.map((e) => (
            <li key={`${e.host}:${e.port}`} className="flex flex-wrap items-center gap-1.5 py-1 border-t border-(--color-border-muted) first:border-t-0">
              <Mono>{e.host}:{e.port}</Mono>
              <Pill tone={OUTCOME_TONE[e.outcome]}>{e.outcome === 'drafted' ? 'in draft' : e.outcome === 'flagged' ? 'flagged' : 'not drafted'}</Pill>
              {e.flags.map((f) => <Pill key={f} tone={FLAG_TONE[f]}>{f}</Pill>)}
            </li>
          ))}
        </ul>
      )}
      {r.flags.length > 0 && (
        <div className="mt-2">
          {r.flags.map((f) => (
            <Kv key={f.flag}>
              <Pill tone={FLAG_TONE[f.flag]}>{f.flag}</Pill> {f.details.join('; ')} <span className="text-sm text-(--color-text-tertiary)">· from {f.source}</span>
            </Kv>
          ))}
        </div>
      )}
      {r.skippedWriteTools.length > 0 && (
        <Note>Skipped side-effect tool(s): {r.skippedWriteTools.join(', ')}. Re-probe with --allow-write-tools only against staging or test-mode keys.</Note>
      )}
    </Panel>
  )
}

const SEV_TONE: Record<string, Tone> = { critical: 'danger', high: 'danger', warning: 'warning', medium: 'warning', low: 'neutral', info: 'neutral' }

function SessionExtras({ r }: { r: ProbeRepo }) {
  if (!r.extras.length) {
    return <Panel title="Session extras (not the lead)"><Note>No session findings.</Note></Panel>
  }
  return (
    <Panel title="Session extras (not the lead)">
      <p className="m-0 mb-2 text-sm text-(--color-text-tertiary)">Hangs, crashes, secrets, PII and output size Probe noticed while harnessing. They are kept on the report; the egress result above is the product.</p>
      <ul className="list-none m-0 p-0">
        {r.extras.map((f, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-2 py-1.5 border-t border-(--color-border-muted) first:border-t-0">
            <Pill tone={SEV_TONE[f.severity] ?? 'neutral'}>{f.severity}</Pill>
            <span className="text-base text-(--color-text-primary)">{f.title}</span>
            {f.file && <Mono>{relFile(f.file, r.repo.path)}</Mono>}
            {f.evidence?.[0]?.detail && <span className="basis-full text-sm text-(--color-text-secondary)">{f.evidence[0].detail}</span>}
          </li>
        ))}
      </ul>
      <Note>Last run <RelTime at={r.lastRun?.started_at} />.</Note>
    </Panel>
  )
}

function relFile(file: string, root: string): string {
  return file.startsWith(root + '/') ? file.slice(root.length + 1) : file
}
