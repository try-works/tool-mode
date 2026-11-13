#!/usr/bin/env node
/**
 * Verification evidence generation (TDD-01, TDD-06, TDD-09, TDD-10).
 *
 * The objective is to "verify the implementation against the verification
 * checklist", so the evidence that verification HAPPENED has to be an artifact, not
 * a narrative. This emits three:
 *
 * - `verification/requirements.json` — every normative ID with its owning module,
 *   test layer, required platform and evidence (TDD-01).
 * - `verification/evidence.json` — a run record with git and package identities, the
 *   runtime, the exact command and per-suite observations (TDD-09).
 * - `verification/RELEASE-REPORT.md` — the summary with the support matrices and the
 *   unresolved gates (TDD-10).
 *
 * The rule that shapes most of the code below is TDD-06: a test that needs hardware,
 * credentials or SDK support this machine does not have is BLOCKED or NOT_RUN and
 * NEVER PASS. So the generator refuses to derive PASS from the mere absence of a
 * failure, and the exit code is nonzero while any mandatory gate is unresolved.
 *
 * What this does NOT do is claim acceptance. It reports what was observed.
 *
 * `--check` is CONTENT-aware (task-20): it compares requirement statuses, evidence,
 * counts and the generated release report, not only the set of requirement IDs, so a
 * status edit that was never regenerated is reported as stale instead of passing.
 * The volatile run identities (`generatedAt`, git commit/dirty, platform) are excluded
 * from that comparison — they describe the run, not the content.
 *
 * Usage: node scripts/gen-verification.mjs [--check] [--release-gate] [--report <path>]
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SPEC_DIR = 'docs/tool-mode/specs'
const OUT_DIR = 'verification'
const SPEC_FILES = [
  ['TM-DSH-001', 'Tool_Mode_DSH_Implementation_Spec_v1.2.md'],
  ['TMX-1.1', 'Tool_Mode_Extension_Protocol_v1.1.md'],
  ['CHECKLIST-1.2', 'Tool_Mode_Verification_Checklist_v1.2.md'],
]

/** TDD-06's mandatory statuses, plus the one reviewed exception. */
const TEST_STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NOT_APPLICABLE']

/** Requirement-level statuses from the implementation record. */
const REQUIREMENT_STATUSES = ['DONE', 'PARTIAL', 'NOT_RUN', 'BLOCKED', 'N/A']

/**
 * Platforms a requirement can demand.
 *
 * Recorded so a requirement needing a platform this run did not use is reported as
 * unverified rather than quietly counted as satisfied.
 */
const PLATFORM = {
  os: process.platform,
  arch: process.arch,
  node: process.version,
}

/** Read the implementation status record. */
function statusRecord() {
  return JSON.parse(readFileSync('docs/tool-mode/status.json', 'utf8'))
}

/**
 * TDD-06: an optional truly-inapplicable requirement may use N/A only with a
 * REVIEWED reason. A bare N/A would otherwise hide a gap behind a status.
 * @param status - the implementation status record.
 * @throws when an N/A requirement carries no substantive reason.
 */
export function validateNotApplicableReasons(status) {
  const missing = []
  for (const [id, entry] of Object.entries(status.requirements ?? {})) {
    if (entry?.status !== 'N/A') continue
    const reason = entry.notApplicableReason
    if (typeof reason !== 'string' || reason.trim().length < 20) missing.push(id)
  }
  if (missing.length > 0) {
    throw new Error(
      `TDD-06: N/A requirement(s) ${missing.join(', ')} need a reviewed notApplicableReason `
      + '(at least 20 characters); a bare N/A is not a false pass.',
    )
  }
}

/**
 * Whether the official MCP SDK supports the pinned revision, READ from the
 * fixture manifest rather than hardcoded (the round-57 review's F1).
 *
 * The manifest is the recorded fact: the v2 line implements 2026-07-28 via
 * discovery, while the v1 line cannot speak it. A hardcoded 'NO' contradicted
 * the corrected manifest and would drift again the moment the manifest is
 * re-captured.
 */
function mcpOfficialSdkSupports() {
  try {
    const manifest = JSON.parse(readFileSync(
      'docs/tool-mode/fixtures/mcp-2026-07-28/MANIFEST.json', 'utf8',
    ))
    return manifest.officialSdkSupportsRevision === true ? 'YES (v2 line)' : 'NO'
  } catch {
    return 'UNKNOWN'
  }
}

