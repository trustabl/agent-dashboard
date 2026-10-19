'use client'
import { Fragment, type KeyboardEvent, type ReactNode } from 'react'
import { Chevron } from './primitives'

// The design's accordion table: a summary row that expands into a detail row.
// The whole row is clickable (design); the chevron is a real button so the
// expand/collapse works from the keyboard and announces its state.

export function DataTable({ head, children, className = '', widths, label }: {
  head: ReactNode[]
  children: ReactNode
  className?: string
  widths?: string[]
  label: string
}) {
  return (
    <div className={`overflow-x-auto rounded-(--radius-base) border border-(--color-border-muted) bg-(--color-bg-surface) mb-3.5 ${className}`}>
      <table className="w-full border-separate border-spacing-0 text-base" aria-label={label} style={widths ? { tableLayout: 'fixed', minWidth: 900 } : undefined}>
        {widths && (
          <colgroup>
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
        )}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-(--color-text-tertiary) whitespace-nowrap bg-(--color-bg-surface)">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, className = '', colSpan, title }: { children?: ReactNode; className?: string; colSpan?: number; title?: string }) {
  return (
    <td colSpan={colSpan} title={title} className={`px-3 py-3 align-middle border-t border-(--color-border-muted) overflow-hidden text-ellipsis ${className}`}>
      {children}
    </td>
  )
}

export function AccRow({ id, open, onToggle, cells, detail, colSpan, highlight, testId }: {
  id: string
  open: boolean
  onToggle: () => void
  cells: ReactNode[]
  detail: ReactNode
  colSpan: number
  highlight?: boolean
  testId?: string
}) {
  const detailId = `acc-${id}`
  const onRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
    onToggle()
  }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight' && !open) onToggle()
    if (e.key === 'ArrowLeft' && open) onToggle()
  }
  return (
    <Fragment>
      <tr
        onClick={onRowClick}
        data-testid={testId}
        data-open={open || undefined}
        className={[
          'cursor-pointer transition-[background] duration-100',
          open ? 'bg-(--color-bg-raised)' : 'hover:bg-(--color-bg-raised)',
          highlight ? 'outline outline-1 -outline-offset-1 outline-(--color-border-focus)' : '',
        ].join(' ')}
      >
        <Td className="w-9 pr-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={open ? 'Collapse row' : 'Expand row'}
            onClick={onToggle}
            onKeyDown={onKey}
            className="grid place-items-center w-6 h-6 rounded-(--radius-sharp) cursor-pointer"
          >
            <Chevron open={open} />
          </button>
        </Td>
        {cells.map((c, i) => <Fragment key={i}>{c}</Fragment>)}
      </tr>
      {open && (
        <tr id={detailId} className="bg-(--color-bg-page)">
          <td colSpan={colSpan} className="px-3 py-4 border-t border-(--color-border-muted)">{detail}</td>
        </tr>
      )}
    </Fragment>
  )
}

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative flex-[1_1_280px] max-w-[320px]">
      <svg aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--color-text-tertiary)" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-[42px] w-full rounded-(--radius-sharp) border border-(--color-border-muted) bg-(--color-bg-surface) pl-[34px] pr-3 text-base text-(--color-text-primary) placeholder:text-(--color-text-tertiary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)"
      />
    </div>
  )
}

export function Chips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={[
            'rounded-(--radius-pill) border px-3 py-1 text-base font-medium cursor-pointer transition-[background,border-color,color] duration-150',
            value === o.value
              ? 'text-(--color-text-primary) bg-(--color-bg-raised) border-(--color-border-focus)'
              : 'text-(--color-text-tertiary) bg-(--color-bg-surface) border-(--color-border-muted) hover:text-(--color-text-secondary) hover:bg-(--color-bg-raised)',
          ].join(' ')}
        >
          {o.label}{o.count !== undefined ? ` (${o.count})` : ''}
        </button>
      ))}
    </div>
  )
}

export function PageTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-(--color-border-muted) mt-2 mb-6">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          id={`tab-${t.value}`}
          aria-selected={value === t.value}
          aria-controls={`pane-${t.value}`}
          onClick={() => onChange(t.value)}
          className={[
            'h-10 px-3.5 -mb-px border-b-2 text-base font-medium cursor-pointer transition-[color,border-color] duration-150',
            value === t.value ? 'text-(--color-text-primary) border-(--color-text-primary)' : 'text-(--color-text-tertiary) border-transparent hover:text-(--color-text-secondary)',
          ].join(' ')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function SkeletonRows({ cols, rows = 3 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: cols }).map((__, c) => (
            <Td key={c}><span className="block h-4 rounded-(--radius-sharp) bg-(--color-bg-raised) animate-pulse" /></Td>
          ))}
        </tr>
      ))}
    </>
  )
}
