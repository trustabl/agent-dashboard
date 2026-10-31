import fs from 'node:fs'
import path from 'node:path'
import { stringify as toYaml } from 'yaml'
import { binaryPath } from '../tools'
import { execCapture } from '../exec'
import { openShellShimEnv } from '../openshell-shim'
import { recordArtifact, registerFinalizer, type FinalizeContext, type FinalizeResult, type StartRunInput } from '../runner'
import { InputError, type RepoRow } from '../repos'
import { scansForRepo, scanJson } from '../queries/scans'
import { cacheState, draftState, GUARD_DENY, parseDraft, parseListFile, probeFlags, sessionExtras, uniqueEgress } from '../../probe'
import type { ProbeFindings, ProbeProfile } from '../../types'
import { stripAnsi } from '../../text'
import { shQuote } from '../../shell'

export type Runner = 'docker' | 'openshell'

export interface ProbeOptions {
  /** 'analyzer' = the tools the latest scan extracted; 'draft' = the repo
   *  root, entrypoints auto-detected (an agent that is not built yet). */
  grantSet: 'analyzer' | 'draft'
  runner: Runner
  model: string
  llmUrl?: string
  allowList?: string
  platformAllowList?: string
  denyList?: string
  envFixtures?: string
  allowWriteTools?: boolean
  /** Required before allowWriteTools is honoured: the person confirmed the
   *  "no production keys" warning. */
  confirmWriteTools?: boolean
  noCache?: boolean
  sandboxArgs?: string
}

