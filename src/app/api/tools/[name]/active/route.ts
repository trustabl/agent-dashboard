import { handler, json } from '@/lib/server/api'
import { setActiveVersion, toolNameParam } from '@/lib/server/tools'

export const dynamic = 'force-dynamic'

/** Switch the version later runs use (runs already started keep theirs). */
export const PUT = handler(async (req: Request, { params }: { params: Promise<{ name: string }> }) => {
  const name = toolNameParam((await params).name)
  const { version } = (await req.json().catch(() => ({}))) as { version?: unknown }
  if (typeof version !== 'string') return json({ error: 'version is required' }, { status: 400 })
  setActiveVersion(name, version)
  return json({ ok: true })
})
