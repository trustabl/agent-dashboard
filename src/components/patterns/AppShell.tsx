'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, Package, ScanSearch, ShieldCheck, Moon, Sun, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { BrandMark } from './BrandMark'
import { useTheme } from '@/components/ui/ThemeContext'
import { useApi } from '@/lib/client/api'
import { Pill } from '@/components/console/primitives'
import { RunDialogProvider } from '@/components/console/RunDialog'
import { shortSha } from '@/lib/text'

// The design's App Shell: 240px rail with exactly four destinations, a 56px
// topbar with the page title, repo count and current rules SHA. There is no
// account menu, org switcher, notifications or settings (single user, no
// login).

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutGrid },
  { href: '/forge', label: 'Forge', icon: Package },
  { href: '/analyzer', label: 'Analyzer', icon: ScanSearch },
  { href: '/probe', label: 'Probe', icon: ShieldCheck },
] as const

interface Status {
  repoCount: number
  rules: { sha: string } | null
  running: { id: string; tool: string }[]
  tools: Record<string, { installed: boolean; pinned: string; reported?: string; error?: string }>
}

function titleFor(pathname: string): string {
  if (pathname.startsWith('/forge')) return 'Forge'
  if (pathname.startsWith('/analyzer')) return 'Analyzer'
  if (pathname.startsWith('/probe')) return 'Probe'
  if (pathname.startsWith('/repos/')) return 'Repo'
  return 'Overview'
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()
  const { data: status } = useApi<Status>('/api/status', { refreshInterval: 3000 })
  const missing = status ? Object.values(status.tools).filter((t) => !t.installed) : []
  const mismatch = status ? Object.values(status.tools).filter((t) => t.installed && t.reported && t.reported !== t.pinned) : []

  return (
    <RunDialogProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2 focus:rounded-(--radius-sharp) focus:bg-(--color-bg-overlay)" style={{ zIndex: 'var(--z-critical)' }}>
        Skip to content
      </a>
      <div className="grid h-screen grid-cols-[240px_1fr] max-md:grid-cols-[64px_1fr] bg-(--color-bg-page)">
        <nav aria-label="Main" className="flex flex-col overflow-y-auto bg-(--color-bg-surface) border-r border-(--color-border-muted) px-4 pt-[17px] pb-4 max-md:px-2">
          <Link href="/" className="flex items-center gap-2.5 cursor-pointer" aria-label="Trustabl Console — Overview">
            <span className="grid h-9 w-9 shrink-0 place-items-center"><BrandMark /></span>
            <span className="text-base font-semibold text-(--color-text-primary) max-md:hidden">Trustabl</span>
          </Link>
          <hr className="border-0 border-t border-(--color-border-muted) -mx-4 mt-[17px] mb-3" />
          <ul className="flex-1 list-none m-0 p-0">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? pathname === '/' || pathname.startsWith('/repos/') : pathname.startsWith(href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'flex items-center gap-2.5 h-9 px-3 mb-0.5 rounded-(--radius-sharp) border text-base font-medium cursor-pointer',
                      'transition-[background,border-color,color] duration-150 ease',
                      active
                        ? 'bg-(--color-bg-raised) text-(--color-text-primary) border-(--color-border-muted)'
                        : 'border-transparent text-(--color-text-secondary) hover:bg-(--color-bg-raised) hover:text-(--color-text-primary)',
                    ].join(' ')}
                  >
                    <Icon size={16} aria-hidden="true" className="shrink-0" />
                    <span className="max-md:sr-only">{label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          <hr className="border-0 border-t border-(--color-border-muted) -mx-4 my-3" />
          <div className="px-3 pt-1 text-sm text-(--color-text-tertiary) leading-snug max-md:hidden">Local · your repos only</div>
        </nav>

        <div className="flex min-w-0 flex-col h-screen">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-6 bg-(--color-bg-surface) border-b border-(--color-border-muted)" style={{ zIndex: 'var(--z-overlay)' }}>
            <div className="text-md font-medium text-(--color-text-primary)">{titleFor(pathname)}</div>
            <div className="flex items-center gap-3">
              {status && status.running.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm text-(--color-warning-text)" role="status" data-testid="running-indicator">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" /> {status.running.length} running
                </span>
              )}
              <Pill>{status ? `${status.repoCount} repo${status.repoCount === 1 ? '' : 's'}` : '— repos'}</Pill>
              <span className="font-mono text-sm text-(--color-text-secondary)" title={status?.rules ? `Rules SHA forge resolves now: ${status.rules.sha}` : 'Rules SHA not resolved yet'}>
                rules {status?.rules ? shortSha(status.rules.sha) : '…'}
              </span>
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                className="grid h-9 w-9 place-items-center rounded-(--radius-base) cursor-pointer text-(--color-text-secondary) hover:bg-(--color-bg-raised) hover:text-(--color-text-primary)"
              >
                {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
              </button>
            </div>
          </header>
          {(missing.length > 0 || mismatch.length > 0) && (
            <div role="alert" className="px-6 py-2 text-sm bg-(--color-danger-bg) text-(--color-danger-text) border-b border-(--color-danger-border)">
              {missing.map((t) => `${'error' in t && t.error ? t.error : 'A pinned CLI is not installed.'}`).join(' ')}
              {mismatch.map((t) => ` A CLI reports ${t.reported} but ${t.pinned} is pinned.`).join('')}
            </div>
          )}
          <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="mx-auto w-full max-w-[1440px] px-6 py-12 max-md:px-4 max-md:py-6">{children}</div>
          </main>
        </div>
      </div>
    </RunDialogProvider>
  )
}
