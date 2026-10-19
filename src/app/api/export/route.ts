import fs from 'node:fs'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { getRun, listArtifacts } from '@/lib/server/runner'

export const dynamic = 'force-dynamic'

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.sarif': 'application/sarif+json',
  '.yaml': 'application/yaml',
  '.md': 'text/markdown; charset=utf-8',
}

/** Download an artifact byte-for-byte as the CLI wrote it.
 *  ?run_id=…&kind=scan.json|trustabl.sarif|SKILL.md|probe.profile.json|…  (&inline=1 to view) */
export const GET = handler(async (req: NextRequest) => {
  const runId = req.nextUrl.searchParams.get('run_id') ?? ''
  const kind = req.nextUrl.searchParams.get('kind') ?? ''
  const run = getRun(runId)
  if (!run) return json({ error: 'Run not found' }, { status: 404 })
  const art = listArtifacts(runId).find((a) => a.kind === kind)
  if (!art || !fs.existsSync(art.path)) return json({ error: `No ${kind} for this run` }, { status: 404 })
  const inline = req.nextUrl.searchParams.get('inline') === '1'
  const body = fs.readFileSync(art.path)
  const type = inline ? 'text/plain; charset=utf-8' : TYPES[path.extname(art.path)] ?? 'application/octet-stream'
  const name = kind === 'scan.json' || kind === 'trustabl.sarif' ? `${run.id}-${kind}` : kind
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
      'X-Artifact-SHA256': art.sha256,
    },
  })
})
