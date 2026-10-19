interface SkeletonProps {
  variant?: 'line' | 'circle' | 'rect'
  width?: string | number
  height?: string | number
  className?: string
}

export function Skeleton({ variant = 'line', width = '100%', height = 14, className }: SkeletonProps) {
  const radiusMap = {
    line: 'rounded-(--radius-sharp)',
    circle: 'rounded-(--radius-pill)',
    rect: 'rounded-(--radius-base)',
  }

  return (
    <div
      aria-hidden="true"
      className={[
        'animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-(--color-bg-surface) via-(--color-bg-raised) to-(--color-bg-surface) bg-[length:800px_100%]',
        radiusMap[variant],
        className,
      ].filter(Boolean).join(' ')}
      style={{ width, height }}
    />
  )
}
