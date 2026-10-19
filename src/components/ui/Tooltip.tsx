'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  content:   string
  position?: TooltipPosition
  children:  React.ReactNode
  // Appended to the trigger wrapper's own "relative inline-flex" — e.g.
  // "w-full flex" for a full-width child (a footer's action button), which
  // inline-flex alone won't give it: an inline-flex box with no explicit
  // width still shrinks to its content regardless of the parent's width,
  // so a wrapped child's own w-full computes against that shrunk box, not
  // the space actually available. Omit for every other case — the default
  // stays exactly as it was.
  className?: string
}

const SHOW_DELAY = 400
const GAP = 8
const MAX_WIDTH = 260
/** Keeps the box off the very edge of the window. */
const MARGIN = 8

/**
 * Tooltips are positioned fixed and measured from the trigger's viewport rect.
 *
 * Absolute positioning inside the trigger looks correct until the trigger sits
 * in a container with overflow hidden, at which point the tooltip is clipped by
 * an ancestor that knows nothing about it. Tables, modals and scroll areas all
 * do this. Fixed positioning escapes the ancestor entirely.
 *
 * Fixed is still not enough on its own. A transformed ancestor becomes the
 * containing block for fixed descendants, so its overflow clips them again —
 * the sidebar keeps a transform for its off-canvas slide — and an ancestor
 * stacking context can paint over the tooltip whatever its own z-index says.
 * Rendering into document.body sidesteps both: no ancestor left to clip it,
 * and the z-index competes at the root.
 *
 * The text also wraps: a long explanation on one line runs off the screen, and
 * an explanation nobody can read is not an explanation.
 */
export function Tooltip({ content, position = 'top', children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    const box = boxRef.current?.getBoundingClientRect()
    const w = box?.width ?? MAX_WIDTH
    const h = box?.height ?? 32

    let top = 0
    let left = 0
    switch (position) {
      case 'bottom': top = r.bottom + GAP; left = r.left + r.width / 2 - w / 2; break
      case 'left':   top = r.top + r.height / 2 - h / 2; left = r.left - w - GAP; break
      case 'right':  top = r.top + r.height / 2 - h / 2; left = r.right + GAP; break
      default:       top = r.top - h - GAP; left = r.left + r.width / 2 - w / 2
    }

    // Nudge back inside the window rather than letting it run off an edge.
    left = Math.min(Math.max(left, MARGIN), window.innerWidth - w - MARGIN)
    top = Math.min(Math.max(top, MARGIN), window.innerHeight - h - MARGIN)

    // Written to the node rather than held in state: this is layout, not
    // data, and routing it through a render only adds a frame where the box
    // sits in the wrong place.
    if (boxRef.current) {
      // On a narrow window the fixed 260px could itself overflow, so the cap
      // is whatever is smaller: the preferred width or the window minus margins.
      boxRef.current.style.maxWidth = `${Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2)}px`
      boxRef.current.style.top = `${top}px`
      boxRef.current.style.left = `${left}px`
      boxRef.current.style.visibility = 'visible'
    }
  }, [position])

  const handleEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY)
  }, [])

  const handleLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setVisible(false)
  }, [])

  // Measure once the box exists, so the placement uses its real size rather
  // than a guess, and follow the trigger if the page moves underneath it.
  useEffect(() => {
    if (!visible) return
    place()
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [visible, place])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <div
      ref={triggerRef}
      className={['relative inline-flex', className].filter(Boolean).join(' ')}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      {visible && typeof document !== 'undefined' && createPortal(
        <div
          ref={boxRef}
          role="tooltip"
          className="fixed px-2.5 py-1.5 rounded-(--radius-sharp) bg-(--color-bg-overlay) border border-(--color-border-muted) shadow-(--shadow-float) text-xs font-medium text-(--color-text-primary) pointer-events-none animate-[fadeIn_var(--duration-base)_ease-out]"
          style={{
            // Top of the scale: a tooltip explains whatever is on top of it,
            // so nothing should ever be able to cover it.
            zIndex: 'var(--z-critical)',
            maxWidth: MAX_WIDTH,
            // Hidden until measured, so it never paints at the origin first.
            visibility: 'hidden',
            top: 0,
            left: 0,
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </div>
  )
}
