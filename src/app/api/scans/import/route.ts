import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { addRepo, getRepo, InputError } from '@/lib/server/repos'
import { finishRecordedRun, recordRun } from '@/lib/server/runner'
import { importSarif } from '@/lib/server/actions/analyzer'
import { binaryPath } from '@/lib/server/tools'
import { formatCommand } from '@/lib/shell'
import { paths } from '@/lib/server/paths'
import { headSha } from '@/lib/server/git'

export const dynamic = 'force-dynamic'

/** Import a `trustabl scan --format sarif` export as a scan of a repo.
 *  multipart/form-data: file, repo_id | path */
export const POST = handler(async (req: NextRequest) => {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new InputError('Choose a .sarif file.')
  if (file.size > 50 * 1024 * 1024) throw new InputError('SARIF file is larger than 50 MB.')
  const repoId = form.get('repo_id')?.toString()
  const p = form.get('path')?.toString()
  const repo = repoId ? getRepo(repoId) : p ? await addRepo(p) : undefined
  if (!repo) throw new InputError('Pick the repo this SARIF belongs to.')
  const text = await file.text()
  const command = formatCommand({ bin: binaryPath('trustabl'), args: ['scan', repo.path, '--format', 'sarif', '-o', file.name || 'trustabl.sarif'], cwd: repo.path })
  const run = recordRun({ tool: 'analyzer', action: 'import', repo, command, status: 'running', options: { file: file.name }, commitSha: (await headSha(repo.path)) ?? null })
  try {
    const { parsed, summary } = importSarif(run.id, repo.id, paths.run(run.id), text)
    finishRecordedRun(run.id, 'succeeded', { summary: { ...summary, file: file.name }, toolVersion: parsed.toolVersion })
  } catch (e) {
    finishRecordedRun(run.id, 'failed', { error: (e as Error).message })
    throw e
  }
  return json({ runId: run.id }, { status: 201 })
})
