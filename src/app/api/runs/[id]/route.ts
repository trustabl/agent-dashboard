import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { getRun, listArtifacts } from '@/lib/server/runner'

export const dynamic = 'force-dynamic'

export const GET = handler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const run = getRun(id)
  if (!run) return json({ error: 'Run not found' }, { status: 404 })
  return json({ run, artifacts: listArtifacts(id).map((a) => ({ kind: a.kind, bytes: a.bytes, sha256: a.sha256 })) })
})
