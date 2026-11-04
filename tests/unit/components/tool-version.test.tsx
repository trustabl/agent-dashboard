// @vitest-environment jsdom
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ToastProvider } from '@/components/ui/ToastContext'
import type { ToolInfo } from '@/lib/types'

const UNTESTED = 'Not the version this dashboard was tested with (0.2.2). Findings and summaries may be incomplete.'
const SWITCH_NOTE = 'Switching changes Forge, Analyzer and Copy CLI. Runs already started are not affected.'
const CHECKSUMS_NOTE = "Checked against the release's own checksums.txt, which catches corrupt downloads but not a compromised release."

function info(over: Partial<ToolInfo> = {}): ToolInfo {
  return {
    name: 'autofix', pinned: '0.2.2', active: '0.2.2', path: '/h/bin/autofix-0.2.2/autofix', installed: true, override: false,
    installedVersions: [{ version: '0.2.2', hashSource: 'lock' }], installing: [], ...over,
  }
}

let tools: Record<string, ToolInfo>
const post = vi.fn(async () => ({ ok: true }))
vi.mock('@/lib/client/api', () => ({
  useApi: (url: string | null) => ({ data: url === '/api/tools' ? tools : undefined, error: undefined, isLoading: false, mutate: vi.fn() }),
  post: (...args: unknown[]) => post(...(args as [])),
  refreshAll: vi.fn(),
}))

const { ToolVersion, toolBadge } = await import('@/components/console/ToolVersion')

beforeEach(() => {
  post.mockClear()
  tools = { autofix: info(), trustabl: info({ name: 'trustabl', pinned: '0.1.15', active: '0.1.15', path: '/h/bin/trustabl-0.1.15/trustabl', installedVersions: [{ version: '0.1.15', hashSource: 'lock' }] }) }
})

const ui = (tool: 'autofix' | 'trustabl' = 'autofix') => render(<ToastProvider><ToolVersion tool={tool} /></ToastProvider>)

describe('toolBadge', () => {
  test('active = pinned, installed', () => {
    expect(toolBadge(info())).toEqual({ text: 'autofix 0.2.2', tone: 'neutral', busy: false })
  })
  test('active ≠ pinned', () => {
    expect(toolBadge(info({ active: '0.5.0' }))).toEqual({ text: 'autofix 0.5.0 · untested', tone: 'warning', title: UNTESTED, busy: false })
  })
  test('not installed', () => {
    expect(toolBadge(info({ installed: false, installedVersions: [] }))).toEqual({ text: 'autofix 0.2.2 · downloads on first run', tone: 'neutral', busy: false })
  })
  test('install running', () => {
    expect(toolBadge(info({ installing: [{ version: '0.5.0', lines: [] }] }))).toEqual({ text: 'autofix 0.5.0 · installing…', tone: 'neutral', busy: true })
  })
  test('env override', () => {
    expect(toolBadge(info({ override: true, path: '/dev/autofix' }))).toEqual({ text: 'autofix override', tone: 'warning', title: '/dev/autofix', busy: false })
  })
})

test('modal lists versions and switches', async () => {
  tools.autofix = info({ active: '0.5.0', installedVersions: [{ version: '0.5.0', hashSource: 'upstream' }, { version: '0.2.2', hashSource: 'lock' }] })
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'autofix 0.5.0 · untested' }))
  const dialog = screen.getByRole('dialog', { name: 'autofix versions' })
  const row = within(dialog).getByRole('row', { name: /0\.2\.2 SHA-256 from tools\.lock\.json/ })
  fireEvent.click(within(row).getByRole('button', { name: 'Use autofix 0.2.2' }))
  expect(post).toHaveBeenCalledWith('/api/tools/autofix/active', { version: '0.2.2' }, 'PUT')
  expect(within(dialog).getByRole('row', { name: /0\.5\.0 SHA-256 from checksums\.txt \(active\)/ })).toBeInTheDocument()
})

test('install button only when latest is newer', () => {
  tools.autofix = info({ latest: { version: '0.5.0', checkedAt: Date.now() } })
  const { unmount } = ui()
  fireEvent.click(screen.getByRole('button', { name: 'autofix 0.2.2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Install and use 0.5.0' }))
  expect(post).toHaveBeenCalledWith('/api/tools/autofix/install', { version: '0.5.0' })
  unmount()
  tools.autofix = info({ latest: { version: '0.5.0', checkedAt: Date.now() }, installedVersions: [{ version: '0.5.0', hashSource: 'upstream' }, { version: '0.2.2', hashSource: 'lock' }] })
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'autofix 0.2.2' }))
  expect(screen.queryByRole('button', { name: /^Install and use/ })).not.toBeInTheDocument()
})

test('Check asks GitHub for the latest release', () => {
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'autofix 0.2.2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  expect(post).toHaveBeenCalledWith('/api/tools/autofix/check')
})

test('trustabl modal shows the switching note', () => {
  ui('trustabl')
  fireEvent.click(screen.getByRole('button', { name: 'trustabl 0.1.15' }))
  expect(screen.getByText(SWITCH_NOTE)).toBeInTheDocument()
})

test('upstream version shows the checksums note', () => {
  tools.autofix = info({ installedVersions: [{ version: '0.5.0', hashSource: 'upstream' }, { version: '0.2.2', hashSource: 'lock' }] })
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'autofix 0.2.2' }))
  expect(screen.getByText(CHECKSUMS_NOTE)).toBeInTheDocument()
  expect(screen.queryByText(SWITCH_NOTE)).not.toBeInTheDocument()
})

test('install progress lines show while installing', () => {
  tools.autofix = info({ installing: [{ version: '0.5.0', lines: ['↓ autofix 0.5.0: https://x'] }] })
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'autofix 0.5.0 · installing…' }))
  expect(screen.getByText('↓ autofix 0.5.0: https://x')).toBeInTheDocument()
})

test('override hides the buttons', () => {
  tools.autofix = info({ override: true, path: '/dev/autofix', latest: { version: '0.5.0', checkedAt: 1 } })
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'autofix override' }))
  const dialog = screen.getByRole('dialog', { name: 'autofix versions' })
  expect(within(dialog).getByText('/dev/autofix')).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: /^(Use|Check|Install)/ })).not.toBeInTheDocument()
})

test('toasts when an install it saw running finishes', () => {
  tools.autofix = info({ installing: [{ version: '0.5.0', lines: [] }] })
  const { rerender } = ui()
  tools = { ...tools, autofix: info({ active: '0.5.0', installedVersions: [{ version: '0.5.0', hashSource: 'upstream' }], lastInstall: { version: '0.5.0', ok: true, finishedAt: 2 } }) }
  rerender(<ToastProvider><ToolVersion tool="autofix" /></ToastProvider>)
  expect(screen.getByText('autofix 0.5.0 is installed')).toBeInTheDocument()
})
