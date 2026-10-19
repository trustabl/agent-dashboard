import fs from 'node:fs'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { boot } from '@/lib/server/boot'
import { getRun } from '@/lib/server/runner'
import { paths } from '@/lib/server/paths'
import { stripAnsi } from '@/lib/text'

export const dynamic = 'force-dynamic'

const POLL_MS = 300
const MAX_STREAM_MS = 2 * 60 * 60 * 1000

/**
 * Server-Sent Events: replays the run's combined log from the start, tails it
 * while the process runs, then sends the final run row. The browser is only a
 * viewer — disconnecting stops this stream, never the run.
 *   event: log    data: {"text": "..."}
 *   event: status data: <RunRow>
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await boot()
  const { id } = await params
  if (!getRun(id)) return new Response('Run not found', { status: 404 })
  const file = path.join(paths.run(id), 'output.log')
  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let offset = 0
      let closed = false
      const send = (event: string, data: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      const drain = () => {
        if (!fs.existsSync(file)) return
        const size = fs.statSync(file).size
        if (size <= offset) return
        const fd = fs.openSync(file, 'r')
        const buf = Buffer.alloc(size - offset)
        fs.readSync(fd, buf, 0, buf.length, offset)
        fs.closeSync(fd)
        offset = size
        send('log', { text: stripAnsi(buf.toString('utf8')) })
      }
      req.signal.addEventListener('abort', () => {
        closed = true
        try { controller.close() } catch { /* closed */ }
      })
      const started = Date.now()
      try {
        while (!closed && Date.now() - started < MAX_STREAM_MS) {
          drain()
          const run = getRun(id)
          if (!run || run.status !== 'running') {
            drain()
            send('status', run ?? null)
            break
          }
          controller.enqueue(enc.encode(': ping\n\n'))
          await new Promise((r) => setTimeout(r, POLL_MS))
        }
      } catch {
        /* client went away */
      } finally {
        closed = true
        try { controller.close() } catch { /* closed */ }
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
