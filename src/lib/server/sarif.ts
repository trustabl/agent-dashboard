import type { ScanFinding, Severity } from '../types'
import { fingerprint } from './fingerprint'

/**
 * Reads a SARIF 2.1.0 log written by `trustabl scan --format sarif` back into
 * scan findings. Mapping inverts trustabl's internal/sarif/render.go:
 *   severity   ← rule properties["security-severity"] (9.0/7.5/5.5/3.0/0.5)
 *   category   ← rule properties.tags[0], scope ← tags[1]
 *   title      ← rule shortDescription, explanation ← fullDescription, fix ← help.text
 *   tool_name  ← result logicalLocations[0].name
 *   origin     ← result properties.origin
 *   fingerprint← result partialFingerprints.primaryLocationLineHash
 */

interface SarifRule {
  id: string
  shortDescription?: { text?: string }
  fullDescription?: { text?: string }
  help?: { text?: string }
  properties?: { confidence?: number; 'security-severity'?: string; tags?: string[] }
}

interface SarifResult {
  ruleId: string
  ruleIndex?: number
  message?: { text?: string }
  locations?: {
    physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number; endLine?: number } }
    logicalLocations?: { name?: string }[]
  }[]
  partialFingerprints?: { primaryLocationLineHash?: string }
  properties?: { confidence?: number; origin?: string }
}

export interface SarifImport {
  toolName: string
  toolVersion: string | null
  scanId: string | null
  findings: (ScanFinding & { fingerprint: string })[]
}

export class SarifError extends Error {
  status = 400
}

export function severityFromSecurity(score: string | undefined): Severity {
  const n = Number(score)
  if (n >= 9) return 'critical'
  if (n >= 7) return 'high'
  if (n >= 4) return 'medium'
  if (n >= 1) return 'low'
  return 'info'
}

export function parseTrustablSarif(text: string): SarifImport {
  let doc: { version?: string; runs?: unknown[] }
  try {
    doc = JSON.parse(text)
  } catch {
    throw new SarifError('Not a JSON file. Export one with: trustabl scan . --format sarif -o trustabl.sarif')
  }
  if (doc.version !== '2.1.0' || !Array.isArray(doc.runs) || doc.runs.length === 0) {
    throw new SarifError('Not a SARIF 2.1.0 log.')
  }
  const run = doc.runs[0] as {
    tool?: { driver?: { name?: string; version?: string; rules?: SarifRule[] } }
    results?: SarifResult[]
    automationDetails?: { id?: string }
  }
  const driver = run.tool?.driver
  if (!driver || driver.name !== 'trustabl') {
    throw new SarifError(`This SARIF was produced by "${driver?.name ?? 'an unknown tool'}", not trustabl. Only \`trustabl scan --format sarif\` exports can be imported.`)
  }
  const rules = driver.rules ?? []
  const byId = new Map(rules.map((r) => [r.id, r]))
  const findings = (run.results ?? []).map((r) => {
    const rule = (r.ruleIndex !== undefined ? rules[r.ruleIndex] : undefined) ?? byId.get(r.ruleId)
    const loc = r.locations?.[0]
    const tags = rule?.properties?.tags ?? []
    const f: ScanFinding = {
      rule_id: r.ruleId,
      category: tags[0],
      scope: tags[1],
      severity: severityFromSecurity(rule?.properties?.['security-severity']),
      tool_name: loc?.logicalLocations?.[0]?.name ?? '',
      file_path: loc?.physicalLocation?.artifactLocation?.uri ?? '',
      start_line: loc?.physicalLocation?.region?.startLine ?? 0,
      end_line: loc?.physicalLocation?.region?.endLine ?? 0,
      title: rule?.shortDescription?.text ?? r.ruleId,
      explanation: rule?.fullDescription?.text ?? r.message?.text ?? '',
      suggested_fix: rule?.help?.text ?? '',
      confidence: r.properties?.confidence ?? rule?.properties?.confidence ?? 0,
      origin: r.properties?.origin,
    }
    return { ...f, fingerprint: r.partialFingerprints?.primaryLocationLineHash ?? fingerprint(f) }
  })
  return { toolName: driver.name, toolVersion: driver.version ?? null, scanId: run.automationDetails?.id ?? null, findings }
}
