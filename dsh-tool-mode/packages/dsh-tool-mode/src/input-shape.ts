/**
 * Compact, bounded input signatures for the adoption digest.
 *
 * The digest must say HOW to call the artifact before the first call, not only what it
 * does: the E15 probe used the artifact but ignored its `texts[]` batch. This module
 * reads untrusted JSON Schema only to render a short signature; it never validates or
 * executes anything.
 *
 * @module input-signature
 */

/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion */

/** The rendered signature and whether any argument takes a list. */
export interface CompactInputSignature {
  /** For example `{ texts: string[] }`. */
  readonly signature: string
  /** True when at least one top-level property is an array. */
  readonly batch: boolean
}

const MAX_PROPERTIES = 6
const MAX_NESTED = 4

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function compactType(value: unknown, depth: number): string {
  const record = asRecord(value)
  if (record === undefined) return 'value'
  const type = record['type']
  if (type === 'array') return compactType(record['items'], depth + 1) + '[]'
  if (type === 'string' || type === 'number' || type === 'integer'
    || type === 'boolean' || type === 'null') return type
  if (type === 'object' && depth < 2) {
    const properties = asRecord(record['properties'])
    if (properties !== undefined) {
      const names = Object.keys(properties).slice(0, MAX_NESTED)
      if (names.length > 0) {
        const suffix = Object.keys(properties).length > MAX_NESTED ? ', …' : ''
        return '{' + names.join(', ') + suffix + '}'
      }
    }
    return 'object'
  }
  return 'value'
}

/**
 * Render one compact signature from a JSON Schema object.
 * @param schema - the artifact's input schema.
 * @returns the signature and batch flag, or undefined when there is nothing to call with.
 */
export function compactInputSignature(schema: Record<string, unknown> | undefined): CompactInputSignature | undefined {
  if (schema === undefined) return undefined
  const properties = asRecord(schema['properties'])
  if (properties === undefined) return undefined
  const entries = Object.entries(properties)
  if (entries.length === 0) return undefined
  const requiredValue = schema['required']
  const required = new Set(Array.isArray(requiredValue)
    ? requiredValue.filter((name): name is string => typeof name === 'string')
    : [])
  const shown = entries.slice(0, MAX_PROPERTIES)
  const parts = shown.map(([name, definition]) =>
    name + (required.has(name) ? '' : '?') + ': ' + compactType(definition, 0))
  if (entries.length > shown.length) parts.push('…')
  return {
    signature: '{' + parts.join(', ') + '}',
    batch: entries.some(([, definition]) => asRecord(definition)?.['type'] === 'array'),
  }
}
