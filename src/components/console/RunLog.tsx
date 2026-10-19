'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { useToast } from '@/components/ui/ToastContext'
import { post, refreshAll } from '@/lib/client/api'
import type { RunRow } from '@/lib/types'
import { CopyCli, CommandBlock } from './CopyCli'
import { ErrorBox, Pill, type Tone } from './primitives'
import { duration } from '@/lib/time'

export const STATUS_TONE: Record<RunRow['status'], Tone> = {
  running: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  interrupted: 'danger',
}

export function RunStatusPill({ status }: { status: RunRow['status'] }) {
  return <Pill tone={STATUS_TONE[status]}>{status}</Pill>
}

/** Live view of one run. Disconnecting (closing it, leaving the page) never
 *  affects the run; re-opening replays the whole log. */
export function RunLog({ run: initial, onDone, maxHeight = 280 }: { run: RunRow; onDone?: (run: RunRow) => void; maxHeight?: number }) {
  const [text, setText] = useState('')
  const [run, setRun] = useState<RunRow>(initial)
  const [cancelling, setCancelling] = useState(false)
  const boxRef = useRef<HTMLPreElement>(null)
  const doneRef = useRef(onDone)
  const { toast } = useToast()
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const es = new EventSource(`/api/runs/${initial.id}/stream`)
    es.addEventListener('log', (e) => {
      const { text: chunk } = JSON.parse((e as MessageEvent).data) as { text: string }
      setText((t) => t + chunk)
    })
    es.addEventListener('status', (e) => {
      const final = JSON.parse((e as MessageEvent).data) as RunRow | null
      es.close()
      if (final) {
        setRun(final)
        refreshAll()
        doneRef.current?.(final)
      }
    })
    es.onerror = () => {
      // The server ends the stream after the final status; a dropped
      // connection mid-run is retried by EventSource on its own.
    }
    return () => es.close()
  }, [initial.id])

  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])

  const cancel = async () => {
    setCancelling(true)
    try {
      await post(`/api/runs/${run.id}/cancel`)
      toast('Cancelling run…')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setCancelling(false)
    }
  }

  const elapsed = run.finished_at ? run.finished_at - run.started_at : null
  return (
    <div className="flex flex-col gap-2" data-testid="run-log" data-status={run.status}>
      <div className="flex items-center gap-2 flex-wrap">
        <RunStatusPill status={run.status} />
        <span className="text-sm text-(--color-text-tertiary)">
          {run.tool} · {run.action}
          {elapsed !== null ? ` · ${duration(elapsed)}` : ''}
          {run.exit_code !== null ? ` · exit ${run.exit_code}` : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <CopyCli command={run.command} />
          {run.status === 'running' && (
            <Button size="sm" variant="danger" onClick={cancel} loading={cancelling}>
              Cancel run
            </Button>
          )}
        </div>
      </div>
      <pre
        ref={boxRef}
        tabIndex={0}
        aria-label="Run output"
        aria-live="polite"
        className="run-log m-0 rounded-(--radius-base) border border-(--color-border-muted) bg-(--color-bg-page) p-3 text-sm text-(--color-text-secondary) overflow-auto"
        style={{ maxHeight, minHeight: 80 }}
      >
        {text || (run.status === 'running' ? 'Waiting for output…' : '(no output)')}
      </pre>
      {(run.status === 'failed' || run.status === 'interrupted') && (
        <ErrorBox title={run.status === 'interrupted' ? 'Run interrupted' : 'Run failed'}>
          <pre className="run-log m-0">{run.error}</pre>
          <div className="mt-2 text-(--color-text-tertiary)">Reproduce it with:</div>
          <CommandBlock command={run.command} />
        </ErrorBox>
      )}
    </div>
  )
}