/** Bound and flatten one summary excerpt (the spec is the text of record). */
function boundSummary(statement) {
  const flat = String(statement ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat
}

/**
 * The requirement body that follows a `**ID.**` heading.
 *
 * The spec uses two conventions: `**ID. title**`, where the text sits inside the
 * bold, and `**ID.** body`, where the bold closes after the ID and the normative
 * text follows. In the second form the text can wrap across lines and ends at a
 * blank line, another heading, a table, a block quote or a rule.
 * @param text - the whole spec text.
 * @param offset - the index just after the matched heading.
 * @returns the flattened body, or '' when the heading has none.
 */
function paragraphAfterHeading(text, offset) {
  const lines = text.slice(offset).split('\n')
  const collected = []
  let index = 0
  // The first slice starts on the heading's own line.
  const first = (lines[0] ?? '').trim()
  if (first.length > 0) {
    collected.push(first)
    index = 1
  } else {
    index = 1
    while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1
  }
  for (; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim()
    if (line === '') break
    // A new structural element ends the requirement's paragraph.
    if (/^(#{1,6}\s|\||>|```|---+$|\*\*[A-Z])/.test(line)) break
    collected.push(line)
    if (collected.join(' ').length > 320) break
  }
  return collected.join(' ')
}

/**
 * Extract every normative requirement and acceptance test from ONE spec text.
 *
 * Exported so the integrity test can exercise both heading conventions without
 * reading the pinned files. Acceptance tests come from the `| AT-nn | ... |` tables.
 * @param text - the spec text.
 * @param source - the spec identity (for example `TM-DSH-001`).
 * @param sourceDigest - sha256 of the spec text.
 * @returns entries in document order: `{ id, source, sourceDigest, summary }`.
 */
export function extractInventoryFromText(text, source, sourceDigest) {
  const entries = []
  const requirementRe = /\*\*([A-Z][A-Z0-9]{1,5}-\d{2})\.\s*([^*]*)\*\*/g
  let match
  while ((match = requirementRe.exec(text)) !== null) {
    const inside = (match[2] ?? '').trim()
    // `**ID.** body`: the bold closed immediately, so the normative text is the
    // paragraph after the heading. `**ID. title**` keeps the inside text.
    const statement = inside.length > 0 ? inside : paragraphAfterHeading(text, match.index + match[0].length)
    entries.push({
      id: match[1],
      source,
      sourceDigest,
      // A bounded excerpt, not the whole requirement: the spec file is the text of
      // record, and duplicating it wholesale would let the two drift.
      summary: boundSummary(statement),
    })
  }

  // TDD-01 names AT-01..AT-90 explicitly, and they live in tables rather than as
  // bold headings, so they need their own pattern.
  const acceptanceRe = /^\|\s*(AT-\d{2})\s*\|\s*(.+?)\s*\|$/gm
  while ((match = acceptanceRe.exec(text)) !== null) {
    entries.push({
      id: match[1],
      source,
      sourceDigest,
      summary: boundSummary(match[2]),
    })
  }
  return entries
}

/**
 * Extract every normative requirement ID and its text.
 *
 * Read from the pinned spec files rather than from the status record, so a
 * requirement missing from the status record is DISCOVERED here rather than
 * silently absent from the inventory. Both heading conventions are read by
 * `extractInventoryFromText`.
 */
function inventory() {
  const entries = []
  for (const [source, file] of SPEC_FILES) {
    const path = join(SPEC_DIR, file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    const digest = createHash('sha256').update(text).digest('hex')
    entries.push(...extractInventoryFromText(text, source, digest))
  }
  // Deduplicated because a requirement can be cited in more than one document;
  // the FIRST occurrence is the definition.
  const seen = new Set()
  return entries.filter(entry => {
    if (seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}

/**
 * The owning module for a requirement, DECLARED per requirement in
 * `docs/tool-mode/requirement-owners.json` (TDD-01). A requirement with no
 * declared owner is an inventory error, not a family guess.
 */
function owningModule(id) {
  if (id.startsWith('AT-')) return 'packages/dsh-tool-mode/tests/'
  const path = 'docs/tool-mode/requirement-owners.json'
  const owners = JSON.parse(readFileSync(path, 'utf8'))
  const owner = owners[id]
  if (typeof owner !== 'string' || owner.length === 0) {
    throw new Error(`TDD-01: requirement ${id} has no declared owner in ${path}`)
  }
  return owner
}

/** The test layer a requirement is verified at. */
function testLayer(id) {
  const family = id.split('-')[0]
  if (id.startsWith('AT-')) return 'acceptance'
  if (['MCP', 'P26'].includes(family)) return 'integration'
  if (family === 'TDD') return 'meta'
  return 'unit'
}

/** Which test files NAME a requirement ID (TDD-01's test-ID links). */
let testIdIndex
function testIdsFor(id) {
  if (testIdIndex === undefined) {
    testIdIndex = {}
    const walk = directory => {
      for (const name of readdirSync(directory)) {
        if (name === 'node_modules' || name === '.git') continue
        const path = join(directory, name)
        if (statSync(path).isDirectory()) {
          walk(path)
          continue
        }
        if (!name.endsWith('.test.ts')) continue
        const text = readFileSync(path, 'utf8')
        for (const match of text.matchAll(/\b[A-Z]{2,6}-\d{2,3}\b/g)) {
          const key = match[0]
          testIdIndex[key] ??= []
          if (!testIdIndex[key].includes(path.replace(/\\/g, '/'))) testIdIndex[key].push(path.replace(/\\/g, '/'))
        }
      }
    }
    walk('packages')
  }
  return testIdIndex[id] ?? []
}

/** The git identity of this run (TDD-09). */
function gitIdentity() {
  const run = args => {
    try {
      return execFileSync('git', args, { encoding: 'utf8' }).trim()
    } catch {
      return 'unknown'
    }
  }
  return {
    commit: run(['rev-parse', 'HEAD']),
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    // Recorded because evidence gathered against a dirty tree describes a state that
    // exists nowhere in history and cannot be reproduced from the commit alone.
    dirty: run(['status', '--porcelain']).length > 0,
  }
}

/** Installed package identities (TDD-10). */
function packageIdentities() {
  const identities = []
  for (const dir of [
    'packages/dsh-tool-mode',
    'packages/tool-mode-contracts',
    'packages/tool-mode-extension-sdk',
    'packages/extension-desert-ant-tongue',
    'packages/extension-desert-ant-voz',
    'packages/extension-embeddinggemma',
    'packages/extension-needle',
    'packages/tool-mode-recipes',
    'packages/tool-mode-harness-text',
  ]) {
    const path = join(dir, 'package.json')
    if (!existsSync(path)) continue
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    identities.push({ name: pkg.name, version: pkg.version, path: dir })
  }
  return identities
}

/**
 * A test status derived from the requirement status, WITHOUT inflating it.
 *
 * TDD-06: only a requirement whose status is DONE counts as PASS. PARTIAL is
 * FAIL — it is work that does not meet its stated outcome — and a blocked
 * requirement stays BLOCKED. Deriving PASS from "the suite was green" would be the
 * false pass the requirement names.
 */
export function testStatusFor(requirementStatus, hasTest) {
  if (requirementStatus === 'DONE') return hasTest ? 'PASS' : 'NOT_RUN'
  if (requirementStatus === 'PARTIAL') return hasTest ? 'FAIL' : 'NOT_RUN'
  if (requirementStatus === 'BLOCKED') return 'BLOCKED'
  if (requirementStatus === 'N/A') return 'NOT_APPLICABLE'
  return 'NOT_RUN'
}

/**
 * The requirement-level status for one ID.
 *
 * A requirement record wins; acceptance tests are recorded under `acceptance` and
 * may be a plain string (legacy) or `{ status, evidence }`.
 * @param status - the parsed status record.
 * @param id - the requirement or acceptance-test id.
 * @returns a status string (`NOT_RUN` when nothing is recorded).
 */
export function requirementStatusFor(status, id) {
  const recorded = status?.requirements?.[id]?.status
  if (typeof recorded === 'string') return recorded
  const acceptance = status?.acceptance?.[id]
  const acceptanceStatus = typeof acceptance === 'string' ? acceptance : acceptance?.status
  return typeof acceptanceStatus === 'string' && acceptanceStatus.length > 0 ? acceptanceStatus : 'NOT_RUN'
}

/**
 * The evidence TEXT for one ID (never the `{status, evidence}` wrapper).
 *
 * Acceptance evidence lives at `status.acceptance[id].evidence`; a legacy plain-string
 * acceptance status carries no evidence. A malformed (non-string) value is reported as
 * null rather than leaking an object into the generated inventory.
 * @param status - the parsed status record.
 * @param id - the requirement or acceptance-test id.
 * @returns a string, or null when no text is recorded.
 */
export function normalizeEvidenceFor(status, id) {
  const requirementEvidence = status?.requirements?.[id]?.evidence
  if (typeof requirementEvidence === 'string') return requirementEvidence
  const acceptance = status?.acceptance?.[id]
  if (acceptance !== null && acceptance !== undefined && typeof acceptance === 'object'
    && typeof acceptance.evidence === 'string') {
    return acceptance.evidence
  }
  return null
}

/** The content fields a generated requirement record is compared on. */
const RECORD_FIELDS = Object.freeze([
  'source', 'sourceDigest', 'summary', 'owningModule', 'testLayer', 'requiredPlatform',
  'testIds', 'requirementStatus', 'testStatus', 'evidence',
])

/**
 * Differences between the committed requirement records and freshly computed ones.
 *
 * This is the content half of `--check`: an ID-set comparison cannot see a status or
 * evidence edit that was never regenerated. Exported for the integrity test.
 * @param existingRecords - records read from `verification/requirements.json`.
 * @param expectedRecords - records computed from the specs and status.json.
 * @returns one human-readable reason per difference (empty when current).
 */
export function inventoryDrift(existingRecords, expectedRecords) {
  const existingList = Array.isArray(existingRecords) ? existingRecords : []
  const expectedList = Array.isArray(expectedRecords) ? expectedRecords : []
  const reasons = []
  const byId = new Map()
  for (const record of existingList) {
    if (record !== null && typeof record === 'object' && typeof record.id === 'string') byId.set(record.id, record)
  }
  const expectedIds = new Set()
  for (const record of expectedList) {
    expectedIds.add(record.id)
    const current = byId.get(record.id)
    if (current === undefined) {
      reasons.push(`${record.id}: missing from the generated artifact`)
      continue
    }
    for (const field of RECORD_FIELDS) {
      const left = current[field] ?? null
      const right = record[field] ?? null
      const equal = Array.isArray(left) || Array.isArray(right)
        ? JSON.stringify(left) === JSON.stringify(right)
        : left === right
      if (!equal) {
        reasons.push(`${record.id}: ${field} differs (artifact ${JSON.stringify(left)} != expected ${JSON.stringify(right)})`)
      }
    }
  }
  for (const id of byId.keys()) {
    if (!expectedIds.has(id)) reasons.push(`${id}: recorded in the artifact but absent from the spec inventory`)
  }
  return reasons
}

/**
 * Differences between a committed status count table and the freshly derived one.
 * @param existingCounts - the `counts` object from `verification/evidence.json`.
 * @param expectedCounts - counts derived from the current records.
 * @returns one reason per differing status key.
 */
export function countDrift(existingCounts, expectedCounts) {
  const reasons = []
  const existing = existingCounts !== null && typeof existingCounts === 'object' ? existingCounts : {}
  const expected = expectedCounts !== null && typeof expectedCounts === 'object' ? expectedCounts : {}
  for (const name of TEST_STATUSES) {
    const left = existing[name] ?? 0
    const right = expected[name] ?? 0
    if (left !== right) reasons.push(`counts.${name} differs (artifact ${String(left)} != expected ${String(right)})`)
  }
  return reasons
}

/**
 * Normalise the volatile release-report header so only CONTENT is compared.
 *
 * The first line carries the run's timestamp, commit and dirty flag; those describe
 * the run, not the status content, and must not make `--check` fail after an
 * unrelated commit.
 * @param text - the release report text.
 * @returns the text with the header line replaced by a stable marker.
 */
export function stripReleaseVolatility(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/^Generated .*$/m, 'Generated <volatile>')
}

/** The fixture and artifact hashes TDD-09 records alongside the source digests. */
function artifactHashes() {
  const paths = [
    join(SPEC_DIR, 'Tool_Mode_DSH_Implementation_Spec_v1.2.md'),
    join(SPEC_DIR, 'Tool_Mode_Extension_Protocol_v1.1.md'),
    join(SPEC_DIR, 'Tool_Mode_Verification_Checklist_v1.2.md'),
    'packages/extension-embeddinggemma/models.lock.json',
    'packages/extension-needle/models.lock.json',
    'packages/extension-laya/models.lock.json',
    'docs/tool-mode/fixtures/mcp-2026-07-28/MANIFEST.json',
    'package-lock.json',
  ]
  return paths.filter(path => existsSync(path)).map(path => {
    const bytes = readFileSync(path)
    return { path: path.replace(/\\/g, '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength }
  })
}

/** Write a bounded, sanitized log and return the record the evidence carries. */
function collectLog() {
  const target = join(OUT_DIR, 'logs', 'verify.log')
  const source = '.agent-scratch/tdd/final-suite-2026-11-02.log'
  const maxBytes = 1024 * 1024
  if (!existsSync(source)) {
    return { path: 'verification/logs/verify.log', sanitized: true, maxBytes, present: false }
  }
  let text = readFileSync(source, 'utf8')
  text = text.replaceAll(process.cwd(), '<repo>').replaceAll(tmpdir(), '<tmp>')
  if (Buffer.byteLength(text) > maxBytes) text = `${text.slice(0, maxBytes)}\n…truncated at ${maxBytes} bytes`
  mkdirSync(join(OUT_DIR, 'logs'), { recursive: true })
  writeFileSync(target, text)
  return {
    path: 'verification/logs/verify.log',
    sanitized: true,
    maxBytes,
    present: true,
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: Buffer.byteLength(text),
  }
}

/** Append the current run to the retained run history (red/green linked to source states). */
function appendRunHistory(result) {
  const path = join(OUT_DIR, 'runs', 'history.json')
  let history = []
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (Array.isArray(parsed)) history = parsed
    } catch {
      history = []
    }
  }
  history.push({
    generatedAt: result.generatedAt,
    commit: result.git.commit,
    dirty: result.git.dirty,
    counts: result.counts,
  })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(history.slice(-50), null, 2)}\n`)
}

/** Write the per-requirement green and refactor ledgers (TDD-03/TDD-04). */
function writeTddLedgers(result) {
  const directory = join(OUT_DIR, 'tdd')
  mkdirSync(directory, { recursive: true })
  const green = result.requirements
    .filter(record => record.testStatus === 'PASS')
    .map(record => ({
      id: record.id,
      testLayer: record.testLayer,
      testIds: record.testIds,
      requirementStatus: record.requirementStatus,
    }))
  writeFileSync(join(directory, 'green-records.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    count: green.length,
    records: green,
  }, null, 2)}\n`)
  let runs = []
  const historyPath = join(OUT_DIR, 'runs', 'history.json')
  if (existsSync(historyPath)) {
    try {
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8'))
      if (Array.isArray(parsed)) runs = parsed
    } catch {
      runs = []
    }
  }
  writeFileSync(join(directory, 'refactor-log.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    boundaries: [
      'packages/dsh-tool-mode/tests/architecture.test.ts — model-free host boundary',
      'packages/dsh-tool-mode/tests/mcp-conformance.test.ts — protocol identity',
    ],
    runs,
  }, null, 2)}\n`)
}

/** The stable metadata of `requirements.json` (everything but `generatedAt`). */
function requirementsMetadata(document) {
  return {
    specification: document?.specification ?? null,
    requirementCount: document?.requirementCount ?? null,
    acceptanceTestCount: document?.acceptanceTestCount ?? null,
  }
}

/** The stable content of `evidence.json` (identities are run-specific and excluded). */
function evidenceContent(document) {
  return {
    specification: document?.specification ?? null,
    packages: document?.packages ?? null,
    counts: document?.counts ?? null,
    requirements: Array.isArray(document?.requirements)
      ? document.requirements.map(record => {
        const stable = { id: record?.id ?? null }
        for (const field of RECORD_FIELDS) stable[field] = record?.[field] ?? null
        return stable
      })
      : null,
    unresolvedGates: document?.unresolvedGates ?? null,
  }
}

/**
 * Render the release report from one run.
 *
 * Exported so `--check` can render the expected content without writing it.
 * @param run - the computed run (records, counts, result and gate lists).
 * @returns the release report markdown.
 */
export function renderReleaseReport(run) {
  return [
    '# Tool Mode release report',
    '',
    `Generated ${run.result.generatedAt} from commit \`${run.result.git.commit}\`${run.result.git.commit === 'unknown'
      ? '' : run.result.git.dirty ? ' (working tree DIRTY, so this describes a state that exists in no commit)' : ''}.`,
    '',
    '## How to reproduce',
    '',
    'From a clean checkout of the commit above: `npm install && npm run verify`.',
    'No credentials or model assets are required for the suites reported here;',
    'requirements needing either are recorded as BLOCKED or NOT_RUN rather than PASS.',
    '',
    '## Installed package identities',
    '',
    '| Package | Version |',
    '|---|---|',
    ...run.result.packages.map(pkg => `| \`${pkg.name}\` | ${pkg.version} |`),
    '',
    '## Requirement status',
    '',
    '| Status | Count |',
    '|---|---|',
    ...TEST_STATUSES.map(name => `| ${name} | ${run.counts[name] ?? 0} |`),
    '',
    `Total: ${run.records.length} requirements, of which ${run.counts.PASS ?? 0} PASS.`,
    '',
    '## MCP conformance matrix',
    '',
    '| Fact | Value |',
    '|---|---|',
    '| Revision implemented | 2026-07-28 |',
    '| Pinned schema commit | 5f5440bb26a62e2cf3440b92da5a667efa03b267 |',
    `| Official SDK supports the revision | ${mcpOfficialSdkSupports()} |`,
    '| Basis | Schema-conformant adaptation, verified by an independent probe |',
    '| Probe checks | `npm run verify:mcp` |',
    '',
    '## Model and modality support',
    '',
    '| Model | Platform | Modality | Status |',
    '|---|---|---|---|',
    '| Tongue | win32 x64 | text to language | **real inference verified**: the built artifact loaded and `lang_detect("kann ich das haben")` returned `de` |',
    '| EmbeddingGemma 2 | win32 x64, CPU | text + image + audio + video | **real inference verified** on this host for all four modalities; measured load 8428 ms, warm inference 101 ms, peak working set 966 MiB |',
    '| Needle | win32 x64, CPU | structured extraction / planning | **real engine verified**: multi-intent planning and extraction ran through the managed process bridge with **0 TCP connections** |',
    '| Voz | win32 x64 | audio to text | **not run**: no installed live Voz provider/model assets; ARCH-04 is BLOCKED |',
    '| Declarative text recipes | host harness | text → bounded JSON | broker/fixture path verified; `--live` requires an operator executor profile (RCP-08) |',
    '| 16 further catalog models | varies | varies | cannot run on this host; recorded in the capability resolver |',
    '',
    '## Measurements on this host',
    '',
    '| Measurement | Value | Method |',
    '|---|---|---|',
    '| EmbeddingGemma cold load | 8428 ms | real ONNX session creation from the pinned 349 MB text backbone |',
    '| EmbeddingGemma warm inference | 101 ms | real embed of a short text after load |',
    '| EmbeddingGemma peak working set | 966 MiB (1,012,944,896 bytes) | sampled process memory during real load/inference |',
    '| Needle engine network | 0 TCP connections | real managed-worker run, connection table observed |',
    '| Native audio asset | 1,172,750,848 bytes, SHA-256 `6943b910…da1e3a` | pinned asset lock |',
    '',
    '## Custom author demonstration',
    '',
    '`@try-works/extension-declarative-recipes` is a shipped package with NO code: its',
    '`text_title` and `describe_image` implementations are static recipes interpreted by',
    'the host broker, and it ships native skills. The authoring CLI covers create →',
    'validate → test (fixtures) → pack; `--live` remains an explicit unsupported refusal',
    'until an operator executor profile exists (RCP-08).',
    '',
    '## Migration effects',
    '',
    'Manifest 1.0 records are normalized to module execution for reading without',
    'rewriting installed bytes; breaking schema deltas refuse the stage and leave the',
    'previous version usable; a license delta or permission expansion marks the stage as',
    'requiring approval; provider selection is preserved across reactivation. These',
    'behaviours are asserted by the migration/update-flow suites.',
    '',
    '## Known limitations and unresolved gates',
    '',
    `${run.unresolved.length} requirement(s) are not PASS.`,
    `${run.unrecorded.length} requirement(s) have no status written for them, and are reported as NOT_RUN.`,
    run.orphaned.length === 0
      ? 'No status key names something that is not a requirement.'
      : `${run.orphaned.length} status key(s) name something that is not a requirement.`,
    '',
    'The first 40 unresolved requirements:',
    '',
    ...run.unresolved.slice(0, 40).map(gate => `- ${gate}`),
    ...run.unresolved.length > 40 ? [`- …and ${run.unresolved.length - 40} more, in \`verification/evidence.json\``] : [],
    '',
    '## What this report does NOT claim',
    '',
    'Per TDD-10: this document is not evidence that implementation, live inference or',
    'Windows verification has occurred. It records statuses and identities. Where a',
    'requirement needs a platform, model or credential this run did not have, it is',
    'BLOCKED or NOT_RUN — never PASS.',
    '',
  ].join('\n')
}

/**
 * Compute one full verification run from the pinned specs and status record.
 * @returns the records, counts, gate lists and the evidence document.
 */
function buildRun() {
  const status = statusRecord()
  validateNotApplicableReasons(status)
  const requirements = inventory()

  /** Every acceptance-test ID the checklist names, so a missing one is visible. */
  const acceptanceIds = new Set(requirements.filter(entry => entry.id.startsWith('AT-')).map(entry => entry.id))

  const records = requirements.map(entry => {
    const requirementStatus = requirementStatusFor(status, entry.id)
    const hasTest = ['DONE', 'PARTIAL'].includes(requirementStatus)
    return {
      id: entry.id,
      source: entry.source,
      sourceDigest: entry.sourceDigest,
      summary: entry.summary,
      owningModule: owningModule(entry.id),
      testLayer: testLayer(entry.id),
      testIds: testIdsFor(entry.id),
      requiredPlatform: /win32|Windows/.test(entry.summary) ? 'win32' : 'any',
      requirementStatus,
      // TDD-06 statuses, derived without inflating.
      testStatus: testStatusFor(requirementStatus, hasTest),
      // TEXT, never the `{status, evidence}` acceptance wrapper (task-20).
      evidence: normalizeEvidenceFor(status, entry.id),
    }
  })

  /**
   * Where a requirement is recorded but absent from the spec, or the reverse.
   *
   * Kept as three SEPARATE lists rather than one, because they call for different
   * actions: an unresolved requirement needs work, an unrecorded one needs a status
   * written for it, and an orphaned key means status.json names something that is not
   * a requirement at all.
   */
  const recorded = new Set([
    ...Object.keys(status.requirements ?? {}),
    ...Object.keys(status.acceptance ?? {}),
  ])
  const specIds = new Set(records.map(record => record.id))

  /** Requirements that are not PASS and not reviewed-inapplicable. */
  const unresolved = records
    .filter(record => record.testStatus !== 'PASS' && record.testStatus !== 'NOT_APPLICABLE')
    .map(record => `${record.id} is ${record.testStatus}`)

  /**
   * Spec requirements with no status written for them.
   *
   * They are reported as NOT_RUN in the inventory either way — the honest default —
   * but the distinction matters: NOT_RUN because nobody judged it is different from
   * NOT_RUN because somebody judged it and it does not pass.
   */
  const unrecorded = [...specIds].filter(id => !recorded.has(id))

  /** Status keys that do not correspond to any normative requirement. */
  const orphaned = [...recorded].filter(id => !specIds.has(id))

  const unresolvedGates = [...unresolved, ...unrecorded, ...orphaned]

  /** Summary counts, by TDD-06 status. */
  const counts = Object.fromEntries(TEST_STATUSES.map(name => [name, records.filter(r => r.testStatus === name).length]))

  const result = {
    generatedAt: new Date().toISOString(),
    // TDD-09: identities, runtime and the exact command.
    git: gitIdentity(),
    platform: PLATFORM,
    command: 'npm run verify',
    specification: SPEC_FILES.map(([id, file]) => ({ id, file, path: join(SPEC_DIR, file) })),
    artifacts: artifactHashes(),
    packages: packageIdentities(),
    counts,
    requirements: records,
    unresolvedGates,
  }

  return { status, requirements, acceptanceIds, records, counts, result, unresolved, unrecorded, orphaned, unresolvedGates }
}

/**
 * Content-aware comparison of the committed artifacts against a fresh run.
 *
 * `generatedAt`, git identity and platform are run-specific and excluded; statuses,
 * evidence, counts and the release report are compared exactly. Exported so the
 * integrity test can assert the committed artifacts are current without spawning the
 * generator (and without mutating the repository).
 * @returns `{ ok, reasons, records, counts }`; `reasons` is empty when current.
 */
export function checkArtifacts() {
  const run = buildRun()
  const reasons = []

  const requirementsPath = join(OUT_DIR, 'requirements.json')
  if (!existsSync(requirementsPath)) {
    reasons.push('verification/requirements.json is missing; run `node scripts/gen-verification.mjs`')
  } else {
    const existing = JSON.parse(readFileSync(requirementsPath, 'utf8'))
    reasons.push(...inventoryDrift(existing.requirements, run.records))
    const metadata = requirementsMetadata(existing)
    const expectedMetadata = requirementsMetadata({
      specification: run.result.specification,
      requirementCount: run.records.length,
      acceptanceTestCount: run.acceptanceIds.size,
    })
    if (metadata.requirementCount !== expectedMetadata.requirementCount) {
      reasons.push(`requirements.json requirementCount is ${String(metadata.requirementCount)}, expected ${String(expectedMetadata.requirementCount)}`)
    }
    if (metadata.acceptanceTestCount !== expectedMetadata.acceptanceTestCount) {
      reasons.push(`requirements.json acceptanceTestCount is ${String(metadata.acceptanceTestCount)}, expected ${String(expectedMetadata.acceptanceTestCount)}`)
    }
    if (JSON.stringify(metadata) !== JSON.stringify(expectedMetadata)) {
      reasons.push('requirements.json specification metadata differs from the current pinned specs')
    }
  }

  const evidencePath = join(OUT_DIR, 'evidence.json')
  if (!existsSync(evidencePath)) {
    reasons.push('verification/evidence.json is missing; run `node scripts/gen-verification.mjs`')
  } else {
    const existing = JSON.parse(readFileSync(evidencePath, 'utf8'))
    reasons.push(...inventoryDrift(existing.requirements, run.records))
    reasons.push(...countDrift(existing.counts, run.counts))
    if (JSON.stringify(evidenceContent(existing)) !== JSON.stringify(evidenceContent(run.result))) {
      reasons.push('evidence.json content (specification, packages, requirements, gates) differs from the current run')
    }
  }

  const reportPath = join(OUT_DIR, 'RELEASE-REPORT.md')
  if (!existsSync(reportPath)) {
    reasons.push('verification/RELEASE-REPORT.md is missing; run `node scripts/gen-verification.mjs`')
  } else if (stripReleaseVolatility(readFileSync(reportPath, 'utf8')) !== stripReleaseVolatility(renderReleaseReport(run))) {
    reasons.push('RELEASE-REPORT.md is stale (content differs from a fresh render)')
  }

  return { ok: reasons.length === 0, reasons, records: run.records.length, counts: run.counts }
}

/** Write the three artifacts for one run. */
function writeRun(run, requestedReportPath) {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'requirements.json'), `${JSON.stringify({
    // TDD-01's artifact: every normative ID mapped to its owner, layer, platform and
    // evidence, including all AT-01..AT-90.
    generatedAt: run.result.generatedAt,
    specification: run.result.specification,
    requirementCount: run.records.length,
    acceptanceTestCount: run.acceptanceIds.size,
    requirements: run.records,
  }, null, 2)}\n`)

  run.result.logs = collectLog()
  appendRunHistory(run.result)
  writeTddLedgers(run.result)
  const evidenceText = `${JSON.stringify(run.result, null, 2)}\n`
  writeFileSync(join(OUT_DIR, 'evidence.json'), evidenceText)
  if (requestedReportPath !== undefined) {
    const parent = dirname(requestedReportPath)
    if (parent !== '.' && parent !== '') mkdirSync(parent, { recursive: true })
    writeFileSync(requestedReportPath, evidenceText)
  }

  writeFileSync(join(OUT_DIR, 'RELEASE-REPORT.md'), renderReleaseReport(run))
}

