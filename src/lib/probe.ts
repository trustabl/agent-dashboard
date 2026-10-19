import { parse as parseYaml } from 'yaml'
import type { Endpoint, ProbeFindings, ProbeProfile } from './types'

// Interprets what `autofix fix` (Trustabl Probe 0.2.2) writes:
// probe.profile.json, probe.findings.json and network_policies.draft.yaml.

export type ProbeFlag = 'egress.denied_class' | 'egress.broad_cidr' | 'egress.not_in_org_allow'

export interface FlagHit {
  flag: ProbeFlag
  /** What the CLI said, verbatim (evidence detail or stderr line). */
  details: string[]
  /** Where the Console read it from. */
  source: string
}

/** Evidence `source` values Probe uses for destinations it did not draft. */
const EGRESS_EVIDENCE = new Set(['deny_list', 'egress.not_in_org_allow', 'class_split'])

/**
 * Flags, from real Probe output only:
 *  - egress.denied_class    ← findings evidence with source "deny_list"
 *                             (built-in metadata/link-local deny + --deny-list)
 *  - egress.not_in_org_allow← findings evidence with source "egress.not_in_org_allow"
 *  - egress.broad_cidr      ← the stderr warning "Broad allow-list entries detected: …"
 */
export function probeFlags(findings: ProbeFindings | null, stderr: string): FlagHit[] {
  const hits: FlagHit[] = []
  const collect = (src: string) =>
    (findings?.findings ?? []).flatMap((f) => (f.evidence ?? []).filter((e) => e.source === src).map((e) => e.detail ?? ''))
  const denied = collect('deny_list')
  if (denied.length) hits.push({ flag: 'egress.denied_class', details: denied, source: 'probe.findings.json (deny_list)' })
  const broad = stderr
    .split(/\r?\n/)
    .map((l) => l.match(/Broad allow-list entries detected:\s*(.+)$/)?.[1]?.trim())
    .filter((x): x is string => !!x)
  if (broad.length) hits.push({ flag: 'egress.broad_cidr', details: broad, source: 'autofix stderr' })
  const notIn = collect('egress.not_in_org_allow')
  if (notIn.length) hits.push({ flag: 'egress.not_in_org_allow', details: notIn, source: 'probe.findings.json (egress.not_in_org_allow)' })
  return hits
}

/** Session findings that are not about where the tool may connect — crashes,
 *  hangs, secrets, unbounded output… Shown apart from the egress result. */
export function sessionExtras(findings: ProbeFindings | null): ProbeFindings['findings'] {
  return (findings?.findings ?? []).filter((f) => !(f.evidence ?? []).some((e) => EGRESS_EVIDENCE.has(e.source ?? '')))
}

export interface DraftDoc {
  outbound: Endpoint[]
  raw: string
}

export function parseDraft(yamlText: string | null): DraftDoc | null {
  if (yamlText === null) return null
  const doc = (parseYaml(yamlText) ?? {}) as { network_policies?: { outbound?: Endpoint[] | null } }
  return { outbound: doc.network_policies?.outbound ?? [], raw: yamlText }
}

export function uniqueEgress(profile: ProbeProfile | null): Endpoint[] {
  const seen = new Map<string, Endpoint>()
  for (const t of profile?.tools ?? []) {
    for (const e of t.egress ?? []) seen.set(`${e.host}:${e.port}/${e.protocol}`, e)
  }
  return [...seen.values()].sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port)
}

export type CacheState = 'cache hit' | 'fresh' | 'partial cache'
export function cacheState(profile: ProbeProfile | null): CacheState | null {
  const tools = profile?.tools ?? []
  if (!tools.length) return null
  const hits = tools.filter((t) => t.cache_hit).length
  return hits === tools.length ? 'cache hit' : hits === 0 ? 'fresh' : 'partial cache'
}

/**
 * Destinations that must never be in a draft whatever a tool reached: cloud
 * metadata, link-local (Probe's built-in deny), unspecified / any-address
 * (0.0.0.0, ::, 0.0.0.0/0) and any CIDR wider than /8. The Console passes a
 * guard deny list so Probe never drafts them, and re-checks the result here.
 */
export function forbiddenDraftEntry(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return 'cloud metadata endpoint'
  if (/^169\.254\./.test(h)) return 'link-local address (169.254.0.0/16)'
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return 'IPv6 link-local address (fe80::/10)'
  if (h === '0.0.0.0' || h === '::' || h === '*' || h === '0.0.0.0/0' || h === '::/0') return 'any-address / 0.0.0.0/0'
  const cidr = h.match(/\/(\d{1,3})$/)
  if (cidr && Number(cidr[1]) <= 8) return `broad CIDR ${h}`
  return null
}

export function draftViolations(draft: DraftDoc | null): { host: string; reason: string }[] {
  return (draft?.outbound ?? []).flatMap((e) => {
    const reason = forbiddenDraftEntry(String(e.host))
    return reason ? [{ host: String(e.host), reason }] : []
  })
}

