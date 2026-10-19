import { Button } from '@/components/ui'
import { Tooltip } from '@/components/ui/Tooltip'

interface EmptyStateProps {
  icon: React.ElementType
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
    variant?: 'primary' | 'ghost'
    /** Disables the action without hiding it — e.g. a permission gate
     *  (Module 11.4), paired with disabledReason for why. */
    disabled?: boolean
    disabledReason?: string
  }
  danger?: boolean
}

export function EmptyState({ icon: Icon, title, description, action, danger }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-12 text-center rounded-(--radius-card) border border-(--color-border-muted) bg-(--color-bg-surface)">
      <div className={[
        'w-14 h-14 rounded-(--radius-card) flex items-center justify-center',
        danger
          ? 'bg-(--color-danger-bg) border border-(--color-danger-border)'
          : 'bg-(--color-bg-raised) border border-(--color-border-muted)',
      ].join(' ')}>
        <Icon size={24} className={danger ? 'text-(--color-danger-text)' : 'text-(--color-text-tertiary)'} />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold text-(--color-text-primary)">{title}</p>
        <p className="text-xs text-(--color-text-secondary) max-w-[280px] leading-relaxed">{description}</p>
      </div>
      {action && (
        action.disabled && action.disabledReason ? (
          <Tooltip content={action.disabledReason}>
            <Button variant={action.variant ?? 'primary'} onClick={action.onClick} disabled className="mt-1">
              {action.label}
            </Button>
          </Tooltip>
        ) : (
          <Button variant={action.variant ?? 'primary'} onClick={action.onClick} disabled={action.disabled} className="mt-1">
            {action.label}
          </Button>
        )
      )}
    </div>
  )
}
