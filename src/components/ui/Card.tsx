interface CardProps {
  variant?: 'default' | 'interactive'
  className?: string
  children: React.ReactNode
  onClick?: () => void
}

interface CardHeaderProps { children: React.ReactNode; className?: string }
interface CardBodyProps { children: React.ReactNode; className?: string }
interface CardFooterProps { children: React.ReactNode; className?: string }

export function Card({ variant = 'default', className, children, onClick }: CardProps) {
  const isInteractive = variant === 'interactive' && !!onClick
  return (
    <div
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={isInteractive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } } : undefined}
      className={[
        'rounded-(--radius-card) border border-(--color-border-muted) bg-(--color-bg-surface) overflow-hidden flex flex-col',
        isInteractive
          ? 'cursor-pointer transition-[border-color,background] duration-150 hover:border-(--color-border-focus) hover:bg-(--color-bg-overlay) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)'
          : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: CardHeaderProps) {
  return (
    <div className={['flex items-center justify-between px-4 py-3 border-b border-(--color-border-muted)', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}

export function CardBody({ children, className }: CardBodyProps) {
  return (
    <div className={['p-4 text-sm text-(--color-text-secondary) flex-1', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}

export function CardFooter({ children, className }: CardFooterProps) {
  return (
    <div className={['flex items-center justify-between px-4 py-3 border-t border-(--color-border-muted)', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}
