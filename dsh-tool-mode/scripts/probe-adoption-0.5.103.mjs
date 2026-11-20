#!/usr/bin/env node
/**
 * Live/offline probe for the 0.5.103 task-turn digest build.
 *
 * WHAT THIS PROBE IS FOR
 *
 * 0.5.103 moved the auto-keep digest from the standing Tool Mode section to a
 * separately-sourced user message on the FIRST step of the FIRST turn (via
 * `agent/pre-step`), and reworded auto rows to "Verify its output on edge cases..."
 * (docs/auto-keep-plan.md, research/session-adoption/REPORT.md). This probe answers four
 * questions and refuses to answer a fifth:
 *
 *   1. Which version is on disk in the profile, and is the RUNNING host older than it?
 *   2. Is the host reachable, and how long did that take — measured independently of
 *      whether extension restore finished?
 *   3. Does a task-turn digest message actually reach a session on the RUNNING build?
 *      (Answered from the recorded session transcript, not from an assumption.)
 *   4. What authored artifacts exist, at which scope keys, and are they visible here?
 *   5. NOT answered: whether a fresh `tool_mode_run` mints a draft, and whether a promoted
 *      row is bindable in a program's binding set. Those need an in-process tool call on
 *      the 0.5.103 module graph. The probe reports them as PENDING with the exact calls.
 *
 * WHY "LOADED VERSION" IS NEVER ASSERTED
 *
 * A packed plugin takes effect only after a full DSH stop/start (plan: "Restart boundary").
 * Nothing on disk records which module graph a RUNNING process holds. What can be proven is
 * an ORDERING: if the installed package's mtime is LATER than the host process's creation
 * time, the running host cannot be executing that package. The probe reports that ordering
 * and the lower bound it implies ("older than 0.5.103"). It never prints "loaded 0.5.103".
 *
 * STATUS VOCABULARY (used for every check, so an absent result cannot look like a pass)
 *
 *   measured — a value was observed and is reported.
 *   absent   — a specific thing was searched for and not found. This is a RESULT.
 *   pending  — needs the 0.5.103 module graph (a restart), or an in-session call this
 *              script cannot make. Carries the exact commands that would settle it.
 *   failed   — the check could not run (timeout, unreadable file). Reported, never skipped.
 *
 * USAGE
 *
 *   node scripts/probe-adoption-0.5.103.mjs                  # offline checks + live plan
 *   node scripts/probe-adoption-0.5.103.mjs --json           # also write a JSON report
 *   node scripts/probe-adoption-0.5.103.mjs --session <id>   # inspect a specific session
 *   node scripts/probe-adoption-0.5.103.mjs --live           # refuse unless 0.5.103 is loaded
 *   node scripts/probe-adoption-0.5.103.mjs --observations research/adoption-live/observations-x.json
 *
 * The probe never writes outside research/adoption-live/, never starts or stops DSH, never
 * packs or installs, and never mutates the authoring store. `--live` only PRINTS the
 * in-session calls; it does not perform them.
 *
 * @module scripts/probe-adoption-0.5.103
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

/** The build this probe is written for. */
const TARGET_VERSION = '0.5.103'

/** Zstandard frame magic, little-endian. */
const ZSTD_MAGIC_LE = 0xFD2FB528

/** The exact auto-row wording 0.5.103 introduced; the pre-0.5.103 build used `Evidence:`. */
const DIGEST_UNVERIFIED_MARKER = 'Verify its output on edge cases'

/** A digest that names a callable artifact. */
const DIGEST_CALL_MARKER = 'Use agent_from_draft'

/** The repo root: this file's parent's parent. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Where reports and observations are allowed to land. */
const OUT_DIR = join(REPO_ROOT, 'research', 'adoption-live')

/** ------------------------------------------------------------------------- *
 * Small utilities
 * ------------------------------------------------------------------------- */

/**
 * Read and parse a JSON file.
 * @param {string} path
 * @returns {any | undefined} the parsed value, or undefined when absent/unreadable.
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** A file's mtime as an ISO string, or undefined. */
function mtimeOf(path) {
  try {
    return new Date(statSync(path).mtimeMs).toISOString()
  } catch {
    return undefined
  }
}

