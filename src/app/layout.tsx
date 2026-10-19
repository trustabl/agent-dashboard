import type { Metadata } from 'next'
import { GeistMono } from 'geist/font/mono'
import '@fontsource-variable/inter'
import './globals.css'
import { ThemeProvider } from '@/components/ui/ThemeContext'
import { ToastProvider } from '@/components/ui/ToastContext'

// Stored choice wins; otherwise follow the OS. Runs before paint (no flash).
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('trustabl_theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`

export const metadata: Metadata = {
  title: 'Trustabl Console',
  description: 'Run Trustabl Forge, Analyzer and Probe on your own repos, locally.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistMono.variable} style={{ ['--font-inter' as string]: "'Inter Variable'" }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
