import { handler, json } from '@/lib/server/api'
import { policyCategories } from '@/lib/server/actions/forge'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => json({ categories: await policyCategories() }))
