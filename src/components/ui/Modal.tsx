'use client'
import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open:      boolean
  onClose:   () => void
  title:     string
  children:  React.ReactNode
  footer?:   React.ReactNode
  variant?:  'default' | 'warning' | 'danger'
  /** 'full' (added 2026-08-21, for the chart-expand pattern) fills most of
   *  the viewport instead of a fixed max-width — a modal overlay, not the
   *  native Fullscreen API (that needs a direct user gesture and behaves
   *  inconsistently embedded/in an iframe; a modal gets the same "much
   *  bigger" result without either risk). */
  size?:     'md' | 'lg' | 'xl' | 'full'
  /** Caps the dialog at 90% of the viewport and scrolls the body, with the
   *  header and footer pinned. For a modal whose content grows as someone
   *  works in it — rows added to a list — where without this it grows past
   *  the screen and the footer's buttons go with it. Opt-in: 'full' already
   *  behaves this way, and the other modals are short enough not to need it.
   *  A Dropdown's menu is positioned fixed, so scrolling the body does not
   *  clip it. */
  scrollBody?: boolean
}

const sizeClass: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-[440px]',
  lg: 'max-w-[680px]',
  xl: 'max-w-[900px]',
  full: 'max-w-[1600px] w-[94vw] max-h-[90vh] flex flex-col',
}

export function Modal({ open, onClose, title, children, footer, size = 'md', scrollBody = false }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 flex items-center justify-center animate-[fadeIn_150ms_ease-out]"
      style={{
        backgroundColor: 'var(--color-backdrop)',
        zIndex: 'var(--z-modal)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`w-full ${sizeClass[size]} ${scrollBody ? 'flex flex-col max-h-[90vh]' : ''} mx-4 rounded-(--radius-card) border border-(--color-border-muted) bg-(--color-bg-surface) shadow-(--shadow-modal) overflow-visible animate-[fadeIn_150ms_ease-out]`}
      >
        <div className="flex shrink-0 items-center justify-between px-5 py-[18px] border-b border-(--color-border-muted)">
          <h2 id="modal-title" className="text-[15px] font-semibold text-(--color-text-primary)">{title}</h2>
          <button onClick={onClose} aria-label="Close modal" className="text-(--color-text-tertiary) hover:text-(--color-text-secondary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className={[
          'px-5 py-5 text-sm text-(--color-text-secondary)',
          size === 'full' || scrollBody ? 'flex-1 min-h-0 overflow-y-auto' : '',
        ].filter(Boolean).join(' ')}>
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 px-5 py-3.5 border-t border-(--color-border-muted)">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
