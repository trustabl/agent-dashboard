'use client'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import { Checkbox } from './Checkbox'

interface Option { label: string; value: string; group?: string }

interface DropdownProps {
  options: Option[]
  value?: string | string[]
  onChange: (value: string | string[]) => void
  type?: 'single' | 'multi'
  placeholder?: string
  label?: string
  disabled?: boolean
  triggerLabel?: string
  triggerIcon?: React.ReactNode
  hideChevron?: boolean
  align?: 'left' | 'right'
  /** `type: 'multi'` only. Adds a "Select all" row above the options —
   *  a single tri-state control (checked/indeterminate/unchecked) that
   *  toggles between everything and nothing selected, not two separate
   *  buttons. Opt-in: a heterogeneous grouped list (e.g. severity +
   *  status + comparison filters together) rarely wants "select
   *  literally everything" as one action, so this stays off by default. */
  selectAll?: boolean
  /** Shorter trigger for sitting inside a widget header, where the standard
   *  42px control makes that header taller than the one beside it. */
  compact?: boolean
  /** Renders a non-scrolling action bar under the option list, inside the
   *  same panel — for a `type: 'multi'` picker whose selections need one
   *  explicit action (e.g. check some scan types, click Scan) rather than
   *  a separate button sitting next to the trigger, disconnected from what
   *  was actually checked. Receives `close` since clicking inside the
   *  panel doesn't trigger the outside-click handler that closes it. */
  footer?: (close: () => void) => React.ReactNode
}

export function Dropdown({
  options, value, onChange, type = 'single',
  placeholder = 'Select...', label, disabled,
  triggerLabel, triggerIcon, hideChevron, align = 'left',
  selectAll = false, compact = false, footer,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, flipUp: false })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const flipUp = spaceBelow < 200
      setPos({
        top: flipUp ? rect.top - 4 : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        flipUp,
      })
    }
  }, [open])

  const selected = type === 'multi'
    ? (value as string[] ?? [])
    : (value as string ?? null)

  const handleSelect = (val: string) => {
    if (type === 'multi') {
      const arr = selected as string[]
      onChange(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val])
    } else {
      onChange(val)
      setOpen(false)
    }
  }

  const selectedLabels = type === 'multi'
    ? options.filter(o => (selected as string[]).includes(o.value))
    : options.find(o => o.value === selected)

  const allValues = options.map(o => o.value)
  const selectedCount = type === 'multi' ? (selected as string[]).length : 0
  const allSelected = selectedCount > 0 && selectedCount === allValues.length
  const someSelected = selectedCount > 0 && !allSelected
  const toggleSelectAll = () => onChange(allSelected ? [] : allValues)

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-xs font-medium text-(--color-text-primary)">{label}</span>}
      <div ref={ref} className="relative">
        <button
          ref={btnRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={[
            'flex items-center gap-2 w-full rounded-(--radius-sharp) border',
            compact ? 'h-7 px-2 text-xs' : 'h-[42px] px-3 text-sm',
            'bg-(--color-bg-surface) transition-[border-color] duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            open
              ? 'border-(--color-text-primary)'
              : 'border-(--color-border-muted)',
          ].join(' ')}
        >
          {triggerIcon && <span className="shrink-0">{triggerIcon}</span>}
          {triggerLabel ? (
            <span className="flex-1 text-left truncate text-(--color-text-primary)">{triggerLabel}</span>
          ) : type === 'multi' && (selected as string[]).length > 0 ? (
            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
              {(selectedLabels as Option[]).map(o => (
                <span key={o.value} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-(--color-bg-raised) border border-(--color-border-focus) text-xs text-(--color-text-primary)">
                  {o.label}
                  <X size={10} onClick={(e) => { e.stopPropagation(); handleSelect(o.value) }} className="cursor-pointer" />
                </span>
              ))}
            </div>
          ) : (
            <span className={['flex-1 text-left truncate', !selected || (Array.isArray(selected) && selected.length === 0) ? 'text-(--color-text-tertiary)' : 'text-(--color-text-primary)'].join(' ')}>
              {Array.isArray(selectedLabels) || !selectedLabels ? placeholder : (selectedLabels as Option).label}
            </span>
          )}
          {!hideChevron && (open
            ? <ChevronUp size={compact ? 13 : 16} className="text-(--color-text-tertiary) shrink-0" />
            : <ChevronDown size={compact ? 13 : 16} className="text-(--color-text-tertiary) shrink-0" />)}
        </button>

        {open && (
          <div
            className="fixed flex flex-col rounded-(--radius-base) border border-(--color-border-muted) bg-(--color-bg-overlay) shadow-(--shadow-float) animate-[fadeScale_150ms_ease-out]"
            style={{ zIndex: 'var(--z-dropdown)', ...(pos.flipUp ? { bottom: window.innerHeight - pos.top } : { top: pos.top }), ...(align === 'right' ? { right: window.innerWidth - pos.left - pos.width } : { left: pos.left }), minWidth: pos.width, maxHeight: 320, transformOrigin: pos.flipUp ? (align === 'right' ? 'bottom right' : 'bottom') : (align === 'right' ? 'top right' : 'top') }}
          >
            <ul
              role="listbox"
              // min-h-0 is what makes the panel's maxHeight bite: a flex
              // child defaults to min-height:auto, so without it a long
              // option list grows past the panel instead of scrolling
              // inside it.
              className="min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
            {type === 'multi' && selectAll && (
              <li role="option" aria-selected={allSelected}>
                <div className="px-3 py-2 hover:bg-(--color-bg-raised) transition-[background] duration-150 border-b border-(--color-border-muted)">
                  <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleSelectAll} label={allSelected ? 'Deselect all' : 'Select all'} />
                </div>
              </li>
            )}
            {options.map((option, i) => {
              const isSelected = type === 'multi'
                ? (selected as string[]).includes(option.value)
                : selected === option.value
              const showGroup = option.group && (i === 0 || options[i - 1].group !== option.group)
              return (
                <li key={option.value} role="option" aria-selected={isSelected}>
                  {showGroup && (
                    <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-(--color-text-tertiary) uppercase tracking-wide">{option.group}</div>
                  )}
                  <div
                    onClick={() => handleSelect(option.value)}
                    className="flex items-center justify-between px-3 py-2 text-sm text-(--color-text-primary) cursor-pointer hover:bg-(--color-bg-raised) transition-[background] duration-150"
                  >
                    {type === 'multi' && (
                      <div className={['w-4 h-4 rounded-[4px] border flex items-center justify-center mr-2.5 shrink-0', isSelected ? 'bg-(--color-text-primary) border-(--color-text-primary)' : 'border-(--color-border-focus)'].join(' ')}>
                        {isSelected && <Check size={9} strokeWidth={2.5} className="text-(--color-bg-page)" />}
                      </div>
                    )}
                    <span className="flex-1">{option.label}</span>
                    {type === 'single' && isSelected && <Check size={16} className="text-(--color-text-primary)" />}
                  </div>
                </li>
              )
            })}
            </ul>
            {footer && (
              <div className="shrink-0 border-t border-(--color-border-muted) p-2">
                {footer(() => setOpen(false))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
