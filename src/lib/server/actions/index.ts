import { addRepo, getRepo, InputError, type RepoRow } from '../repos'
import { startRun } from '../runner'
import { formatCommand } from '../../shell'
import { scanPreview, scanRun } from './analyzer'
import { forgeCheckPreview, forgeCheckRun, forgeGeneratePreview, forgeGenerateRun, type ForgeOptions } from './forge'
import { probePreview, probeRun, checkRunner, type ProbeOptions } from './probe'
import type { RunRow } from '../../types'

export interface RunRequest {
  tool: 'forge' | 'analyzer' | 'probe'
  action?: 'generate' | 'check' | 'scan' | 'probe'
  repoId?: string
  /** A new local path (the run dialog's "New local path — agent not built"). */
  path?: string
  /** Create the folder when it does not exist yet. */
  create?: boolean
  options?: Record<string, unknown>
}

function defaultAction(tool: RunRequest['tool']): NonNullable<RunRequest['action']> {
  return tool === 'forge' ? 'generate' : tool === 'analyzer' ? 'scan' : 'probe'
}

async function resolveRepo(req: RunRequest, { register }: { register: boolean }): Promise<RepoRow> {
  if (req.repoId) {
    const repo = getRepo(req.repoId)
    if (!repo) throw new InputError('Unknown repo.')
    return repo
  }
  if (req.path) {
    if (register) return addRepo(req.path, { create: !!req.create })
    // Preview without side effects: pretend-register.
    const { normalizeRepoPath } = await import('../repos')
    const p = normalizeRepoPath(req.path)
    return { id: '', path: p, name: p.split('/').pop() ?? p, created_at: 0 }
  }
  throw new InputError('Pick a repo or enter a local path.')
}

function inputFor(req: RunRequest, repo: RepoRow) {
  const action = req.action ?? defaultAction(req.tool)
  const o = req.options ?? {}
  if (req.tool === 'forge' && action === 'generate') return forgeGenerateRun(repo, o as ForgeOptions)
  if (req.tool === 'forge' && action === 'check') return forgeCheckRun(repo, o as ForgeOptions)
  if (req.tool === 'analyzer' && action === 'scan') return scanRun(repo)
  if (req.tool === 'probe' && action === 'probe') return probeRun(repo, o as unknown as ProbeOptions)
  throw new InputError(`Unsupported action ${req.tool}/${action}.`)
}

export async function startToolRun(req: RunRequest): Promise<RunRow> {
  const repo = await resolveRepo(req, { register: true })
  if (req.tool === 'probe') {
    const o = (req.options ?? {}) as unknown as ProbeOptions
    // Validate inputs before the runner check so mistakes surface first.
    inputFor(req, repo)
    const check = await checkRunner(o.runner)
    if (!check.ok) {
      const err = new InputError(`${check.detail} ${check.fix ?? ''}`.trim())
      throw err
    }
  }
  return startRun(inputFor(req, repo))
}

/** The command a Start would run — for "Copy CLI" before anything runs. */
export async function previewCommand(req: RunRequest): Promise<{ command: string; note?: string; extra?: Record<string, unknown> }> {
  const repo = await resolveRepo(req, { register: false })
  const action = req.action ?? defaultAction(req.tool)
  const o = req.options ?? {}
  if (req.tool === 'forge' && action === 'generate') return { command: formatCommand(forgeGeneratePreview(repo, o as ForgeOptions)) }
  if (req.tool === 'forge' && action === 'check') return { command: formatCommand(forgeCheckPreview(repo, o as ForgeOptions)) }
  if (req.tool === 'analyzer') return { command: formatCommand(scanPreview(repo)) }
  if (req.tool === 'probe') {
    if (!repo.id) {
      const p = probePreview(repo, { ...(o as unknown as ProbeOptions), grantSet: 'draft' })
      return { command: p.command ?? formatCommand(p.spec), extra: { classYaml: p.classYaml } }
    }
    const p = probePreview(repo, o as unknown as ProbeOptions)
    return { command: p.command ?? formatCommand(p.spec), note: p.note, extra: { classYaml: p.classYaml } }
  }
  throw new InputError(`Unsupported action ${req.tool}/${action}.`)
}
