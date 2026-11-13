/**
 * The CODE-09 evidence artifact: a durable record that the confinement acceptance
 * suite passed on THIS build.
 *
 * Why an artifact instead of a module flag: the flag shipped false and only a test-only
 * setter (armed by an environment marker) could move it, so a real deployment could never
 * serve `tool_mode_run` — not by configuration, not by running the very tests the
 * specification names. That is a release gate with no release path.
 *
 * This module gives the gate an operator path that stays auditable:
 *
 * 1. the operator runs `scripts/record-confinement-evidence.mjs`, which runs the
 *    confinement suite (`tests/ptc-sandbox.test.ts`, on the real Node backend) and writes
 *    the artifact ONLY when the suite passes;
 * 2. the operator starts the host with `DSH_PTC_CONFINEMENT_EVIDENCE=<artifact path>`;
 * 3. the runtime reads and VALIDATES the artifact (kind, version, pass, package version,
 *    platform, non-empty test list) — a malformed, stale or failed artifact is refused
 *    with the reason, never treated as "some evidence exists".
 *
 * The conjunction is unchanged: CODE-10's operator grant AND this evidence. External MCP
 * exposure keeps its own additional gate.
 */
import { readFileSync } from 'node:fs'

/** The environment variable naming the evidence artifact. */
export const CONFINEMENT_EVIDENCE_ENV = 'DSH_PTC_CONFINEMENT_EVIDENCE'
/** The artifact's discriminator. */
export const CONFINEMENT_EVIDENCE_KIND = 'ptc-confinement-evidence'
/** The artifact's schema version. */
export const CONFINEMENT_EVIDENCE_VERSION = 1

/** The validated shape the recorder writes. */
export interface ConfinementEvidence {
  readonly kind: typeof CONFINEMENT_EVIDENCE_KIND
  readonly version: number
  readonly passed: boolean
  /** ISO timestamp of the run. */
  readonly generatedAt: string
  /** The package version the suite ran against. */
  readonly packageVersion: string
  /** `process.platform` of the machine that ran it. */
  readonly platform: string
  /** `process.version` of the machine that ran it. */
  readonly node: string
  /** The suite files that were run. */
  readonly tests: readonly string[]
  /** The exact command line, so the run is reproducible. */
  readonly command: string
}

/** The result of reading the artifact. */
export type ConfinementEvidenceCheck =
  | { readonly ok: true; readonly path: string; readonly evidence: ConfinementEvidence }
  | { readonly ok: false; readonly present: boolean; readonly path?: string; readonly reason: string }

/** One well-formedness question about a parsed value. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read and validate the evidence artifact.
 *
 * The path is the operator's `DSH_PTC_CONFINEMENT_EVIDENCE` when set, otherwise the
 * standard local artifact `~/.dsh/ptc-confinement-evidence.json` that the recorder writes.
 * The default matters because a host started normally never carries that variable, and a
 * gate whose only release path requires a wrapper launcher is still effectively closed.
 * The default is not a bypass: the artifact is validated exactly like an explicit one —
 * kind, schema, pass, package version, platform, timestamp, test list, command and counts.
 *
 * Failures are VALUES with a reason, never exceptions: a gate that throws on a malformed
 * file would crash the host, and one that silently treats a malformed file as evidence
 * would open the gate. Both are refused here with the reason spelled out.
 * @param options - the environment, the expected package version, and the platform.
 * @returns the check outcome.
 */
