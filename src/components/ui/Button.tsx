import { Loader2 } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'text'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ElementType
  iconOnly?: boolean
  children?: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:   'bg-(--color-accent-default) text-(--color-text-on-accent) hover:bg-(--color-accent-hover) active:bg-(--color-accent-active)',
  secondary: 'bg-(--color-bg-raised) text-(--color-text-primary) border border-(--color-border-muted) hover:bg-(--color-bg-overlay) hover:border-(--color-border-focus)',
  ghost:     'bg-transparent text-(--color-text-primary) border border-(--color-border-muted) hover:bg-(--color-bg-surface) hover:border-(--color-border-focus)',
  danger:    'bg-(--color-danger-bg) text-(--color-danger-text) border border-(--color-danger-border) hover:bg-(--color-danger-hover)',
  text:      'bg-transparent text-(--color-text-secondary) border-none hover:bg-(--color-bg-surface) hover:text-(--color-text-primary)',
}

const sizeStyles: Record<ButtonSize, { base: string; withIcon: string }> = {
  sm: { base: 'h-[36px] px-3 text-xs', withIcon: 'h-[36px] pl-2.5 pr-3 text-xs' },
  md: { base: 'h-[42px] px-4 text-sm', withIcon: 'h-[42px] pl-3 pr-4 text-sm' },
  lg: { base: 'h-[46px] px-5 text-sm', withIcon: 'h-[46px] pl-4 pr-5 text-sm' },
}

const iconOnlySizeStyles: Record<ButtonSize, string> = {
  sm: 'w-[36px] h-[36px] p-0',
  md: 'w-[42px] h-[42px] p-0',
  lg: 'w-[46px] h-[46px] p-0',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconOnly = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center gap-(--space-inner) rounded-(--radius-base) font-medium cursor-pointer',
        'transition-[background,border-color,color] duration-150 ease',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variantStyles[variant],
        iconOnly ? iconOnlySizeStyles[size] : (Icon ? sizeStyles[size].withIcon : sizeStyles[size].base),
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      ) : Icon ? (
        <Icon size={16} aria-hidden="true" />
      ) : null}
      {loading && <span className="sr-only">Loading</span>}
      {!iconOnly && children}
    </button>
  )
}