export interface ClassMember {
  path: string
  entrypoint?: string
  /** Tool names the Analyzer saw in this file (display only, not in YAML). */
  tools?: string[]
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

/** Members for the class YAML. Analyzer mode: one per file holding a tool the
 *  latest scan found (Probe's unit is a tool directory + entrypoint). */
export function grantSetMembers(repo: RepoRow, mode: ProbeOptions['grantSet']): { members: ClassMember[]; scanRunId: string | null } {
  if (mode === 'draft') return { members: [{ path: repo.path }], scanRunId: null }
  const latest = scansForRepo(repo.id).filter((r) => r.action === 'scan').pop()
  const scan = latest ? scanJson(latest.id) : null
  const tools = scan?.tools ?? []
  if (!latest || tools.length === 0) {
    throw new InputError(
      latest
        ? 'The latest Analyzer scan extracted no tools, so there is no grant set to probe. Choose "Draft agent" to let Probe find entrypoints itself.'
        : 'No Analyzer scan for this repo yet. Scan it first, or choose "Draft agent" to let Probe find entrypoints itself.',
    )
  }
  const byFile = new Map<string, ClassMember>()
  for (const t of tools) {
    const abs = path.resolve(repo.path, t.file_path)
    const m = byFile.get(abs) ?? { path: path.dirname(abs), entrypoint: path.basename(abs), tools: [] }
    m.tools!.push(t.name)
    byFile.set(abs, m)
  }
  return { members: [...byFile.values()].sort((a, b) => `${a.path}/${a.entrypoint}`.localeCompare(`${b.path}/${b.entrypoint}`)), scanRunId: latest.id }
}

export function toolSetKey(members: ClassMember[]): string {
  return members.map((m) => `${m.path}::${m.entrypoint ?? ''}`).sort().join('\n')
}

export function classYaml(name: string, members: ClassMember[]): string {
  return toYaml({ class: name, tools: members.map((m) => (m.entrypoint ? { path: m.path, entrypoint: m.entrypoint } : { path: m.path })) })
}

function validate(o: ProbeOptions) {
  if (!o.model?.trim()) throw new InputError('Probe needs a model (--model). Use the LLM endpoint you trust — source code is sent only there.')
  if (o.runner !== 'docker' && o.runner !== 'openshell') throw new InputError('Runner must be docker or openshell.')
  if (o.grantSet !== 'analyzer' && o.grantSet !== 'draft') throw new InputError('Grant set must be "analyzer" or "draft".')
  if (o.llmUrl && !/^https?:\/\/[^\s]+$/.test(o.llmUrl.trim())) throw new InputError('LLM URL must be an http(s) URL.')
  if (o.allowWriteTools && !o.confirmWriteTools) {
    throw new InputError('Confirm --allow-write-tools first: side-effect tools will really run. Use staging or test-mode keys, never production keys.')
  }
  if (o.sandboxArgs && /[;&|`$<>\\]/.test(o.sandboxArgs)) throw new InputError('Sandbox args must not contain shell metacharacters.')
}

interface Files { classFile: string; outDir: string; allow?: string; platform?: string; deny: string; fixtures?: string }

function argvFor(o: ProbeOptions, f: Files): string[] {
  const args = ['fix', '--class', f.classFile, '--sandbox', '--runner', o.runner, '--output-dir', f.outDir, '--no-sign', '--model', o.model.trim()]
  if (o.llmUrl?.trim()) args.push('--llm-url', o.llmUrl.trim())
  if (f.allow) args.push('--allow-list', f.allow)
  if (f.platform) args.push('--platform-allow-list', f.platform)
  args.push('--deny-list', f.deny)
  if (f.fixtures) args.push('--env-fixtures', f.fixtures)
  if (o.allowWriteTools) args.push('--allow-write-tools')
  if (o.noCache) args.push('--no-cache')
  if (o.sandboxArgs?.trim()) args.push('--sandbox-args', o.sandboxArgs.trim())
  return args
}

/** stdin "q": leave autofix's interactive fix review without applying any
 *  generated fix. The Console never edits source code. */
const QUIT_REVIEW = 'q\n'

export function probeRun(repo: RepoRow, o: ProbeOptions): StartRunInput {
  validate(o)
  const { members, scanRunId } = grantSetMembers(repo, o.grantSet)
  const className = slug(repo.name.split('/').pop() ?? repo.name)
  return {
    tool: 'probe',
    action: 'probe',
    repo,
    toolName: 'autofix',
    // Never store fixture contents (may hold credentials) in the DB.
    options: { ...o, envFixtures: o.envFixtures ? '(provided)' : undefined, scanRunId, members, className, toolSetKey: toolSetKey(members) },
    build: async ({ dir }) => {
      const files: Files = {
        classFile: path.join(dir, 'class.yaml'),
        outDir: path.join(dir, 'out'),
        deny: path.join(dir, 'deny-list.txt'),
      }
      fs.mkdirSync(files.outDir, { recursive: true }) // autofix does not create --output-dir
      fs.writeFileSync(files.classFile, classYaml(className, members))
      if (o.allowList?.trim()) fs.writeFileSync((files.allow = path.join(dir, 'allow-list.txt')), o.allowList.trim() + '\n')
      if (o.platformAllowList?.trim()) fs.writeFileSync((files.platform = path.join(dir, 'platform-allow-list.txt')), o.platformAllowList.trim() + '\n')
      const userDeny = parseListFile(o.denyList ?? '')
      fs.writeFileSync(
        files.deny,
        [
          '# Your deny list (if any), then the Console guard: any-address destinations never belong in a draft.',
          '# Probe always adds its built-in metadata / link-local deny on top.',
          ...userDeny,
          ...GUARD_DENY.filter((g) => !userDeny.includes(g)),
          '',
        ].join('\n'),
      )
      if (o.envFixtures?.trim()) {
        files.fixtures = path.join(dir, 'env-fixtures.env')
        fs.writeFileSync(files.fixtures, o.envFixtures.trim() + '\n', { mode: 0o600 })
      }
      const env = o.runner === 'openshell' ? openShellShimEnv(dir) : undefined
      return { bin: binaryPath('autofix'), args: argvFor(o, files), cwd: repo.path, stdin: QUIT_REVIEW, env }
    },
  }
}

export function probePreview(repo: RepoRow, o: ProbeOptions) {
  const files: Files = {
    classFile: '<run>/class.yaml',
    outDir: '<run>/out',
    deny: '<run>/deny-list.txt',
    allow: o.allowList?.trim() ? '<run>/allow-list.txt' : undefined,
    platform: o.platformAllowList?.trim() ? '<run>/platform-allow-list.txt' : undefined,
    fixtures: o.envFixtures?.trim() ? '<run>/env-fixtures.env' : undefined,
  }
  let members: ClassMember[] = []
  let note: string | undefined
  try {
    members = grantSetMembers(repo, o.grantSet).members
  } catch (e) {
    note = (e as Error).message
  }
  const className = slug(repo.name.split('/').pop() ?? repo.name)
  return {
    spec: { bin: binaryPath('autofix'), args: argvFor({ ...o, model: o.model || '<model>' }, files), cwd: repo.path, stdin: QUIT_REVIEW },
    command: members.length ? standaloneCommand(repo, o, className, members) : null,
    classYaml: members.length ? classYaml(className, members) : null,
    note,
  }
}

/**
 * "Copy CLI" for a Probe run that has not happened yet: one paste-able shell
 * command that writes the same class YAML and list files the Console would
 * write (into a fresh temp folder), then runs the same `autofix fix` argv.
 * Env fixture values are never embedded — the command reads them from
 * $ENV_FIXTURES; a missing model reads $PROBE_MODEL.
 */
export function standaloneCommand(repo: RepoRow, o: ProbeOptions, className: string, members: ClassMember[]): string {
  const lines = (text: string) => text.split(/\r?\n/)
  const write = (body: string[], file: string) => `printf '%s\\n' ${body.map(shQuote).join(' ')} > "$D/${file}"`
  const userDeny = parseListFile(o.denyList ?? '')
  const steps = [
    `cd ${shQuote(repo.path)}`,
    'D="$(mktemp -d)"',
    'mkdir "$D/out"',
    write(lines(classYaml(className, members).trimEnd()), 'class.yaml'),
    write([...userDeny, ...GUARD_DENY.filter((g) => !userDeny.includes(g))], 'deny-list.txt'),
  ]
  if (o.allowList?.trim()) steps.push(write(lines(o.allowList.trim()), 'allow-list.txt'))
  if (o.platformAllowList?.trim()) steps.push(write(lines(o.platformAllowList.trim()), 'platform-allow-list.txt'))
  const f: Files = {
    classFile: '\u0000class.yaml',
    outDir: '\u0000out',
    deny: '\u0000deny-list.txt',
    allow: o.allowList?.trim() ? '\u0000allow-list.txt' : undefined,
    platform: o.platformAllowList?.trim() ? '\u0000platform-allow-list.txt' : undefined,
    fixtures: o.envFixtures?.trim() ? '\u0001' : undefined,
  }
  const model = o.model?.trim() ? o.model.trim() : '\u0002'
  const argv = [binaryPath('autofix'), ...argvFor({ ...o, model }, f)]
    .map((a) => (a.startsWith('\u0000') ? `"$D/${a.slice(1)}"` : a === '\u0001' ? '"${ENV_FIXTURES:?set ENV_FIXTURES to your KEY=value fixtures file}"' : a === '\u0002' ? '"${PROBE_MODEL:?set PROBE_MODEL to the model Probe should use}"' : shQuote(a)))
    .join(' ')
  steps.push(`printf 'q\\n' | ${argv}`)
  return steps.join(' && ')
}

const ARTIFACTS = ['probe.profile.json', 'probe.findings.json', 'network_policies.draft.yaml', 'autofix-attestation.json']

async function finalizeProbe(ctx: FinalizeContext): Promise<FinalizeResult> {
  const out = path.join(ctx.dir, 'out')
  const has = (f: string) => fs.existsSync(path.join(out, f))
  for (const f of ARTIFACTS) if (has(f)) recordArtifact(ctx.run.id, f, path.join(out, f))
  if (!has('probe.profile.json')) {
    return { status: 'failed' }
  }
  const profile = JSON.parse(fs.readFileSync(path.join(out, 'probe.profile.json'), 'utf8')) as ProbeProfile
  const findings = has('probe.findings.json') ? (JSON.parse(fs.readFileSync(path.join(out, 'probe.findings.json'), 'utf8')) as ProbeFindings) : null
  const draft = parseDraft(has('network_policies.draft.yaml') ? fs.readFileSync(path.join(out, 'network_policies.draft.yaml'), 'utf8') : null)
  const stderr = stripAnsi(ctx.stderr)
  const flags = probeFlags(findings, stderr)
  const egress = uniqueEgress(profile)
  const state = draftState(draft, flags, egress)
  const skipped = (findings?.findings ?? []).filter((f) => /Sandbox execution skipped/i.test(f.title)).map((f) => f.file ?? '')
  return {
    status: ctx.exitCode === 0 ? 'succeeded' : 'failed',
    summary: {
      className: profile.class ?? null,
      grantSet: profile.grant_set ?? [],
      grantSetHash: profile.grant_set_hash ?? null,
      egress,
      flags: flags.map((f) => f.flag),
      draft: state,
      cache: cacheState(profile),
      runner: (ctx.run.options as unknown as ProbeOptions).runner,
      extras: sessionExtras(findings).length,
      skippedWriteTools: skipped,
    },
  }
}

registerFinalizer('probe', finalizeProbe)

export interface RunnerCheck {
  runner: Runner
  ok: boolean
  detail: string
  fix?: string
  command: string
}

/** Checked before every Probe run: is the sandbox runner reachable? */
export async function checkRunner(runner: Runner): Promise<RunnerCheck> {
  if (runner === 'docker') {
    const res = await execCapture('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 15_000 })
    if (res.code === 0 && res.stdout.trim()) return { runner, ok: true, detail: `Docker ${res.stdout.trim()} is running.`, command: 'docker info' }
    const missing = res.error?.includes('ENOENT')
    return {
      runner,
      ok: false,
      command: 'docker info',
      detail: missing ? 'Docker is not installed (no docker command on PATH).' : `Docker is not reachable: ${(res.stderr || res.error || '').trim().split('\n').pop()}`,
      fix: missing
        ? 'Install Docker Desktop (macOS/Windows) or Docker Engine (Linux), start it, then retry.'
        : 'Start Docker Desktop (or `sudo systemctl start docker` on Linux), wait until `docker info` succeeds, then retry.',
    }
  }
  const res = await execCapture('openshell', ['sandbox', 'list'], { timeoutMs: 15_000 })
  if (res.code === 0) return { runner, ok: true, detail: 'OpenShell gateway is reachable.', command: 'openshell sandbox list' }
  const missing = res.error?.includes('ENOENT')
  return {
    runner,
    ok: false,
    command: 'openshell sandbox list',
    detail: missing ? 'OpenShell is not installed (no openshell command on PATH).' : `OpenShell gateway is not reachable: ${(res.stderr || res.error || '').trim().split('\n').pop()}`,
    fix: missing
      ? 'Install OpenShell from build.nvidia.com/openshell, or switch the runner to Docker.'
      : 'Run `openshell gateway start` in a separate terminal and keep it running, then retry.',
  }
}

/** Which API-key variable autofix will pick up (names only — never values). */
export function llmKeyEnv(): string[] {
  return ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_API_KEY'].filter((k) => !!process.env[k])
}
