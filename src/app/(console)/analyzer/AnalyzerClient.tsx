'use client'
import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ScanSearch, Upload, Download } from 'lucide-react'
import { Button } from '@/components/ui'
import { EmptyState } from '@/components/patterns/EmptyState'
import {
  Conf, ErrorBox, Kpi, KpiGrid, Mono, Note, PageHeader, Panel, Pill, RelTime, Sev, SevRow, Spark, Subtext, Toolbar, ToolbarActions, Unavailable,
} from '@/components/console/primitives'
import { AccRow, Chips, DataTable, PageTabs, SearchField, SkeletonRows, Td } from '@/components/console/table'
import { useRunDialog } from '@/components/console/RunDialog'
import { CopyCli } from '@/components/console/CopyCli'
import { RunStatusPill } from '@/components/console/RunLog'
import { ImportSarif } from './ImportSarif'
import { useApi } from '@/lib/client/api'
import { cursorPrompt, locationOf, readinessTone, rulebookUrl } from '@/lib/findings'
import { shortDateTime } from '@/lib/time'
import { shortSha } from '@/lib/text'
import type { AnalyzerRepo, FindingView } from '@/lib/server/queries/views'

interface View {
  kpis: {
    open: number
    resolved: number
    introduced: number
    introducedRepos: string[]
    otelGaps: number
    otelRules: string[]
    bestReadiness: number | null
    bestRepo: string | null
    scannedRepos: number
  }
  repos: AnalyzerRepo[]
}

type StatusFilter = 'open' | 'resolved' | 'introduced' | 'all'