/** SHA-256 of a file, first 16 hex characters; undefined when absent. */
function hashOf(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
  } catch {
    return undefined
  }
}

/** Run a PowerShell one-liner and return trimmed stdout, or undefined on any failure. */
function powershell(script) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    })
    const trimmed = out.trim()
    return trimmed.length === 0 ? undefined : trimmed
  } catch {
    return undefined
  }
}

/**
 * Locate complete Zstandard frames in a concatenated-frame container.
 *
 * Ported from the DSH persistence backend (`packages/session/session-persistence-jsonl/
 * src/zstd.ts`), because the session log is a SEQUENCE of frames and a single
 * `zstdDecompress` returns only the first one — which silently reads a 137 MB transcript as
 * its 201-byte header. Walking the frame structure is what makes the read honest.
 * @param {Buffer} buffer
 * @returns {{ frames: {start: number, end: number}[], tornStart?: number }}
 */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC_LE) throw new Error(`invalid Zstandard frame magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const headerRest = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < headerRest) return { frames, tornStart: start }
    offset += headerRest
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved Zstandard block type at byte ${offset - 3}`)
      const payload = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payload) return { frames, tornStart: start }
      offset += payload
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/**
 * Decode a multi-frame Zstandard JSONL transcript to text.
 * @param {string} path
 * @returns {{ text: string, frames: number, torn: boolean }}
 */
function decodeTranscript(path) {
  const buffer = readFileSync(path)
  const { frames, tornStart } = scanZstdFrames(buffer)
  const parts = frames.map(frame => zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  return { text: Buffer.concat(parts).toString('utf8'), frames: frames.length, torn: tornStart !== undefined }
}

/** Every workspace session directory under the DSH session store. */
function sessionWorkspaceDirs(home) {
  const root = join(home, 'sessions')
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(root, entry.name))
  } catch {
    return []
  }
}

/**
 * Find a session transcript.
 * @param {string} home DSH home.
 * @param {string | undefined} sessionId explicit id, when supplied.
 * @returns {string | undefined} the transcript path.
 */
