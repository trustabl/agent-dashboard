import { handler, json } from '@/lib/server/api'
import { probeView } from '@/lib/server/queries/views'

export const dynamic = 'force-dynamic'

/** Probe page: per-repo grant set, last harness run, egress, draft and flags. */
export const GET = handler(async () => json(probeView()))
