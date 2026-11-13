#!/usr/bin/env node
/**
 * Exercise the two COMPOSED Tool Mode flows end to end, in-process.
 *
 * There is no cross-extension composite tool: each flow is a SEQUENCE the agent
 * composes out of independent tools, and the ordering and thresholds are CALLER
 * policy — no tool calls another tool. This script plays the caller. It mounts the
 * host plugin in this process (extension store + verified asset cache + first-party
 * source directory), installs / prepares / enables the extensions a flow needs from
 * source into a FRESH scratch store, and then dispatches each call through the real
 * `ctx.tools.execute` registry pipeline, printing one JSON line per call.
 *
 * Flow 1 (audio locate -> transcribe -> compare):
 *   media_find_moments   (EmbeddingGemma, audio windows ranked by cosine)
 *   -> caller materializes the located window as a WAV (stt_transcribe takes no range)
 *   -> stt_transcribe    (Desert Ant Voz, on the window)
 *   -> semantic_similarity (transcript vs the original query)
 *
 * Flow 2 (semantic gate):
 *   semantic_similarity  (two texts)
 *   -> the CALLER compares the score with its own threshold (policy, not model output)
 *   -> decision_test     (Laya) only when the caller's gate opens; advisory evidence,
 *      never the gate itself
 *   -> a negative control pair whose gate stays closed (no decision_test call)
 *
 * What this proves: the real engines run under the host's registry pipeline, the
 * declared contracts are enforced, and the composition an agent would perform
 * returns real results. What it does NOT prove: retrieval quality on a real corpus,
 * calibrated probabilities (Laya's confidence is EXPLICITLY uncalibrated), or that
 * every tool carries a host receipt in its result (see the receipt note below).
 *
 * Receipts: the host stamps the reserved `meta` envelope — and records the
 * invocation receipt — only when the tool's DECLARED output schema requires `meta`.
 * Of these calls only `semantic_similarity` does, so it is the only one whose
 * `meta.receiptId` travels with the result; the other three print `receiptId: null`
 * with the reason. Nothing here invents a receipt that the host did not author.
 *
 * Usage:
 *   node scripts/verify-flows.mjs [--store-root D:/DEV/verify-flows]
 *     [--cache E:/dsh-asset-cache] [--threshold 0.75] [--flow 1] [--audio <abs path>]
 *
 * Exit codes:
 *   0  every requested flow produced real results
 *   1  a flow failed (the exact failing call and its error are printed)
 *   2  bad usage
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../packages/dsh-tool-mode/lib/index.js'

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

/** First-party sources, resolved from this checkout — nothing is fetched from npm. */
const EXTENSION_SOURCES = {
  '@try-works/extension-embeddinggemma': join(PACKAGES_DIR, 'extension-embeddinggemma'),
  '@try-works/extension-desert-ant-voz': join(PACKAGES_DIR, 'extension-desert-ant-voz'),
  '@try-works/extension-laya': join(PACKAGES_DIR, 'extension-laya'),
}

/** The fixture candidates, in preference order: real speech, then longer corpora. */
const FIXTURE_CANDIDATES = [
  'docs/tool-mode/qualification/.voz-wavs-10200/english.wav',
  'docs/tool-mode/qualification/.voz-wavs-3084/english.wav',
  '.tmp-real-corpus/aids-prevention-s120.wav',
  '.tmp-real-corpus/imf-spoken-word.wav',
]

const QUERY_TEXT = 'The quick brown fox jumps over the lazy dog.'
const FLOW2_POSITIVE = {
  a: 'The quick brown fox jumps over the lazy dog.',
  b: 'A quick brown fox is jumping over a lazy dog.',
}
const FLOW2_NEGATIVE = 'Quarterly revenue grew twelve percent year over year.'

/** A flow stopped for a reason the caller can act on; carries no stack noise. */
class FlowFailure extends Error {
  name = 'FlowFailure'
}

