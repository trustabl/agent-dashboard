import { NextResponse } from 'next/server'
import { boot } from './boot'

/** Wraps a route handler: boots the server state once, maps known errors to
 *  their status and everything else to a 500 with the message (local app —
 *  the person reading it is the person who can fix it). */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      await boot()
      return await fn(...args)
    } catch (e) {
      const err = e as Error & { status?: number }
      const status = err.status ?? 500
      if (status >= 500) console.error('[agent-dashboard]', err)
      return NextResponse.json({ error: err.message || 'Unexpected error' }, { status })
    }
  }
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}