function findTranscript(home, sessionId) {
  const candidates = []
  for (const workspaceDir of sessionWorkspaceDirs(home)) {
    let entries = []
    try {
      entries = readdirSync(workspaceDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (sessionId !== undefined && !entry.name.endsWith(sessionId)) continue
      const file = join(workspaceDir, entry.name, 'session.v4.jsonl.zstd')
      if (existsSync(file)) candidates.push(file)
    }
  }
  if (candidates.length === 0) return undefined
  candidates.sort((left, right) => (mtimeOf(right) ?? '').localeCompare(mtimeOf(left) ?? ''))
  return candidates[0]
}

/** ------------------------------------------------------------------------- *
 * Checks
 * ------------------------------------------------------------------------- */

/**
 * Check 1: source, installed, boot ordering, loaded-version bound.
 *
 * The only defensible claim is an ORDERING. `loadedVerdict` is therefore one of
 * `older-than-target` (proven), `possibly-current` (installed before boot — necessary but
 * not sufficient), or `unknown`.
 */
function checkVersions() {
  const home = process.env['DSH_HOME']
  const profileDir = process.env['DSH_PROFILE_DIR']
  const sourcePkgPath = join(REPO_ROOT, 'packages', 'dsh-tool-mode', 'package.json')
  const installedPkgPath = profileDir === undefined
    ? undefined
    : join(profileDir, 'node_modules', '@try-works', 'dsh-tool-mode', 'package.json')

  const sourcePkg = readJson(sourcePkgPath)
  const installedPkg = installedPkgPath === undefined ? undefined : readJson(installedPkgPath)
  const installedAt = installedPkgPath === undefined ? undefined : mtimeOf(installedPkgPath)

  // Boot time comes from the OS process table. Startup logs are NOT a boot record: DSH only
  // writes one when startup FAILS, so a log timestamp is a failure dump, not a recent boot.
  const bootRaw = powershell(
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'dsh web' } | " +
    "Sort-Object CreationDate | Select-Object -First 1 | " +
    "ForEach-Object { $_.CreationDate.ToString('o') + '|' + $_.ProcessId }",
  )
  const [bootAt, bootPid] = bootRaw === undefined ? [undefined, undefined] : bootRaw.split('|')

  let loadedVerdict = 'unknown'
  let gapMs
  // The OS reports boot time with a LOCAL offset while the filesystem reports UTC. Both are
  // parsed as instants (correct), but the evidence prints UTC so a reader is not asked to
  // reconcile two zone spellings by hand.
  const bootAtUtc = bootAt === undefined ? undefined : new Date(bootAt).toISOString()
  if (bootAtUtc !== undefined && installedAt !== undefined) {
    gapMs = new Date(installedAt).getTime() - new Date(bootAtUtc).getTime()
    loadedVerdict = gapMs > 0 ? 'older-than-target' : 'possibly-current'
  }

  const libPath = installedPkgPath === undefined
    ? undefined
    : join(dirname(installedPkgPath), 'lib', 'index.js')

  return {
    id: 'versions',
    title: 'source / installed / boot ordering',
    status: installedPkg === undefined ? 'failed' : 'measured',
    detail: loadedVerdict === 'older-than-target'
      ? `installed ${installedPkg?.version} at ${installedAt}, but the host booted at ${bootAtUtc} (${Math.round((gapMs ?? 0) / 60000)} min EARLIER): the running graph cannot be ${installedPkg?.version}`
      : loadedVerdict === 'possibly-current'
        ? `installed ${installedPkg?.version} at ${installedAt}, before the host booted at ${bootAtUtc}: the install COULD be loaded, which a restart would still have to prove`
        : 'boot time or install time unavailable: the loaded version is unknown and is NOT guessed',
    evidence: {
      sourceVersion: sourcePkg?.version,
      sourceGitHead: powershell('git -C "' + REPO_ROOT + '" rev-parse --short HEAD'),
      installedVersion: installedPkg?.version,
      installedAt,
      installedLibHash: hashOf(libPath),
      repoLibHash: hashOf(join(REPO_ROOT, 'packages', 'dsh-tool-mode', 'lib', 'index.js')),
      targetVersion: TARGET_VERSION,
      bootAt,
      bootAtUtc,
      bootPid,
      loadedVerdict,
      gapMs,
    },
  }
}

/**
 * Check 2: auth/boot reachability, measured independently of extension restore.
 *
 * Reachability is an HTTP fact with a duration. Restore state is a DIFFERENT fact that this
 * probe only reports when it can see it directly; it is never inferred from the HTTP answer.
 */
