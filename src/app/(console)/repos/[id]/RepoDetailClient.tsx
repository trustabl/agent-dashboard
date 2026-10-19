'use client'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { ErrorBox, Kpi, KpiGrid, Kv, Mono, Note, Pill, Spark, Unavailable } from '@/components/console/primitives'
import { useRunDialog } from '@/components/console/RunDialog'
import { RunHistory } from '@/components/console/RunHistory'
import { CopyCli } from '@/components/console/CopyCli'
import { artifactUrl } from '@/components/console/ArtifactViewer'
import { analyzerState, forgeState, probeState, StateCell } from '@/components/console/cells'
import { useApi } from '@/lib/client/api'
import { prettySdk } from '@/lib/findings'
import { shortDateTime } from '@/lib/time'
import { plural, shortSha } from '@/lib/text'
import type { OverviewRow, RunBrief } from '@/lib/server/queries/views'

export type RepoDetail = OverviewRow & {
  projected: { fixMedium: number | null; fixHigh: number | null; fixAll: number | null } | null
  runs: (RunBrief & { artifacts: string[] })[]
}

const linkBtn = 'inline-flex items-center gap-1.5 h-9 px-3 rounded-(--radius-sharp) border border-(--color-border-muted) bg-transparent text-xs font-medium text-(--color-text-primary) hover:border-(--color-border-focus)'

export function RepoDetailClient({ id }: { id: string }) {
  const { data, error, isLoading } = useApi<RepoDetail>(`/api/repositories/${id}`)
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-(--color-text-tertiary) mb-3">
        <Link href="/" className="underline hover:text-(--color-text-primary)">Overview</Link> / <span>{data?.repo.name ?? '…'}</span>
      </nav>
      {error ? (
        <ErrorBox title={(error as Error).message === 'Repo not found' ? 'Repo not found' : 'Could not load this repo'}>
          {(error as Error).message === 'Repo not found' ? 'It may have been removed. Go back to the Overview.' : (error as Error).message}
        </ErrorBox>
      ) : isLoading || !data ? (
        <div aria-busy="true">
          <h1 className="text-xl font-semibold m-0">Loading…</h1>
          <KpiGrid>{['Readiness', 'Open findings', 'OTel', 'Probe dest'].map((l) => <Kpi key={l} label={l} value={0} loading />)}</KpiGrid>
        </div>
      ) : (
        <RepoDetailView d={data} />
      )}
    </>
  )
}