/** One JSON line per record: the run output is machine-readable end to end. */
function emit(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`)
}

/** The message of anything thrown, without the `Error: ` envelope games. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Read `--key value` (and bare `--key` as true) from argv. */
function readArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      values.set(key, true)
    } else {
      values.set(key, next)
      index += 1
    }
  }
  return values
}

const args = readArgs(process.argv.slice(2))
const STORE_ROOT = resolve(String(args.get('store-root') ?? 'D:/DEV/verify-flows'))
const ASSET_CACHE = resolve(String(args.get('cache') ?? 'E:/dsh-asset-cache'))
const THRESHOLD = Number(args.get('threshold') ?? 0.75)
const ONLY_FLOW = args.get('flow') === undefined ? undefined : Number(args.get('flow'))
const AUDIO_OVERRIDE = args.get('audio') === undefined ? undefined : String(args.get('audio'))

if (!Number.isFinite(THRESHOLD) || THRESHOLD < -1 || THRESHOLD > 1) {
  process.stderr.write('--threshold must be a finite cosine threshold in [-1, 1]\n')
  process.exit(2)
}
if (ONLY_FLOW !== undefined && ONLY_FLOW !== 1 && ONLY_FLOW !== 2) {
  process.stderr.write('--flow must be 1 or 2\n')
  process.exit(2)
}

/** One unique run directory: every store this run uses is fresh by construction. */
const RUN_STAMP = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`
const RUN_ROOT = join(STORE_ROOT, `run-${RUN_STAMP}`)

/** Free bytes at the scratch volume, so a disk limit is visible before it fails. */
function scratchFreeBytes() {
  try {
    const stats = statfsSync(existsSync(STORE_ROOT) ? STORE_ROOT : REPO_ROOT)
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

/**
 * Remove the abandoned run directories an earlier invocation left behind.
 *
 * A store is NOT small: installing an extension from source copies its runtime
 * dependencies beside it (about 1 GB for the EmbeddingGemma tree), and the scratch
 * volume is finite — the third unpruned run of this verifier hit ENOSPC mid-install
 * and the process died with a Windows fail-fast before printing a line. Only
 * directories directly under the store root whose name starts with `run-` are
 * removed, the resolved parent must be the store root, and directories touched in
 * the last hour are left alone so a concurrent invocation cannot be sabotaged.
 */
function pruneAbandonedRuns() {
  if (!existsSync(STORE_ROOT)) return []
  const removed = []
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const entry of readdirSync(STORE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('run-')) continue
    const target = join(STORE_ROOT, entry.name)
    if (dirname(target) !== STORE_ROOT) continue
    try {
      if (statSyncSafe(target) >= cutoff) continue
      rmSync(target, { recursive: true, force: true })
      removed.push(entry.name)
    } catch {
      // A directory that cannot be pruned is NOT a reason to fail the run; the
      // preparation's own free-space preflight will name the shortage if it bites.
    }
  }
  return removed
}

/** Modification time in milliseconds, or 0 when it cannot be read. */
function statSyncSafe(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Parse a RIFF/WAVE header by walking its chunks.
 *
 * Chunk walking rather than fixed offsets: the fixtures are 16-bit PCM WAVs whose
 * `fmt ` chunk is 18 bytes and whose `data` chunk moves accordingly, and a fixed
 * offset reads the wrong bytes on exactly those files.
 * @param bytes - the whole file.
 * @returns the format fields the slicer and the report need.
 */
function parseWav(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new FlowFailure('the audio fixture is not a RIFF/WAVE file')
  }
  let format
  let channels
  let sampleRate
  let bitsPerSample
  let dataOffset
  let dataBytes
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      format = bytes.readUInt16LE(offset + 8)
      channels = bytes.readUInt16LE(offset + 10)
      sampleRate = bytes.readUInt32LE(offset + 12)
      bitsPerSample = bytes.readUInt16LE(offset + 22)
    } else if (id === 'data') {
      dataOffset = offset + 8
      // A streaming writer may leave 0xFFFFFFFF; the rest of the file is the data.
      dataBytes = Math.min(size === 0xffffffff ? bytes.length - dataOffset : size, bytes.length - dataOffset)
    }
    offset += 8 + size + (size % 2)
  }
  if (format === undefined || dataOffset === undefined) {
    throw new FlowFailure('the audio fixture has no fmt/data chunk pair')
  }
  if (format !== 1 || bitsPerSample !== 16) {
    throw new FlowFailure(`the verifier's slicer supports 16-bit PCM only; this fixture is format ${format}, ${bitsPerSample} bit`)
  }
  const blockAlign = channels * (bitsPerSample / 8)
  return {
    format,
    channels,
    sampleRate,
    bitsPerSample,
    dataOffset,
    dataBytes,
    blockAlign,
    durationSeconds: dataBytes / (sampleRate * blockAlign),
  }
}

