import { createHash } from 'node:crypto'

/**
 * Finding identity across scans: rule + location. This is byte-for-byte the
 * formula trustabl itself uses for SARIF `partialFingerprints.primaryLocationLineHash`
 * (internal/sarif/render.go fingerprintFor: sha256(rule_id|file_path|tool_name)),
 * so a scan run here and a SARIF file imported from the CLI agree on identity.
 * Line numbers are deliberately not part of it: an edit above a finding does
 * not turn it into "resolved + introduced".
 */
export function fingerprint(f: { rule_id: string; file_path?: string | null; tool_name?: string | null }): string {
  return createHash('sha256')
    .update(f.rule_id)
    .update('|')
    .update(f.file_path ?? '')
    .update('|')
    .update(f.tool_name ?? '')
    .digest('hex')
}
