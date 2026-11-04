import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  InstallError, archiveName, download, installTool, latestVersion, parseChecksums, parseLatestTag, platform, type LockEntry,
} from '../../../scripts/lib/install-tool.mjs'

// A tiny release archive holding one executable, built once for the suite.
const plat = platform()
const ARCHIVE = `fake_1.0.0_${plat.os}_${plat.arch}.tar.gz`
const REL = 'https://github.com/acme/fake/releases/download/v1.0.0'
let fixtures: string
let archiveFile: string
let hash: string

beforeAll(() => {
  fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'install-tool-fx-'))
  const src = path.join(fixtures, 'src')
  fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'fake'), '#!/bin/sh\necho 1.0.0\n', { mode: 0o755 })
  archiveFile = path.join(fixtures, ARCHIVE)
  execFileSync('tar', ['-czf', archiveFile, '-C', src, 'fake'])
  hash = createHash('sha256').update(fs.readFileSync(archiveFile)).digest('hex')
})

afterAll(() => fs.rmSync(fixtures, { recursive: true, force: true }))

let home: string
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-tool-home-'))
})
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

function entry(over: Partial<LockEntry> = {}): LockEntry {
  return { version: '1.0.0', repo: 'acme/fake', binary: 'fake', archive: 'fake_{version}_{os}_{arch}.tar.gz', sha256: { [ARCHIVE]: hash }, ...over }
}

/** Serves URLs from a map of local files; anything else is a network error. */
function server(files: Record<string, string>) {
  const calls: string[] = []
  const download = async (url: string, dest: string) => {
    calls.push(url)
    if (!files[url]) throw new Error(`HTTP 404 ${url}`)
    fs.copyFileSync(files[url], dest)
  }
  return { download, calls }
}

const tmpLeft = () => (fs.existsSync(path.join(home, 'bin')) ? fs.readdirSync(path.join(home, 'bin')).filter((f) => f.startsWith('.tmp-')) : [])
const H = (c: string) => c.repeat(64)

describe('parseChecksums', () => {
  test('reads the two-space format and skips malformed lines', () => {
    const m = parseChecksums(`${H('a')}  a.tar.gz\n\n${H('b')}  b.zip\nzz  a\n${'c'.repeat(63)}  c.tar.gz\n`)
    expect([...m.entries()]).toEqual([['a.tar.gz', H('a')], ['b.zip', H('b')]])
  })
})

describe('parseLatestTag', () => {
  test('reads a plain vX.Y.Z tag', () => {
    expect(parseLatestTag('https://github.com/a/b/releases/tag/v0.5.0')).toBe('0.5.0')
  })
  test.each([
    'https://github.com/a/b/releases/tag/v1.2',
    'https://github.com/a/b/releases/tag/v1.2.3-rc1',
    'https://github.com/a/b/releases',
  ])('rejects %s', (url) => {
    expect(() => parseLatestTag(url)).toThrow(InstallError)
  })
})

test('latestVersion resolves the releases/latest redirect', async () => {
  const seen: string[] = []
  const v = await latestVersion('a/b', { resolve: async (url) => { seen.push(url); return 'https://github.com/a/b/releases/tag/v2.3.4' } })
  expect(v).toBe('2.3.4')
  expect(seen).toEqual(['https://github.com/a/b/releases/latest'])
})

test('archiveName fills the template', () => {
  expect(archiveName(entry(), '1.0.0', { os: 'linux', arch: 'arm64' })).toBe('fake_1.0.0_linux_arm64.tar.gz')
})

