#!/usr/bin/env node
// Downloads the pinned Trustabl CLIs (tools.lock.json) into
// $AGENT_DASHBOARD_HOME/bin/<tool>-<version>/ and verifies every archive's
// SHA-256 before extracting it. `make run` calls it on every start (only what
// is missing is downloaded); the dashboard also installs a missing CLI on its
// first run.
//
//   node scripts/fetch-tools.mjs              fetch what is missing
//   node scripts/fetch-tools.mjs --force      re-download everything
//   node scripts/fetch-tools.mjs --fail-fast  give up quickly when GitHub is
//                                             unreachable (`make run`)
//
// Offline / air-gapped: set TRUSTABL_TOOLS_ARCHIVE_DIR to a folder that holds
// the same release archives; they are verified against the same hashes.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { download, installTool } from './lib/install-tool.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'tools.lock.json'), 'utf8'))
const home = path.resolve(process.env.AGENT_DASHBOARD_HOME || path.join(os.homedir(), '.agent-dashboard'))
const force = process.argv.includes('--force')
// ~11 s instead of ~90 s when a firewall drops GitHub's packets.
const get = process.argv.includes('--fail-fast') ? (url, dest) => download(url, dest, { connectTimeout: 5, retries: 1 }) : download

async function main() {
  for (const [name, entry] of Object.entries(lock.tools)) {
    const dir = path.join(home, 'bin', `${name}-${entry.version}`)
    const bin = path.join(dir, entry.binary)
    if (!force && fs.existsSync(bin)) {
      console.log(`✓ ${name} ${entry.version} already installed (${bin})`)
      continue
    }
    if (force) fs.rmSync(dir, { recursive: true, force: true })
    await installTool({ name, entry, version: entry.version, home, hashSource: 'lock', download: get, onProgress: (line) => console.log(line) })
    console.log(`✓ ${name} ${entry.version} installed and verified (${bin})`)
  }
}

main().catch((err) => {
  console.error(`fetch-tools: ${err.message}`)
  process.exit(1)
})
