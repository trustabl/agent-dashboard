'use client'
import { Tooltip } from './Tooltip'
interface Tab {
  label: string
  value: string
  icon?: React.ElementType
  badge?: number
  disabled?: boolean
  /** Explains a disabled tab. A tab that cannot be clicked and says nothing
   *  reads as broken. */
  tooltip?: string
}

interface TabsProps {
  tabs: Tab[]
  value: string
  onChange: (value: string) => void
  variant?: 'underline' | 'pill'
  /** Pill height. 'md' (default) is the compact pill used inside a panel;
   *  'lg' matches a md Button's 42px so pills sit level with the search
   *  box and buttons when they share a page toolbar. */
  size?: 'md' | 'lg'
  /** Splits the width evenly and centres each label. For a small set of tabs
   *  dividing one surface, such as a modal, rather than navigating a page. */
  fullWidth?: boolean
}

export function Tabs({ tabs, value, onChange, variant = 'underline', fullWidth = false, size = 'md' }: TabsProps) {
  if (variant === 'pill') {
    return (
      <div role="tablist" className="flex items-center gap-0.5 p-1 rounded-(--radius-base) border border-(--color-border-muted) bg-(--color-bg-surface) w-fit">
        {tabs.map(tab => {
          const Icon = tab.icon
          const isActive = tab.value === value
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={isActive}
              disabled={tab.disabled}
              onClick={() => onChange(tab.value)}
              className={[
                'flex items-center gap-1.5 rounded-(--radius-sharp) text-sm font-medium',
                size === 'lg' ? 'h-[34px] px-4' : 'h-8 px-3.5',
                'transition-[background,color] duration-150',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                isActive
                  ? 'bg-(--color-bg-raised) text-(--color-text-primary) border border-(--color-border-muted)'
                  : 'text-(--color-text-tertiary) hover:text-(--color-text-secondary)',
              ].filter(Boolean).join(' ')}
            >
              {Icon && <Icon size={14} />}
              {tab.label}
              {tab.badge !== undefined && (
                <span className={['text-[11px] font-medium px-1.5 py-0.5 rounded-full border', isActive ? 'text-(--color-text-primary) bg-(--color-border-muted) border-(--color-border-focus)' : 'text-(--color-text-secondary) bg-(--color-bg-surface) border-(--color-border-muted)'].join(' ')}>
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div role="tablist" className={[
      'flex items-center border-b border-(--color-border-muted)',
      fullWidth ? 'w-full' : '',
    ].filter(Boolean).join(' ')}>
      {tabs.map(tab => {
        const Icon = tab.icon
        const isActive = tab.value === value
        const button = (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            disabled={tab.disabled}
            onClick={() => onChange(tab.value)}
            className={[
              'flex items-center gap-1.5 h-[52px] px-3.5 text-sm font-medium -mb-px',
              // The right rule is coloured on its own: the shared border colour
              // below belongs to the underline, and the active tab would
              // otherwise light up its divider too.
              fullWidth ? 'flex-1 justify-center border-r border-r-(--color-border-muted) last:border-r-0' : '',
              'border-b-2 transition-[color,border-color] duration-150',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              isActive
                ? 'text-(--color-text-primary) border-(--color-text-primary)'
                : 'text-(--color-text-tertiary) border-transparent hover:text-(--color-text-secondary)',
            ].filter(Boolean).join(' ')}
          >
            {Icon && <Icon size={14} />}
            {tab.label}
            {tab.badge !== undefined && (
              <span className={['text-[11px] font-medium px-1.5 py-0.5 rounded-full border', isActive ? 'text-(--color-text-primary) bg-(--color-border-muted) border-(--color-border-focus)' : 'text-(--color-text-secondary) bg-(--color-bg-raised) border-(--color-border-muted)'].join(' ')}>
                {tab.badge}
              </span>
            )}
          </button>
        )

        // A disabled tab that says nothing reads as broken, so the reason
        // travels with it. Wrapped rather than titled, to match every other
        // explanation in the app.
        return tab.tooltip ? (
          <Tooltip key={tab.value} content={tab.tooltip} position="bottom">
            {button}
          </Tooltip>
        ) : (
          button
        )
      })}
    </div>
  )
}
