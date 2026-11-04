// Run by playwright.config.ts's webServer command BEFORE the server starts
// (Playwright starts webServer before globalSetup, so state must be prepared here).
// Fresh Console home + git-initialised copies of the fixture repos. The pinned
// CLIs are NOT installed here: the server installs each one on its first run
// (from TRUSTABL_TOOLS_ARCHIVE_DIR, so the tests need no network once the
// release archives are cached).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { archiveName, download } from '../../scripts/lib/install-tool.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = path.join(root, 'tests', '.tmp')
const HOME = path.join(tmp, 'home')
const REPOS = path.join(tmp, 'repos')
const ARCHIVES = process.env.TRUSTABL_TOOLS_ARCHIVE_DIR || path.join(tmp, 'archives')

fs.rmSync(HOME, { recursive: true, force: true })
fs.rmSync(REPOS, { recursive: true, force: true })
fs.mkdirSync(REPOS, { recursive: true })
fs.mkdirSync(ARCHIVES, { recursive: true })
const lock = JSON.parse(fs.readFileSync(path.join(root, 'tools.lock.json'), 'utf8'))
for (const entry of Object.values(lock.tools)) {
  const archive = archiveName(entry, entry.version)
  const file = path.join(ARCHIVES, archive)
  if (fs.existsSync(file)) continue
  const url = `https://github.com/${entry.repo}/releases/download/v${entry.version}/${archive}`
  console.log(`↓ caching ${url}`)
  await download(url, `${file}.part`)
  fs.renameSync(`${file}.part`, file)
}
for (const name of fs.readdirSync(path.join(root, 'tests', 'fixtures', 'repos'))) {
  const dest = path.join(REPOS, name)
  fs.cpSync(path.join(root, 'tests', 'fixtures', 'repos', name), dest, { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', dest, ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', 'commit', '-qm', 'fixture')
}
