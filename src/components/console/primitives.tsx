'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { relativeTime, absoluteTime } from '@/lib/time'

// Small building blocks shared by the four pages. They reproduce the design's
// pill / sev / conf / spark / kpi / panel patterns with the design tokens.

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const pillTone: Record<Tone, string> = {
  neutral: 'text-(--color-neutral-text) bg-(--color-neutral-bg) border-(--color-border-muted)',
  success: 'text-(--color-success-text) bg-(--color-success-bg) border-transparent',
  warning: 'text-(--color-warning-text) bg-(--color-warning-bg) border-transparent',
  danger: 'text-(--color-danger-text) bg-(--color-danger-bg) border-transparent',
  info: 'text-(--color-text-primary) bg-(--color-accent-subtle) border-(--color-accent-border)',
}

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap text-sm font-medium px-2 py-px rounded-(--radius-pill) border ${pillTone[tone]}`}
    >
      {children}
    </span>
  )
}

const sevTone = {
  critical: 'bg-(--color-danger-bg) text-(--color-danger-text)',
  high: 'bg-(--color-warning-bg) text-(--color-warning-text)',
  medium: 'bg-(--color-medium-bg) text-(--color-medium-text)',
  low: 'bg-(--color-success-bg) text-(--color-success-text)',
  info: 'bg-(--color-neutral-bg) text-(--color-neutral-text) border border-(--color-border-muted)',
} as const

const sevLetter = { critical: 'C', high: 'H', medium: 'M', low: 'L', info: 'I' } as const
const sevName = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' } as const

export function Sev({ level, children }: { level: keyof typeof sevTone; children?: ReactNode }) {
  return (
    <span
      className={`inline-block min-w-[1.6em] text-center text-sm font-semibold rounded-[4px] px-1 ${sevTone[level]}`}
      title={sevName[level]}
      aria-label={children !== undefined ? `${sevName[level]}: ${children}` : sevName[level]}
    >
      {children ?? sevLetter[level]}
    </span>
  )
}

export function SevRow({ counts }: { counts: { critical: number; high: number; medium: number; low: number } }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Sev level="critical">{counts.critical}</Sev>
      <Sev level="high">{counts.high}</Sev>
      <Sev level="medium">{counts.medium}</Sev>
      <Sev level="low">{counts.low}</Sev>
    </span>
  )
}

export function Conf({ value, bar = true }: { value: number; bar?: boolean }) {
  const pct = Math.round(value * 100)
  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm tabular-nums text-(--color-text-secondary)" title={`Confidence ${value.toFixed(2)}`}>
      {value.toFixed(2).replace(/^0/, '')}
      {bar && (
        <span className="w-14 h-1 rounded-(--radius-pill) bg-(--color-bg-page) overflow-hidden" aria-hidden="true">
          <i className="block h-full bg-(--color-accent-default) rounded-[inherit]" style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  )
}

/** Bars = open-finding counts per scan, newest last. */
export function Spark({ values, height = 18, barWidth = 4, label }: { values: number[]; height?: number; barWidth?: number; label?: string }) {
  const max = Math.max(1, ...values)
  return (
    <span className="inline-flex items-end gap-0.5" style={{ height }} role="img" aria-label={label ?? `Open findings per scan: ${values.join(', ')}`}>
      {values.map((v, i) => (
        <i
          key={i}
          className={`block rounded-[1px] ${i === values.length - 1 ? 'bg-(--color-accent-default)' : 'bg-(--color-text-tertiary)'}`}
          style={{ width: barWidth, height: Math.max(2, Math.round((v / max) * height)) }}
        />
      ))}
    </span>
  )
}

export function Kpi({ label, value, small, trend, tone = 'flat', loading }: {
  label: string
  value: ReactNode
  small?: ReactNode
  trend?: ReactNode
  tone?: 'up' | 'down' | 'flat'
  loading?: boolean
}) {
  const trendTone = tone === 'down' ? 'text-(--color-danger-text)' : tone === 'up' ? 'text-(--color-success-text)' : 'text-(--color-text-tertiary)'
  return (
    <div className="bg-(--color-bg-surface) border border-(--color-border-muted) rounded-(--radius-card) px-4 py-3.5" aria-busy={loading || undefined}>
      <div className="text-xs font-semibold uppercase tracking-wide text-(--color-text-tertiary) mb-1.5">{label}</div>
      <div className="text-xl font-semibold tracking-tight leading-tight text-(--color-text-primary)">
        {loading ? <span className="inline-block w-12 h-6 rounded-(--radius-sharp) bg-(--color-bg-raised) animate-pulse" /> : value}
        {small && !loading ? <small className="text-sm font-medium text-(--color-text-tertiary) ml-1.5">{small}</small> : null}
      </div>
      {trend && !loading ? <div className={`text-sm mt-1 ${trendTone}`}>{trend}</div> : null}
    </div>
  )
}

export function Panel({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-(--color-bg-raised) border border-(--color-border-muted) rounded-(--radius-card) p-4 mb-2 min-w-0 ${className}`}>
      {title ? <h3 className="m-0 mb-2 text-base font-semibold text-(--color-text-primary)">{title}</h3> : null}
      {children}
    </div>
  )
}

export function Kv({ children }: { children: ReactNode }) {
  return <p className="text-base text-(--color-text-secondary) mt-1.5 first:mt-0 break-words [&_b]:text-(--color-text-primary) [&_b]:font-semibold">{children}</p>
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return <span className="font-mono text-sm text-(--color-text-secondary)" title={title}>{children}</span>
}

export function Subtext({ children }: { children: ReactNode }) {
  return <div className="text-sm text-(--color-text-tertiary) truncate">{children}</div>
}

/** A field the design shows but no pinned CLI produces. */
export function Unavailable({ what }: { what: string }) {
  return (
    <span className="text-(--color-text-tertiary)" title={`${what}: not reported by the pinned CLIs`}>
      {what} n/a
    </span>
  )
}

export function RelTime({ at }: { at: number | string | null | undefined }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  if (!at) return <span className="text-(--color-text-tertiary)">never</span>
  return <time dateTime={new Date(at).toISOString()} title={absoluteTime(at)}>{relativeTime(at)}</time>
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={16}
      aria-hidden="true"
      className={`transition-transform duration-150 ${open ? 'rotate-90 text-(--color-text-primary)' : 'text-(--color-text-tertiary)'}`}
    />
  )
}

export function PageHeader({ title, badge, lead }: { title: string; badge?: ReactNode; lead: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight m-0 text-(--color-text-primary)">{title}</h1>
        {badge}
      </div>
      <p className="text-base text-(--color-text-secondary) mt-2 mb-6 max-w-[920px]">{lead}</p>
    </>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">{children}</div>
}

export function ToolbarActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 ml-auto flex-wrap">{children}</div>
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6">{children}</div>
}

export function AccGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-2.5">{children}</div>
}

export function ErrorBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-(--radius-base) border border-(--color-danger-border) bg-(--color-danger-bg) px-4 py-3 my-3">
      <p className="text-base font-semibold text-(--color-danger-text) m-0">{title}</p>
      {children ? <div className="text-sm text-(--color-text-secondary) mt-1">{children}</div> : null}
    </div>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-(--color-text-secondary) mt-1.5">{children}</p>
}
