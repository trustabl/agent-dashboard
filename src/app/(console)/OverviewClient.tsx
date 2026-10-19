'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FolderGit2, Download } from 'lucide-react'
import { Button } from '@/components/ui'
import { EmptyState } from '@/components/patterns/EmptyState'
import {
  AccGrid, ErrorBox, Kpi, KpiGrid, Kv, Mono, PageHeader, Panel, RelTime, SevRow, Subtext, Toolbar, ToolbarActions, Unavailable,
} from '@/components/console/primitives'
import { AccRow, DataTable, FilterSelect, SearchField, SkeletonRows, Td } from '@/components/console/table'
import { useRunDialog, type OpenRunArgs } from '@/components/console/RunDialog'
import { RunHistory, runResult } from '@/components/console/RunHistory'
import { RunStatusPill } from '@/components/console/RunLog'
import { ArtifactViewer, artifactUrl } from '@/components/console/ArtifactViewer'
import { analyzerState, forgeState, issuesSummary, probeState, StateCell } from '@/components/console/cells'
import { post, refreshAll, useApi } from '@/lib/client/api'
import { useToast } from '@/components/ui/ToastContext'
import { prettySdk } from '@/lib/findings'
import { shortDateTime } from '@/lib/time'
import { plural, shortSha } from '@/lib/text'
import type { OverviewRow, RunBrief } from '@/lib/server/queries/views'

export interface OverviewData {
  rules: { sha: string; checkedAt: number } | null
  kpis: {
    repos: number
    notForged: number
    open: number
    openRepos: number
    lastWeekOpen: number | null
    emitting: number
    scanned: number
    notEmitting: string[]
    drafts: number
    untested: number
  }
  filters: { all: number; open: number; stale: number; otel: number }
  rows: OverviewRow[]
}

type Filter = 'all' | 'open' | 'stale' | 'otel'

export function OverviewClient() {
  const { openRun } = useRunDialog()
  const { data, error, isLoading } = useApi<OverviewData>('/api/overview')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [viewing, setViewing] = useState<{ runId: string; kind: string; repo: string } | null>(null)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (data?.rows ?? [])
      .filter((r) => filter === 'all' || r.tags[filter])
      .filter((r) => !s || `${r.repo.name} ${r.repo.path} ${r.className ?? ''} ${r.analyzer.sdks.join(' ')} ${r.forge.stamp?.sdks.join(' ') ?? ''} ${r.analyzer.languages.join(' ')}`.toLowerCase().includes(s))
  }, [data, search, filter])

  const k = data?.kpis
  const f = data?.filters
  return (
    <>
      <PageHeader title="Overview" lead="Per-repo record of Forge, Analyzer, and Probe. Click a tool column to open that product on the same repo. Generate a skill, scan, or probe from the toolbar or a repo row." />
      <KpiGrid>
        <Kpi label="Repos" value={k?.repos ?? 0} loading={isLoading} trend={k ? `${k.notForged} not yet forged` : undefined} />
        <Kpi
          label="Open findings"
          value={k?.open ?? 0}
          small={k ? `across ${plural(k.openRepos, 'repo')}` : undefined}
          loading={isLoading}
          trend={k ? weekTrend(k.open, k.lastWeekOpen) : undefined}
          tone={k && k.lastWeekOpen !== null ? (k.open < k.lastWeekOpen ? 'up' : k.open > k.lastWeekOpen ? 'down' : 'flat') : 'flat'}
        />
        <Kpi
          label="OTel profile"
          value={k?.emitting ?? 0}
          small={k ? `/ ${k.scanned} emitting` : undefined}
          loading={isLoading}
          trend={k ? (k.scanned === 0 ? 'no scans yet' : k.notEmitting.length ? `${k.notEmitting.join(', ')} not emitting` : 'every scanned repo emits') : undefined}
          tone={k?.notEmitting.length ? 'down' : 'flat'}
        />
        <Kpi label="Probe drafts" value={k?.drafts ?? 0} loading={isLoading} trend={k ? `${plural(k.untested, 'grant set')} untested` : undefined} tone={k?.untested ? 'down' : 'flat'} />
      </KpiGrid>

      <Toolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search repo, agent, or stack…" label="Search repos" />
        <ToolbarActions>
          <Button variant="ghost" onClick={() => openRun({ tool: 'forge' })}>Generate skill</Button>
          <Button variant="ghost" onClick={() => openRun({ tool: 'analyzer' })}>Scan repo</Button>
          <Button onClick={() => openRun({ tool: 'probe' })}>Run Probe</Button>
          <FilterSelect
            label="Filter repos"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={[
              { value: 'all', label: `All repos (${f?.all ?? 0})` },
              { value: 'open', label: `Has open findings (${f?.open ?? 0})` },
              { value: 'stale', label: `Stale or missing tool (${f?.stale ?? 0})` },
              { value: 'otel', label: `OTel gap (${f?.otel ?? 0})` },
            ]}
          />
        </ToolbarActions>
      </Toolbar>

      {error && <ErrorBox title="Could not load the overview">{(error as Error).message}</ErrorBox>}
      {data && data.rows.length === 0 ? (
        <EmptyState icon={FolderGit2} title="No repos yet" description="Run a local tool on a folder on this machine — it is added here. The agent does not have to be built yet." action={{ label: 'Run a local tool', onClick: () => openRun() }} />
      ) : (
        <OverviewTable
          rows={rows}
          loading={isLoading}
          emptyText={data && data.rows.length > 0 ? 'No repo matches this filter.' : null}
          onRun={openRun}
          onView={(runId, kind, repo) => setViewing({ runId, kind, repo })}
        />
      )}
      <RunHistory repoNames={Object.fromEntries((data?.rows ?? []).map((r) => [r.repo.id, r.repo.name]))} />
      {viewing && <ArtifactViewer runId={viewing.runId} kind={viewing.kind} title={`${viewing.kind} · ${viewing.repo}`} onClose={() => setViewing(null)} />}
    </>
  )
}

