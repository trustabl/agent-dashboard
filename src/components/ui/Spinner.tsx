interface SpinnerProps {
  size?: 'sm' | 'md'
  variant?: 'neutral' | 'accent'
  className?: string
}

const sizeStyles = {
  sm: 'w-[14px] h-[14px] border-2',
  md: 'w-[20px] h-[20px] border-2',
}

const variantStyles = {
  neutral: 'border-t-(--color-text-primary)',
  accent: 'border-t-(--color-accent-default)',
}

export function Spinner({ size = 'md', variant = 'neutral', className }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={[
        'rounded-(--radius-pill) border-(--color-border-muted) animate-spin',
        sizeStyles[size],
        variantStyles[variant],
        className,
      ].filter(Boolean).join(' ')}
    />
  )
}