async function checkAuth() {
  const webUrl = process.env['DSH_WEB_URL'] ?? 'http://127.0.0.1:3080'
  const home = process.env['DSH_HOME']
  const started = Date.now()
  let status
  let error
  try {
    const response = await fetch(webUrl, { signal: AbortSignal.timeout(15_000) })
    status = response.status
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  const elapsedMs = Date.now() - started

  // The newest startup log is a FAILURE dump when it exists at all; report it as such and
  // check whether it predates the current boot, rather than calling it the boot record.
  let startupLog
  if (home !== undefined) {
    const logDir = join(home, 'logs')
    try {
      const logs = readdirSync(logDir)
        .filter(name => name.startsWith('startup-') && name.endsWith('.log'))
        .map(name => join(logDir, name))
        .sort((left, right) => (mtimeOf(right) ?? '').localeCompare(mtimeOf(left) ?? ''))
      const newest = logs[0]
      if (newest !== undefined) {
        const head = readFileSync(newest, 'utf8').slice(0, 600)
        startupLog = {
          path: newest,
          at: mtimeOf(newest),
          isFailureDump: head.includes('startup failed'),
          mentionsRestore: /restore|verifyUnchanged/i.test(head),
        }
      }
    } catch {
      startupLog = undefined
    }
  }

  return {
    id: 'auth',
    title: 'auth/boot reachability (independent of restore)',
    status: status === undefined ? 'failed' : 'measured',
    detail: status === undefined
      ? `${webUrl} did not answer within 15 s: ${error}`
      : `${webUrl} answered HTTP ${status} in ${elapsedMs} ms. Extension restore was NOT consulted for this answer and is NOT claimed complete`,
    evidence: {
      webUrl,
      httpStatus: status,
      elapsedMs,
      error,
      startupLog: startupLog === undefined ? 'no startup log present' : startupLog,
      extensionRestoreObserved: startupLog?.mentionsRestore === true ? 'mentioned in the newest (failure) log' : 'not observed',
      assumption: 'none: reachability is an HTTP measurement, not a restore-complete signal',
    },
  }
}

/**
 * Check 3: is the task-turn digest actually present in a recorded session?
 *
 * Classification matters more than a count. On a build with the STANDING section only, the
 * text can appear inside assistant/tool payloads (an agent quoting it) while never appearing
 * as a `user/message` — which is exactly what the task-turn placement would produce. So the
 * check counts marker occurrences PER RECORD TYPE and singles out `user/message`.
 */
function checkDigest(sessionId) {
  const home = process.env['DSH_HOME']
  if (home === undefined) {
    return { id: 'digest', title: 'task-turn digest delivery', status: 'failed', detail: 'DSH_HOME is not set', evidence: {} }
  }
  const transcript = findTranscript(home, sessionId)
  if (transcript === undefined) {
    return { id: 'digest', title: 'task-turn digest delivery', status: 'failed', detail: 'no session transcript found', evidence: {} }
  }

  let decoded
  try {
    decoded = decodeTranscript(transcript)
  } catch (caught) {
    return {
      id: 'digest',
      title: 'task-turn digest delivery',
      status: 'failed',
      detail: `transcript could not be decoded: ${caught instanceof Error ? caught.message : String(caught)}`,
      evidence: { transcript },
    }
  }

  const byType = new Map()
  let userMessageHits = 0
  let firstAt
  let lastAt
  let records = 0
  let parsedFailures = 0
  for (const line of decoded.text.split('\n')) {
    if (line.trim().length === 0) continue
    records += 1
    if (!line.includes(DIGEST_UNVERIFIED_MARKER) && !line.includes(DIGEST_CALL_MARKER)) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      parsedFailures += 1
      continue
    }
    const type = String(record.type ?? 'unknown')
    byType.set(type, (byType.get(type) ?? 0) + 1)
    if (type === 'user/message') userMessageHits += 1
    // A record's time is an epoch-ms number when present. Number() is the parse: it maps the
    // absent/NaN case to a non-finite value instead of branching on a representation.
    const at = Number(record.time)
    if (Number.isFinite(at)) {
      firstAt ??= at
      lastAt = at
    }
  }

  const totalHits = [...byType.values()].reduce((sum, count) => sum + count, 0)
  return {
    id: 'digest',
    title: 'task-turn digest delivery',
    status: userMessageHits > 0 ? 'measured' : 'absent',
    detail: userMessageHits > 0
      ? `${userMessageHits} user/message record(s) carry the digest: the task-turn placement IS delivering on the running build`
      : totalHits > 0
        ? `the digest text appears in ${totalHits} record(s), but in NO user/message: it is being QUOTED (${[...byType.keys()].join(', ')}), not delivered as a first-step task message. Expected when the running build predates ${TARGET_VERSION}`
        : `neither the 0.5.103 wording nor a digest call shape appears in ${records} records: no digest reached this session`,
    evidence: {
      transcript,
      frames: decoded.frames,
      tornFinalFrame: decoded.torn,
      records,
      parsedFailures,
      marker: DIGEST_UNVERIFIED_MARKER,
      callMarker: DIGEST_CALL_MARKER,
      hitsByRecordType: Object.fromEntries(byType),
      userMessageHits,
      firstMarkerAt: firstAt === undefined ? undefined : new Date(firstAt).toISOString(),
      lastMarkerAt: lastAt === undefined ? undefined : new Date(lastAt).toISOString(),
    },
  }
}