/**
 * Materialize one time range of a PCM WAV as its own file.
 *
 * stt_transcribe's contract takes a PATH, not a range, so the caller — not a tool —
 * has to produce the window it wants transcribed. That is part of the composition,
 * and it is pure PCM arithmetic: no re-encoding, no resampling.
 * @param sourcePath - the fixture.
 * @param targetPath - where the window is written.
 * @param startSeconds - the range start.
 * @param endSeconds - the range end.
 * @returns the written file's format and frame count.
 */
function sliceWav(sourcePath, targetPath, startSeconds, endSeconds) {
  const source = readFileSync(sourcePath)
  const info = parseWav(source)
  const totalFrames = Math.floor(info.dataBytes / info.blockAlign)
  const startFrame = Math.max(0, Math.floor(startSeconds * info.sampleRate))
  const endFrame = Math.min(totalFrames, Math.ceil(endSeconds * info.sampleRate))
  if (endFrame <= startFrame) {
    throw new FlowFailure(`the located window ${startSeconds}-${endSeconds}s contains no audio frames`)
  }
  const from = info.dataOffset + startFrame * info.blockAlign
  const to = info.dataOffset + endFrame * info.blockAlign
  const payload = source.subarray(from, to)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + payload.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(info.channels, 22)
  header.writeUInt32LE(info.sampleRate, 24)
  header.writeUInt32LE(info.sampleRate * info.blockAlign, 28)
  header.writeUInt16LE(info.blockAlign, 32)
  header.writeUInt16LE(info.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(payload.length, 40)
  writeFileSync(targetPath, Buffer.concat([header, payload]))
  return {
    path: targetPath,
    sampleRateHz: info.sampleRate,
    channels: info.channels,
    startSeconds,
    endSeconds,
    frames: endFrame - startFrame,
    seconds: (endFrame - startFrame) / info.sampleRate,
  }
}

/**
 * Synthesize a 3 s 16 kHz mono 16-bit WAV when the repository has no fixture.
 *
 * The signal is a 440 Hz tone, NOT speech: with no recording on disk the STT call
 * is expected to return an empty transcript, and flow 1 then fails with that exact
 * reason rather than pretending to have transcribed something.
 * @param targetPath - where the synthetic WAV is written.
 */
function synthesizeFixture(targetPath) {
  const script = [
    '$path = $env:VERIFY_WAV_PATH',
    '$rate = 16000',
    '$seconds = 3',
    '$samples = $rate * $seconds',
    '$stream = [System.IO.File]::Create($path)',
    '$writer = New-Object System.IO.BinaryWriter($stream)',
    'try {',
    "  $writer.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))",
    '  $writer.Write([int](36 + $samples * 2))',
    "  $writer.Write([System.Text.Encoding]::ASCII.GetBytes('WAVE'))",
    "  $writer.Write([System.Text.Encoding]::ASCII.GetBytes('fmt '))",
    '  $writer.Write([int]16)',
    '  $writer.Write([int16]1)',
    '  $writer.Write([int16]1)',
    '  $writer.Write([int]$rate)',
    '  $writer.Write([int]($rate * 2))',
    '  $writer.Write([int16]2)',
    '  $writer.Write([int16]16)',
    "  $writer.Write([System.Text.Encoding]::ASCII.GetBytes('data'))",
    '  $writer.Write([int]($samples * 2))',
    '  for ($i = 0; $i -lt $samples; $i++) {',
    '    $value = [int16]([math]::Round(8000 * [math]::Sin(2 * [math]::PI * 440 * $i / $rate)))',
    '    $writer.Write($value)',
    '  }',
    '} finally {',
    '  $writer.Close()',
    '  $stream.Close()',
    '}',
  ].join('\n')
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, VERIFY_WAV_PATH: targetPath },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new FlowFailure(`PowerShell could not synthesize the fallback WAV: ${result.stderr || result.stdout || `exit ${result.status}`}`)
  }
}

