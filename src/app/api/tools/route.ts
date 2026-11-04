import { handler, json } from '@/lib/server/api'
import { toolInfo } from '@/lib/server/tools'

export const dynamic = 'force-dynamic'

/** Both CLIs: active, pinned, installed and latest-known versions, installs in progress. */
export const GET = handler(async () => {
  const [trustabl, autofix] = await Promise.all([toolInfo('trustabl'), toolInfo('autofix')])
  return json({ trustabl, autofix })
})
