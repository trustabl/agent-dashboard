export function relativeTime(at: number | string, now = Date.now()): string {
  const t = typeof at === 'number' ? at : Date.parse(at)
  if (Number.isNaN(t)) return String(at)
  const s = Math.round((now - t) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  return mo < 12 ? `${mo}mo ago` : `${Math.round(mo / 12)}y ago`
}

/** "Sep 11, 12:18" — the design's timestamp format, in local time. */
export function shortDateTime(at: number | string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return String(at)
  const mon = d.toLocaleString('en-US', { month: 'short' })
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${mon} ${d.getDate()}, ${hh}:${mm}`
}

export function absoluteTime(at: number | string): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? String(at) : d.toLocaleString()
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
