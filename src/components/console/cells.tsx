'use client'
import { Pill, RelTime, type Tone } from './primitives'
import { readinessTone } from '@/lib/findings'
import { plural } from '@/lib/text'
import type { AnalyzerRepo, ForgeRepo, ProbeRepo } from '@/lib/server/queries/views'

// One-line tool states for the Overview row and the repo detail header.
// Every label is derived from that tool's real output or the run history.

export interface CellState {
  tone: Tone
  label: string
  sub: React.ReactNode
  title?: string
}

export function forgeState(f: ForgeRepo): CellState {
  if (f.running) return { tone: 'warning', label: 'running', sub: 'forge in progress' }
  if (!f.exists) {
    if (f.pending) return { tone: 'warning', label: 'not written', sub: 'generated skill awaits review' }
    if (f.lastError) return { tone: 'danger', label: 'no skill', sub: `last generate ${f.lastError.status}`, title: f.lastError.error ?? undefined }
    return { tone: 'neutral', label: 'no skill', sub: f.lastGenerate ? 'not written to the repo' : 'forge never run' }
  }
  const age = f.skillMtime ? <><RelTime at={f.skillMtime} /></> : null
  const c = f.check
  if (!c) return { tone: 'neutral', label: f.stamp ? 'not checked' : 'unstamped', sub: <>{age} · run forge check</> }
  if (c.status === 'pass') return { tone: 'success', label: 'skill current', sub: <>{age} · stamp ok</> }
  if (c.status === 'stale') {
    const why = c.cause === 'template' ? 'template moved' : c.cause === 'rules' ? 'rules moved' : 'rules + template moved'
    return { tone: 'warning', label: 'skill stale', sub: why, title: f.staleReason ?? undefined }
  }
  if (c.status === 'unstamped') return { tone: 'warning', label: 'unstamped', sub: 'forge check cannot verify', title: f.staleReason ?? undefined }
  return { tone: 'danger', label: 'check error', sub: c.detail, title: c.detail }
}

export function analyzerState(a: AnalyzerRepo): CellState {
  if (a.running) return { tone: 'warning', label: 'running', sub: 'scan in progress' }
  if (!a.lastScan) {
    if (a.lastError) return { tone: 'danger', label: 'not scanned', sub: `last scan ${a.lastError.status}`, title: a.lastError.error ?? undefined }
    return { tone: 'neutral', label: 'not scanned', sub: 'never' }
  }
  const when = <>{a.lastScan.action === 'import' ? 'import' : 'scan'} <RelTime at={a.lastScan.started_at} /></>
  if (a.readiness === null) return { tone: 'neutral', label: 'n/a ready', sub: when, title: 'An imported SARIF has no readiness score' }
  return { tone: readinessTone(a.readiness), label: `${a.readiness} ready`, sub: when }
}

export function probeState(p: ProbeRepo): CellState {
  if (p.running) return { tone: 'warning', label: 'running', sub: 'harness in progress' }
  if (!p.lastRun) {
    if (p.lastError) return { tone: 'danger', label: 'not run', sub: `last run ${p.lastError.status}`, title: p.lastError.error ?? undefined }
    return { tone: 'neutral', label: 'not run', sub: p.untested ? 'grant set untested' : p.hasScan ? 'no tools extracted' : 'no grant set yet' }
  }
  const age = <RelTime at={p.lastRun.started_at} />
  const risky = p.flags.filter((f) => f.flag === 'egress.denied_class' || f.flag === 'egress.broad_cidr')
  if (risky.length) return { tone: 'danger', label: 'egress risk', sub: risky.map((f) => f.flag.replace(/^egress\./, '')).join(' + '), title: risky.flatMap((f) => f.details).join('\n') }
  if (p.draft.kind === 'drafted') return { tone: 'success', label: 'draft ready', sub: <>{plural(p.egress.length, 'dest')} · {age}</> }
  if (p.draft.kind === 'withheld') return { tone: 'danger', label: 'draft withheld', sub: age, title: p.draft.reason }
  if (p.draft.kind === 'empty') return { tone: p.flags.length ? 'warning' : 'neutral', label: 'not drafted', sub: <>{p.flags.length ? plural(p.flags.length, 'flag') : 'no egress'} · {age}</>, title: p.draft.reason }
  return { tone: 'neutral', label: 'no profile', sub: age }
}

export function StateCell({ s }: { s: CellState }) {
  return (
    <>
      <Pill tone={s.tone} title={s.title}>{s.label}</Pill>
      <div className="text-sm text-(--color-text-tertiary) truncate group-hover:text-(--color-text-secondary)">{s.sub}</div>
    </>
  )
}

/** "12 → 3 open" across scans, or "3 open · 1 resolved" on a first scan. */
export function issuesSummary(a: AnalyzerRepo): string {
  if (!a.lastScan) return 'not scanned'
  if (a.scans > 1 && a.firstOpen !== null) return `${a.firstOpen} → ${a.open} open`
  const last = a.history[a.history.length - 1]
  return `${a.open} open · ${last?.resolved.length ?? 0} resolved`
}
