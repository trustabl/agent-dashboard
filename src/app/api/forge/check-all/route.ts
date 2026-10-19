import { handler, json } from '@/lib/server/api'
import { recheckAllSkills } from '@/lib/server/actions/forge'

export const dynamic = 'force-dynamic'

/** Run `trustabl forge check` on every repo that has a SKILL.md. */
export const POST = handler(async () => json({ started: await recheckAllSkills('manual') }, { status: 202 }))