/**
 * Resolve the audio fixture, preferring a recording that is already in the repo.
 * @returns the fixture path and how it was obtained.
 */
function resolveFixture() {
  if (AUDIO_OVERRIDE !== undefined) {
    const absolute = isAbsolute(AUDIO_OVERRIDE) ? AUDIO_OVERRIDE : resolve(process.cwd(), AUDIO_OVERRIDE)
    if (!existsSync(absolute)) throw new FlowFailure(`--audio ${absolute} does not exist`)
    return { path: absolute, origin: 'explicit --audio' }
  }
  for (const candidate of FIXTURE_CANDIDATES) {
    const absolute = join(REPO_ROOT, candidate)
    if (existsSync(absolute)) return { path: absolute, origin: `repository fixture: ${candidate}` }
  }
  // Fall back to any other per-voice directory the synthesis script left behind.
  const qualification = join(REPO_ROOT, 'docs', 'tool-mode', 'qualification')
  if (existsSync(qualification)) {
    for (const entry of readdirSync(qualification)) {
      if (!entry.startsWith('.voz-wavs-')) continue
      const absolute = join(qualification, entry, 'english.wav')
      if (existsSync(absolute)) return { path: absolute, origin: `repository fixture: docs/tool-mode/qualification/${entry}/english.wav` }
    }
  }
  mkdirSync(join(RUN_ROOT, 'fixtures'), { recursive: true })
  const synthetic = join(RUN_ROOT, 'fixtures', 'synthesized-3s-16k-mono.wav')
  synthesizeFixture(synthetic)
  return {
    path: synthetic,
    origin: 'SYNTHESIZED by PowerShell: a 3 s 16 kHz mono 440 Hz tone (no speech), because no repository audio fixture exists',
  }
}

/** Mount the host plugin in this process over one FRESH store directory. */
async function mount(storeDir) {
  mkdirSync(storeDir, { recursive: true })
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(plugin, {
    extensionStore: storeDir,
    assetCacheRoot: ASSET_CACHE,
    extensionSourceDir: PACKAGES_DIR,
    extensions: { allowSourceDirectories: true },
    allowSourceDirectories: true,
    allowPreinstalledDependencies: true,
    preinstalledDependenciesRoot: REPO_ROOT,
    allowExecutablePreparation: true,
    approvedRoots: [REPO_ROOT, storeDir],
    models: ['__none__'],
    stateFile: join(storeDir, 'verify-flows-state.json'),
  })
  const service = ctx.get('modelTools')
  if (service === undefined) throw new FlowFailure('the plugin mounted without a modelTools service')
  return { ctx, service, storeDir }
}

/**
 * Install, prepare and enable the extensions one flow needs.
 *
 * A store that already holds an extension answers the install with an upgrade
 * refusal; that is a SKIP, not a failure, because the installed copy is the one the
 * prepare/enable steps then operate on.
 * @param mounted - the mounted host.
 * @param flow - the flow number, for the log lines.
 * @param extensionIds - the extensions this flow needs.
 */
