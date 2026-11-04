// Downloads, verifies and installs one release of a Trustabl CLI into
// <home>/bin/<name>-<version>/. Shared by scripts/fetch-tools.mjs (pinned
// versions, `make run` and `make tools`) and the dashboard server (first-run
// installs and upgrades). No dashboard imports: plain Node only.
//
// Hashes come from tools.lock.json for the pinned version ('lock'), or from the
// release's own checksums.txt for any other version ('upstream'). An archive
// whose SHA-256 differs is never extracted.

import { createHash } from 'node:crypto'
import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

// Async on purpose: the dashboard server installs while it keeps answering
// requests (run log streams, status polls), so nothing here may block.
const run = promisify(execFile)

const VERSION_RE = /^\d+\.\d+\.\d+$/

export class InstallError extends Error {
  constructor(message, step) {
    super(message)
    this.name = 'InstallError'
    this.step = step
  }
}

export function platform() {
  const osName = { darwin: 'darwin', linux: 'linux' }[process.platform]
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch]
  if (!osName || !arch) {
    throw new Error(`Unsupported platform ${process.platform}/${process.arch}. Supported: macOS and Linux (incl. WSL2) on x64 or arm64.`)
  }
  return { os: osName, arch }
}

export function archiveName(entry, version, plat = platform()) {
  return entry.archive.replace('{version}', version).replace('{os}', plat.os).replace('{arch}', plat.arch)
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

let curl
function hasCurl() {
  curl ??= spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0
  return curl
}

/** Give up on a stalled transfer (under 1 KB/s for a minute) instead of
 *  holding the install, and every run waiting on it, forever. */
export function curlArgs(url, dest, { connectTimeout = 20, retries = 3 } = {}) {
  return ['-fsSL', '--retry', String(retries), '--connect-timeout', String(connectTimeout), '--speed-limit', '1024', '--speed-time', '60', '-o', dest, url]
}

export async function download(url, dest, opts) {
  // curl honours HTTPS_PROXY and system CA stores; Node's fetch does not
  // always, so prefer it when present.
  if (hasCurl()) {
    await run('curl', curlArgs(url, dest, opts))
    return
  }
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60_000) })
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

/** `<sha256>  <file>` lines, as goreleaser writes them. */
export function parseChecksums(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(\S+)\s*$/)
    if (m) map.set(m[2], m[1])
  }
  return map
}

/** The version in the URL that /releases/latest redirects to. */
export function parseLatestTag(finalUrl) {
  const m = String(finalUrl).match(/\/releases\/tag\/v([^/?#]+)$/)
  if (!m) throw new InstallError(`GitHub did not redirect to a release tag (got ${finalUrl}).`, 'resolve')
  if (!VERSION_RE.test(m[1])) throw new InstallError(`Latest release tag v${m[1]} is not a plain X.Y.Z version.`, 'resolve')
  return m[1]
}

async function resolveRedirect(url) {
  if (hasCurl()) {
    const { stdout } = await run('curl', ['-fsSIL', '--max-time', '30', '-o', '/dev/null', '-w', '%{url_effective}', url])
    return stdout.trim()
  }
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HEAD ${url} -> HTTP ${res.status}`)
  return res.url
}

/** Latest release of github.com/<repo>, from the /releases/latest redirect
 *  (no API call, so no 60-per-hour limit). */
export async function latestVersion(repo, { resolve = resolveRedirect } = {}) {
  return parseLatestTag(await resolve(`https://github.com/${repo}/releases/latest`))
}

function errText(e) {
  const stderr = e && e.stderr ? String(e.stderr).trim() : ''
  return stderr || (e && e.message) || String(e)
}

export async function installTool({ name, entry, version, home, hashSource, onProgress = () => {}, download: get = download, archiveDir = process.env.TRUSTABL_TOOLS_ARCHIVE_DIR }) {
  if (!VERSION_RE.test(version)) throw new InstallError(`${name}: "${version}" is not a plain X.Y.Z version.`, 'resolve')
  if (hashSource === 'lock' && version !== entry.version) {
    throw new InstallError(`${name} ${version} is not the pinned version (${entry.version}); tools.lock.json has no hash for it.`, 'resolve')
  }
  if (hashSource !== 'lock' && hashSource !== 'upstream') throw new InstallError(`Unknown hash source ${hashSource}.`, 'resolve')
  const archive = archiveName(entry, version)
  const binRoot = path.join(home, 'bin')
  const dir = path.join(binRoot, `${name}-${version}`)
  const bin = path.join(dir, entry.binary)
  const release = `https://github.com/${entry.repo}/releases/download/v${version}`

  fs.mkdirSync(binRoot, { recursive: true, mode: 0o700 })
  const tmp = fs.mkdtempSync(path.join(binRoot, '.tmp-'))
  try {
    let expected
    if (hashSource === 'lock') {
      expected = entry.sha256[archive]
      if (!expected) throw new InstallError(`tools.lock.json has no SHA-256 for ${archive}`, 'resolve')
    } else {
      const sumsFile = path.join(tmp, 'checksums.txt')
      try {
        await get(`${release}/checksums.txt`, sumsFile)
      } catch (e) {
        throw new InstallError(`Could not download ${release}/checksums.txt: ${errText(e)}`, 'download')
      }
      expected = parseChecksums(fs.readFileSync(sumsFile, 'utf8')).get(archive)
      if (!expected) throw new InstallError(`${release}/checksums.txt has no entry for ${archive}.`, 'checksums')
    }

    const file = path.join(tmp, archive)
    if (hashSource === 'lock' && archiveDir) {
      const local = path.join(archiveDir, archive)
      try {
        fs.copyFileSync(local, file)
      } catch (e) {
        throw new InstallError(`Could not read ${local}: ${errText(e)}`, 'download')
      }
      onProgress(`• ${name}: using ${local}`)
    } else {
      const url = `${release}/${archive}`
      onProgress(`↓ ${name} ${version}: ${url}`)
      try {
        await get(url, file)
      } catch (e) {
        throw new InstallError(`Could not download ${url}: ${errText(e)}`, 'download')
      }
    }

    const actual = sha256(file)
    if (actual !== expected) {
      throw new InstallError(`${archive}: SHA-256 mismatch (expected ${expected}, got ${actual}). Refusing to install.`, 'verify')
    }
    onProgress(`✓ SHA-256 matches ${hashSource === 'lock' ? 'tools.lock.json' : 'checksums.txt'} (${expected.slice(0, 8)}…)`)

    const out = path.join(tmp, 'out')
    fs.mkdirSync(out, { mode: 0o700 })
    try {
      await run('tar', ['--no-same-owner', '-xzf', file, '-C', out, entry.binary])
      fs.chmodSync(path.join(out, entry.binary), 0o755)
    } catch (e) {
      throw new InstallError(`Could not extract ${entry.binary} from ${archive}: ${errText(e)}`, 'extract')
    }
    fs.writeFileSync(path.join(out, 'SHA256'), `${expected}  ${archive}  ${hashSource}\n`)
    try {
      fs.renameSync(out, dir)
    } catch (e) {
      // Another process installed the same version first: keep theirs.
      if (!fs.existsSync(bin)) throw new InstallError(`Could not install into ${dir}: ${errText(e)}`, 'extract')
    }
    return { dir, bin, sha256: expected, hashSource }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
