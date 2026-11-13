/**
 * AT-23/LIC-03 — the durable provider permission-basis record.
 *
 * This is a DECISION RECORD, not an export switch. The MCP publication gate is the
 * operator's `exportTools` allowlist; recording `distribution: true` here does not
 * change that gate, and enabling a provider natively does not write this file.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface LicenseBasis {
  native: boolean
  export: boolean
  distribution: boolean
  telemetry: boolean
  principal: string
  recordedAt: string
}

export const LICENSE_BASIS_FILE = 'license-bases.json'

/** Read the recorded bases; a missing or malformed file reads as empty. */
export function readLicenseBases(directory: string): Record<string, LicenseBasis> {
  try {
    const parsed = JSON.parse(readFileSync(join(directory, LICENSE_BASIS_FILE), 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, LicenseBasis> = {}
    for (const [providerId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as Record<string, unknown>
      out[providerId] = {
        native: entry['native'] === true,
        export: entry['export'] === true,
        distribution: entry['distribution'] === true,
        telemetry: entry['telemetry'] === true,
        principal: typeof entry['principal'] === 'string' ? entry['principal'] : 'unattributed',
        recordedAt: typeof entry['recordedAt'] === 'string' ? entry['recordedAt'] : '',
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Record one provider's basis. The other providers' records are preserved and
 * the write is a single file replacement, so a reader never sees half a record.
 */
export function recordLicenseBasis(
  directory: string,
  providerId: string,
  basis: { readonly native?: boolean; readonly export?: boolean; readonly distribution?: boolean; readonly telemetry?: boolean },
  principal: string,
  now: () => Date = () => new Date(),
): LicenseBasis {
  if (providerId.trim() === '') throw new Error('a license basis needs a provider id')
  const record: LicenseBasis = {
    native: basis.native === true,
    export: basis.export === true,
    distribution: basis.distribution === true,
    telemetry: basis.telemetry === true,
    principal: principal.trim() === '' ? 'unattributed' : principal,
    recordedAt: now().toISOString(),
  }
  const bases = readLicenseBases(directory)
  bases[providerId] = record
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, LICENSE_BASIS_FILE), `${JSON.stringify(bases, null, 2)}\n`)
  return record
}