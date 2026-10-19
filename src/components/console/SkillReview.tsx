'use client'
import { useState } from 'react'
import { Button, Modal } from '@/components/ui'
import { useToast } from '@/components/ui/ToastContext'
import { post, refreshAll, useApi } from '@/lib/client/api'
import type { RunRow } from '@/lib/types'
import { CopyCli } from './CopyCli'
import { ErrorBox, Note, Pill } from './primitives'

interface Candidate {
  target: string
  candidate: string
  existing: string | null
  diff: string | null
  identical: boolean
  applyCommand: string
  stamp: { raw: string } | null
}

/** Generated skill → confirm → written. Shows a diff when the repo already
 *  has a SKILL.md. Nothing touches the repo until "Write SKILL.md". */
export function SkillReview({ run, onClose }: { run: RunRow; onClose: () => void }) {
  const { toast } = useToast()
  const { data, error } = useApi<Candidate>(`/api/forge/runs/${run.id}`, { refreshInterval: 0 })
  const [tab, setTab] = useState<'diff' | 'preview'>('diff')
  const [busy, setBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const write = async () => {
    setBusy(true)
    setApplyError(null)
    try {
      const res = await post<{ path: string }>(`/api/forge/runs/${run.id}`, {})
      toast(`Wrote ${res.path} · forge check started`)
      refreshAll()
      onClose()
    } catch (e) {
      setApplyError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const discard = async () => {
    await post(`/api/forge/runs/${run.id}`, undefined, 'DELETE').catch(() => {})
    refreshAll()
    onClose()
  }

  const showDiff = !!data?.existing && tab === 'diff'
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      scrollBody
      title={data?.existing ? 'Review changes to SKILL.md' : 'Write SKILL.md?'}
      footer={
        <>
          {data && <CopyCli command={data.applyCommand} />}
          <Button variant="secondary" onClick={discard}>Discard</Button>
          <Button onClick={write} loading={busy} disabled={!data || data.identical}>Write SKILL.md</Button>
        </>
      }
    >
      {error && <ErrorBox title="Could not load the generated skill">{(error as Error).message}</ErrorBox>}
      {data && (
        <div className="flex flex-col gap-2">
          <p className="m-0">
            Forge generated a skill. It will be written to <span className="font-mono text-(--color-text-primary) break-all">{data.target}</span>
            {data.existing ? ', replacing the current file.' : '.'}
          </p>
          {data.stamp && <p className="m-0 font-mono text-sm break-all">{data.stamp.raw}</p>}
          {data.identical && <Note>The generated skill is identical to the file on disk — nothing to write.</Note>}
          {data.existing && !data.identical && (
            <div role="tablist" className="flex gap-1 border-b border-(--color-border-muted)">
              {(['diff', 'preview'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`h-9 px-3 -mb-px border-b-2 text-base font-medium cursor-pointer ${tab === t ? 'border-(--color-text-primary) text-(--color-text-primary)' : 'border-transparent text-(--color-text-tertiary) hover:text-(--color-text-secondary)'}`}
                >
                  {t === 'diff' ? 'Diff' : 'New file'}
                </button>
              ))}
              {data.diff && <span className="ml-auto self-center"><Pill>{diffStat(data.diff)}</Pill></span>}
            </div>
          )}
          <pre className="run-log m-0 max-h-[55vh] overflow-auto rounded-(--radius-base) border border-(--color-border-muted) bg-(--color-bg-page) p-3 text-sm" tabIndex={0} aria-label={showDiff ? 'Diff' : 'Generated SKILL.md'}>
            {showDiff ? <DiffLines diff={data.diff ?? ''} /> : data.candidate}
          </pre>
          {applyError && <ErrorBox title="Could not write SKILL.md">{applyError}</ErrorBox>}
        </div>
      )}
    </Modal>
  )
}

function diffStat(diff: string): string {
  let add = 0
  let del = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) add++
    else if (l.startsWith('-') && !l.startsWith('---')) del++
  }
  return `+${add} −${del}`
}

function DiffLines({ diff }: { diff: string }) {
  return (
    <>
      {diff.split('\n').map((l, i) => {
        const cls = l.startsWith('+') && !l.startsWith('+++')
          ? 'text-(--color-success-text) bg-(--color-success-bg)'
          : l.startsWith('-') && !l.startsWith('---')
            ? 'text-(--color-danger-text) bg-(--color-danger-bg)'
            : l.startsWith('@@')
              ? 'text-(--color-text-tertiary)'
              : 'text-(--color-text-secondary)'
        return <span key={i} className={`block ${cls}`}>{l || ' '}</span>
      })}
    </>
  )
}