function weekTrend(open: number, lastWeek: number | null): string {
  if (lastWeek === null) return 'no scan older than a week to compare'
  if (open === lastWeek) return `same as last week (${lastWeek})`
  return `${open < lastWeek ? '↓' : '↑'} from ${lastWeek} last week`
}

const goto = 'group block w-full text-left rounded-(--radius-sharp) -m-1 p-1 hover:bg-(--color-bg-page) focus-visible:outline-2 focus-visible:outline-(--color-border-focus)'

export function OverviewTable({ rows, loading, emptyText, onRun, onView }: {
  rows: OverviewRow[]
  loading?: boolean
  emptyText?: string | null
  onRun: (a: OpenRunArgs) => void
  onView: (runId: string, kind: string, repo: string) => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <DataTable label="Repos" head={['', 'Repo', 'Stack', 'Forge', 'Analyzer', 'Probe', 'Issues']} widths={['36px', '21%', '17%', '14%', '13%', '14%', '17%']}>
      {loading && <SkeletonRows cols={7} />}
      {rows.map((r) => {
        const id = r.repo.id
        const sdks = r.analyzer.sdks.length ? r.analyzer.sdks : r.forge.stamp?.sdks ?? []
        return (
          <AccRow
            key={id}
            id={`ov-${id}`}
            testId={`overview-row-${r.repo.name}`}
            open={!!open[id]}
            onToggle={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
            colSpan={7}
            cells={[
              <Td key="repo">
                <b className="block truncate font-semibold">{r.repo.name}</b>
                <div className="font-mono text-sm text-(--color-text-secondary) truncate">
                  {r.className ?? 'agent not scanned'} · <Unavailable what="agent ID" />{r.analyzer.commitSha ? ` · ${shortSha(r.analyzer.commitSha)}` : ''}
                </div>
              </Td>,
              <Td key="stack">
                <span className="block truncate">{sdks.length ? [...new Set(sdks.map(prettySdk))].join(' · ') : <span className="text-(--color-text-tertiary)">stack not detected</span>}</span>
                <Subtext>{r.analyzer.languages.length ? `${r.analyzer.languages.join(', ')} · ` : ''}<Unavailable what="IDE/model" /></Subtext>
              </Td>,
              <Td key="forge"><Link href={`/forge?repo=${id}`} className={goto} aria-label={`Forge for ${r.repo.name}: ${forgeState(r.forge).label}`}><StateCell s={forgeState(r.forge)} /></Link></Td>,
              <Td key="analyzer"><Link href={`/analyzer?repo=${id}&open=issues`} className={goto} aria-label={`Analyzer for ${r.repo.name}: ${analyzerState(r.analyzer).label}`}><StateCell s={analyzerState(r.analyzer)} /></Link></Td>,
              <Td key="probe"><Link href={`/probe?repo=${id}`} className={goto} aria-label={`Probe for ${r.repo.name}: ${probeState(r.probe).label}`}><StateCell s={probeState(r.probe)} /></Link></Td>,
              <Td key="issues">
                <Link href={`/analyzer?repo=${id}&open=${r.analyzer.open || !r.analyzer.lastScan ? 'issues' : 'history'}`} className={goto} aria-label={`Issues for ${r.repo.name}: ${issuesSummary(r.analyzer)}`}>
                  <SevRow counts={r.analyzer.counts} />
                  <div className="text-sm text-(--color-text-tertiary) truncate group-hover:text-(--color-text-secondary)">{issuesSummary(r.analyzer)}</div>
                </Link>
              </Td>,
            ]}
            detail={<OverviewDetail r={r} onRun={onRun} onView={(runId, kind) => onView(runId, kind, r.repo.name)} />}
          />
        )
      })}
      {emptyText && rows.length === 0 && (
        <tr><Td colSpan={7} className="text-center text-(--color-text-tertiary) py-7">{emptyText}</Td></tr>
      )}
    </DataTable>
  )
}

function RunLine({ label, run }: { label: string; run: RunBrief | null }) {
  if (!run) return <Kv>{label} <span className="text-(--color-text-tertiary)">never run</span></Kv>
  return (
    <Kv>
      {label} <b>{shortDateTime(run.started_at)}</b> <RunStatusPill status={run.status} />{' '}
      <span title={runResult(run)}>· {runResult(run)}</span>
      {run.rules_sha ? <> · rules <Mono>{shortSha(run.rules_sha)}</Mono></> : null}
    </Kv>
  )
}

export function OverviewDetail({ r, onRun, onView }: { r: OverviewRow; onRun: (a: OpenRunArgs) => void; onView: (runId: string, kind: string) => void }) {
  const { toast } = useToast()
  const inv = r.inventory
  const id = r.repo.id
  const forgeCheck = async () => {
    try {
      await post('/api/runs', { tool: 'forge', action: 'check', repoId: id })
      toast('forge check started')
      refreshAll()
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const nextButton = (() => {
    switch (r.next.action) {
      case 'forge': return <Button size="sm" onClick={() => onRun({ tool: 'forge', repoId: id })}>{r.forge.exists ? 'Regenerate skill' : 'Generate skill'}</Button>
      case 'forge-check': return <Button size="sm" onClick={forgeCheck}>Run forge check</Button>
      case 'analyzer': return <Button size="sm" onClick={() => onRun({ tool: 'analyzer', repoId: id })}>{r.analyzer.lastScan ? 'Rescan' : 'Scan repo'}</Button>
      case 'probe': return <Button size="sm" onClick={() => onRun({ tool: 'probe', repoId: id, grantSet: r.probe.analyzerTools ? 'analyzer' : 'draft' })}>Run Probe</Button>
      default: return null
    }
  })()
  const linkBtn = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-(--radius-sharp) border border-(--color-border-muted) bg-(--color-bg-page) text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text-primary) hover:border-(--color-border-focus) cursor-pointer'
  return (
    <AccGrid>
      <Panel title="Inventory">
        {inv ? (
          <Kv>Agents <b>{inv.agents}</b> · tools <b>{inv.tools}</b> · MCP <b>{inv.mcp}</b> · subagents <b>{inv.subagents}</b> · skills <b>{inv.skills}</b></Kv>
        ) : (
          <Kv>Not scanned yet — inventory comes from <Mono>trustabl scan</Mono>.</Kv>
        )}
        <Kv>Grant-set hash {r.probe.grantSetHash ? <Mono title={r.probe.grantSetHash}>{shortSha(r.probe.grantSetHash)}</Mono> : <span className="text-(--color-text-tertiary)">no Probe run</span>}</Kv>
        <Kv>
          OTel profile <b>{r.analyzer.otel ?? 'not scanned'}</b>
          {r.otelSignals.length ? ` · ${[...new Set(r.otelSignals.map((s) => `${s.vendor} ${s.kind}`))].join(', ')}` : ''}
          {r.analyzer.otelRules.length ? ` · ${r.analyzer.otelRules.join(', ')}` : ''}
        </Kv>
        <div className="flex flex-wrap gap-2 mt-2.5">
          <Link href={`/repos/${id}`} className={linkBtn}>Open repo</Link>
          <Button size="sm" variant="ghost" onClick={() => onRun({ tool: 'analyzer', repoId: id })}>Rescan</Button>
          <Button size="sm" variant="ghost" onClick={() => onRun({ tool: 'probe', repoId: id, grantSet: r.probe.grantSetMode ?? (r.probe.analyzerTools ? 'analyzer' : 'draft') })}>Re-probe</Button>
          <Button size="sm" variant="ghost" onClick={() => onRun({ tool: 'forge', repoId: id })}>{r.forge.exists ? 'Regenerate' : 'Generate skill'}</Button>
        </div>
      </Panel>
      <Panel title="Latest runs">
        <RunLine label="Forge" run={r.latestRuns.forge} />
        <RunLine label="Analyzer" run={r.latestRuns.analyzer} />
        <RunLine label="Probe" run={r.latestRuns.probe} />
        {r.forge.staleReason && (
          <>
            <h4 className="m-0 mt-3 text-sm font-semibold text-(--color-text-primary)">Why the skill is stale</h4>
            <Kv>{r.forge.staleReason}</Kv>
          </>
        )}
      </Panel>
      <Panel title="Next">
        <Kv>{r.next.text}</Kv>
        {nextButton && <div className="flex flex-wrap gap-2 mt-2.5">{nextButton}</div>}
        <h4 className="m-0 mt-3 mb-1.5 text-sm font-semibold text-(--color-text-primary)">Artifacts</h4>
        {r.forge.exists || r.artifacts.length ? (
          <ul className="list-none m-0 p-0 flex flex-wrap gap-1.5">
            {r.forge.exists && (
              <li><a className={linkBtn} href={`/api/forge/skill?repo_id=${id}&download=1`} download><Download size={14} aria-hidden="true" />SKILL.md</a></li>
            )}
            {r.artifacts.map((a) => (
              <li key={`${a.runId}-${a.kind}`} className="inline-flex gap-1">
                <button type="button" className={linkBtn} onClick={() => onView(a.runId, a.kind)} aria-label={`View ${a.kind}`}><span className="font-mono">{a.kind === 'trustabl.sarif' ? 'SARIF' : a.kind}</span></button>
                <a className={linkBtn} href={artifactUrl(a.runId, a.kind)} download aria-label={`Download ${a.kind}`}><Download size={14} aria-hidden="true" /></a>
              </li>
            ))}
          </ul>
        ) : (
          <Kv><span className="text-(--color-text-tertiary)">None yet.</span></Kv>
        )}
        <p className="text-sm text-(--color-text-tertiary) mt-2 mb-0">Updated <RelTime at={Math.max(r.latestRuns.forge?.started_at ?? 0, r.latestRuns.analyzer?.started_at ?? 0, r.latestRuns.probe?.started_at ?? 0) || null} /></p>
      </Panel>
    </AccGrid>
  )
}
