import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { listRuns } from '@/lib/server/runner'
import { startToolRun, type RunRequest } from '@/lib/server/actions'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  const runs = listRuns({
    repoId: sp.get('repo_id') ?? undefined,
    tool: sp.get('tool') ?? undefined,
    status: sp.get('status') ?? undefined,
    limit: Number(sp.get('limit') ?? 100),
  })
  return json({ runs })
})

export const POST = handler(async (req: NextRequest) => {
  const body = (await req.json()) as RunRequest
  const run = await startToolRun(body)
  return json({ run }, { status: 202 })
})
