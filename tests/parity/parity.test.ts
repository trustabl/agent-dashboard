// Artifact parity: every artifact the Console keeps for a run is what the
// CLI writes for the same input. For each tool the test runs it through the
// Console's own run engine, saves the artifacts, then runs the run's recorded
// "Copy CLI" command in a plain shell and compares the two sets of files with
// timestamps (and Probe's per-run harness id) masked.
//
//   make parity                      (fetches the pinned CLIs if needed)
//   PARITY_HOME=/path make parity    reuse a Console home (e.g. a warm rules cache)
//
// Probe needs Docker; without it the Probe case is skipped, not failed.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(__dirname, '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trustabl-parity-'))
const home = process.env.PARITY_HOME ?? path.join(tmp, 'home')
process.env.AGENT_DASHBOARD_HOME = home
process.env.AGENT_DASHBOARD_NO_AUTORULES = '1'
const repos = path.join(tmp, 'repos')

type Mods = {
  startToolRun: typeof import('@/lib/server/actions').startToolRun
  getRun: typeof import('@/lib/server/runner').getRun
  listArtifacts: typeof import('@/lib/server/runner').listArtifacts
  paths: typeof import('@/lib/server/paths').paths
}
let m: Mods

const dockerUp = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', timeout: 15_000 }).status === 0

beforeAll(async () => {
  execFileSync('node', [path.join(root, 'scripts', 'fetch-tools.mjs')], { stdio: 'inherit', env: { ...process.env, AGENT_DASHBOARD_HOME: home } })
  fs.mkdirSync(repos, { recursive: true })
  for (const name of fs.readdirSync(path.join(root, 'tests', 'fixtures', 'repos'))) {
    const dest = path.join(repos, name)
    fs.cpSync(path.join(root, 'tests', 'fixtures', 'repos', name), dest, { recursive: true })
    const git = (...args: string[]) => execFileSync('git', ['-C', dest, ...args], { stdio: 'ignore' })
    git('init', '-q')
    git('add', '-A')
    git('-c', 'user.email=parity@example.com', '-c', 'user.name=parity', 'commit', '-qm', 'fixture')
  }
  const { boot } = await import('@/lib/server/boot')
  await boot()
  const actions = await import('@/lib/server/actions')
  const runner = await import('@/lib/server/runner')
  const p = await import('@/lib/server/paths')
  m = { startToolRun: actions.startToolRun, getRun: runner.getRun, listArtifacts: runner.listArtifacts, paths: p.paths }
}, 300_000)

afterAll(() => {
  if (!process.env.PARITY_KEEP) fs.rmSync(tmp, { recursive: true, force: true })
})

async function consoleRun(req: Parameters<Mods['startToolRun']>[0]) {
  const started = await m.startToolRun(req)
  for (let i = 0; i < 1200; i++) {
    const r = m.getRun(started.id)!
    if (r.status !== 'running') return r
    await new Promise((x) => setTimeout(x, 250))
  }
  throw new Error('run did not finish')
}

/** Saves the Console's artifacts, re-runs the recorded command, returns both. */
function rerun(run: { id: string; command: string }, kinds: string[]) {
  const arts = m.listArtifacts(run.id).filter((a) => kinds.includes(a.kind))
  expect(arts.map((a) => a.kind).sort()).toEqual([...kinds].sort())
  const saved = Object.fromEntries(arts.map((a) => [a.kind, fs.readFileSync(a.path, 'utf8')]))
  for (const a of arts) fs.rmSync(a.path)
  const res = spawnSync('sh', ['-c', run.command], {
    env: { ...process.env, XDG_CACHE_HOME: m.paths.cliCache(), NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 300_000,
  })
  const cli = Object.fromEntries(arts.map((a) => [a.kind, fs.existsSync(a.path) ? fs.readFileSync(a.path, 'utf8') : `<missing; exit ${res.status}: ${res.stderr.slice(-400)}>`]))
  return { saved, cli }
}

const VOLATILE_KEYS = /^(generated_at|timestamp|started_at|finished_at|duration(_ms)?|elapsed(_ms)?|harness_id|start_time|end_time|startTimeUtc|endTimeUtc)$/

export function mask(kind: string, text: string): string {
  if (kind.endsWith('.json') || kind.endsWith('.sarif')) {
    const walk = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(walk)
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, VOLATILE_KEYS.test(k) ? '<masked>' : walk(x)]))
          : typeof v === 'string' ? maskText(v) : v
    return JSON.stringify(walk(JSON.parse(text)), null, 2)
  }
  return maskText(text)
}

function maskText(s: string): string {
  return s
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, '<ts>')
    .replace(/generated: \d{4}-\d{2}-\d{2}/g, 'generated: <date>')
    .replace(/autofix-\d{10,}/g, 'autofix-<id>')
}

function expectParity(saved: Record<string, string>, cli: Record<string, string>) {
  for (const kind of Object.keys(saved)) {
    expect({ kind, text: mask(kind, cli[kind]) }).toEqual({ kind, text: mask(kind, saved[kind]) })
  }
}

describe('artifact parity (Console run == CLI run, timestamps masked)', () => {
  it('Analyzer: scan.json and SARIF', async () => {
    const run = await consoleRun({ tool: 'analyzer', path: path.join(repos, 'acme-support') })
    expect(run.status).toBe('succeeded')
    const { saved, cli } = rerun(run, ['scan.json', 'trustabl.sarif'])
    expectParity(saved, cli)
  }, 300_000)

  it('Forge: SKILL.md', async () => {
    const run = await consoleRun({ tool: 'forge', path: path.join(repos, 'acme-support') })
    expect(run.status).toBe('succeeded')
    const { saved, cli } = rerun(run, ['SKILL.md'])
    expectParity(saved, cli)
  }, 300_000)

  it('Probe: probe.profile.json, probe.findings.json, network_policies.draft.yaml', async () => {
    if (!dockerUp) {
      console.warn('Probe parity skipped: Docker is not reachable')
      return
    }
    const run = await consoleRun({
      tool: 'probe',
      path: path.join(repos, 'research-tools'),
      options: { grantSet: 'draft', runner: 'docker', model: 'qwen2.5-coder:32b', llmUrl: 'http://127.0.0.1:9/v1', allowList: 'api.perplexity.ai', noCache: true },
    })
    expect(run.status).toBe('succeeded')
    const { saved, cli } = rerun(run, ['probe.profile.json', 'probe.findings.json', 'network_policies.draft.yaml'])
    expectParity(saved, cli)
  }, 600_000)
})
