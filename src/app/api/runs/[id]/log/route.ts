import fs from 'node:fs'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { getRun } from '@/lib/server/runner'
import { paths } from '@/lib/server/paths'
import { stripAnsi } from '@/lib/text'

export const dynamic = 'force-dynamic'

/** Whole run log as text (the stream route is the live view). */
export const GET = handler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (!getRun(id)) return json({ error: 'Run not found' }, { status: 404 })
  const file = path.join(paths.run(id), 'output.log')
  const text = fs.existsSync(file) ? stripAnsi(fs.readFileSync(file, 'utf8')) : ''
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
})