export function checkConfinementEvidence(options: {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly expectedVersion: string
  readonly platform?: string
  readonly readFile?: (path: string) => string
  /** Fallback path when the environment names none; the runtime supplies the home file. */
  readonly defaultPath?: string
}): ConfinementEvidenceCheck {
  const env = options.env ?? process.env
  const configured = env[CONFINEMENT_EVIDENCE_ENV]
  const path = configured !== undefined && configured.trim().length > 0 ? configured : options.defaultPath
  if (path === undefined || path.trim().length === 0) {
    return {
      ok: false,
      present: false,
      reason: `no confinement evidence is configured (set ${CONFINEMENT_EVIDENCE_ENV} to the `
        + 'artifact written by scripts/record-confinement-evidence.mjs)',
    }
  }
  let text: string
  try {
    text = (options.readFile ?? (file => readFileSync(file, 'utf8')))(path)
  } catch (error) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} cannot be read: `
        + `${error instanceof Error ? error.message : String(error)}`,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} is not JSON: `
        + `${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!isRecord(parsed)) {
    return { ok: false, present: true, path, reason: `the confinement evidence at ${path} is not an object` }
  }
  if (parsed['kind'] !== CONFINEMENT_EVIDENCE_KIND) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} has kind ${JSON.stringify(parsed['kind'])}, `
        + `expected ${JSON.stringify(CONFINEMENT_EVIDENCE_KIND)}`,
    }
  }
  if (parsed['version'] !== CONFINEMENT_EVIDENCE_VERSION) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} is schema version ${String(parsed['version'])}, `
        + `expected ${String(CONFINEMENT_EVIDENCE_VERSION)}`,
    }
  }
  if (parsed['passed'] !== true) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} does not record a passing run`,
    }
  }
  const expectedVersion = options.expectedVersion
  if (parsed['packageVersion'] !== expectedVersion) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} was recorded for package version `
        + `${JSON.stringify(parsed['packageVersion'])}, but this host is ${JSON.stringify(expectedVersion)}; `
        + 're-run scripts/record-confinement-evidence.mjs against this build',
    }
  }
  const platform = options.platform ?? process.platform
  if (parsed['platform'] !== platform) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} was recorded on ${JSON.stringify(parsed['platform'])}, `
        + `not ${JSON.stringify(platform)}`,
    }
  }
  if (typeof parsed['generatedAt'] !== 'string' || Number.isNaN(Date.parse(parsed['generatedAt']))) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} has no valid generatedAt timestamp`,
    }
  }
  if (!Array.isArray(parsed['tests']) || parsed['tests'].length === 0
    || parsed['tests'].some(entry => typeof entry !== 'string' || entry.length === 0)) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} names no test file`,
    }
  }
  /**
   * COUNTS are validated, not decorative.
   *
   * "2 pass, 3 skipped" is not evidence that the workspace-write arms are confined — a
   * skip is an arm that never ran. The recorder refuses to write such an artifact, and the
   * runtime refuses one anyway: a hand-edited or older artifact must not open a gate the
   * suite did not earn.
   */
  const counts = parsed['counts']
  if (!isRecord(counts)
    || typeof counts['tests'] !== 'number' || typeof counts['pass'] !== 'number'
    || typeof counts['fail'] !== 'number' || typeof counts['skipped'] !== 'number') {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} carries no test counts`,
    }
  }
  const testsCount = counts['tests'] as number
  const passCount = counts['pass'] as number
  const failCount = counts['fail'] as number
  const skippedCount = counts['skipped'] as number
  if (testsCount <= 0 || passCount !== testsCount || failCount !== 0 || skippedCount !== 0) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} records ${String(testsCount)} tests, `
        + `${String(passCount)} passed, ${String(failCount)} failed, ${String(skippedCount)} skipped; `
        + 'every confinement arm must pass with none skipped',
    }
  }
  if (typeof parsed['command'] !== 'string' || parsed['command'].length === 0) {
    return {
      ok: false,
      present: true,
      path,
      reason: `the confinement evidence at ${path} has no command line`,
    }
  }
  return {
    ok: true,
    path,
    evidence: {
      kind: CONFINEMENT_EVIDENCE_KIND,
      version: CONFINEMENT_EVIDENCE_VERSION,
      passed: true,
      generatedAt: parsed['generatedAt'],
      packageVersion: expectedVersion,
      platform,
      node: typeof parsed['node'] === 'string' ? parsed['node'] : '',
      tests: parsed['tests'] as readonly string[],
      command: parsed['command'],
    },
  }
}
