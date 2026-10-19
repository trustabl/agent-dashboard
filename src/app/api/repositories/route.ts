import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { addRepo, listRepos } from '@/lib/server/repos'
import { reposWithFlags } from '@/lib/server/queries/views'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) =>
  json({ repositories: req.nextUrl.searchParams.get('with') === 'flags' ? reposWithFlags() : listRepos() }),
)

export const POST = handler(async (req: NextRequest) => {
  const body = (await req.json()) as { path?: string; create?: boolean }
  const repo = await addRepo(body.path ?? '', { create: !!body.create })
  return json({ repository: repo }, { status: 201 })
})
