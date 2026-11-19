/**
 * Phase 6 safety checks for auto-kept artifacts.
 *
 * These are deliberately conservative, bounded heuristics: they keep a credential-shaped
 * literal out of the durable store and keep side-effecting programs from being promoted to
 * the workspace automatically. They are not a proof of safety.
 *
 * @module artifact-safety
 */

/** Credential-shaped literals that must not be persisted in a captured program. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bapi[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/i,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
]

/** Tools whose use means a program is not a pure transform. */
const SIDE_EFFECT_TOOLS: ReadonlySet<string> = new Set([
  'pwsh',
  'write',
  'delete',
  'edit',
  'apply_patch',
  'tool_mode_run',
])

/**
 * Whether text contains a credential-shaped literal.
 * @param text - captured program or description.
 * @returns true when a known secret pattern matches.
 */
export function containsSecretLikeLiteral(text: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Whether a bound tool list can cause an external side effect.
 * @param tools - the program's binding subset.
 * @returns true when any known side-effecting tool is present.
 */
export function hasSideEffectTools(tools: readonly string[]): boolean {
  return tools.some(tool => SIDE_EFFECT_TOOLS.has(tool))
}
