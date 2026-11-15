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

/** Which candidate supplied the accepted artifact. */
export type ConfinementEvidenceSource = 'env' | 'home' | 'bundled'

/** The result of reading the artifact. */
export type ConfinementEvidenceCheck =
  | {
    readonly ok: true
    readonly path: string
    /** Which candidate the artifact came from; the env path always wins when it is valid. */
    readonly source: ConfinementEvidenceSource
    readonly evidence: ConfinementEvidence
  }
  | { readonly ok: false; readonly present: boolean; readonly path?: string; readonly reason: string }

/** The result of validating ONE path, before the candidate order is applied. */
type SinglePathCheck =
  | { readonly ok: true; readonly path: string; readonly evidence: ConfinementEvidence }
  | { readonly ok: false; readonly present: boolean; readonly path?: string; readonly reason: string }

/** One well-formedness question about a parsed value. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The options the single-path validator reads. */
interface EvidenceReadOptions {
  readonly expectedVersion: string
  readonly platform?: string
  readonly readFile?: (path: string) => string
}

/**
 * Read and validate ONE evidence file.
 *
 * This is the ONLY validator: the candidate order below decides WHICH file is tried, never
 * how lenient the checks are. A shipped artifact and the operator's own artifact are held to
 * exactly the same standard — kind, schema, pass, package version, platform, timestamp, test
 * list, command and counts — so "a file exists" is never mistaken for evidence.
 *
 * Failures are VALUES with a reason, never exceptions: a gate that throws on a malformed
 * file would crash the host, and one that silently treats a malformed file as evidence
 * would open the gate. Both are refused here with the reason spelled out.
 * @param path - the artifact to read.
 * @param options - the expected package version and platform, plus a file reader for tests.
 * @returns the check outcome for this path.
 */
function readConfinementEvidenceAt(path: string, options: EvidenceReadOptions): SinglePathCheck {
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

/**
 * Read and validate the evidence artifact, in priority order.
 *
 * THE RELEASE GATE MUST HAVE A RELEASE PATH. The operator's artifact (the env path, then the
 * standard home file) is authoritative while it is valid, but a host that was installed
 * normally has neither: requiring a wrapper launcher for the only path left the gate
 * effectively closed, and every version bump invalidated the home artifact (a 0.5.19
 * artifact blocked 0.5.66). The package therefore SHIPS its own artifact, recorded against
 * the release build, as the last candidate.
 *
 * Order: `DSH_PTC_CONFINEMENT_EVIDENCE` → `~/.dsh/ptc-confinement-evidence.json` → the
 * bundled `verification/ptc-confinement-evidence.json`.
 *
 * An EXPLICITLY configured path still fails closed against the HOME file: falling forward to
 * a different operator artifact would make the configuration meaningless. It does fall
 * forward to the SHIPPED artifact, which is the release's own evidence rather than a second
 * operator selection. The shipped artifact is never trusted on faith: the same version check
 * refuses one recorded for another build.
 * @param options - the environment, the expected package version, platform and candidate paths.
 * @returns the check outcome, naming the source that was accepted.
 */
export function checkConfinementEvidence(options: {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly expectedVersion: string
  readonly platform?: string
  readonly readFile?: (path: string) => string
  /** Standard local artifact when the environment names none; the runtime supplies the home file. */
  readonly defaultPath?: string
  /** The artifact the package ships, recorded against the release build. */
  readonly bundledPath?: string | undefined
}): ConfinementEvidenceCheck {
  const env = options.env ?? process.env
  const configured = env[CONFINEMENT_EVIDENCE_ENV]
  const configuredPath = configured !== undefined && configured.trim().length > 0 ? configured : undefined
  const candidates: { readonly path: string; readonly source: ConfinementEvidenceSource }[] = []
  if (configuredPath !== undefined) {
    candidates.push({ path: configuredPath, source: 'env' })
  } else if (options.defaultPath !== undefined && options.defaultPath.trim().length > 0) {
    candidates.push({ path: options.defaultPath, source: 'home' })
  }
  if (options.bundledPath !== undefined && options.bundledPath.trim().length > 0) {
    candidates.push({ path: options.bundledPath, source: 'bundled' })
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      present: false,
      reason: `no confinement evidence is configured (set ${CONFINEMENT_EVIDENCE_ENV} to the `
        + 'artifact written by scripts/record-confinement-evidence.mjs)',
    }
  }
  /**
   * The FIRST VALID candidate wins. A failure is remembered only so the refusal can name the
   * most authoritative defect instead of a generic one; a later candidate is still tried,
   * which is what makes a stale home artifact stop blocking a shipped release build.
   */
  let firstFailure: Extract<SinglePathCheck, { ok: false }> | undefined
  for (const candidate of candidates) {
    const outcome = readConfinementEvidenceAt(candidate.path, options)
    if (outcome.ok) {
      return { ok: true, path: outcome.path, source: candidate.source, evidence: outcome.evidence }
    }
    if (firstFailure === undefined) firstFailure = outcome
  }
  return firstFailure ?? {
    ok: false,
    present: false,
    reason: 'no confinement evidence artifact could be read',
  }
}
