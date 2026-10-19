'use client'
import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/components/ui/ToastContext'

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for non-secure contexts / older browsers.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** "Copy CLI": the exact command for the action, ready to paste. */
export function CopyCli({ command, label = 'Copy CLI', size = 'sm', variant = 'ghost', toastText }: {
  command: string | null | undefined
  label?: string
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'secondary' | 'link'
  toastText?: string
}) {
  const { toast } = useToast()
  const [done, setDone] = useState(false)
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!command) return
    const ok = await copyText(command)
    setDone(ok)
    toast(ok ? toastText ?? 'Command copied to clipboard' : 'Could not copy — select the command text instead')
    setTimeout(() => setDone(false), 1500)
  }
  const base =
    variant === 'link'
      ? 'inline-flex items-center gap-1.5 text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text-primary) cursor-pointer'
      : [
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-(--radius-sharp) font-medium cursor-pointer border',
          size === 'sm' ? 'h-8 px-2.5 text-sm' : 'h-[42px] px-4 text-base',
          variant === 'secondary'
            ? 'bg-(--color-bg-raised) border-(--color-border-muted) text-(--color-text-primary) hover:border-(--color-border-focus)'
            : 'bg-transparent border-(--color-border-muted) text-(--color-text-primary) hover:bg-(--color-bg-raised) hover:border-(--color-border-focus)',
          'transition-[background,border-color,color] duration-150 ease',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        ].join(' ')
  return (
    <button type="button" onClick={onClick} disabled={!command} className={base} title={command ?? undefined} aria-label={`${label}: ${command ?? ''}`}>
      {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {label}
    </button>
  )
}

export function CommandBlock({ command }: { command: string }) {
  return (
    <pre className="m-0 mt-1 whitespace-pre-wrap break-all rounded-(--radius-sharp) border border-(--color-border-muted) bg-(--color-bg-page) px-3 py-2 font-mono text-sm text-(--color-text-secondary)">
      {command}
    </pre>
  )
}
