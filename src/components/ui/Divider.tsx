interface DividerProps {
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

export function Divider({ orientation = 'horizontal', className }: DividerProps) {
  if (orientation === 'vertical') {
    return <div className={['w-px h-6 bg-(--color-border-muted) shrink-0', className].filter(Boolean).join(' ')} />
  }
  return <hr className={['border-none h-px bg-(--color-border-muted) w-full', className].filter(Boolean).join(' ')} />
}