export function AnalyzerClient() {
  const params = useSearchParams()
  const router = useRouter()
  const { openRun } = useRunDialog()
  const [includeTests, setIncludeTests] = useState(false)
  const q = includeTests ? '?include_tests=1' : ''
  const { data, error, isLoading } = useApi<View>(`/api/scans${q}`)
  const tab = (params.get('tab') === 'all' ? 'all' : 'byrepo') as 'byrepo' | 'all'
  const focusRepo = params.get('repo')
  const focusOpen = (params.get('open') as 'issues' | 'history' | null) ?? 'issues'
  const [expanded, setExpanded] = useState<Record<string, 'issues' | 'history' | undefined>>({})
  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const setTab = (t: 'byrepo' | 'all') => {
    const sp = new URLSearchParams(params.toString())
    if (t === 'all') sp.set('tab', 'all')
    else sp.delete('tab')
    router.replace(`/analyzer${sp.size ? `?${sp}` : ''}`, { scroll: false })
  }

  const stateFor = (id: string): 'issues' | 'history' | undefined =>
    id in expanded ? expanded[id] : focusRepo === id ? focusOpen : undefined
  const toggle = (id: string, which: 'issues' | 'history') =>
    setExpanded((e) => ({ ...e, [id]: stateFor(id) === which ? undefined : which }))

  const repos = useMemo(() => {
    const s = search.trim().toLowerCase()
    const list = data?.repos ?? []
    return s ? list.filter((r) => `${r.repo.name} ${r.agent ?? ''} ${r.repo.path}`.toLowerCase().includes(s)) : list
  }, [data, search])

  const k = data?.kpis
  return (
    <>
      <PageHeader
        title="Analyzer"
        lead="Default is per repo: severity counts and scan history. Open findings are ranked severity then confidence. Status is a rescan fingerprint — gone is resolved, still present is open, new is introduced."
      />
      <KpiGrid>
        <Kpi label="Open" value={k?.open ?? 0} loading={isLoading} trend={k ? `${k.resolved} resolved on last rescans` : undefined} tone={k?.resolved ? 'up' : 'flat'} />
        <Kpi
          label="Introduced since last"
          value={k?.introduced ?? 0}
          loading={isLoading}
          trend={k ? (k.introduced ? `on ${k.introducedRepos.join(', ')}` : 'none on the latest rescans') : undefined}
          tone={k?.introduced ? 'down' : 'flat'}
        />
        <Kpi
          label="OTel gaps"
          value={k?.otelGaps ?? 0}
          loading={isLoading}
          trend={k ? (k.otelGaps ? k.otelRules.join(', ') || 'no initialized tracing found' : k.scannedRepos ? 'all scanned repos emitting' : 'no scans yet') : undefined}
          tone={k?.otelGaps ? 'down' : 'flat'}
        />
        <Kpi label="Best readiness" value={k?.bestReadiness ?? '—'} loading={isLoading} trend={k?.bestRepo ?? (k ? (k.scannedRepos ? 'latest scans carry no score (SARIF import)' : 'no scans yet') : undefined)} tone={k?.bestRepo ? 'up' : 'flat'} />
      </KpiGrid>

      <PageTabs value={tab} onChange={setTab} tabs={[{ value: 'byrepo', label: 'By repo' }, { value: 'all', label: 'All findings' }]} />

      {error && <ErrorBox title="Could not load scans">{(error as Error).message}</ErrorBox>}

      {tab === 'byrepo' ? (
        <div role="tabpanel" id="pane-byrepo" aria-labelledby="tab-byrepo">
          <Toolbar>
            <SearchField value={search} onChange={setSearch} placeholder="Search repos…" label="Search repos" />
            <ToolbarActions>
              <TestToggle value={includeTests} onChange={setIncludeTests} />
              <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>Import SARIF</Button>
              <Button onClick={() => openRun({ tool: 'analyzer' })}>Scan repo</Button>
            </ToolbarActions>
          </Toolbar>
          {data && data.repos.length === 0 ? (
            <EmptyState icon={ScanSearch} title="No repos yet" description="Scan a folder on this machine — it is added here. Findings, readiness and history appear after the first scan." action={{ label: 'Scan repo', onClick: () => openRun({ tool: 'analyzer' }) }} />
          ) : (
            <DataTable label="Scans by repo" head={['', 'Repo', 'Last scan', 'Ready', 'Open by severity', 'Trend', '']} widths={['36px', '24%', '11%', '8%', '20%', '14%', '17%']}>
              {isLoading && <SkeletonRows cols={7} />}
              {repos.map((r) => (
                <RepoRow key={r.repo.id} r={r} state={stateFor(r.repo.id)} onToggle={(w) => toggle(r.repo.id, w)} onScan={() => openRun({ tool: 'analyzer', repoId: r.repo.id })} highlight={focusRepo === r.repo.id} />
              ))}
              {data && repos.length === 0 && data.repos.length > 0 && (
                <tr><Td colSpan={7} className="text-center text-(--color-text-tertiary) py-7">No repo matches “{search}”.</Td></tr>
              )}
            </DataTable>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="pane-all" aria-labelledby="tab-all">
          <AllFindings includeTests={includeTests} setIncludeTests={setIncludeTests} />
        </div>
      )}
      <p className="text-sm text-(--color-text-secondary) mt-1.5">
        Scan from this page or load a <Mono>trustabl scan --format sarif</Mono> export. Test-path findings are hidden by default and never counted (the CLI excludes them from the score).
      </p>
      {importOpen && <ImportSarif repos={data?.repos.map((r) => r.repo) ?? []} onClose={() => setImportOpen(false)} />}
    </>
  )
}

function TestToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-base text-(--color-text-secondary) cursor-pointer">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 cursor-pointer accent-(--color-text-primary)" />
      Show test-path findings
    </label>
  )
}

function trendWord(r: AnalyzerRepo): string {
  if (!r.trendLabel) return ''
  return r.trendLabel
}

function openSummary(r: AnalyzerRepo): string {
  if (!r.lastScan) return 'not scanned'
  if (r.scans > 1 && r.firstOpen !== null) return `${r.firstOpen} → ${r.open} open`
  const last = r.history[r.history.length - 1]
  return `${r.open} open · ${last?.resolved.length ?? 0} resolved`
}

