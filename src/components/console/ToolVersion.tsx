'use client'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/ToastContext'
import { post, refreshAll, useApi } from '@/lib/client/api'
import { canInstallLatest } from '@/lib/tool-versions'
import type { ToolInfo, ToolName } from '@/lib/types'
import { Mono, Note, Pill, RelTime, type Tone } from './primitives'

// The CLI version a page runs, next to its title. Opens the versions dialog:
// check GitHub for the latest release, install it, or switch between installed
// versions. trustabl serves Forge and Analyzer; autofix serves Probe.

const SWITCH_NOTE = 'Switching changes Forge, Analyzer and Copy CLI. Runs already started are not affected.'
const CHECKSUMS_NOTE = "Checked against the release's own checksums.txt, which catches corrupt downloads but not a compromised release."

export function toolBadge(info: ToolInfo): { text: string; tone: Tone; title?: string; busy: boolean } {
  const n = info.name
  if (info.override) return { text: `${n} override`, tone: 'warning', title: info.path, busy: false }
  if (info.installing.length) return { text: `${n} ${info.installing[0].version} · installing…`, tone: 'neutral', busy: true }
  if (info.active !== info.pinned) {
    return {
      text: `${n} ${info.active} · untested`,
      tone: 'warning',
      title: `Not the version this dashboard was tested with (${info.pinned}). Findings and summaries may be incomplete.`,
      busy: false,
    }
  }
  if (!info.installed) return { text: `${n} ${info.active} · downloads on first run`, tone: 'neutral', busy: false }
  return { text: `${n} ${info.active}`, tone: 'neutral', busy: false }
}

const hashText = { lock: 'SHA-256 from tools.lock.json', upstream: 'SHA-256 from checksums.txt' } as const

export function ToolVersion({ tool }: { tool: ToolName }) {
  const { toast } = useToast()
  const { data, mutate } = useApi<Record<ToolName, ToolInfo>>('/api/tools', {
    refreshInterval: (d) => (d?.[tool]?.installing.length ? 1000 : 4000),
  })
  const info = data?.[tool]
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  // Toast the result when an install this page saw running finishes.
  const wasInstalling = useRef(false)
  const installing = !!info?.installing.length
  useEffect(() => {
    if (wasInstalling.current && !installing && info?.lastInstall) {
      const l = info.lastInstall
      toast(l.ok ? `${tool} ${l.version} is installed` : `Could not install ${tool} ${l.version}: ${l.error ?? 'unknown error'}`)
      refreshAll()
    }
    wasInstalling.current = installing
  }, [installing, info?.lastInstall, tool, toast])

  if (!info) return null
  const badge = toolBadge(info)

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message)
    }
    await mutate()
    refreshAll()
  }
  const use = (version: string) => act(() => post(`/api/tools/${tool}/active`, { version }, 'PUT'))
  const install = (version: string) => act(() => post(`/api/tools/${tool}/install`, { version }))
  const check = async () => {
    setChecking(true)
    setCheckError(null)
    try {
      await post(`/api/tools/${tool}/check`)
    } catch (e) {
      setCheckError((e as Error).message)
    } finally {
      setChecking(false)
    }
    await mutate()
  }

  const manage = !info.override
  const pinnedInstalled = info.installedVersions.some((v) => v.version === info.pinned)
  const showChecksumsNote = info.installedVersions.some((v) => v.hashSource === 'upstream') || canInstallLatest(info)
  const labelForUse = (version: string) => (
    <>Use{' '}<span className="sr-only">{tool} {version}</span></>
  )
  const th = 'text-left font-medium text-(--color-text-primary) py-2 pr-4 align-top whitespace-nowrap'
  const td = 'py-2 pr-4 align-top'

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        title={badge.title}
        className="cursor-pointer rounded-(--radius-pill) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)"
      >
        <Pill tone={badge.tone}>
          {badge.busy && <Loader2 size={12} className="animate-spin mr-1" aria-hidden="true" />}
          {badge.text}
        </Pill>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${tool} versions`} size="lg">
        {info.override ? (
          <Note>
            Runs use <Mono>{info.path}</Mono>, set by {tool === 'trustabl' ? 'TRUSTABL_BIN' : 'AUTOFIX_BIN'}. Unset it to manage versions here.
          </Note>
        ) : (
          <table className="w-full text-sm border-collapse">
            <tbody>
              <tr>
                <th scope="row" className={th}>Active</th>
                <td className={td}><Mono>{info.active}</Mono></td>
                <td className={td}>{info.active !== info.pinned && <Pill tone="warning">untested</Pill>}</td>
                <td className={td} />
              </tr>
              <tr>
                <th scope="row" className={th}>Pinned</th>
                <td className={td}><Mono>{info.pinned}</Mono></td>
                <td className={td}>tested with this dashboard{!pinnedInstalled && ' · downloads on first run'}</td>
                <td className={`${td} text-right`}>
                  {manage && !pinnedInstalled && info.active !== info.pinned && (
                    <Button size="sm" variant="secondary" onClick={() => use(info.pinned)}>{labelForUse(info.pinned)}</Button>
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row" className={th}>Latest</th>
                <td className={td}><Mono>{info.latest?.version ?? '—'}</Mono></td>
                <td className={td}>
                  {info.latest ? <>checked <RelTime at={info.latest.checkedAt} /></> : 'not checked'}
                  {checkError && <p role="alert" className="mt-1 text-(--color-danger-text)">{checkError}</p>}
                </td>
                <td className={`${td} text-right`}>
                  <Button size="sm" variant="secondary" loading={checking} onClick={check}>Check</Button>
                </td>
              </tr>
              {info.installedVersions.map((v, i) => (
                <tr key={v.version} className={i === 0 ? 'border-t border-(--color-border-muted)' : ''}>
                  <th scope="row" className={th}>{i === 0 ? 'Installed' : <span className="sr-only">Installed</span>}</th>
                  <td className={td}><Mono>{v.version}</Mono></td>
                  <td className={td}>{v.hashSource ? hashText[v.hashSource] : 'no SHA256 record'}</td>
                  <td className={`${td} text-right`}>
                    {v.version === info.active
                      ? '(active)'
                      : <Button size="sm" variant="secondary" onClick={() => use(v.version)}>{labelForUse(v.version)}</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {manage && info.installing.length > 0 && (
          <div className="mt-4" role="status">
            {info.installing.map((j) => (
              <div key={j.version}>
                <p className="flex items-center gap-1.5 text-(--color-text-primary)">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Installing {tool} {j.version}
                </p>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-sm">{j.lines.join('\n')}</pre>
              </div>
            ))}
          </div>
        )}
        {manage && !installing && canInstallLatest(info) && (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => install(info.latest!.version)}>Install and use {info.latest!.version}</Button>
          </div>
        )}
        {manage && tool === 'trustabl' && <Note>{SWITCH_NOTE}</Note>}
        {manage && showChecksumsNote && <Note>{CHECKSUMS_NOTE}</Note>}
      </Modal>
    </>
  )
}
