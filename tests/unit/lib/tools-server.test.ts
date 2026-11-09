import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSetting, resetDbForTests } from '@/lib/server/db'
import {
  __setInstallToolForTests, __setLatestVersionForTests, activeVersion, binaryPath, checkLatest, cleanupInstallTemp,
  ensureInstalled, installJobs, installedVersions, latestKnown, onToolInstalled, setActiveVersion, toolInfo,
} from '@/lib/server/tools'
import { InstallError, type InstallOptions } from '../../../scripts/lib/install-tool.mjs'

let home: string
let calls: InstallOptions[]
let gate: Promise<void> | null

/** Writes a runnable fake CLI the way installTool lays it out. */
function writeTool(name: string, version: string, sha?: string) {
  const dir = path.join(home, 'bin', `${name}-${version}`)
  fs.mkdirSync(dir, { recursive: true })
  const out = name === 'trustabl' ? `Trustabl v${version}` : version
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\necho "${out}"\n`, { mode: 0o755 })
  if (sha !== undefined) fs.writeFileSync(path.join(dir, 'SHA256'), sha)
  return dir
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-server-'))
  process.env.AGENT_DASHBOARD_HOME = home
  delete process.env.TRUSTABL_BIN
  delete process.env.AUTOFIX_BIN
  resetDbForTests()
  calls = []
  gate = null
  __setInstallToolForTests(async (opts) => {
    calls.push(opts)
    opts.onProgress?.(`fake install ${opts.name} ${opts.version}`)
    if (gate) await gate
    const dir = writeTool(opts.name, opts.version, `x  a  ${opts.hashSource}\n`)
    return { dir, bin: path.join(dir, opts.name), sha256: 'x', hashSource: opts.hashSource }
  })
})

afterEach(() => {
  __setInstallToolForTests(null)
  __setLatestVersionForTests(null)
  resetDbForTests()
  fs.rmSync(home, { recursive: true, force: true })
})

test('activeVersion defaults to pinned', () => {
  expect(activeVersion('trustabl')).toBe('0.1.16')
  expect(activeVersion('autofix')).toBe('0.5.0')
})

test('setActiveVersion refuses a version that is not installed', () => {
  let err: (Error & { status?: number }) | undefined
  try { setActiveVersion('autofix', '9.9.9') } catch (e) { err = e as Error }
  expect(err?.status).toBe(400)
  expect(activeVersion('autofix')).toBe('0.5.0')
})

test('setActiveVersion accepts the pinned version when not installed', () => {
  writeTool('autofix', '9.9.9')
  setActiveVersion('autofix', '9.9.9')
  setActiveVersion('autofix', '0.5.0')
  expect(activeVersion('autofix')).toBe('0.5.0')
})

test('binaryPath follows the active version', async () => {
  await ensureInstalled('autofix', '9.9.9')
  setActiveVersion('autofix', '9.9.9')
  expect(binaryPath('autofix')).toBe(path.join(home, 'bin', 'autofix-9.9.9', 'autofix'))
  expect(binaryPath('autofix', '0.5.0')).toBe(path.join(home, 'bin', 'autofix-0.5.0', 'autofix'))
})

test('installedVersions newest first, hash source from SHA256', () => {
  writeTool('autofix', '0.5.0', 'abc  autofix_0.5.0_darwin_arm64.tar.gz\n')
  writeTool('autofix', '0.10.0', 'abc  autofix_0.10.0_darwin_arm64.tar.gz  upstream\n')
  writeTool('autofix', '0.6.0')
  fs.mkdirSync(path.join(home, 'bin', 'autofix-1.0.0')) // no binary: not installed
  expect(installedVersions('autofix')).toEqual([
    { version: '0.10.0', hashSource: 'upstream' },
    { version: '0.6.0', hashSource: null },
    { version: '0.5.0', hashSource: 'lock' },
  ])
})

test('ensureInstalled joins a running job', async () => {
  let open!: () => void
  gate = new Promise((r) => (open = r))
  const a: string[] = []
  const b: string[] = []
  const p1 = ensureInstalled('autofix', '0.5.0', (l) => a.push(l))
  const p2 = ensureInstalled('autofix', '0.5.0', (l) => b.push(l))
  await new Promise((r) => setTimeout(r, 10))
  expect(installJobs('autofix')).toEqual([{ version: '0.5.0', lines: ['fake install autofix 0.5.0'] }])
  open()
  await Promise.all([p1, p2])
  expect(calls).toHaveLength(1)
  expect(a).toEqual(['fake install autofix 0.5.0'])
  expect(b).toEqual(['fake install autofix 0.5.0'])
  expect(installJobs('autofix')).toEqual([])
})

test('ensureInstalled picks the hash source', async () => {
  await ensureInstalled('autofix', '0.5.0')
  await ensureInstalled('autofix', '0.6.0')
  expect(calls.map((c) => [c.version, c.hashSource])).toEqual([['0.5.0', 'lock'], ['0.6.0', 'upstream']])
})

test('ensureInstalled resolves at once when installed', async () => {
  writeTool('autofix', '0.5.0')
  await ensureInstalled('autofix', '0.5.0')
  expect(calls).toEqual([])
})

test('ensureInstalled rejects a version that is not X.Y.Z', async () => {
  await expect(ensureInstalled('autofix', '../x')).rejects.toThrow(/not a plain X\.Y\.Z/)
  expect(calls).toEqual([])
})

test('ensureInstalled with an override that does not exist throws', async () => {
  process.env.TRUSTABL_BIN = path.join(home, 'nope')
  await expect(ensureInstalled('trustabl', '0.1.16')).rejects.toThrow(`TRUSTABL_BIN points to ${path.join(home, 'nope')}, which does not exist.`)
  expect(calls).toEqual([])
})

test('a failed install is reported as lastInstall', async () => {
  __setInstallToolForTests(async () => { throw new InstallError('SHA-256 mismatch', 'verify') })
  await expect(ensureInstalled('autofix', '0.6.0')).rejects.toThrow('SHA-256 mismatch')
  const info = await toolInfo('autofix')
  expect(info.lastInstall).toMatchObject({ version: '0.6.0', ok: false, error: 'SHA-256 mismatch' })
  expect(info.installing).toEqual([])
})

test('toolInfo does not cache a missing binary', async () => {
  const before = await toolInfo('autofix')
  expect(before).toMatchObject({ installed: false, active: '0.5.0', pinned: '0.5.0', override: false, installing: [] })
  expect(before.error).toBeUndefined()
  await ensureInstalled('autofix', '0.5.0')
  const after = await toolInfo('autofix')
  expect(after).toMatchObject({ installed: true, reported: '0.5.0', installedVersions: [{ version: '0.5.0', hashSource: 'lock' }] })
  expect(after.lastInstall).toMatchObject({ version: '0.5.0', ok: true })
})

test('onToolInstalled fires after a successful install', async () => {
  const seen: [string, string][] = []
  onToolInstalled('test', (n, v) => seen.push([n, v]))
  await ensureInstalled('trustabl', '0.1.16')
  expect(seen).toEqual([['trustabl', '0.1.16']])
  onToolInstalled('test', () => {})
})

test('checkLatest stores the version', async () => {
  __setLatestVersionForTests(async () => '0.6.0')
  const res = await checkLatest('autofix')
  expect(res.version).toBe('0.6.0')
  expect(latestKnown('autofix')?.version).toBe('0.6.0')
})

test('checkLatest wraps network errors', async () => {
  __setLatestVersionForTests(async () => { throw new Error('getaddrinfo ENOTFOUND github.com') })
  const net = await checkLatest('autofix').catch((e) => e)
  expect(net.message).toBe('Could not reach github.com: getaddrinfo ENOTFOUND github.com')
  expect(net.status).toBe(502)
  __setLatestVersionForTests(async () => { throw new InstallError('Latest release tag v1.2.3-rc1 is not a plain X.Y.Z version.', 'resolve') })
  const tag = await checkLatest('autofix').catch((e) => e)
  expect(tag.message).toBe('Latest release tag v1.2.3-rc1 is not a plain X.Y.Z version.')
  expect(tag.status).toBe(502)
  expect(latestKnown('autofix')).toBeUndefined()
})

test('cleanupInstallTemp removes bin/.tmp-*', () => {
  writeTool('trustabl', '0.1.16')
  fs.mkdirSync(path.join(home, 'bin', '.tmp-abc'), { recursive: true })
  cleanupInstallTemp()
  expect(fs.readdirSync(path.join(home, 'bin'))).toEqual(['trustabl-0.1.16'])
})

test('choosing the pinned version follows the pin, not a fixed number', () => {
  writeTool('autofix', '9.9.9')
  setActiveVersion('autofix', '9.9.9')
  expect(getSetting('tool.autofix.active')).toBe('9.9.9')
  setActiveVersion('autofix', '0.5.0')
  expect(getSetting('tool.autofix.active')).toBeUndefined()
  expect(activeVersion('autofix')).toBe('0.5.0')
})