function RepoRow({ r, state, onToggle, onScan, highlight }: {
  r: AnalyzerRepo
  state: 'issues' | 'history' | undefined
  onToggle: (w: 'issues' | 'history') => void
  onScan: () => void
  highlight: boolean
}) {
  const cells = [
    <Td key="repo">
      <b className="block truncate font-semibold">{r.repo.name}</b>
      <div className="font-mono text-sm text-(--color-text-secondary) truncate">
        {r.agent ?? 'no agent found'}{r.commitSha ? ` · ${shortSha(r.commitSha)}` : ''}
      </div>
    </Td>,
    <Td key="last">
      {r.running ? <RunStatusPill status="running" /> : <Mono>{r.lastScan ? <RelTime at={r.lastScan.started_at} /> : 'never'}</Mono>}
      {r.lastError && !r.running && <div><Pill tone="danger" title={r.lastError.error ?? undefined}>last run {r.lastError.status}</Pill></div>}
    </Td>,
    <Td key="ready">{r.readiness !== null ? <Pill tone={readinessTone(r.readiness)}>{r.readiness}</Pill> : r.lastScan ? <Pill title="An imported SARIF has no readiness score">n/a</Pill> : <span className="text-(--color-text-tertiary)">—</span>}</Td>,
    <Td key="sev">
      <button type="button" className="block text-left w-full cursor-pointer" onClick={() => onToggle('issues')}>
        <span className="sr-only">Open findings for {r.repo.name}:</span>{' '}
        <SevRow counts={r.counts} />
        <Subtext>{openSummary(r)}</Subtext>
      </button>
    </Td>,
    <Td key="trend">
      {r.trend.length ? <Spark values={r.trend} /> : <span className="text-(--color-text-tertiary)">—</span>}
      <Subtext>{trendWord(r)}</Subtext>
    </Td>,
    <Td key="act" className="whitespace-nowrap text-right">
      <span className="inline-flex gap-2">
        <Button size="sm" onClick={onScan} disabled={!!r.running}>Scan</Button>
        <Button size="sm" variant="secondary" onClick={() => onToggle('history')} aria-pressed={state === 'history'}>History</Button>
      </span>
    </Td>,
  ]
  return (
    <AccRow
      id={`an-${r.repo.id}`}
      testId={`analyzer-row-${r.repo.name}`}
      open={!!state}
      onToggle={() => onToggle(state ?? 'issues')}
      highlight={highlight}
      colSpan={7}
      cells={cells}
      detail={state === 'history' ? <HistoryPanel r={r} /> : <IssuesPanel r={r} />}
    />
  )
}

function IssuesPanel({ r }: { r: AnalyzerRepo }) {
  if (!r.lastScan) {
    return (
      <Panel title={`Open findings · ${r.repo.name}`}>
        {r.lastError ? (
          <ErrorBox title={`Last scan ${r.lastError.status}`}>
            <pre className="run-log m-0">{r.lastError.error}</pre>
            <div className="mt-2"><CopyCli command={r.lastError.command} label="Copy CLI to reproduce" /></div>
          </ErrorBox>
        ) : (
          <Note>Not scanned yet. Click Scan.</Note>
        )}
      </Panel>
    )
  }
  const latest = r.history[r.history.length - 1]
  return (
    <Panel title={`Open findings · ${r.repo.name}`}>
      {r.openFindings.length === 0 ? (
        <Note>None. {latest && latest.resolved.length ? `Last rescan cleared ${latest.resolved.map((x) => x.rule_id).join(', ')}.` : ''}</Note>
      ) : (
        <FindingMini findings={r.openFindings} />
      )}
      {r.resolvedLast.length > 0 && (
        <p className="text-base text-(--color-text-secondary) mt-2.5">
          Resolved on last rescan: {r.resolvedLast.map((f) => `${f.rule_id} ${f.title}`).join('; ')} — fingerprints gone.
        </p>
      )}
      {r.testPathHidden > 0 && <Note>{r.testPathHidden} test-path finding(s) hidden.</Note>}
      <p className="text-base text-(--color-text-secondary) mt-2.5">
        OTel profile <b>{r.otel ?? 'n/a'}</b>{r.otelRules.length ? ` · ${r.otelRules.join(', ')}` : ''} · SDKs {r.sdks.join(', ') || 'none detected'}
      </p>
      <ScanDownloads runId={r.lastScan.id} imported={r.lastScan.action === 'import'} command={r.lastScan.command} />
    </Panel>
  )
}

