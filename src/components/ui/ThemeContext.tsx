'use client'
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'trustabl_theme'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, _setTheme] = useState<Theme>('dark')

  // The blocking script in layout.tsx already applied the stored theme to
  // the DOM before paint — this only syncs React state to match, so it
  // must not touch document.documentElement itself.
  useEffect(() => {
    // Console: the init script may have followed the OS preference, so the
    // DOM attribute (not only localStorage) is the source of truth.
    const stored = document.documentElement.getAttribute('data-theme') ?? localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring theme state from localStorage after hydration
      _setTheme(stored)
    }
  }, [])

  const setTheme = useCallback((next: Theme) => {
    try { localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* private window */ }
    document.documentElement.setAttribute('data-theme', next)
    _setTheme(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
