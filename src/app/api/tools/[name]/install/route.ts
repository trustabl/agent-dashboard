import { handler, json } from '@/lib/server/api'
import { ensureInstalled, latestKnown, pinnedVersion, toolNameParam } from '@/lib/server/tools'

export const dynamic = 'force-dynamic'

/** Install the pinned or the latest-checked version, then make it active.
 *  Returns at once; GET /api/tools shows the progress and lastInstall. */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ name: string }> }) => {
  const name = toolNameParam((await params).name)
  const { version } = (await req.json().catch(() => ({}))) as { version?: unknown }
  const allowed = [pinnedVersion(name), latestKnown(name)?.version].filter(Boolean)
  if (typeof version !== 'string' || !allowed.includes(version)) {
    return json({ error: `Only ${allowed.join(' or ')} can be installed for ${name}.` }, { status: 400 })
  }
  ensureInstalled(name, version, undefined, { activate: true }).catch(() => { /* reported through lastInstall */ })
  return json({ ok: true }, { status: 202 })
})
