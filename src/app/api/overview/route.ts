import { handler, json } from '@/lib/server/api'
import { overviewView } from '@/lib/server/queries/views'

export const dynamic = 'force-dynamic'

/** Overview page: tiles, filter counts and one row per repo combining Forge, Analyzer and Probe. */
export const GET = handler(async () => json(overviewView()))
