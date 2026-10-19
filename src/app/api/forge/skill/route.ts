import fs from 'node:fs'
import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { getRepo } from '@/lib/server/repos'
import { skillPath } from '@/lib/server/actions/forge'

export const dynamic = 'force-dynamic'

/** The SKILL.md currently on disk in a repo (view / download). */
export const GET = handler(async (req: NextRequest) => {
  const repo = getRepo(req.nextUrl.searchParams.get('repo_id') ?? '')
  if (!repo) return json({ error: 'Repo not found' }, { status: 404 })
  const p = skillPath(repo)
  if (!fs.existsSync(p)) return json({ error: 'No SKILL.md on disk' }, { status: 404 })
  const download = req.nextUrl.searchParams.get('download') === '1'
  return new Response(fs.readFileSync(p), {
    headers: {
      'Content-Type': download ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="SKILL.md"`,
    },
  })
})
