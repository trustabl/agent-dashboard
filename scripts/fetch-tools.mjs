#!/usr/bin/env node
// Downloads the pinned Trustabl CLIs (tools.lock.json) into
// $AGENT_DASHBOARD_HOME/bin/<tool>-<version>/ and verifies every archive's
// SHA-256 before extracting it. The user never installs a CLI by hand.
//
//   node scripts/fetch-tools.mjs            fetch what is missing
//   node scripts/fetch-tools.mjs --force    re-download everything
//
// Offline / air-gapped: set TRUSTABL_TOOLS_ARCHIVE_DIR to a folder that holds
// the same release archives; they are verified against the same hashes.

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'tools.lock.json'), 'utf8'))
const home = path.resolve(process.env.AGENT_DASHBOARD_HOME || path.join(os.homedir(), '.agent-dashboard'))
const binRoot = path.join(home, 'bin')
const force = process.argv.includes('--force')

function platform() {
  const osName = { darwin: 'darwin', linux: 'linux' }[process.platform]
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch]
  if (!osName || !arch) {
    throw new Error(`Unsupported platform ${process.platform}/${process.arch}. Supported: macOS and Linux (incl. WSL2) on x64 or arm64.`)
  }
  return { os: osName, arch }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function hasCurl() {
  return spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0
}

async function download(url, dest) {
  // curl honours HTTPS_PROXY and system CA stores; Node's fetch does not
  // always, so prefer it when present.
  if (hasCurl()) {
    execFileSync('curl', ['-fsSL', '--retry', '3', '-o', dest, url], { stdio: ['ignore', 'inherit', 'inherit'] })
    return
  }
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

async function main() {
  const { os: osName, arch } = platform()
  fs.mkdirSync(binRoot, { recursive: true, mode: 0o700 })
  for (const [name, tool] of Object.entries(lock.tools)) {
    const dir = path.join(binRoot, `${name}-${tool.version}`)
    const bin = path.join(dir, tool.binary)
    if (!force && fs.existsSync(bin)) {
      console.log(`✓ ${name} ${tool.version} already installed (${bin})`)
      continue
    }
    const archive = tool.archive.replace('{version}', tool.version).replace('{os}', osName).replace('{arch}', arch)
    const expected = tool.sha256[archive]
    if (!expected) throw new Error(`tools.lock.json has no SHA-256 for ${archive}`)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `agent-dashboard-${name}-`))
    const file = path.join(tmp, archive)
    const offlineDir = process.env.TRUSTABL_TOOLS_ARCHIVE_DIR
    if (offlineDir) {
      fs.copyFileSync(path.join(offlineDir, archive), file)
      console.log(`• ${name}: using ${path.join(offlineDir, archive)}`)
    } else {
      const url = `https://github.com/${tool.repo}/releases/download/v${tool.version}/${archive}`
      console.log(`↓ ${name} ${tool.version}: ${url}`)
      await download(url, file)
    }
    const actual = sha256(file)
    if (actual !== expected) {
      fs.rmSync(tmp, { recursive: true, force: true })
      throw new Error(`${archive}: SHA-256 mismatch (expected ${expected}, got ${actual}). Refusing to install.`)
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    execFileSync('tar', ['--no-same-owner', '-xzf', file, '-C', dir, tool.binary], { stdio: 'inherit' })
    fs.chmodSync(bin, 0o755)
    fs.writeFileSync(path.join(dir, 'SHA256'), `${expected}  ${archive}\n`)
    fs.rmSync(tmp, { recursive: true, force: true })
    console.log(`✓ ${name} ${tool.version} installed and verified (${bin})`)
  }
}

main().catch((err) => {
  console.error(`fetch-tools: ${err.message}`)
  process.exit(1)
})