/**
 * Check 4: authored artifacts on disk, their scopes, and whether they are visible HERE.
 *
 * "Advertised but not visible" is reported as a shape, not a verdict: a workspace row whose
 * scopeKey is another directory is CORRECTLY unresolvable from this one. The defect worth
 * naming is that such rows can still appear in this session's callable tool list.
 */
function checkArtifacts() {
  const home = process.env['DSH_HOME']
  const cwd = process.cwd()
  const normalise = value => String(value ?? '').toLowerCase().replace(/\\/g, '/')
  const statePath = home === undefined ? undefined : join(home, 'model-as-tool', 'agent-authoring.json')
  const state = statePath === undefined ? undefined : readJson(statePath)
  if (state === undefined) {
    return { id: 'artifacts', title: 'authored artifacts and scopes', status: 'failed', detail: 'agent-authoring.json not readable', evidence: {} }
  }
  const rows = []
  for (const kind of ['workflows', 'tools']) {
    for (const row of Array.isArray(state[kind]) ? state[kind] : []) {
      rows.push({
        kind,
        name: row.name,
        scope: row.scope,
        scopeKey: row.scopeKey,
        version: row.version,
        digest: row.digest === undefined ? undefined : String(row.digest).slice(0, 12),
        status: row.status,
        origin: row.origin,
        promotedFrom: row.promotedFrom === undefined ? undefined : { scope: row.promotedFrom.scope, version: row.promotedFrom.version },
        visibleFromCwd: row.scope !== 'workspace' ? undefined : normalise(row.scopeKey) === normalise(cwd),
      })
    }
  }
  const workspaceElsewhere = rows.filter(row => row.scope === 'workspace' && row.visibleFromCwd === false)
  return {
    id: 'artifacts',
    title: 'authored artifacts and scopes',
    status: 'measured',
    detail: `${rows.length} row(s); ${rows.filter(row => row.scope === 'workspace').length} workspace, ${rows.filter(row => row.promotedFrom !== undefined).length} promoted; ${workspaceElsewhere.length} workspace row(s) belong to OTHER directories (unresolvable here by design)`,
    evidence: { documentVersion: state.version, cwd, rows, workspaceElsewhere: workspaceElsewhere.map(row => row.name) },
  }
}

/**
 * Checks 5 + 6: the two things a Node script cannot do — mint a draft and test bindability.
 * They need an in-process tool call on the 0.5.103 graph, so they are reported PENDING with
 * the exact calls, and the restart that would enable them.
 */
function liveChecks(versions) {
  const needsRestart = versions.evidence.loadedVerdict === 'older-than-target'
  const common = {
    status: 'pending',
    evidence: {
      blockedBy: needsRestart
        ? `the running host predates ${TARGET_VERSION}; a full DSH stop/start is required before any 0.5.103 behavior can be observed`
        : 'in-process tool calls cannot be made from this script; run them in a live session',
    },
  }
  return [
    {
      ...common,
      id: 'draft',
      title: 'create a session auto-draft with tool_mode_run',
      detail: needsRestart
        ? 'PENDING: after the restart, run the call below and expect a NEW agent_from_draft_* row at session scope in this session'
        : 'PENDING: run the call below in a live session',
      evidence: {
        ...common.evidence,
        call: 'tool_mode_run({ code: "return { probe: Date.now() }", tools: [], description: "adoption probe 0.5.103" })',
        expect: 'a new agent_from_draft_<hash> appears in tool_mode_list with scope=session, and tool_mode_tools list (scope all) shows it',
        thenVerify: 'tool_mode_run({ probe: true, tools: ["<the new agent_from_draft_name>"] }) → resolved: true',
      },
    },
    {
      ...common,
      id: 'bindability',
      title: 'promoted workspace artifact bindable in a delegated binding set',
      detail: needsRestart
        ? 'PENDING: needs a 0.5.103 graph AND a caller whose workspaceKey matches the promoted row'
        : 'PENDING: needs a caller whose workspaceKey matches the promoted row',
      evidence: {
        ...common.evidence,
        prep: 'tool_mode_workflows({ action: "promote", name: "<name>", to: "workspace" }) from the owning session (or tool_mode_tools for an agent_ tool)',
        call: 'tool_mode_run({ probe: true, tools: ["<promoted name>"] })',
        expectBindable: 'preflight[0].resolved === true; then a real run declaring it must execute',
        observedFailureIfUnfixed: 'preflight[0].resolved === false with reason "not-visible-at-scope" (the U42 advertised-but-unbindable result)',
        delegatedCheck: 'repeat the SAME probe from a subagent session whose workspaceKey is that workspace: the binding set must include it',
      },
    },
  ]
}