describe('installTool', () => {
  test('lock: verifies and installs', async () => {
    const { download } = server({ [`${REL}/${ARCHIVE}`]: archiveFile })
    const lines: string[] = []
    const res = await installTool({ name: 'fake', entry: entry(), version: '1.0.0', home, hashSource: 'lock', onProgress: (l) => lines.push(l), download, archiveDir: '' })
    const bin = path.join(home, 'bin', 'fake-1.0.0', 'fake')
    expect(res).toEqual({ dir: path.dirname(bin), bin, sha256: hash, hashSource: 'lock' })
    expect(fs.statSync(bin).mode & 0o777).toBe(0o755)
    expect(fs.readFileSync(path.join(home, 'bin', 'fake-1.0.0', 'SHA256'), 'utf8')).toBe(`${hash}  ${ARCHIVE}  lock\n`)
    expect(lines).toContain(`↓ fake 1.0.0: ${REL}/${ARCHIVE}`)
    expect(lines).toContain(`✓ SHA-256 matches tools.lock.json (${hash.slice(0, 8)}…)`)
    expect(tmpLeft()).toEqual([])
  })

  test('upstream: uses checksums.txt', async () => {
    const sums = path.join(fixtures, 'checksums.txt')
    fs.writeFileSync(sums, `${H('0')}  other.tar.gz\n${hash}  ${ARCHIVE}\n`)
    const { download } = server({ [`${REL}/${ARCHIVE}`]: archiveFile, [`${REL}/checksums.txt`]: sums })
    const lines: string[] = []
    const res = await installTool({ name: 'fake', entry: entry({ version: '0.9.0', sha256: {} }), version: '1.0.0', home, hashSource: 'upstream', onProgress: (l) => lines.push(l), download, archiveDir: '' })
    expect(res.hashSource).toBe('upstream')
    expect(lines).toContain(`✓ SHA-256 matches checksums.txt (${hash.slice(0, 8)}…)`)
    expect(fs.readFileSync(path.join(res.dir, 'SHA256'), 'utf8')).toBe(`${hash}  ${ARCHIVE}  upstream\n`)
  })

  test('wrong hash leaves nothing', async () => {
    const { download } = server({ [`${REL}/${ARCHIVE}`]: archiveFile })
    const err = await installTool({ name: 'fake', entry: entry({ sha256: { [ARCHIVE]: H('f') } }), version: '1.0.0', home, hashSource: 'lock', download, archiveDir: '' }).catch((e) => e)
    expect(err).toBeInstanceOf(InstallError)
    expect(err.step).toBe('verify')
    expect(err.message).toContain('SHA-256 mismatch')
    expect(fs.existsSync(path.join(home, 'bin', 'fake-1.0.0'))).toBe(false)
    expect(tmpLeft()).toEqual([])
  })

  test('lock with a non-pinned version throws', async () => {
    const { download, calls } = server({})
    const err = await installTool({ name: 'fake', entry: entry({ version: '0.9.0' }), version: '1.0.0', home, hashSource: 'lock', download, archiveDir: '' }).catch((e) => e)
    expect(err).toBeInstanceOf(InstallError)
    expect(err.step).toBe('resolve')
    expect(calls).toEqual([])
  })

  test('missing checksum entry throws', async () => {
    const sums = path.join(fixtures, 'checksums-other.txt')
    fs.writeFileSync(sums, `${H('0')}  other.tar.gz\n`)
    const { download } = server({ [`${REL}/checksums.txt`]: sums })
    const err = await installTool({ name: 'fake', entry: entry({ version: '0.9.0' }), version: '1.0.0', home, hashSource: 'upstream', download, archiveDir: '' }).catch((e) => e)
    expect(err).toBeInstanceOf(InstallError)
    expect(err.step).toBe('checksums')
    expect(tmpLeft()).toEqual([])
  })

  test("download failure has step 'download'", async () => {
    const { download } = server({})
    const err = await installTool({ name: 'fake', entry: entry(), version: '1.0.0', home, hashSource: 'lock', download, archiveDir: '' }).catch((e) => e)
    expect(err).toBeInstanceOf(InstallError)
    expect(err.step).toBe('download')
    expect(tmpLeft()).toEqual([])
  })

  test("invalid version '1.0' throws before any download", async () => {
    const { download, calls } = server({})
    const err = await installTool({ name: 'fake', entry: entry({ version: '1.0' }), version: '1.0', home, hashSource: 'lock', download, archiveDir: '' }).catch((e) => e)
    expect(err).toBeInstanceOf(InstallError)
    expect(err.step).toBe('resolve')
    expect(calls).toEqual([])
  })

  test('target already present counts as success', async () => {
    const dir = path.join(home, 'bin', 'fake-1.0.0')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'fake'), 'existing', { mode: 0o755 })
    const { download } = server({ [`${REL}/${ARCHIVE}`]: archiveFile })
    const res = await installTool({ name: 'fake', entry: entry(), version: '1.0.0', home, hashSource: 'lock', download, archiveDir: '' })
    expect(res.bin).toBe(path.join(dir, 'fake'))
    expect(fs.readFileSync(res.bin, 'utf8')).toBe('existing')
    expect(tmpLeft()).toEqual([])
  })

  test('archiveDir with lock copies instead of downloading', async () => {
    const { download, calls } = server({})
    const lines: string[] = []
    await installTool({ name: 'fake', entry: entry(), version: '1.0.0', home, hashSource: 'lock', onProgress: (l) => lines.push(l), download, archiveDir: fixtures })
    expect(calls).toEqual([])
    expect(lines).toContain(`• fake: using ${path.join(fixtures, ARCHIVE)}`)
    expect(fs.existsSync(path.join(home, 'bin', 'fake-1.0.0', 'fake'))).toBe(true)
  })
})

test('download does not block the event loop', async () => {
  // A blocking (sync) download would let no timer run until it returns.
  let ticked = false
  setTimeout(() => (ticked = true), 0)
  const dest = path.join(home, 'copy.tar.gz')
  await download(`file://${archiveFile}`, dest)
  expect(ticked).toBe(true)
  expect(fs.readFileSync(dest)).toEqual(fs.readFileSync(archiveFile))
})
