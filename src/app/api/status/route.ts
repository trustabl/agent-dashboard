import { handler, json } from '@/lib/server/api'
import { toolInfo } from '@/lib/server/tools'
import { paths } from '@/lib/server/paths'
import { currentRules } from '@/lib/server/actions/forge'
import { listRepos } from '@/lib/server/repos'
import { listRuns } from '@/lib/server/runner'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => {
  const [trustabl, autofix] = await Promise.all([toolInfo('trustabl'), toolInfo('autofix')])
  return json({
    home: paths.home(),
    tools: { trustabl, autofix },
    rules: currentRules() ?? null,
    repoCount: listRepos().length,
    running: listRuns({ status: 'running', limit: 50 }).map((r) => ({ id: r.id, tool: r.tool, action: r.action, repo_id: r.repo_id, started_at: r.started_at })),
  })
})
