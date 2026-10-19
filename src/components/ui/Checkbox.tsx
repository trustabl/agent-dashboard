'use client'
import { Check, Minus } from 'lucide-react'
import { useId, useEffect, useRef } from 'react'

interface CheckboxProps {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Checkbox({ checked, indeterminate, onChange, label, disabled }: CheckboxProps) {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])

  return (
    <label
      htmlFor={id}
      className={[
        'flex items-center gap-2.5 cursor-pointer',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={[
          'w-4 h-4 rounded-[4px] border flex items-center justify-center transition-[background,border-color] duration-150',
          checked || indeterminate
            ? 'bg-(--color-text-primary) border-(--color-text-primary)'
            : 'bg-transparent border-(--color-border-focus)',
        ].join(' ')}>
          {indeterminate
            ? <Minus size={9} strokeWidth={2.5} className="text-(--color-bg-page)" />
            : checked
            ? <Check size={9} strokeWidth={2.5} className="text-(--color-bg-page)" />
            : null}
        </div>
      </div>
      {label && <span className="text-sm text-(--color-text-primary)">{label}</span>}
    </label>
  )
}
