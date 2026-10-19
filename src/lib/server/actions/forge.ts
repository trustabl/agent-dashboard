import fs from 'node:fs'
import path from 'node:path'
import { db, getSetting, setSetting } from '../db'
import { paths, ensureDir, SKILL_REL_PATH } from '../paths'
import { binaryPath } from '../tools'
import {
  getRun, recordArtifact, registerFinalizer, startRun, updateRunSummary, listRuns,
  type FinalizeContext, type FinalizeResult, type StartRunInput,
} from '../runner'
import { getRepo, listRepos, type RepoRow } from '../repos'
import { outlineSkill, parseForgeCheck, parseNoSdk, parseStamp } from '../../forge'
import { InputError } from '../repos'

export interface ForgeOptions {
  policy?: string[]
  lang?: string[]
  rulesRef?: string
}

const CATEGORY_RE = /^[a-z_]+$/
const LANGS = ['python', 'typescript', 'go']

export function sanitizeForgeOptions(o: ForgeOptions): ForgeOptions {
  const policy = (o.policy ?? []).map((p) => p.trim()).filter(Boolean)
  for (const p of policy) if (!CATEGORY_RE.test(p)) throw new InputError(`Not a policy category: ${p}`)
  const lang = (o.lang ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean)
  for (const l of lang) if (!LANGS.includes(l)) throw new InputError(`--lang accepts python, typescript, go (got ${l})`)
  const rulesRef = o.rulesRef?.trim() || undefined
  if (rulesRef && !/^[\w./-]+$/.test(rulesRef)) throw new InputError(`Not a branch or tag: ${rulesRef}`)
  return { policy, lang, rulesRef }
}

function forgeFlags(o: ForgeOptions): string[] {
  const args: string[] = []
  if (o.policy?.length) args.push('--policy', o.policy.join(','))
  if (o.lang?.length) args.push('--lang', o.lang.join(','))
  if (o.rulesRef) args.push('--rules-ref', o.rulesRef)
  return args
}

export function skillPath(repo: RepoRow): string {
  return path.join(repo.path, SKILL_REL_PATH)
}

/** Generate writes to the run dir first; the repo's SKILL.md is only written
 *  after the person confirms (applySkill). Copy CLI shows the one-step command. */
export function forgeGenerateRun(repo: RepoRow, raw: ForgeOptions): StartRunInput {
  const o = sanitizeForgeOptions(raw)
  return {
    tool: 'forge',
    action: 'generate',
    repo,
    toolName: 'trustabl',
    options: { ...o },
    build: async ({ dir }) => ({
      bin: binaryPath('trustabl'),
      args: ['forge', repo.path, ...forgeFlags(o), '-o', path.join(dir, 'SKILL.md')],
      cwd: repo.path,
    }),
  }
}

/** The command a person would type to do Generate + Write in one go. */
export function forgeGeneratePreview(repo: RepoRow, raw: ForgeOptions) {
  const o = sanitizeForgeOptions(raw)
  return { bin: binaryPath('trustabl'), args: ['forge', repo.path, ...forgeFlags(o), '-o', skillPath(repo)], cwd: repo.path }
}

export function forgeCheckRun(repo: RepoRow, raw: Pick<ForgeOptions, 'rulesRef'> = {}, trigger = 'manual'): StartRunInput {
  const o = sanitizeForgeOptions(raw)
  return {
    tool: 'forge',
    action: 'check',
    repo,
    toolName: 'trustabl',
    options: { rulesRef: o.rulesRef, trigger },
    build: async () => ({
      bin: binaryPath('trustabl'),
      args: ['forge', 'check', skillPath(repo), ...(o.rulesRef ? ['--rules-ref', o.rulesRef] : [])],
      cwd: repo.path,
    }),
  }
}

export function forgeCheckPreview(repo: RepoRow, raw: Pick<ForgeOptions, 'rulesRef'> = {}) {
  const o = sanitizeForgeOptions(raw)
  return { bin: binaryPath('trustabl'), args: ['forge', 'check', skillPath(repo), ...(o.rulesRef ? ['--rules-ref', o.rulesRef] : [])], cwd: repo.path }
}

