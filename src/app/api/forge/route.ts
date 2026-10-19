import { handler, json } from '@/lib/server/api'
import { forgeView } from '@/lib/server/queries/views'

export const dynamic = 'force-dynamic'

/** Forge page: per-repo skill, stamp, OTel-in-skill and forge check state. */
export const GET = handler(async () => json(forgeView()))
