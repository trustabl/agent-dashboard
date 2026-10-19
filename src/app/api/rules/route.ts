import { handler, json } from '@/lib/server/api'
import { currentRules, ensureRulesStatus } from '@/lib/server/actions/forge'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => json({ rules: currentRules() ?? null }))

/** Re-resolve the rules SHA now; a change re-runs forge check on every skill. */
export const POST = handler(async () => {
  await ensureRulesStatus(0)
  return json({ ok: true }, { status: 202 })
})