/** Guard entries the Console adds to every --deny-list it passes (exact
 *  hosts; a CIDR like 0.0.0.0/0 would deny every IPv4 destination). */
export const GUARD_DENY = ['0.0.0.0', '::']

export function parseListFile(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

export interface EgressEval {
  host: string
  port: number
  protocol: string
  /** Probe's own label for the destination (declared / observed / platform). */
  source?: string
  /** Tool files that reached it. */
  tools: string[]
  /** drafted = in network_policies.outbound; flagged = named by a flag;
   *  excluded = observed but not drafted, with no flag naming it. */
  outcome: 'drafted' | 'flagged' | 'excluded'
  flags: ProbeFlag[]
}

/**
 * The design's "observed ∩ declared-allow → draft", per destination, from
 * real output only: profile egress (observed), the draft Probe wrote, and the
 * flags that name a destination. Draft entries Probe added that no tool
 * reached (e.g. platform allow list) are listed too, with no tools.
 */
export function evaluateEgress(profile: ProbeProfile | null, draft: DraftDoc | null, flags: FlagHit[]): EgressEval[] {
  const key = (h: string, p: number) => `${h.toLowerCase()}:${p}`
  const drafted = new Set((draft?.outbound ?? []).map((e) => key(String(e.host), Number(e.port))))
  const out = new Map<string, EgressEval>()
  for (const t of profile?.tools ?? []) {
    for (const e of t.egress ?? []) {
      const k = key(e.host, e.port)
      const cur = out.get(k) ?? { host: e.host, port: e.port, protocol: e.protocol, source: e.source, tools: [], outcome: 'excluded' as const, flags: [] }
      if (!cur.tools.includes(t.path)) cur.tools.push(t.path)
      out.set(k, cur)
    }
  }
  for (const e of draft?.outbound ?? []) {
    const k = key(String(e.host), Number(e.port))
    if (!out.has(k)) out.set(k, { host: String(e.host), port: Number(e.port), protocol: e.protocol, source: e.source, tools: [], outcome: 'drafted', flags: [] })
  }
  // Destinations Probe kept out of the profile but named in a flag
  // ("api.stripe.com:443 (tcp) is not on the declared … allow list").
  for (const f of flags) {
    if (f.flag === 'egress.broad_cidr') continue
    for (const d of f.details) {
      const m = d.match(/(\[[0-9a-f:]+\]|[A-Za-z0-9*][A-Za-z0-9.*-]*):(\d{1,5})\b(?:\s*\((\w+)\))?/i)
      if (!m) continue
      const k = key(m[1], Number(m[2]))
      if (!out.has(k)) out.set(k, { host: m[1], port: Number(m[2]), protocol: m[3] ?? 'tcp', tools: [], outcome: 'flagged', flags: [] })
    }
  }
  for (const ev of out.values()) {
    const hostRe = new RegExp(`(^|[^a-z0-9.-])${ev.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9.-]|$)`, 'i')
    ev.flags = flags.filter((f) => f.flag !== 'egress.broad_cidr' && f.details.some((d) => hostRe.test(d))).map((f) => f.flag)
    ev.outcome = drafted.has(key(ev.host, ev.port)) ? 'drafted' : ev.flags.length ? 'flagged' : 'excluded'
  }
  return [...out.values()].sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port)
}

export type DraftState =
  | { kind: 'drafted'; count: number }
  | { kind: 'empty'; reason: string; noEgress?: boolean }
  | { kind: 'withheld'; reason: string }
  | { kind: 'none' }

export function draftState(draft: DraftDoc | null, flags: FlagHit[], observed: Endpoint[]): DraftState {
  if (!draft) return { kind: 'none' }
  const bad = draftViolations(draft)
  if (bad.length) {
    return { kind: 'withheld', reason: `Draft withheld: it lists ${bad.map((b) => `${b.host} (${b.reason})`).join(', ')}. The Console never offers such a draft.` }
  }
  // A broad allow-list entry (e.g. *.com) lets any matching destination into
  // the draft, so what Probe wrote is not a safe allow list: show it as
  // withheld rather than as a draft.
  const broad = flags.find((f) => f.flag === 'egress.broad_cidr')
  if (draft.outbound.length > 0 && broad) {
    return {
      kind: 'withheld',
      reason: `Draft withheld: the allow list you supplied has broad entries (${broad.details.join(', ')}), so ${draft.outbound.length} destination(s) were drafted only because they matched a wildcard. Replace them with exact hosts and re-run.`,
    }
  }
  if (draft.outbound.length > 0) return { kind: 'drafted', count: draft.outbound.length }
  if (flags.length) {
    const names = flags.map((f) => f.flag).join(', ')
    return { kind: 'empty', reason: `Draft left empty: every observed destination was flagged (${names}) instead of being allowed. Fix the tool or add the destination to your allow list, then re-run.` }
  }
  if (observed.length === 0) return { kind: 'empty', reason: 'No network egress observed — the draft allows no outbound destinations.', noEgress: true }
  return { kind: 'empty', reason: 'Probe wrote no outbound entries.' }
}
