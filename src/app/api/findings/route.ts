import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { allFindings } from '@/lib/server/queries/views'

export const dynamic = 'force-dynamic'

/** Every finding with its fingerprint status. ?status=open|resolved|introduced|all&include_tests=1 */
export const GET = handler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? 'all'
  let findings = allFindings({ includeTests: sp.get('include_tests') === '1' })
  if (status === 'open') findings = findings.filter((f) => f.status !== 'resolved')
  else if (status !== 'all') findings = findings.filter((f) => f.status === status)
  return json({ findings })
})
