'use client'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Package, RefreshCw, Download, FileText } from 'lucide-react'
import { Button, Modal } from '@/components/ui'
import { useToast } from '@/components/ui/ToastContext'
import { EmptyState } from '@/components/patterns/EmptyState'
import { ErrorBox, Kv, Mono, Note, PageHeader, Panel, Pill, RelTime, Subtext, Toolbar, ToolbarActions, Unavailable, AccGrid, type Tone } from '@/components/console/primitives'
import { AccRow, DataTable, SearchField, SkeletonRows, Td } from '@/components/console/table'
import { useRunDialog } from '@/components/console/RunDialog'
import { CopyCli } from '@/components/console/CopyCli'
import { RunStatusPill } from '@/components/console/RunLog'
import { SkillReview } from '@/components/console/SkillReview'
import { post, refreshAll, useApi } from '@/lib/client/api'
import { prettySdk } from '@/lib/findings'
import { shortSha } from '@/lib/text'
import type { ForgeRepo } from '@/lib/server/queries/views'

interface View {
  rules: { sha: string; checkedAt: number } | null
  repos: ForgeRepo[]
}

const SKILL_PATH = '.claude/skills/trustabl-pre-coding/SKILL.md'

export function ForgeClient() {
  const params = useSearchParams()
  const focusRepo = params.get('repo')
  const { openRun } = useRunDialog()
  const { toast } = useToast()
  const { data, error, isLoading } = useApi<View>('/api/forge')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [review, setReview] = useState<string | null>(null)
  const [viewSkill, setViewSkill] = useState<ForgeRepo | null>(null)

  const repos = useMemo(() => {
    const s = search.trim().toLowerCase()
    const list = data?.repos ?? []
    return s ? list.filter((r) => `${r.repo.name} ${r.agent ?? ''} ${r.stamp?.sdks.join(' ') ?? ''}`.toLowerCase().includes(s)) : list
  }, [data, search])

  const isOpen = (id: string) => (id in expanded ? expanded[id] : focusRepo === id)

  const runCheck = async (repoId: string) => {
    try {
      await post('/api/runs', { tool: 'forge', action: 'check', repoId })
      toast('forge check started')
      refreshAll()
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const checkAll = async () => {
    try {
      const r = await post<{ started: number }>('/api/forge/check-all')
      toast(r.started ? `forge check started on ${r.started} repo(s)` : 'No repo has a SKILL.md yet')
      refreshAll()
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const refreshRules = async () => {
    try {
      await post('/api/rules')
      toast('Resolving the current rules SHA…')
      refreshAll()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <>
      <PageHeader
        title="Forge"
        lead="Pre-coding SKILL.md per repo. Forge does not score the code — it tells the model which reliability rules and which enriched OTel fields to emit before anything is written."
      />
      <Toolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search skills…" label="Search skills" />
        <ToolbarActions>
          <span className="text-sm text-(--color-text-secondary)" title={data?.rules?.sha}>
            Current rules <Mono>{data?.rules ? shortSha(data.rules.sha) : '…'}</Mono>
            {data?.rules && <> · resolved <RelTime at={data.rules.checkedAt} /></>}
          </span>
          <Button variant="secondary" size="md" icon={RefreshCw} onClick={refreshRules}>Refresh rules</Button>
          <Button variant="secondary" onClick={checkAll}>Run forge check</Button>
          <Button onClick={() => openRun({ tool: 'forge' })}>Generate skill</Button>
        </ToolbarActions>
      </Toolbar>
      {error && <ErrorBox title="Could not load skills">{(error as Error).message}</ErrorBox>}
      {data && data.repos.length === 0 ? (
        <EmptyState icon={Package} title="No repos yet" description="Generate a pre-coding skill for a folder on this machine — even before the agent is written." action={{ label: 'Generate skill', onClick: () => openRun({ tool: 'forge' }) }} />
      ) : (
        <DataTable label="Skills by repo" head={['', 'Repo', 'Detected stack', 'Skill', 'Stamp', 'OTel in skill', 'forge check']} widths={['36px', '18%', '16%', '22%', '18%', '11%', '15%']}>
          {isLoading && <SkeletonRows cols={7} />}
          {repos.map((r) => (
            <AccRow
              key={r.repo.id}
              id={`fg-${r.repo.id}`}
              testId={`forge-row-${r.repo.name}`}
              open={isOpen(r.repo.id)}
              highlight={focusRepo === r.repo.id}
              onToggle={() => setExpanded((e) => ({ ...e, [r.repo.id]: !isOpen(r.repo.id) }))}
              colSpan={7}
              cells={[
                <Td key="repo"><b className="block truncate font-semibold">{r.repo.name}</b><div className="font-mono text-sm text-(--color-text-secondary) truncate">{r.agent ?? 'agent not scanned'}</div></Td>,
                <Td key="stack">
                  {r.stamp ? (
                    <span className="block truncate text-(--color-text-secondary)">{r.stamp.sdks.join(', ') || 'no SDK in stamp'}</span>
                  ) : (
                    <span className="block truncate text-(--color-text-secondary)">not forged</span>
                  )}
                  <Subtext>
                    {r.stamp
                      ? <Unavailable what="IDE/model" />
                      : r.analyzerSdks.length ? `${r.analyzerSdks.map(prettySdk).join(', ')} detected by Analyzer only` : 'stack not detected yet'}
                  </Subtext>
                </Td>,
                <Td key="skill">{r.exists ? <span className="block truncate font-mono text-sm text-(--color-text-secondary)" title={r.skillPath}>{SKILL_PATH}</span> : <span className="text-(--color-text-tertiary)">—</span>}</Td>,
                <Td key="stamp">
                  {r.stamp ? (
                    <>
                      <Mono>{r.stamp.generated}</Mono>
                      <div title={`rules ${r.stamp.rules} · schema ${r.stamp.schema} · template ${r.stamp.template}`}><Subtext>{shortSha(r.stamp.rules)} · schema {r.stamp.schema} · tmpl {r.stamp.template}</Subtext></div>
                    </>
                  ) : r.exists ? <Pill tone="warning">unstamped</Pill> : <span className="text-(--color-text-tertiary)">—</span>}
                </Td>,
                <Td key="otel">{r.exists ? <OtelPill otel={r.otel} /> : <Pill>no skill</Pill>}</Td>,
                <Td key="check">
                  {r.running ? <RunStatusPill status="running" /> : <CheckPill r={r} />}
                  {r.pending && (
                    <div className="mt-1">
                      <button type="button" className="text-sm font-medium text-(--color-accent-default) underline cursor-pointer" onClick={() => setReview(r.pending!.id)}>
                        Review generated skill
                      </button>
                    </div>
                  )}
                </Td>,
              ]}
              detail={<ForgeDetail r={r} onCheck={() => runCheck(r.repo.id)} onGenerate={() => openRun({ tool: 'forge', repoId: r.repo.id })} onView={() => setViewSkill(r)} onReview={() => r.pending && setReview(r.pending.id)} />}
            />
          ))}
          {data && repos.length === 0 && data.repos.length > 0 && (
            <tr><Td colSpan={7} className="text-center text-(--color-text-tertiary) py-7">No repo matches “{search}”.</Td></tr>
          )}
        </DataTable>
      )}
      <p className="text-sm text-(--color-text-secondary) mt-1.5">
        Generate runs <Mono>trustabl forge</Mono> into the run folder; the skill is written to <Mono>{SKILL_PATH}</Mono> only after you confirm.
        forge check re-runs automatically after a write and whenever the rules SHA changes.
      </p>
      {review && <SkillReview runId={review} onClose={() => setReview(null)} />}
      {viewSkill && <SkillViewer r={viewSkill} onClose={() => setViewSkill(null)} />}
    </>
  )
}

function OtelPill({ otel }: { otel: ForgeRepo['otel'] }) {
  const tone: Tone = otel === 'encoded' ? 'success' : otel === 'partial' ? 'warning' : 'neutral'
  return <Pill tone={tone}>{otel ?? 'none'}</Pill>
}

function CheckPill({ r }: { r: ForgeRepo }) {
  if (!r.exists) return <Pill>n/a</Pill>
  const c = r.check
  if (!c) return <Pill title="No forge check since this file changed">not checked</Pill>
  if (c.status === 'pass') return <Pill tone="success">pass</Pill>
  if (c.status === 'stale') return <Pill tone="warning">{c.cause === 'template' ? 'stale template' : c.cause === 'rules' ? 'stale rules' : 'stale'}</Pill>
  if (c.status === 'unstamped') return <Pill tone="warning">unstamped</Pill>
  if (c.status === 'error') return <Pill tone="danger" title={c.detail}>error</Pill>
  return <Pill>n/a</Pill>
}

function ForgeDetail({ r, onCheck, onGenerate, onView, onReview }: { r: ForgeRepo; onCheck: () => void; onGenerate: () => void; onView: () => void; onReview: () => void }) {
  const errorBox = r.lastError && (
    <ErrorBox title={`Last generate ${r.lastError.status}`}>
      <pre className="run-log m-0">{r.lastError.error}</pre>
      <div className="mt-2"><CopyCli command={r.lastError.command} label="Copy CLI to reproduce" /></div>
    </ErrorBox>
  )
  if (!r.exists) {
    return (
      <Panel>
        {errorBox}
        <Kv>No SKILL.md on disk{r.analyzerSdks.length ? '' : ' — the agent may not be built yet'}. Forge can detect the stack from the dependency manifests and write a pre-coding skill so the first generation already follows reliability rules and emits the OTel profile.</Kv>
        {r.pending && <Kv>A generated skill is waiting for your review.</Kv>}
        <div className="flex flex-wrap gap-2 mt-2.5">
          {r.pending ? <Button size="sm" onClick={onReview}>Review generated skill</Button> : <Button size="sm" onClick={onGenerate}>Generate skill for this repo</Button>}
          <CopyCli command={r.commands.generate} />
        </div>
      </Panel>
    )
  }
  const o = r.outline
  return (
    <>
      {errorBox}
      {r.check && r.check.status !== 'pass' && (
        <Panel title="Why forge check fails">
          <Kv>{r.staleReason}</Kv>
          <Kv><Mono>{r.check.detail}</Mono></Kv>
          <div className="flex flex-wrap gap-2 mt-2.5">
            <Button size="sm" onClick={onGenerate}>Regenerate skill</Button>
            <CopyCli command={`${r.commands.generate} && ${r.commands.check.replace(/^cd [^&]+&& /, '')}`} />
          </div>
        </Panel>
      )}
      <AccGrid>
        <Panel title="What this skill instructs">
          <ul className="list-none m-0 p-0">
            {o?.hasApplyLoop && <Check>Apply loop: check each definition against the constraints, name violations by rule ID, apply the directive</Check>}
            {o && o.otel !== 'none' && <Check>Emit OpenTelemetry spans{o.tracingLanguages.length ? ` (${o.tracingLanguages.join(', ')})` : ''}</Check>}
            {o?.otel === 'encoded' && <Check>Label spans with agent-reliability-otel-labels (run identity, step order, tool-call fingerprints, retries, side-effect class, exit reason)</Check>}
            {o?.sections.map((s) => (
              <Check key={s.title}>{s.title}: {s.scopes.reduce((n, x) => n + x.rules.length, 0)} rules, severity-first</Check>
            ))}
            {o && o.otel === 'none' && <Check no>No Runtime Tracing section</Check>}
          </ul>
        </Panel>
        <Panel title="Inventory at generate time">
          <Kv>SDKs <b>{r.stamp?.sdks.join(', ') || 'none in stamp'}</b></Kv>
          <Kv>Tracing languages <b>{o?.tracingLanguages.join(', ') || 'none'}</b></Kv>
          <Kv>Scopes in skill: {[...new Set(o?.sections.flatMap((s) => s.scopes.map((x) => x.scope.toLowerCase())) ?? [])].join(', ') || 'none'}</Kv>
          <Kv>Rules <b>{o?.sections.reduce((n, s) => n + s.scopes.reduce((m, x) => m + x.rules.length, 0), 0) ?? 0}</b> · file changed <RelTime at={r.skillMtime} /></Kv>
        </Panel>
        <Panel title="Stamp">
          {r.stamp ? <p className="m-0 font-mono text-sm text-(--color-text-secondary) break-all">{r.stamp.raw}</p> : <Kv>No stamp — forge check cannot verify this file.</Kv>}
          {r.check && <Kv>forge check <CheckPill r={r} /> {r.checkRun && <span className="text-sm text-(--color-text-tertiary)">· <RelTime at={r.checkRun.started_at} /></span>}</Kv>}
          <div className="flex flex-wrap gap-2 mt-2.5">
            <Button size="sm" variant="secondary" icon={FileText} onClick={onView}>Open SKILL.md</Button>
            <Button size="sm" variant="secondary" onClick={onCheck}>Run forge check</Button>
            <CopyCli command={r.commands.check} label="Copy check" />
            <CopyCli command={r.commands.generate} label="Copy forge command" />
          </div>
        </Panel>
      </AccGrid>
    </>
  )
}

function Check({ children, no }: { children: React.ReactNode; no?: boolean }) {
  return (
    <li className="flex items-start gap-2 py-1.5 border-t border-(--color-border-muted) first:border-t-0 text-base text-(--color-text-secondary)">
      <span aria-hidden="true" className={`w-3.5 shrink-0 font-semibold ${no ? 'text-(--color-danger-text)' : 'text-(--color-success-text)'}`}>{no ? '✗' : '✓'}</span>
      <span>{children}</span>
    </li>
  )
}

function SkillViewer({ r, onClose }: { r: ForgeRepo; onClose: () => void }) {
  const [state, setState] = useState<{ text?: string; err?: string }>({})
  useEffect(() => {
    let alive = true
    fetch(`/api/forge/skill?repo_id=${r.repo.id}`)
      .then(async (res) => {
        const next = res.ok ? { text: await res.text() } : { err: ((await res.json()) as { error: string }).error }
        if (alive) setState(next)
      })
      .catch((e) => alive && setState({ err: String(e) }))
    return () => { alive = false }
  }, [r.repo.id])
  const { text, err } = state
  return (
    <Modal open onClose={onClose} title={`SKILL.md · ${r.repo.name}`} size="xl" scrollBody footer={
      <a href={`/api/forge/skill?repo_id=${r.repo.id}&download=1`} download className="inline-flex items-center gap-1.5 h-9 px-3 rounded-(--radius-sharp) border border-(--color-border-muted) text-sm font-medium"><Download size={14} aria-hidden="true" />Download</a>
    }>
      <p className="m-0 mb-2 font-mono text-sm break-all">{r.skillPath}</p>
      {err ? <ErrorBox title="Could not read SKILL.md">{err}</ErrorBox> : <pre tabIndex={0} className="run-log m-0 max-h-[60vh] overflow-auto rounded-(--radius-base) border border-(--color-border-muted) bg-(--color-bg-page) p-3 text-sm">{text ?? 'Loading…'}</pre>}
      <Note>Read-only view of the file on disk.</Note>
    </Modal>
  )
}
