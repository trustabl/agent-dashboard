import { NextResponse, type NextRequest } from 'next/server'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The Console runs commands on this machine, so it only answers requests that
 * are addressed to localhost (defeats DNS rebinding) and, for anything that is
 * not a plain read, only requests whose Origin is this same local app (defeats
 * a web page you visit posting to http://127.0.0.1:4317). There is no login:
 * the server listens on 127.0.0.1 only.
 */
export function proxy(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase()
  if (!LOCAL_HOSTS.has(host)) {
    return new NextResponse('Agent Dashboard only answers on localhost.', { status: 403 })
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin')
    if (origin) {
      let ok = false
      try {
        const o = new URL(origin)
        ok = LOCAL_HOSTS.has(o.hostname.toLowerCase()) || o.hostname === '::1'
        ok = ok && o.host === req.headers.get('host')
      } catch {
        ok = false
      }
      if (!ok) return new NextResponse('Cross-origin request refused.', { status: 403 })
    } else if (req.headers.get('sec-fetch-site') && req.headers.get('sec-fetch-site') !== 'same-origin' && req.headers.get('sec-fetch-site') !== 'none') {
      return new NextResponse('Cross-site request refused.', { status: 403 })
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/:path*',
}
