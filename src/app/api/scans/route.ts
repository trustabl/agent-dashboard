import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { analyzerView } from '@/lib/server/queries/views'

export const dynamic = 'force-dynamic'

/** Analyzer page: tiles + per-repo scans (open findings, history). ?include_tests=1 shows test-path findings. */
export const GET = handler(async (req: NextRequest) =>
  json(analyzerView({ includeTests: req.nextUrl.searchParams.get('include_tests') === '1' })),
)