async function provision(mounted, flow, extensionIds) {
  for (const extensionId of extensionIds) {
    const source = EXTENSION_SOURCES[extensionId]
    if (source === undefined) throw new FlowFailure(`no first-party source is known for ${extensionId}`)
    try {
      const installed = await mounted.service.install(extensionId, source)
      emit({
        flow,
        phase: 'install',
        extension: extensionId,
        ok: true,
        version: installed.version,
        source: installed.source,
      })
    } catch (error) {
      const message = messageOf(error)
      const alreadyInstalled = /upgrade|already installed/i.test(message)
      emit({
        flow,
        phase: 'install',
        extension: extensionId,
        ok: alreadyInstalled,
        skipped: alreadyInstalled,
        error: message,
        note: alreadyInstalled
          ? 'the store already holds this extension: treated as a skip, then prepared and enabled'
          : 'install failed for a reason other than an existing installation',
      })
      if (!alreadyInstalled) throw new FlowFailure(`install ${extensionId} failed: ${message}`)
    }
  }
  for (const extensionId of extensionIds) {
    let prepared
    try {
      prepared = await mounted.service.prepare(extensionId)
    } catch (error) {
      throw new FlowFailure(`prepare ${extensionId} failed: ${messageOf(error)}`)
    }
    emit({
      flow,
      phase: 'prepare',
      extension: extensionId,
      ok: prepared.prepared === true || prepared.activationReady === true,
      prepared: prepared.prepared === true,
      activationReady: prepared.activationReady === true,
      reason: prepared.reason ?? null,
    })
    if (prepared.prepared !== true && prepared.activationReady !== true) {
      throw new FlowFailure(`prepare ${extensionId} did not reach readiness: ${prepared.reason ?? 'no reason reported'}`)
    }
    let enabled
    try {
      enabled = await mounted.service.enable(extensionId)
    } catch (error) {
      throw new FlowFailure(`enable ${extensionId} failed: ${messageOf(error)}`)
    }
    emit({ flow, phase: 'enable', extension: extensionId, ok: enabled.active === true })
    if (enabled.active !== true) throw new FlowFailure(`enable ${extensionId} left the extension inactive`)
  }
}

/**
 * The tool-result BOUNDARY.
 *
 * `ctx.tools.execute` returns the extension's declared contract payload, which is
 * unvalidated JSON as far as this caller is concerned. These readers are the one
 * place that inspects the runtime shape; every branch after them works on parsed
 * domain values (a string, a finite number, or undefined) instead of re-testing
 * types at each use.
 */
function resultRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/** A string field of a parsed record, or undefined. */
function stringField(record, name) {
  const field = record?.[name]
  return typeof field === 'string' ? field : undefined
}

/** A finite number field of a parsed record, or undefined. */
function numberField(record, name) {
  const field = record?.[name]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

/** Dispatch one tool call through the registry and print its result line. */
async function invoke(mounted, flow, tool, callArguments) {
  const started = performance.now()
  const callId = `flow${flow}-${tool}-${Math.floor(performance.now())}`
  const outcome = await mounted.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(callId),
    name: tool,
    arguments: callArguments,
  })
  const elapsedMs = Math.round(performance.now() - started)
  if (outcome.isError) {
    emit({ flow, phase: 'call', tool, ok: false, elapsedMs, error: outcome.error?.message ?? 'the call failed without a message' })
    throw new FlowFailure(`${tool} failed: ${outcome.error?.message ?? 'no message'}`)
  }
  const value = outcome.value
  const meta = resultRecord(value)?.meta
  const receiptId = stringField(resultRecord(meta), 'receiptId') ?? null
  emit({
    flow,
    phase: 'call',
    tool,
    ok: true,
    elapsedMs,
    receiptId,
    receiptNote: receiptId === null
      ? 'no host meta: this tool\'s declared output schema does not require the reserved meta envelope, so the host stamps no receipt on the result'
      : 'host-authored meta envelope on the result',
    arguments: callArguments,
    result: value,
  })
  return value
}