/** ------------------------------------------------------------------------- *
 * Report
 * ------------------------------------------------------------------------- */

/** Print one aligned block per check. */
function printCheck(check) {
  const badge = check.status.toUpperCase().padEnd(8)
  console.log(`[${badge}] ${check.title}`)
  console.log(`           ${check.detail}`)
  for (const [key, value] of Object.entries(check.evidence)) {
    if (value === undefined) continue
    // One renderer for every evidence value. It inspects the ENCODING (is the result a quoted
    // JSON string?) rather than the runtime type, so numbers and arrays are never clipped.
    const encoded = JSON.stringify(value) ?? 'null'
    const quoted = encoded.startsWith('"') && encoded.endsWith('"')
    const rendered = (quoted ? encoded.slice(1, -1) : encoded).replace(/\\n/g, ' ')
    console.log(`           ${key}: ${rendered.length > 300 ? rendered.slice(0, 300) + '…' : rendered}`)
  }
  console.log('')
}

async function main() {
  const argv = process.argv.slice(2)
  const has = flag => argv.includes(flag)
  const valueOf = flag => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const versions = checkVersions()
  const auth = await checkAuth()
  const digest = has('--skip-transcript')
    ? { id: 'digest', title: 'task-turn digest delivery', status: 'pending', detail: 'skipped by --skip-transcript', evidence: {} }
    : checkDigest(valueOf('--session'))
  const artifacts = checkArtifacts()
  const live = liveChecks(versions)

  const observationsPath = valueOf('--observations')
  const observations = observationsPath === undefined ? undefined : readJson(observationsPath)

  const checks = [versions, auth, digest, artifacts, ...live]
  const counts = checks.reduce((acc, check) => ({ ...acc, [check.status]: (acc[check.status] ?? 0) + 1 }), {})

  console.log('=== probe: adoption / 0.5.103 ===')
  console.log(`target ${TARGET_VERSION}   node ${process.version}   repo ${REPO_ROOT}`)
  console.log(`cwd ${process.cwd()}`)
  console.log('')
  for (const check of checks) printCheck(check)

  if (observations !== undefined) {
    console.log('=== in-session observations (supplied, not produced by this script) ===')
    console.log(JSON.stringify(observations, null, 2).slice(0, 4000))
    console.log('')
  }

  const livePending = live.filter(check => check.status === 'pending').length
  console.log(`summary: ${JSON.stringify(counts)} livePending=${livePending}`)

  if (has('--live') && versions.evidence.loadedVerdict !== 'possibly-current') {
    console.log('')
    console.log('REFUSED --live: the running host is not running the installed build.')
    console.log('  1. stop DSH completely (the web host process, not just the browser tab)')
    console.log('  2. start DSH again')
    console.log('  3. re-run: node scripts/probe-adoption-0.5.103.mjs --live')
    console.log(`  4. only then do the PENDING calls above; until step 3, every 0.5.103 result is unknown`)
  }

  if (has('--json')) {
    mkdirSync(OUT_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const out = join(OUT_DIR, `probe-${stamp}.json`)
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), targetVersion: TARGET_VERSION, node: process.version, cwd: process.cwd(), checks, observations }, null, 2) + '\n', 'utf8')
    console.log(`json: ${out}`)
  }

  // Exit 0 only when nothing structural failed; exit 3 signals "live checks pending",
  // which is the expected state until the restart, and is not an error.
  if ((counts.failed ?? 0) > 0) process.exitCode = 1
  else if (livePending > 0) process.exitCode = 3
}

await main()
