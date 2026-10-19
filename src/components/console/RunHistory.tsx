'use client'
import { useState } from 'react'
import { Modal } from '@/components/ui'
import { useApi } from '@/lib/client/api'
import type { RunRow } from '@/lib/types'
import { shortDateTime } from '@/lib/time'
import { shortSha } from '@/lib/text'
import { CopyCli } from './CopyCli'
import { RunLog, RunStatusPill } from './RunLog'
import { Mono } from './primitives'

const TOOL_LABEL: Record<string, string> = { forge: 'Forge', analyzer: 'Analyzer', probe: 'Probe' }
const ACTION_LABEL: Record<string, string> = {
  generate: 'generate', check: 'forge check', 'rules-status': 'rules SHA', scan: 'scan', import: 'SARIF import', probe: 'harness',
}

export function runResult(r: Pick<RunRow, 'status' | 'action' | 'summary' | 'error'>): string {
  const s = r.summary as Record<string, unknown>
  if (r.status === 'running') return 'running…'
  if (r.status !== 'succeeded') return (r.error ?? r.status).split('\n')[0]
  switch (r.action) {
    case 'scan':
    case 'import':
      return `${s.open ?? 0} open · ${s.introduced ?? 0} introduced · ${s.resolved ?? 0} resolved · readiness ${s.readiness ?? 'n/a'}`
    case 'generate':
      return s.pending ? 'SKILL.md generated — not written yet' : s.appliedAt ? 'SKILL.md written' : s.discardedAt ? 'discarded' : 'SKILL.md generated'
    case 'check': {
      const c = s.check as { status?: string; detail?: string } | undefined
      return c ? `${c.status}: ${c.detail ?? ''}` : 'checked'
    }
    case 'rules-status':
      return `rules ${shortSha(s.rules as string)}${s.changed ? ' (changed)' : ''}`
    case 'probe': {
      const d = s.draft as { kind?: string; count?: number } | undefined
      const egress = (s.egress as unknown[] | undefined)?.length ?? 0
      return `${egress} destination${egress === 1 ? '' : 's'} · ${d?.kind === 'drafted' ? `unsigned draft (${d.count})` : d?.kind ?? 'no draft'} · ${s.cache ?? ''}`
    }
  }
  return r.status
}

/** The run log: every run with tool, repo, commit SHA, rules SHA, tool
 *  version, time and result; each row opens the full output. */
export function RunHistory({ repoId, tool, limit = 20, repoNames, title = 'Run log' }: {
  repoId?: string
  tool?: string
  limit?: number
  repoNames?: Record<string, string>
  title?: string
}) {
  const q = new URLSearchParams()
  if (repoId) q.set('repo_id', repoId)
  if (tool) q.set('tool', tool)
  q.set('limit', String(limit))
  const { data, error, isLoading } = useApi<{ runs: RunRow[] }>(`/api/runs?${q}`)
  const [open, setOpen] = useState<RunRow | null>(null)
  const runs = data?.runs ?? []
  return (
    <section aria-label={title} className="mt-6">
      <h2 className="text-lg font-semibold m-0 mb-2.5">{title}</h2>
      {error ? (
        <p className="text-sm text-(--color-danger-text)">Could not load runs: {(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-sm text-(--color-text-tertiary)">Loading runs…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-(--color-text-tertiary) py-6 text-center border border-(--color-border-muted) rounded-(--radius-base) bg-(--color-bg-surface)">No runs yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-(--radius-base) border border-(--color-border-muted) bg-(--color-bg-surface)">
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="text-left">
                {['Time', 'Tool', ...(repoNames ? ['Repo'] : []), 'Result', 'Commit', 'Rules', 'Version', ''].map((h, i) => (
                  <th key={i} scope="col" className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-(--color-text-tertiary) whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-(--color-border-muted) hover:bg-(--color-bg-raised)">
                  <td className="px-3 py-2.5 whitespace-nowrap"><Mono>{shortDateTime(r.started_at)}</Mono></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{TOOL_LABEL[r.tool]} <span className="text-(--color-text-tertiary)">· {ACTION_LABEL[r.action] ?? r.action}</span></td>
                  {repoNames && <td className="px-3 py-2.5 whitespace-nowrap">{r.repo_id ? repoNames[r.repo_id] ?? '—' : '—'}</td>}
                  <td className="px-3 py-2.5 max-w-[420px]">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <RunStatusPill status={r.status} />
                      <span className="truncate text-sm text-(--color-text-secondary)" title={runResult(r)}>{runResult(r)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5"><Mono title={r.commit_sha ?? 'not a git repo'}>{r.commit_sha ? shortSha(r.commit_sha) : '—'}</Mono></td>
                  <td className="px-3 py-2.5"><Mono title={r.rules_sha ?? undefined}>{r.rules_sha ? shortSha(r.rules_sha) : '—'}</Mono></td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><Mono>{r.tool === 'probe' ? 'autofix' : 'trustabl'} {r.tool_version ?? ''}</Mono></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    <span className="inline-flex gap-2">
                      <button type="button" onClick={() => setOpen(r)} className="h-8 px-2.5 text-sm font-medium rounded-(--radius-sharp) border border-(--color-border-muted) hover:border-(--color-border-focus) cursor-pointer">Log</button>
                      {r.command && <CopyCli command={r.command} />}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${TOOL_LABEL[open.tool]} · ${ACTION_LABEL[open.action] ?? open.action} · ${shortDateTime(open.started_at)}`} size="xl" scrollBody>
          {open.argv.length ? <RunLog key={open.id} run={open} maxHeight={480} /> : <p className="m-0">{runResult(open)}</p>}
        </Modal>
      )}
    </section>
  )
}
