import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetDbForTests, setSetting } from '@/lib/server/db'
import { __setInstallToolForTests, __setLatestVersionForTests, activeVersion, ensureInstalled, latestKnown } from '@/lib/server/tools'
import { listRuns } from '@/lib/server/runner'
import { GET as listTools } from '@/app/api/tools/route'
import { POST as check } from '@/app/api/tools/[name]/check/route'
import { POST as install } from '@/app/api/tools/[name]/install/route'
import { PUT as setActive } from '@/app/api/tools/[name]/active/route'
import { parseLatestTag } from '../../../scripts/lib/install-tool.mjs'

let home: string

const ctx = (name: string) => ({ params: Promise.resolve({ name }) })
const body = (url: string, data: unknown, method = 'POST') =>
  new Request(`http://127.0.0.1:4317${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
const empty = (url: string) => new Request(`http://127.0.0.1:4317${url}`, { method: 'POST' })

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-routes-'))
  process.env.AGENT_DASHBOARD_HOME = home
  process.env.AGENT_DASHBOARD_NO_AUTORULES = '1'
  delete process.env.TRUSTABL_BIN
  delete process.env.AUTOFIX_BIN
  resetDbForTests()
  __setInstallToolForTests(async (opts) => {
    const dir = path.join(home, 'bin', `${opts.name}-${opts.version}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, opts.name), `#!/bin/sh\necho ${opts.version}\n`, { mode: 0o755 })
    return { dir, bin: path.join(dir, opts.name), sha256: 'x', hashSource: opts.hashSource }
  })
})

afterEach(() => {
  __setInstallToolForTests(null)
  __setLatestVersionForTests(null)
  resetDbForTests()
  fs.rmSync(home, { recursive: true, force: true })
})

test('GET lists both tools', async () => {
  const res = await listTools()
  expect(res.status).toBe(200)
  const data = await res.json()
  expect(Object.keys(data).sort()).toEqual(['autofix', 'trustabl'])
  expect(data.autofix).toMatchObject({ pinned: '0.2.2', active: '0.2.2', installed: false })
})

test('unknown tool is 404', async () => {
  const res = await check(empty('/api/tools/foo/check'), ctx('foo'))
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'Unknown tool' })
})

test('check stores the latest version', async () => {
  __setLatestVersionForTests(async () => '0.5.0')
  const res = await check(empty('/api/tools/autofix/check'), ctx('autofix'))
  expect(res.status).toBe(200)
  expect((await res.json()).version).toBe('0.5.0')
})

test('check does not store a bad tag', async () => {
  __setLatestVersionForTests(async () => parseLatestTag('https://github.com/a/b/releases'))
  const res = await check(empty('/api/tools/autofix/check'), ctx('autofix'))
  expect(res.status).toBe(502)
  expect((await res.json()).error).toBe('GitHub did not redirect to a release tag (got https://github.com/a/b/releases).')
  expect(latestKnown('autofix')).toBeUndefined()
})

test('install accepts only pinned or latest', async () => {
  const bad = await install(body('/api/tools/autofix/install', { version: '0.4.0' }), ctx('autofix'))
  expect(bad.status).toBe(400)
  const ok = await install(body('/api/tools/autofix/install', { version: '0.2.2' }), ctx('autofix'))
  expect(ok.status).toBe(202)
  await ensureInstalled('autofix', '0.2.2')
})

test('install of latest activates it', async () => {
  setSetting('tool.autofix.latest', { version: '0.5.0', checkedAt: Date.now() })
  const res = await install(body('/api/tools/autofix/install', { version: '0.5.0' }), ctx('autofix'))
  expect(res.status).toBe(202)
  await ensureInstalled('autofix', '0.5.0')
  await new Promise((r) => setTimeout(r, 0))
  expect(activeVersion('autofix')).toBe('0.5.0')
})

test('active PUT switches to an installed version', async () => {
  await ensureInstalled('autofix', '0.2.2')
  setSetting('tool.autofix.latest', { version: '0.5.0', checkedAt: Date.now() })
  await ensureInstalled('autofix', '0.5.0')
  const res = await setActive(body('/api/tools/autofix/active', { version: '0.5.0' }, 'PUT'), ctx('autofix'))
  expect(res.status).toBe(200)
  expect(activeVersion('autofix')).toBe('0.5.0')
})

test('active PUT 400 for a version not installed', async () => {
  const res = await setActive(body('/api/tools/autofix/active', { version: '0.5.0' }, 'PUT'), ctx('autofix'))
  expect(res.status).toBe(400)
  expect(activeVersion('autofix')).toBe('0.2.2')
})

test('a first trustabl install from the dialog resolves the rules SHA', async () => {
  await listTools() // boots, with autorules off: nothing installed, no rules run
  delete process.env.AGENT_DASHBOARD_NO_AUTORULES
  setSetting('tool.trustabl.latest', { version: '9.9.9', checkedAt: Date.now() })
  const res = await install(body('/api/tools/trustabl/install', { version: '9.9.9' }), ctx('trustabl'))
  expect(res.status).toBe(202)
  await ensureInstalled('trustabl', '9.9.9')
  expect(activeVersion('trustabl')).toBe('9.9.9')
  for (let i = 0; i < 40 && !listRuns({ action: 'rules-status' }).length; i++) await new Promise((r) => setTimeout(r, 50))
  expect(listRuns({ action: 'rules-status' })).toHaveLength(1)
})
