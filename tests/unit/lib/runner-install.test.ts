import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetDbForTests } from '@/lib/server/db'
import { __setInstallToolForTests, binaryPath, setActiveVersion } from '@/lib/server/tools'
import { cancelRun, getRun, listRuns, startRun, type StartRunInput } from '@/lib/server/runner'
import { ensureRulesStatus, policyCategories } from '@/lib/server/actions/forge'
import { boot } from '@/lib/server/boot'
import { InstallError, type InstallOptions } from '../../../scripts/lib/install-tool.mjs'

const OFFLINE_HINT = 'Offline? Run "make tools" with TRUSTABL_TOOLS_ARCHIVE_DIR set to a folder holding the release archives.'

let home: string
let installs: InstallOptions[]

function writeTool(name: string, version: string, script?: string) {
  const dir = path.join(home, 'bin', `${name}-${version}`)
  fs.mkdirSync(dir, { recursive: true })
  const out = name === 'trustabl' ? `Trustabl v${version}` : version
  fs.writeFileSync(path.join(dir, name), script ?? `#!/bin/sh\necho "${out}"\n`, { mode: 0o755 })
}

function fakeInstaller(before?: (opts: InstallOptions) => Promise<void>) {
  __setInstallToolForTests(async (opts) => {
    installs.push(opts)
    opts.onProgress?.(`↓ ${opts.name} ${opts.version}: https://example.test/${opts.name}.tar.gz`)
    if (before) await before(opts)
    writeTool(opts.name, opts.version)
    const dir = path.join(home, 'bin', `${opts.name}-${opts.version}`)
    return { dir, bin: path.join(dir, opts.name), sha256: 'x', hashSource: opts.hashSource }
  })
}

const versionRun = (): StartRunInput => ({
  tool: 'analyzer', action: 'test-version', repo: null, toolName: 'trustabl', options: {},
  build: async () => ({ bin: binaryPath('trustabl'), args: ['version'] }),
})

async function waitDone(id: string) {
  for (let i = 0; i < 200; i++) {
    const r = getRun(id)!
    if (r.status !== 'running') return r
    await new Promise((x) => setTimeout(x, 25))
  }
  throw new Error('run did not finish')
}

/** The run's log; none at all when nothing was installed or spawned. */
const outputLog = (id: string) => {
  const f = path.join(home, 'runs', id, 'output.log')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-install-'))
  process.env.AGENT_DASHBOARD_HOME = home
  process.env.AGENT_DASHBOARD_NO_AUTORULES = '1'
  delete process.env.TRUSTABL_BIN
  delete process.env.AUTOFIX_BIN
  resetDbForTests()
  installs = []
  fakeInstaller()
})

afterEach(() => {
  __setInstallToolForTests(null)
  resetDbForTests()
  fs.rmSync(home, { recursive: true, force: true })
})

test('installs a missing tool into the run log, then runs it', async () => {
  let open!: () => void
  const gate = new Promise<void>((r) => (open = r))
  fakeInstaller(() => gate)
  const run = await startRun(versionRun())
  expect(run.status).toBe('running')
  expect(run.tool_version).toBe('0.1.15')
  open()
  const done = await waitDone(run.id)
  expect(done.status).toBe('succeeded')
  expect(done.tool_version).toBe('0.1.15')
  const log = outputLog(run.id)
  expect(log.indexOf('↓ trustabl 0.1.15:')).toBeGreaterThanOrEqual(0)
  expect(log.indexOf('↓ trustabl 0.1.15:')).toBeLessThan(log.indexOf('Trustabl v0.1.15'))
  expect(installs.map((i) => i.hashSource)).toEqual(['lock'])
})

test('an installed tool starts without an install', async () => {
  writeTool('trustabl', '0.1.15')
  const done = await waitDone((await startRun(versionRun())).id)
  expect(done.status).toBe('succeeded')
  expect(installs).toEqual([])
})

test('install failure fails the run', async () => {
  __setInstallToolForTests(async () => { throw new InstallError('SHA-256 mismatch for x', 'verify') })
  const done = await waitDone((await startRun(versionRun())).id)
  expect(done.status).toBe('failed')
  expect(done.error).toContain('SHA-256 mismatch for x')
  expect(done.error).not.toContain('Offline?')
  expect(done.finished_at).not.toBeNull()
})

