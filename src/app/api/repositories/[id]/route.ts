import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { getRepo, removeRepo } from '@/lib/server/repos'
import { repoDetail } from '@/lib/server/queries/views'

export const dynamic = 'force-dynamic'

export const GET = handler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const detail = await repoDetail(id)
  if (!detail) return json({ error: 'Repo not found' }, { status: 404 })
  return json(detail)
})

/** Forget a repo (its runs and findings). Never touches files on disk. */
export const DELETE = handler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (!getRepo(id)) return json({ error: 'Repo not found' }, { status: 404 })
  removeRepo(id)
  return json({ ok: true })
})