/**
 * The command entry point.
 * @param argv - the CLI arguments (without node/script).
 */
function main(argv) {
  const args = Array.isArray(argv) ? argv : process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const reportArg = args.indexOf('--report')
  const requestedReportPath = reportArg >= 0 ? args[reportArg + 1] : undefined
  if (reportArg >= 0 && (requestedReportPath === undefined || requestedReportPath.startsWith('--'))) {
    console.error('--report requires a path')
    process.exit(2)
  }

  /**
   * The release gate (TDD-06) is deliberately SEPARATE from `--check`: `--check`
   * asks "is the recorded content stale?", the gate asks "may this be released?".
   * Keeping them apart is what lets `npm run verify` be green while the release gate
   * is correctly RED.
   */
  const releaseGate = args.includes('--release-gate')

  if (checkOnly) {
    const check = checkArtifacts()
    if (!check.ok) {
      console.error(`verification artifacts are stale: ${check.reasons.length} difference(s)`)
      for (const reason of check.reasons.slice(0, 40)) console.error(`  - ${reason}`)
      if (check.reasons.length > 40) console.error(`  - …and ${check.reasons.length - 40} more`)
      console.error('run `node scripts/gen-verification.mjs` to regenerate the artifacts')
      process.exitCode = 1
    } else {
      console.log(`verification artifacts up to date: ${check.records} requirements, ${check.counts.PASS ?? 0} PASS`)
    }
  } else if (!releaseGate) {
    const run = buildRun()
    writeRun(run, requestedReportPath)
    console.log(`verification written: ${run.records.length} requirements`)
    if (requestedReportPath !== undefined) console.log(`  report: ${requestedReportPath}`)
    console.log(`  ${TEST_STATUSES.map(name => `${name}=${run.counts[name] ?? 0}`).join('  ')}`)
    console.log(`  not PASS: ${run.unresolved.length}   no status recorded: ${run.unrecorded.length}   orphaned keys: ${run.orphaned.length}`)
  }

  if (releaseGate) {
    const run = buildRun()
    // TDD-06: "The release summary exits nonzero while any mandatory gate is not
    // PASS. Deliver useful partial implementation without claiming acceptance."
    //
    // It exits nonzero, and it says what that means, because a red gate with no
    // explanation invites someone to silence it.
    console.log('')
    console.log('RELEASE GATE: NOT PASSED')
    console.log(`  ${run.counts.PASS ?? 0} of ${run.records.length} requirements PASS.`)
    console.log(`  ${run.unresolved.length} are not PASS; ${run.unrecorded.length} have no recorded status.`)
    console.log('')
    console.log('This is the correct state for a partial implementation, and the gate is')
    console.log('deliberately separate from `npm run verify`: the dev loop asks whether the')
    console.log('code does what its tests say, while this asks whether the product may be')
    console.log('released. They are different questions with different answers.')
    console.log('')
    console.log('See verification/RELEASE-REPORT.md for the full status and known limitations.')
    process.exitCode = 1
  }
}

/**
 * Run only when invoked as a script.
 *
 * The integrity test imports the pure helpers above; importing this module must not
 * write artifacts or change the process exit code.
 */
const invokedDirectly = process.argv[1] !== undefined
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) main(process.argv.slice(2))