test('install download failure adds the offline hint', async () => {
  __setInstallToolForTests(async () => { throw new InstallError('Could not download https://github.com/x: curl: (6) Could not resolve host', 'download') })
  const done = await waitDone((await startRun(versionRun())).id)
  expect(done.status).toBe('failed')
  expect(done.error).toBe(`Could not download https://github.com/x: curl: (6) Could not resolve host ${OFFLINE_HINT}`)
})

test('cancel during install', async () => {
  let open!: () => void
  const gate = new Promise<void>((r) => (open = r))
  fakeInstaller(() => gate)
  const run = await startRun(versionRun())
  expect(cancelRun(run.id)).toBe(true)
  // Ends at once: the shared install keeps going without holding the run.
  expect(getRun(run.id)!.status).toBe('cancelled')
  open()
  await new Promise((r) => setTimeout(r, 100))
  const done = await waitDone(run.id)
  expect(done.status).toBe('cancelled')
  expect(done.error).toBe('Cancelled from the Console.')
  expect(done.pid).toBeNull()
  expect(outputLog(run.id)).not.toContain('Trustabl v')
})

test('ensureRulesStatus skips a missing trustabl', async () => {
  await ensureRulesStatus(0)
  expect(listRuns({ action: 'rules-status' })).toEqual([])
  await ensureRulesStatus(0, { installMissing: true })
  expect(listRuns({ action: 'rules-status' })).toHaveLength(1)
  await waitDone(listRuns({ action: 'rules-status' })[0].id)
})

test('boot removes install temp folders', async () => {
  fs.mkdirSync(path.join(home, 'bin', '.tmp-abc'), { recursive: true })
  delete (globalThis as { __trustablBooted?: unknown }).__trustablBooted
  await boot()
  expect(fs.existsSync(path.join(home, 'bin', '.tmp-abc'))).toBe(false)
})

test('policyCategories caches per binary path and not when empty', async () => {
  const empty = path.join(home, 'empty.sh')
  fs.writeFileSync(empty, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const full = path.join(home, 'full.sh')
  fs.writeFileSync(full, '#!/bin/sh\necho "      --detectors string   comma-separated detector categories to run (default: all): llm_calls,tools"\n', { mode: 0o755 })
  process.env.TRUSTABL_BIN = empty
  expect(await policyCategories()).toEqual([])
  process.env.TRUSTABL_BIN = full
  expect(await policyCategories()).toEqual(['llm_calls', 'tools'])
  fs.writeFileSync(full, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  expect(await policyCategories()).toEqual(['llm_calls', 'tools'])
})

test('cancel while the post-install version check runs spawns nothing', async () => {
  // The fresh binary is slow to answer `version`; the cancel lands then.
  __setInstallToolForTests(async (opts) => {
    writeTool(opts.name, opts.version, `#!/bin/sh\nsleep 0.4\necho "Trustabl v${opts.version}"\n`)
    const dir = path.join(home, 'bin', `${opts.name}-${opts.version}`)
    return { dir, bin: path.join(dir, opts.name), sha256: 'x', hashSource: opts.hashSource }
  })
  const run = await startRun(versionRun())
  await new Promise((r) => setTimeout(r, 150))
  expect(cancelRun(run.id)).toBe(true)
  await new Promise((r) => setTimeout(r, 1200))
  const done = await waitDone(run.id)
  expect(done.status).toBe('cancelled')
  expect(outputLog(run.id)).not.toContain('Trustabl v')
})

test('tool_version is the version the run used, not one activated meanwhile', async () => {
  let open!: () => void
  const gate = new Promise<void>((r) => (open = r))
  fakeInstaller(async (opts) => { if (opts.version === '0.1.15') await gate })
  const run = await startRun(versionRun())
  writeTool('trustabl', '9.9.9')
  setActiveVersion('trustabl', '9.9.9')
  open()
  const done = await waitDone(run.id)
  expect(done.status).toBe('succeeded')
  expect(done.tool_version).toBe('0.1.15')
  expect(outputLog(run.id)).toContain('Trustabl v0.1.15')
})
