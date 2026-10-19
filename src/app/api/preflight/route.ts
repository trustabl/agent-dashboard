import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { checkRunner, llmKeyEnv, type Runner } from '@/lib/server/actions/probe'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  const runner = (req.nextUrl.searchParams.get('runner') ?? 'docker') as Runner
  return json({ runner: await checkRunner(runner), llmKeyEnv: llmKeyEnv() })
})