/** "What rules SHA would forge stamp right now?" — generate the smallest skill
 *  (claude_skill only) in an empty folder and read its stamp. */
export function rulesStatusRun(): StartRunInput {
  return {
    tool: 'forge',
    action: 'rules-status',
    repo: null,
    toolName: 'trustabl',
    options: {},
    build: async ({ dir }) => {
      const cwd = ensureDir(path.join(dir, 'empty'))
      return { bin: binaryPath('trustabl'), args: ['forge', '--policy', 'claude_skill', '-o', path.join(dir, 'rules-probe.SKILL.md')], cwd }
    },
  }
}

async function finalizeGenerate(ctx: FinalizeContext): Promise<FinalizeResult> {
  const file = path.join(ctx.dir, 'SKILL.md')
  if (ctx.exitCode !== 0 || !fs.existsSync(file)) {
    const nosdk = parseNoSdk(ctx.stderr)
    if (nosdk.noSdk) {
      return {
        status: 'failed',
        error: 'No SDK detected from the dependency manifests. Choose one or more --policy categories and generate again.',
        summary: { needsPolicy: true, categories: nosdk.categories },
      }
    }
    return { status: 'failed' }
  }
  recordArtifact(ctx.run.id, 'SKILL.md', file)
  const text = fs.readFileSync(file, 'utf8')
  const stamp = parseStamp(text)
  const repo = getRepo(ctx.run.repo_id!)
  const target = repo ? skillPath(repo) : null
  const existing = target && fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
  return {
    status: 'succeeded',
    rulesSha: stamp?.rules ?? null,
    summary: {
      stamp,
      otel: outlineSkill(text).otel,
      pending: existing !== text,
      identical: existing === text,
      hadExisting: existing !== null,
      target,
    },
  }
}

async function finalizeCheck(ctx: FinalizeContext): Promise<FinalizeResult> {
  const result = parseForgeCheck(ctx.exitCode, ctx.stdout, ctx.stderr)
  const ok = result.status !== 'error'
  if (ctx.run.repo_id) {
    db()
      .prepare(`INSERT INTO skills (repo_id, check_status, check_detail, check_run_id, checked_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(repo_id) DO UPDATE SET check_status = excluded.check_status, check_detail = excluded.check_detail,
                check_run_id = excluded.check_run_id, checked_at = excluded.checked_at`)
      .run(ctx.run.repo_id, result.status, JSON.stringify(result), ctx.run.id, Date.now())
  }
  return { status: ok ? 'succeeded' : 'failed', rulesSha: result.currentRules ?? null, summary: { check: result } }
}

async function finalizeRulesStatus(ctx: FinalizeContext): Promise<FinalizeResult> {
  const file = path.join(ctx.dir, 'rules-probe.SKILL.md')
  if (ctx.exitCode !== 0 || !fs.existsSync(file)) return { status: 'failed' }
  const stamp = parseStamp(fs.readFileSync(file, 'utf8'))
  if (!stamp) return { status: 'failed', error: 'forge wrote a SKILL.md without a stamp.' }
  const previous = getSetting<{ sha: string }>('rules.current')
  setSetting('rules.current', { sha: stamp.rules, schema: stamp.schema, template: stamp.template, checkedAt: Date.now(), runId: ctx.run.id })
  const changed = !!previous && previous.sha !== stamp.rules
  if (changed) {
    // Rules moved: re-check every skill on disk so stale ones say why.
    setImmediate(() => void recheckAllSkills('rules-update'))
  }
  return { status: 'succeeded', rulesSha: stamp.rules, summary: { rules: stamp.rules, previous: previous?.sha ?? null, changed } }
}

registerFinalizer('generate', finalizeGenerate)
registerFinalizer('check', finalizeCheck)
registerFinalizer('rules-status', finalizeRulesStatus)

