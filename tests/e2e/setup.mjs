// Run by playwright.config.ts's webServer command BEFORE the server starts
// (Playwright starts webServer before globalSetup, so state must be prepared here).
// Fresh Console home + git-initialised copies of the fixture repos.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = path.join(root, 'tests', '.tmp')
const HOME = path.join(tmp, 'home')
const REPOS = path.join(tmp, 'repos')

fs.rmSync(HOME, { recursive: true, force: true })
fs.rmSync(REPOS, { recursive: true, force: true })
fs.mkdirSync(REPOS, { recursive: true })
execFileSync('node', [path.join(root, 'scripts', 'fetch-tools.mjs')], { stdio: 'inherit', env: { ...process.env, TRUSTABL_CONSOLE_HOME: HOME } })
for (const name of fs.readdirSync(path.join(root, 'tests', 'fixtures', 'repos'))) {
  const dest = path.join(REPOS, name)
  fs.cpSync(path.join(root, 'tests', 'fixtures', 'repos', name), dest, { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', dest, ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', 'commit', '-qm', 'fixture')
}
