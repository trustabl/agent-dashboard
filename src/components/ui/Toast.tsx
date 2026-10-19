'use client'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  onDismiss: () => void
  duration?: number
}

export function Toast({ message, onDismiss, duration = 4000 }: ToastProps) {
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)))
  }, [])

  useEffect(() => {
    if (duration === 0) return
    const fadeTimer = setTimeout(() => setAnimate(false), duration - 200)
    const removeTimer = setTimeout(onDismiss, duration)
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer) }
  }, [duration, onDismiss])

  const handleDismiss = () => {
    setAnimate(false)
    setTimeout(onDismiss, 200)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-(--radius-base) border border-(--color-border-muted) bg-(--color-bg-surface) shadow-(--shadow-float) max-w-[360px] transition-[opacity,transform] duration-200 ease-out"
      style={{
        opacity: animate ? 1 : 0,
        transform: animate ? 'translateY(0)' : 'translateY(8px)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-(--color-text-tertiary) text-sm">•</span>
        <span className="text-sm font-medium text-(--color-text-primary)">{message}</span>
      </div>
      <button onClick={handleDismiss} aria-label="Dismiss notification" className="text-(--color-text-tertiary) hover:text-(--color-text-secondary) shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)">
        <X size={14} />
      </button>
    </div>
  )
}