export function RepoDetailView({ d }: { d: RepoDetail }) {
  const { openRun } = useRunDialog()
  const a = d.analyzer
  const f = d.forge
  const p = d.probe
  const sdks = [...new Set((a.sdks.length ? a.sdks : f.stamp?.sdks ?? []).map(prettySdk))]
  const projected = d.projected && a.readiness !== null
    ? d.projected.fixMedium !== null && d.projected.fixMedium > a.readiness
      ? `projected ${d.projected.fixMedium} if medium fixed`
      : d.projected.fixAll !== null && d.projected.fixAll > a.readiness ? `projected ${d.projected.fixAll} if all fixed` : 'nothing left to gain'
    : a.lastScan ? 'no score on an imported SARIF' : 'not scanned'
  const lastSarif = a.lastScan ? artifactUrl(a.lastScan.id, 'trustabl.sarif') : null
  const hist = a.history
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight m-0 text-(--color-text-primary)">{d.repo.name}</h1>
          <p className="font-mono text-sm text-(--color-text-secondary) mt-1.5 mb-0">
            {d.className ?? 'agent not scanned'} · <Unavailable what="agent ID" />{a.commitSha ? ` · sha ${shortSha(a.commitSha)}` : ''}
          </p>
          <p className="font-mono text-sm text-(--color-text-tertiary) mt-0.5 mb-0 break-all">{d.repo.path}</p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {sdks.map((s) => <Pill key={s}>{s}</Pill>)}
            {a.languages.map((l) => <Pill key={l}>{l}</Pill>)}
            {!sdks.length && !a.languages.length && <span className="text-sm text-(--color-text-tertiary)">Stack not detected yet</span>}
            <span className="text-sm"><Unavailable what="IDE/model" /></span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => openRun({ tool: 'forge', repoId: d.repo.id })}>{f.exists ? 'Regenerate skill' : 'Generate skill'}</Button>
          <Button size="sm" onClick={() => openRun({ tool: 'analyzer', repoId: d.repo.id })}>Scan</Button>
          <Button size="sm" variant="ghost" onClick={() => openRun({ tool: 'probe', repoId: d.repo.id, grantSet: p.grantSetMode ?? (p.analyzerTools ? 'analyzer' : 'draft') })}>{p.lastRun ? 'Re-probe' : 'Run Probe'}</Button>
          {f.exists && <a className={linkBtn} href={`/api/forge/skill?repo_id=${d.repo.id}&download=1`} download><Download size={14} aria-hidden="true" />SKILL.md</a>}
          {lastSarif && <a className={linkBtn} href={lastSarif} download><Download size={14} aria-hidden="true" />SARIF</a>}
        </div>
      </div>

      <KpiGrid>
        <Kpi label="Readiness" value={a.readiness ?? '—'} trend={projected} tone={a.readiness !== null ? 'up' : 'flat'} />
        <Kpi label="Open findings" value={a.open} trend={hist.length ? hist.slice(-5).map((h) => h.open).join(' → ') : 'not scanned'} />
        <Kpi
          label="OTel"
          value={a.otel ?? '—'}
          trend={d.otelSignals.length ? [...new Set(d.otelSignals.map((s) => `${s.vendor} ${s.kind}`))].join(', ') : a.otelRules.length ? a.otelRules.join(', ') : a.lastScan ? 'no instrumentation found' : 'not scanned'}
          tone={a.otel && a.otel !== 'emitting' ? 'down' : 'flat'}
        />
        <Kpi label="Probe dest" value={p.lastRun ? p.egress.length : '—'} trend={p.lastRun ? (p.draft.kind === 'drafted' ? 'draft unsigned' : p.draft.kind === 'withheld' ? 'draft withheld' : 'not drafted') : 'no profile'} />
      </KpiGrid>

      <Card className="p-5 mb-4">
        <h2 className="m-0 text-lg font-semibold">Issue history</h2>
        <p className="text-base text-(--color-text-secondary) mt-1 mb-3">Fingerprint diff across Analyzer scans. Bars are open-finding counts.</p>
        {hist.length ? (
          <>
            <Spark values={hist.slice(-12).map((h) => h.open)} height={36} barWidth={10} />
            <p className="text-sm text-(--color-text-tertiary) mt-2 mb-0">
              {hist.slice(-12).map((h, i, arr) => `${shortDateTime(h.at)}: ${h.open} open${i === arr.length - 1 ? ` / ${h.resolved.length} resolved` : ''}`).join(' · ')}
            </p>
            <Link href={`/analyzer?repo=${d.repo.id}&open=history`} className="inline-block text-sm underline text-(--color-text-secondary) mt-2">Scan history in Analyzer</Link>
          </>
        ) : (
          <Note>No scans yet. Scan the repo to start its history.</Note>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card className="p-5">
          <h2 className="m-0 mb-2 text-lg font-semibold">Forge</h2>
          <div className="mb-2"><StateCell s={forgeState(f)} /></div>
          {f.stamp ? (
            <>
              <Kv>Generated <b>{f.stamp.generated}</b></Kv>
              <Kv>Rules <Mono title={f.stamp.rules}>{shortSha(f.stamp.rules)}</Mono> · schema {f.stamp.schema} · template {f.stamp.template} · sdks {f.stamp.sdks.join(', ') || 'none'}</Kv>
            </>
          ) : (
            <Kv>{f.exists ? 'SKILL.md has no forge stamp.' : 'No SKILL.md in this repo.'}</Kv>
          )}
          {f.staleReason && <Kv>{f.staleReason}</Kv>}
          {f.exists && f.outline && (
            <ul className="list-none m-0 mt-2 p-0">
              <CheckItem ok={f.outline.sections.some((s) => s.scopes.some((x) => x.rules.length))}>Reliability rules in skill</CheckItem>
              <CheckItem ok={f.otel === 'encoded'} partial={f.otel === 'partial'}>Enriched OTel fields required of the model{f.otel === 'partial' ? ' (tracing without the Trustabl labels)' : ''}</CheckItem>
            </ul>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <Link href={`/forge?repo=${d.repo.id}`} className={linkBtn}>Open in Forge</Link>
            <CopyCli command={f.commands.generate} label="Copy forge command" />
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="m-0 mb-2 text-lg font-semibold">Probe</h2>
          <div className="mb-2"><StateCell s={probeState(p)} /></div>
          {p.lastRun ? (
            <>
              <Kv>Last run <b>{shortDateTime(p.lastRun.started_at)}</b> · {p.runner === 'docker' ? 'Docker' : p.runner === 'openshell' ? 'OpenShell' : p.runner ?? '—'} · {p.cache ?? '—'}</Kv>
              <Kv>
                Grant set {p.grantSetHash ? <Mono title={p.grantSetHash}>{shortSha(p.grantSetHash)}</Mono> : '—'}
                {p.grantSetMode === 'analyzer' ? (p.untested ? ' · Analyzer grant set changed since — untested' : ' · matches Analyzer') : ' · draft agent'}
              </Kv>
              <Kv>
                {p.draft.kind === 'drafted' ? `Draft written (${plural(p.draft.count, 'destination')}, unsigned)` : p.draft.kind === 'none' ? 'No draft' : p.draft.reason}
                {' · '}{p.flags.some((x) => x.flag === 'egress.denied_class') ? 'deny-list hit' : 'no deny-list hits'}
              </Kv>
              {p.extras.length > 0 && <Kv>Session extras: {plural(p.extras.length, 'finding')} ({[...new Set(p.extras.map((e) => e.title))].slice(0, 2).join('; ')})</Kv>}
            </>
          ) : (
            <Kv>{p.untested ? 'Analyzer grant set is ready to harness — no Probe run yet.' : 'No Probe profile yet.'}</Kv>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <Link href={`/probe?repo=${d.repo.id}`} className={linkBtn}>Open in Probe</Link>
            <CopyCli command={p.lastRun?.command ?? p.nextCommand} />
          </div>
        </Card>
      </div>

      <Card className="p-5 mb-4">
        <h2 className="m-0 mb-2 text-lg font-semibold">Analyzer</h2>
        <div className="mb-2"><StateCell s={analyzerState(a)} /></div>
        <Kv>{a.lastScan ? `${a.open} open · ${a.counts.critical} critical · ${a.counts.high} high · ${a.counts.medium} medium · ${a.counts.low} low` : 'Not scanned yet.'}</Kv>
        {a.openFindings.slice(0, 5).map((x) => (
          <Kv key={x.fingerprint}><Pill tone={x.severity === 'critical' || x.severity === 'high' ? 'danger' : x.severity === 'medium' ? 'warning' : 'neutral'}>{x.severity}</Pill> {x.title} <Mono>{x.rule_id}</Mono></Kv>
        ))}
        <div className="flex flex-wrap gap-2 mt-3">
          <Link href={`/analyzer?repo=${d.repo.id}&open=issues`} className={linkBtn}>Open in Analyzer</Link>
          {a.lastScan && <CopyCli command={a.lastScan.command} />}
        </div>
      </Card>

      <RunHistory repoId={d.repo.id} limit={200} title="Run log" />
    </>
  )
}

function CheckItem({ ok, partial, children }: { ok: boolean; partial?: boolean; children: React.ReactNode }) {
  const mark = ok ? '✓' : partial ? '~' : '✗'
  const tone = ok ? 'text-(--color-success-text)' : partial ? 'text-(--color-warning-text)' : 'text-(--color-danger-text)'
  return (
    <li className="flex items-start gap-2 py-1 text-base text-(--color-text-secondary)">
      <span aria-hidden="true" className={`w-3.5 shrink-0 font-semibold ${tone}`}>{mark}</span>
      <span><span className="sr-only">{ok ? 'Yes: ' : partial ? 'Partly: ' : 'No: '}</span>{children}</span>
    </li>
  )
}
