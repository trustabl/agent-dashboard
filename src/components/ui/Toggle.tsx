import { useId } from 'react'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  const id = useId()

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
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={[
          'w-9 h-5 rounded-full transition-[background] duration-150',
          checked
            ? 'bg-(--color-text-primary)'
            : 'bg-(--color-border-muted) border border-(--color-border-focus)',
        ].join(' ')}>
          <div className={[
            'absolute top-[3px] w-3.5 h-3.5 rounded-full transition-[left] duration-150',
            checked
              ? 'left-[18px] bg-(--color-bg-page)'
              : 'left-[3px] bg-(--color-text-primary)',
          ].join(' ')} />
        </div>
      </div>
      {label && <span className="text-sm text-(--color-text-primary)">{label}</span>}
    </label>
  )
}
