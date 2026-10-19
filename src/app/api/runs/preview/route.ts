import type { NextRequest } from 'next/server'
import { handler, json } from '@/lib/server/api'
import { previewCommand, type RunRequest } from '@/lib/server/actions'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: NextRequest) => json(await previewCommand((await req.json()) as RunRequest)))