/** Flow 1: locate a window in real audio, transcribe it, compare it with the query. */
async function runAudioFlow(mounted, flow) {
  const fixture = resolveFixture()
  const fixtureBytes = readFileSync(fixture.path)
  const info = parseWav(fixtureBytes)
  emit({
    flow,
    phase: 'fixture',
    path: fixture.path,
    origin: fixture.origin,
    sampleRateHz: info.sampleRate,
    channels: info.channels,
    bitsPerSample: info.bitsPerSample,
    durationSeconds: Number(info.durationSeconds.toFixed(3)),
    query: QUERY_TEXT,
  })

  const moments = await invoke(mounted, flow, 'media_find_moments', {
    query: { id: 'q', parts: [{ kind: 'text', text: QUERY_TEXT }] },
    media: { kind: 'audio', path: fixture.path },
    windowSeconds: 2,
    strideSeconds: 0.5,
    top_k: 4,
    dimensions: 768,
  })
  const matches = Array.isArray(moments.matches) ? moments.matches : []
  if (matches.length === 0) throw new FlowFailure('media_find_moments returned no matches for the query')
  const top = matches[0]
  if (!(top.endSeconds > top.startSeconds)) {
    throw new FlowFailure(`media_find_moments returned an empty window ${top.startSeconds}-${top.endSeconds}s`)
  }

  /**
   * Report how much of the SOURCE the window plan actually covers.
   *
   * The audio decoder converts the source to the model's 16 kHz timeline, and its
   * admitted-sample count for a source that is NOT 16 kHz comes out short by
   * modelHz/sourceHz (measured: a 22050 Hz, 3.374 s file is admitted as 2.448 s, i.e.
   * 39172 samples). The caller has to see that, because the located timestamps are
   * then relative to the admitted prefix, not to the whole file.
   */
  const lastWindowEndSeconds = Math.max(...matches.map(match => match.endSeconds))
  const coverage = {
    sourceDurationSeconds: Number(info.durationSeconds.toFixed(6)),
    lastWindowEndSeconds,
    admittedFraction: Number((lastWindowEndSeconds / info.durationSeconds).toFixed(6)),
    modelHzOverSourceHz: Number((16000 / info.sampleRate).toFixed(6)),
  }
  emit({
    flow,
    phase: 'coverage',
    ...coverage,
    covered: lastWindowEndSeconds >= info.durationSeconds - 1e-3,
    note: lastWindowEndSeconds >= info.durationSeconds - 1e-3
      ? 'the window plan reaches the end of the source'
      : 'the window plan does NOT reach the end of the source: the decoder admits only a fraction of a non-16 kHz file (modelHz/sourceHz), and the unreachable tail cannot be located',
  })

  // CALLER step, not a tool call: stt_transcribe's contract takes a path, not a range.
  const windowPath = join(mounted.storeDir, `flow${flow}-window-${String(top.startSeconds).replaceAll('.', '_')}-${String(top.endSeconds).replaceAll('.', '_')}.wav`)
  const window = sliceWav(fixture.path, windowPath, top.startSeconds, top.endSeconds)
  emit({
    flow,
    phase: 'materialize-window',
    note: 'caller-side: no tool accepts a time range for transcription, so the caller cuts the located window into its own WAV',
    window,
  })

  const transcription = await invoke(mounted, flow, 'stt_transcribe', {
    audio: { path: windowPath, sampleRateHz: window.sampleRateHz, channels: window.channels },
    language: 'en',
    timestamps: 'none',
  })
  const transcript = stringField(transcription, 'text')?.trim() ?? ''
  if (transcript.length === 0) {
    throw new FlowFailure('stt_transcribe returned an empty transcript; with no speech in the fixture there is nothing to compare')
  }

  const similarity = await invoke(mounted, flow, 'semantic_similarity', {
    left: { id: 'transcript', parts: [{ kind: 'text', text: transcript }] },
    right: { id: 'query', parts: [{ kind: 'text', text: QUERY_TEXT }] },
    dimensions: 768,
  })
  const score = numberField(similarity, 'score')
  if (score === undefined) {
    throw new FlowFailure('semantic_similarity did not return a finite cosine score')
  }
  return {
    ok: true,
    fixture: fixture.path,
    windowsEvaluated: moments.windowsEvaluated,
    coverage,
    topWindow: { startSeconds: top.startSeconds, endSeconds: top.endSeconds, score: top.score },
    matches,
    transcript,
    score,
    scoreKind: similarity.scoreKind,
    embeddingSpaceId: similarity.embeddingSpaceId,
  }
}

