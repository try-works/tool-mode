/**
 * The bounded library digest (adoption plan Phase 4).
 *
 * Shows a few caller-owned artifacts in an always-visible prompt section. It is
 * value-free: names, one-line descriptions and evidence counts only.
 *
 * @module library-digest
 */

/** One artifact line. */
export interface LibraryDigestRow {
  readonly name: string
  readonly callableName: string
  readonly description: string
  readonly uses?: number
  readonly sessions?: number
  readonly failures?: number
  readonly scope?: string
}

/** Options. */
export interface LibraryDigestOptions {
  readonly maxLines?: number
  readonly maxChars?: number
}

const DEFAULT_MAX_LINES = 4
const DEFAULT_MAX_CHARS = 600

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

/**
 * Build the digest, capped by whole lines.
 * @param rows - caller-visible workspace/global artifacts.
 * @param options - caps.
 * @returns the prompt text, or an empty string when there is nothing to show.
 */
export function buildLibraryDigest(rows: readonly LibraryDigestRow[], options: LibraryDigestOptions = {}): string {
  const maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LINES)
  const maxChars = Math.max(80, options.maxChars ?? DEFAULT_MAX_CHARS)
  const seen = new Set<string>()
  const lines: string[] = []
  for (const row of rows) {
    if (row.callableName.length === 0 || seen.has(row.callableName)) continue
    seen.add(row.callableName)
    const description = truncate(oneLine(row.description), 90)
    const evidence = row.uses !== undefined && row.uses >= 5
      ? ` [${row.uses} uses/${row.sessions ?? 0} sessions/${row.failures ?? 0} failures]`
      : ''
    const both = row.name === row.callableName
      ? `\`${row.callableName}\``
      : `\`${row.callableName}\` (stored \`${row.name}\`)`
    lines.push(`- ${both}: ${description}${evidence}`)
    if (lines.length >= maxLines) break
  }
  if (lines.length === 0) return ''
  const heading = '## Your saved Tool Mode artifacts\nCallable now; reuse beats rebuilding.\n'
  let out = heading
  for (const line of lines) {
    if (out.length + line.length + 1 > maxChars) break
    out += line + '\n'
  }
  return out.trimEnd()
}
