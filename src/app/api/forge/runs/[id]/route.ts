import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { applySkill, discardSkill, skillCandidate } from '@/lib/server/actions/forge'

export const dynamic = 'force-dynamic'
type P = { params: Promise<{ id: string }> }

export const GET = handler(async (_req: NextRequest, { params }: P) => json(await skillCandidate((await params).id)))

/** Confirmed: write the generated skill to .claude/skills/trustabl-pre-coding/SKILL.md. */
export const POST = handler(async (_req: NextRequest, { params }: P) => json(await applySkill((await params).id)))

export const DELETE = handler(async (_req: NextRequest, { params }: P) => {
  discardSkill((await params).id)
  return json({ ok: true })
})