/** Flow 2: similarity, then the CALLER's threshold gate, then Laya's advisory answer. */
async function runSemanticGateFlow(mounted, flow) {
  const positive = await invoke(mounted, flow, 'semantic_similarity', {
    left: { id: 'a', parts: [{ kind: 'text', text: FLOW2_POSITIVE.a }] },
    right: { id: 'b', parts: [{ kind: 'text', text: FLOW2_POSITIVE.b }] },
    dimensions: 768,
  })
  const positiveScore = numberField(positive, 'score')
  if (positiveScore === undefined) {
    throw new FlowFailure('semantic_similarity did not return a finite cosine score for the positive pair')
  }

  // CALLER policy, stated as data: the comparison happens here, not in any tool.
  const gate = {
    score: positiveScore,
    threshold: THRESHOLD,
    opens: positiveScore >= THRESHOLD,
    policy: 'the caller compares score >= threshold; no tool knows, applies, or reports the threshold',
  }
  emit({ flow, phase: 'gate', pair: 'positive', ...gate })
  if (!gate.opens) {
    throw new FlowFailure(`the caller's gate stayed closed (score ${positiveScore} < threshold ${THRESHOLD}), so decision_test was not called: no tool would have called it`)
  }

  const decision = await invoke(mounted, flow, 'decision_test', {
    prompt: `Do these two texts describe the same event? Text A: "${FLOW2_POSITIVE.a}" Text B: "${FLOW2_POSITIVE.b}"`,
    allow_abstain: true,
  })

  const negative = await invoke(mounted, flow, 'semantic_similarity', {
    left: { id: 'a', parts: [{ kind: 'text', text: FLOW2_POSITIVE.a }] },
    right: { id: 'c', parts: [{ kind: 'text', text: FLOW2_NEGATIVE }] },
    dimensions: 768,
  })
  const negativeScore = numberField(negative, 'score')
  const control = {
    score: negativeScore,
    threshold: THRESHOLD,
    opens: negativeScore !== undefined && negativeScore >= THRESHOLD,
  }
  emit({
    flow,
    phase: 'gate',
    pair: 'negative-control',
    ...control,
    note: control.opens
      ? 'the control crossed the caller threshold: this threshold does not separate this pair in this space'
      : 'the caller gate stays closed and decision_test is not called for this pair',
  })

  return {
    ok: true,
    positiveScore,
    threshold: THRESHOLD,
    decision: {
      decision: decision.decision,
      confidence: decision.confidence,
      calibrated: decision.calibrated,
      abstained: decision.abstained,
    },
    negativeScore,
    negativeGateOpens: control.opens,
  }
}

/** Run one flow in its own fresh store and its own plugin mount, then dispose. */
async function runFlow(flow, extensionIds, body) {
  const storeDir = join(RUN_ROOT, `flow${flow}-store`)
  emit({ flow, phase: 'store', path: storeDir, fresh: !existsSync(storeDir), assetCache: ASSET_CACHE })
  let mounted
  try {
    mounted = await mount(storeDir)
    await provision(mounted, flow, extensionIds)
    const summary = await body(mounted, flow)
    emit({ flow, phase: 'flow-complete', ok: true, ...summary })
    return { flow, ok: true, summary }
  } catch (error) {
    emit({ flow, phase: 'flow-failed', ok: false, error: messageOf(error) })
    return { flow, ok: false, error: messageOf(error) }
  } finally {
    if (mounted !== undefined) {
      try {
        await mounted.ctx.fiber.dispose()
      } catch (error) {
        emit({ flow, phase: 'dispose', ok: false, error: messageOf(error) })
      }
    }
  }
}

const prunedRuns = pruneAbandonedRuns()
emit({
  phase: 'scratch',
  storeRoot: STORE_ROOT,
  runRoot: RUN_ROOT,
  freeBytes: scratchFreeBytes(),
  prunedRuns,
  note: 'each flow gets a fresh store under the run directory; stores are NOT small (installed dependencies are copied beside the extension)',
})

const results = []
if (ONLY_FLOW === undefined || ONLY_FLOW === 1) {
  results.push(await runFlow(1, ['@try-works/extension-embeddinggemma', '@try-works/extension-desert-ant-voz'], runAudioFlow))
}
if (ONLY_FLOW === undefined || ONLY_FLOW === 2) {
  results.push(await runFlow(2, ['@try-works/extension-embeddinggemma', '@try-works/extension-laya'], runSemanticGateFlow))
}

const failed = results.filter(result => !result.ok)
emit({
  phase: 'summary',
  runRoot: RUN_ROOT,
  flows: results.map(result => ({ flow: result.flow, ok: result.ok, ...(result.ok ? { summary: result.summary } : { error: result.error }) })),
  verdict: failed.length === 0 ? 'pass' : 'fail',
})
process.exitCode = failed.length === 0 ? 0 : 1
