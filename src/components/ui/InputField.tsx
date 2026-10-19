import { AlertCircle } from 'lucide-react'
import { useId } from 'react'

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
  required?: boolean
  optional?: boolean
  iconLeft?: React.ElementType
  iconRight?: React.ElementType
  /** Makes iconRight a real button. Without it the icon stays decorative,
   *  which is why a bare eye icon looks clickable but is not. */
  onIconRightClick?: () => void
  /** Accessible name for the icon button. Required when onIconRightClick is set. */
  iconRightLabel?: string
}

export function InputField({
  label,
  error,
  hint,
  required,
  optional,
  iconLeft: IconLeft,
  iconRight: IconRight,
  onIconRightClick,
  iconRightLabel,
  disabled,
  className,
  ...props
}: InputFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-(--color-text-primary)">
          {label}
          {required && <span className="text-(--color-danger-text) ml-0.5">*</span>}
          {optional && <span className="text-(--color-text-tertiary) font-normal ml-1 text-[11px]">(optional)</span>}
        </label>
      )}

      <div className="relative flex items-center">
        {IconLeft && (
          <IconLeft
            size={16}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--color-text-tertiary) pointer-events-none"
          />
        )}
        <input
          id={id}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={[error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined}
          className={[
            'h-[42px] w-full rounded-(--radius-sharp) border bg-(--color-bg-surface)',
            'px-3 text-sm text-(--color-text-primary)',
            'placeholder:text-(--color-text-tertiary)',
            'outline-none transition-[border-color] duration-150 ease',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            error
              ? 'border-(--color-danger-text)'
              : 'border-(--color-border-muted)',
            IconLeft ? 'pl-9' : '',
            IconRight ? 'pr-9' : '',
            className,
          ].filter(Boolean).join(' ')}
          {...props}
        />
        {IconRight && (
          onIconRightClick ? (
            <button
              type="button"
              onClick={onIconRightClick}
              aria-label={iconRightLabel}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-(--color-text-tertiary) hover:text-(--color-text-secondary) cursor-pointer transition-[color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)"
            >
              <IconRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <IconRight
              size={16}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-(--color-text-tertiary) pointer-events-none"
            />
          )
        )}
      </div>

      {error && (
        // TR-996: items-center was fine for a one-line message, but this
        // field's errors regularly wrap to two lines — GitHub's own rejection
        // text is long. items-center then centers the icon against the
        // height of BOTH lines, so it visibly sits low, between the lines
        // rather than beside the first one. items-start plus a 1px nudge
        // lines the icon up with the first line's cap-height instead.
        <p id={errorId} className="flex items-start gap-1 text-[11px] text-(--color-danger-text)">
          <AlertCircle size={12} className="shrink-0 mt-px" />
          {error}
        </p>
      )}

      {hint && !error && (
        <p id={hintId} className="text-[11px] text-(--color-text-tertiary)">
          {hint}
        </p>
      )}
    </div>
  )
}
