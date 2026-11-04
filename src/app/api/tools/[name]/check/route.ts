import { handler, json } from '@/lib/server/api'
import { checkLatest, toolNameParam } from '@/lib/server/tools'

export const dynamic = 'force-dynamic'

/** Look up the latest release on GitHub (the only update check; never automatic). */
export const POST = handler(async (_req: Request, { params }: { params: Promise<{ name: string }> }) => {
  const name = toolNameParam((await params).name)
  return json(await checkLatest(name))
})
