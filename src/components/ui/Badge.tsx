type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral'
type BadgeShape = 'pill' | 'sharp'
type BadgeSize = 'sm' | 'md'

interface BadgeProps {
  variant?: BadgeVariant
  shape?: BadgeShape
  size?: BadgeSize
  children: React.ReactNode
}

const variantStyles: Record<BadgeVariant, string> = {
  info:    'bg-(--color-info-bg) text-(--color-info-text)',
  success: 'bg-(--color-success-bg) text-(--color-success-text)',
  warning: 'bg-(--color-warning-bg) text-(--color-warning-text)',
  danger:  'bg-(--color-danger-bg) text-(--color-danger-text)',
  neutral: 'bg-(--color-neutral-bg) text-(--color-neutral-text) border border-(--color-border-muted)',
}

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-3 py-1 text-xs',
}

export function Badge({ variant = 'neutral', shape = 'pill', size = 'md', children }: BadgeProps) {
  return (
    <span className={[
      'inline-flex items-center font-medium',
      shape === 'pill' ? 'rounded-(--radius-pill)' : 'rounded-(--radius-sharp)',
      variantStyles[variant],
      sizeStyles[size],
    ].join(' ')}>
      {children}
    </span>
  )
}
