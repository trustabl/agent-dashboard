'use client'
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Modal } from '@/components/ui'
import { ErrorBox, Note, Pill } from './primitives'

/** Read-only view of a run artifact exactly as the CLI wrote it, with a
 *  byte-for-byte download. `network_policies.draft.yaml` is always labeled
 *  unsigned: the Console never signs, binds or pushes a draft. */
export function ArtifactViewer({ runId, kind, title, onClose }: { runId: string; kind: string; title?: string; onClose: () => void }) {
  const [state, setState] = useState<{ text?: string; err?: string }>({})
  useEffect(() => {
    let alive = true
    fetch(`/api/export?run_id=${encodeURIComponent(runId)}&kind=${encodeURIComponent(kind)}&inline=1`, { cache: 'no-store' })
      .then(async (res) => {
        const next = res.ok ? { text: await res.text() } : { err: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}` }
        if (alive) setState(next)
      })
      .catch((e) => alive && setState({ err: String(e) }))
    return () => { alive = false }
  }, [runId, kind])
  const unsigned = kind === 'network_policies.draft.yaml'
  const pretty = state.text !== undefined && kind.endsWith('.json') ? prettyJson(state.text) : state.text
  return (
    <Modal
      open
      onClose={onClose}
      title={title ?? kind}
      size="xl"
      scrollBody
      footer={
        <a href={artifactUrl(runId, kind)} download className="inline-flex items-center gap-1.5 h-9 px-3 rounded-(--radius-sharp) border border-(--color-border-muted) text-sm font-medium">
          <Download size={14} aria-hidden="true" />Download {kind}
        </a>
      }
    >
      {unsigned && (
        <p className="m-0 mb-2 flex items-center gap-2 text-sm text-(--color-text-secondary)">
          <Pill tone="warning">unsigned</Pill> Draft written by Probe. The Console does not sign, bind or push it.
        </p>
      )}
      {state.err ? (
        <ErrorBox title={`Could not read ${kind}`}>{state.err}</ErrorBox>
      ) : (
        <pre tabIndex={0} aria-label={kind} className="run-log m-0 max-h-[60vh] overflow-auto rounded-(--radius-base) border border-(--color-border-muted) bg-(--color-bg-page) p-3 text-sm">
          {pretty ?? 'Loading…'}
        </pre>
      )}
      <Note>Shown as the CLI wrote it{kind.endsWith('.json') ? ' (indented for reading; the download is byte-for-byte)' : ''}.</Note>
    </Modal>
  )
}

export function artifactUrl(runId: string, kind: string): string {
  return `/api/export?run_id=${encodeURIComponent(runId)}&kind=${encodeURIComponent(kind)}`
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** One artifact: View (modal) + Download. */
export function ArtifactLinks({ runId, kinds, onView }: { runId: string; kinds: string[]; onView: (kind: string) => void }) {
  const btn = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-(--radius-sharp) border border-(--color-border-muted) bg-(--color-bg-page) text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text-primary) hover:border-(--color-border-focus) cursor-pointer'
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
      {kinds.map((k) => (
        <li key={k} className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn} onClick={() => onView(k)} aria-label={`View ${k}`}>
            <span className="font-mono">{k}</span>
          </button>
          <a className={btn} href={artifactUrl(runId, k)} download aria-label={`Download ${k}`}>
            <Download size={14} aria-hidden="true" />Download
          </a>
          {k === 'network_policies.draft.yaml' && <Pill tone="warning">unsigned</Pill>}
        </li>
      ))}
    </ul>
  )
}