export function ScanDownloads({ runId, imported, command }: { runId: string; imported: boolean; command: string }) {
  const link = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-(--radius-sharp) border border-(--color-border-muted) bg-(--color-bg-page) text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text-primary) hover:border-(--color-border-focus)'
  return (
    <div className="flex flex-wrap gap-2 mt-2.5">
      {!imported && <a className={link} href={`/api/export?run_id=${runId}&kind=scan.json`} download><Download size={14} aria-hidden="true" />scan.json</a>}
      <a className={link} href={`/api/export?run_id=${runId}&kind=trustabl.sarif`} download><Download size={14} aria-hidden="true" />SARIF</a>
      <CopyCli command={command} />
    </div>
  )
}

function FindingMini({ findings }: { findings: FindingView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-base" aria-label="Open findings">
        <thead>
          <tr className="text-left">
            {['Sev', 'Conf', 'Finding', 'Location', ''].map((h, i) => (
              <th key={i} scope="col" className="px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-(--color-text-tertiary)">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => (
            <tr key={f.fingerprint} className="border-t border-(--color-border-muted)">
              <td className="px-2.5 py-2"><Sev level={f.severity} /></td>
              <td className="px-2.5 py-2"><Conf value={f.confidence} bar={i < 3} /></td>
              <td className="px-2.5 py-2">
                {i < 3 ? <b className="font-semibold">{f.title}</b> : f.title}
                <div className="text-sm"><RuleLink f={f} />{f.origin === 'test' && <span className="ml-2"><Pill>test path</Pill></span>}</div>
                {f.status === 'introduced' && <Subtext>introduced this scan</Subtext>}
              </td>
              <td className="px-2.5 py-2 max-w-[260px]"><span className="block truncate font-mono text-sm text-(--color-text-secondary)" title={locationOf(f)}>{locationOf(f)}</span></td>
              <td className="px-2.5 py-2 text-right"><CopyCli command={cursorPrompt(f)} label="Copy for Cursor" toastText="Finding copied for Cursor" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RuleLink({ f }: { f: { rule_id: string; category: string | null } }) {
  return (
    <a href={rulebookUrl(f.category, f.rule_id)} target="_blank" rel="noreferrer" className="font-mono text-sm text-(--color-text-secondary) underline decoration-dotted underline-offset-2 hover:text-(--color-text-primary)" title="Open in trustabl-rulebook">
      {f.rule_id}
    </a>
  )
}

function HistoryPanel({ r }: { r: AnalyzerRepo }) {
  const hist = [...r.history].reverse()
  return (
    <Panel title={`Scan history · ${r.repo.name}`}>
      <p className="text-base text-(--color-text-tertiary) mt-0 mb-4">Fingerprint diff. Counts are open findings after each scan.</p>
      {hist.length === 0 ? (
        <Note>No scans yet.</Note>
      ) : (
        <>
          <div className="mb-3"><Spark values={r.history.map((h) => h.open)} height={28} barWidth={10} /></div>
          <ul className="list-none m-0 p-0">
            {hist.map((h, i) => {
              const parts = [`${h.open} open`]
              if (h.introduced.length) parts.push(`+${h.introduced.length} introduced (${h.introduced.map((x) => x.rule_id).join(', ')})`)
              if (h.resolved.length) parts.push(`${h.resolved.length} resolved`)
              if (i === hist.length - 1) parts.push(hist.length === 1 ? 'first scan' : 'baseline')
              if (h.imported) parts.push('imported SARIF')
              return (
                <li key={h.runId} className="grid grid-cols-[150px_1fr_auto_auto] gap-3 items-center py-2 border-t border-(--color-border-muted) first:border-t-0">
                  <Mono>{shortDateTime(h.at)}</Mono>
                  <span>{parts.join(' · ')}</span>
                  {h.readiness !== null ? <Pill tone={readinessTone(h.readiness)}>{h.readiness} ready</Pill> : <Unavailable what="readiness" />}
                  <span className="flex gap-2">
                    {!h.imported && <a className="text-sm underline text-(--color-text-secondary)" href={`/api/export?run_id=${h.runId}&kind=scan.json`} download>JSON</a>}
                    <a className="text-sm underline text-(--color-text-secondary)" href={`/api/export?run_id=${h.runId}&kind=trustabl.sarif`} download>SARIF</a>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Panel>
  )
}

function AllFindings({ includeTests, setIncludeTests }: { includeTests: boolean; setIncludeTests: (v: boolean) => void }) {
  const [status, setStatus] = useState<StatusFilter>('open')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { data, error, isLoading } = useApi<{ findings: FindingView[] }>(`/api/findings?status=all${includeTests ? '&include_tests=1' : ''}`)
  const all = data?.findings ?? []
  const counts = {
    open: all.filter((f) => f.status !== 'resolved').length,
    resolved: all.filter((f) => f.status === 'resolved').length,
    introduced: all.filter((f) => f.status === 'introduced').length,
    all: all.length,
  }
  const s = search.trim().toLowerCase()
  const rows = all
    .filter((f) => (status === 'all' ? true : status === 'open' ? f.status !== 'resolved' : f.status === status))
    .filter((f) => !s || `${f.rule_id} ${f.title} ${f.file_path ?? ''} ${f.repoName} ${f.tool_name ?? ''}`.toLowerCase().includes(s))
  return (
    <>
      <Toolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search rule, file, repo…" label="Search findings" />
        <Chips
          label="Finding status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Open', count: counts.open },
            { value: 'resolved', label: 'Resolved', count: counts.resolved },
            { value: 'introduced', label: 'Introduced', count: counts.introduced },
            { value: 'all', label: 'All', count: counts.all },
          ]}
        />
        <ToolbarActions><TestToggle value={includeTests} onChange={setIncludeTests} /></ToolbarActions>
      </Toolbar>
      {error && <ErrorBox title="Could not load findings">{(error as Error).message}</ErrorBox>}
      <DataTable label="All findings" head={['', 'Sev', 'Conf', 'Status', 'Finding', 'Repo / surface', 'Location', '']} widths={['36px', '6%', '11%', '10%', '25%', '16%', '16%', '14%']}>
        {isLoading && <SkeletonRows cols={8} />}
        {rows.map((f) => {
          const id = `${f.repo_id}-${f.fingerprint}-${f.status}`
          return (
            <AccRow
              key={id}
              id={id}
              open={open === id}
              onToggle={() => setOpen(open === id ? null : id)}
              colSpan={8}
              cells={[
                <Td key="s"><Sev level={f.severity} /></Td>,
                <Td key="c"><Conf value={f.confidence} /></Td>,
                <Td key="st"><Pill tone={f.status === 'resolved' ? 'success' : f.status === 'introduced' ? 'warning' : 'danger'}>{f.status}</Pill></Td>,
                <Td key="f"><b className="block truncate font-semibold" title={f.title}>{f.title}</b><RuleLink f={f} /></Td>,
                <Td key="r"><span className="block truncate">{f.repoName} · {f.scope ?? 'repo'}{f.tool_name ? ` ${f.tool_name}` : ''}</span></Td>,
                <Td key="l"><span className="block truncate font-mono text-sm text-(--color-text-secondary)" title={locationOf(f)}>{locationOf(f)}</span></Td>,
                <Td key="a" className="text-right">
                  {f.status === 'resolved' ? <span className="text-sm text-(--color-text-tertiary)">gone on scan <RelTime at={f.goneAt} /></span> : <CopyCli command={cursorPrompt(f)} label="Copy for Cursor" toastText="Finding copied for Cursor" />}
                </Td>,
              ]}
              detail={
                <Panel>
                  {f.explanation && <p className="m-0 text-base text-(--color-text-secondary)">{f.explanation}</p>}
                  {f.suggested_fix && <p className="mt-2 mb-0 text-base"><b>Suggested fix:</b> <span className="text-(--color-text-secondary)">{f.suggested_fix}</span></p>}
                  <Note>Fingerprint <Mono>{f.fingerprint.slice(0, 16)}</Mono> (rule + file + surface — same as the CLI&apos;s SARIF hash).</Note>
                </Panel>
              }
            />
          )
        })}
        {data && rows.length === 0 && (
          <tr><Td colSpan={8} className="text-center text-(--color-text-tertiary) py-7">{all.length === 0 ? 'No findings yet — scan a repo.' : 'No findings match.'}</Td></tr>
        )}
      </DataTable>
    </>
  )
}
