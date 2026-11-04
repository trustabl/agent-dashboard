import { canInstallLatest, compareVersions, toolBanner } from '@/lib/tool-versions'
import type { ToolInfo } from '@/lib/types'

function info(over: Partial<ToolInfo> = {}): ToolInfo {
  return {
    name: 'autofix', pinned: '0.2.2', active: '0.2.2', path: '/h/bin/autofix-0.2.2/autofix', installed: true, override: false,
    installedVersions: [{ version: '0.2.2', hashSource: 'lock' }], installing: [], ...over,
  }
}

test('compareVersions orders numerically', () => {
  expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
  expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  expect(compareVersions('0.2.2', '0.5.0')).toBeLessThan(0)
})

describe('canInstallLatest', () => {
  const latest = { version: '0.5.0', checkedAt: 1 }
  test('true when the latest is newer than every installed version', () => {
    expect(canInstallLatest(info({ latest }))).toBe(true)
  })
  test('false when the latest is installed', () => {
    expect(canInstallLatest(info({ latest, installedVersions: [{ version: '0.5.0', hashSource: 'upstream' }, { version: '0.2.2', hashSource: 'lock' }] }))).toBe(false)
  })
  test('false without a checked latest', () => {
    expect(canInstallLatest(info())).toBe(false)
  })
  test('false with an env override', () => {
    expect(canInstallLatest(info({ latest, override: true }))).toBe(false)
  })
})

describe('toolBanner', () => {
  test('nothing for a missing tool (it installs on first run)', () => {
    expect(toolBanner([info({ installed: false, installedVersions: [] })])).toBeNull()
  })
  test('nothing when the binary reports the active version', () => {
    expect(toolBanner([info({ active: '0.5.0', reported: '0.5.0' })])).toBeNull()
  })
  test('flags a binary that reports another version than the active one', () => {
    expect(toolBanner([info({ reported: '0.2.3' }), info({ name: 'trustabl', pinned: '0.1.15', active: '0.1.15', reported: '0.1.15' })]))
      .toBe('A CLI reports 0.2.3 but 0.2.2 is active.')
  })
})
