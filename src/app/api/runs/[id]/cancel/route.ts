import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { cancelRun, getRun } from '@/lib/server/runner'

export const dynamic = 'force-dynamic'

export const POST = handler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const run = getRun(id)
  if (!run) return json({ error: 'Run not found' }, { status: 404 })
  if (run.status !== 'running') return json({ error: `Run already ${run.status}.` }, { status: 409 })
  if (!cancelRun(id)) return json({ error: 'This run is not owned by this server process.' }, { status: 409 })
  return json({ ok: true })
})