export async function recheckAllSkills(trigger: string): Promise<number> {
  let n = 0
  for (const repo of listRepos()) {
    if (!fs.existsSync(skillPath(repo))) continue
    try {
      await startRun(forgeCheckRun(repo, {}, trigger))
      n++
    } catch {
      /* a check already running for this repo is fine */
    }
  }
  return n
}

/** Write the generated skill into the repo — the explicit, confirmed step. */
export async function applySkill(runId: string): Promise<{ path: string }> {
  const run = getRun(runId)
  if (!run || run.tool !== 'forge' || run.action !== 'generate') throw new InputError('Not a Forge generate run.')
  if (run.status !== 'succeeded') throw new InputError('This run did not produce a skill.')
  const repo = getRepo(run.repo_id!)
  if (!repo) throw new InputError('The repo for this run was removed.')
  const candidate = path.join(paths.run(run.id), 'SKILL.md')
  if (!fs.existsSync(candidate)) throw new InputError('The generated SKILL.md is no longer in the run folder.')
  const target = skillPath(repo)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(candidate, target)
  updateRunSummary(run.id, { pending: false, appliedAt: Date.now(), target })
  await startRun(forgeCheckRun(repo, { rulesRef: (run.options as ForgeOptions).rulesRef }, 'after-write'))
  return { path: target }
}

export function discardSkill(runId: string) {
  updateRunSummary(runId, { pending: false, discardedAt: Date.now() })
}

export function currentRules(): { sha: string; checkedAt: number; runId: string } | undefined {
  return getSetting('rules.current')
}

/** Refresh the rules SHA at most every `maxAgeMs` (startup + page loads). */
export async function ensureRulesStatus(maxAgeMs = 6 * 60 * 60 * 1000): Promise<void> {
  const cur = currentRules()
  if (cur && Date.now() - cur.checkedAt < maxAgeMs) return
  const running = listRuns({ action: 'rules-status', status: 'running', limit: 1 })
  if (running.length) return
  try {
    await startRun(rulesStatusRun())
  } catch {
    /* tool missing: surfaced elsewhere */
  }
}

let categoryCache: string[] | null = null

/** The --policy categories this trustabl build accepts, read from its own
 *  `trustabl scan --help` (the --detectors line lists them). */
export async function policyCategories(): Promise<string[]> {
  if (categoryCache) return categoryCache
  const { execCapture } = await import('../exec')
  const res = await execCapture(binaryPath('trustabl'), ['scan', '--help'], { timeoutMs: 15_000 })
  const m = res.stdout.match(/--detectors string\s+comma-separated detector categories to run \(default: all\):\s*([^\n]+)/)
  categoryCache = m ? m[1].split(',').map((s) => s.trim()).filter((s) => /^[a-z_]+$/.test(s)) : []
  return categoryCache
}

/** Candidate vs. on-disk skill, for the confirm step. */
export async function skillCandidate(runId: string) {
  const { createTwoFilesPatch } = await import('diff')
  const { formatCommand } = await import('../../shell')
  const run = getRun(runId)
  if (!run || run.tool !== 'forge' || run.action !== 'generate') throw new InputError('Not a Forge generate run.')
  const repo = getRepo(run.repo_id!)
  if (!repo) throw new InputError('The repo for this run was removed.')
  const file = path.join(paths.run(run.id), 'SKILL.md')
  if (!fs.existsSync(file)) throw new InputError('This run produced no SKILL.md.')
  const candidate = fs.readFileSync(file, 'utf8')
  const target = skillPath(repo)
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
  const diff = existing !== null && existing !== candidate
    ? createTwoFilesPatch(`a/${SKILL_REL_PATH}`, `b/${SKILL_REL_PATH}`, existing, candidate, '', '', { context: 3 })
    : null
  return {
    target,
    candidate,
    existing,
    diff,
    identical: existing === candidate,
    stamp: parseStamp(candidate),
    applyCommand: formatCommand(forgeGeneratePreview(repo, run.options as ForgeOptions)),
  }
}
