#!/usr/bin/env node
/**
 * Independent, READ-ONLY benchmark of the Settings > Model as Tool extension-state read.
 *
 * It times the three calls the page path depends on, against a real extension store:
 *   1. ExtensionsService.describeFast()   - identity/state/tools, no installed-bytes digest
 *   2. ExtensionStore.verifyUnchanged()   - the full digest of one installed record
 *   3. ExtensionsService.describe()       - every row with its integrity verified
 *
 * The script never installs, enables, disables or writes. It takes a store census before
 * and after the timed calls and reports whether anything changed, so "read-only" is
 * measured rather than asserted. (A concurrently running host can change the store; that
 * is reported, not hidden.)
 *
 * Usage:
 *   npx tsx scripts/bench-extension-state.mjs [options]
 *
 * Options:
 *   --store <dir>          extension store (default %USERPROFILE%\.dsh\profiles\web\extensions)
 *   --runs <n>             timed runs for describeFast and verifyUnchanged (default 3)
 *   --describe-runs <n>    timed runs for describe (default 1; it digests every install)
 *   --skip-describe        do not run describe() at all
 *   --label <text>         label echoed in the RESULT line (default "run")
 *   --help
 *
 * Output is a human-readable report plus one final "RESULT {...}" JSON line, so a
 * baseline and an after run can be compared mechanically.
 *
 * @module scripts/bench-extension-state
 */

import { lstatSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import { ExtensionsService } from '../packages/dsh-tool-mode/src/extensions-service.ts'
import { ExtensionStore } from '../packages/tool-mode-extension-sdk/src/index.ts'

/** Parse the small CLI surface; unknown flags are refused rather than ignored. */
function parseArgs(argv) {
  const options = {
    store: join(process.env.USERPROFILE ?? homedir(), '.dsh', 'profiles', 'web', 'extensions'),
    runs: 3,
    describeRuns: 1,
    skipDescribe: false,
    label: 'run',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(arg + ' needs a value')
      index += 1
      return value
    }
    switch (arg) {
      case '--store': options.store = next(); break
      case '--runs': options.runs = positiveInteger(next(), arg); break
      case '--describe-runs': options.describeRuns = positiveInteger(next(), arg); break
      case '--skip-describe': options.skipDescribe = true; break
      case '--label': options.label = next(); break
      case '--help':
        console.log('usage: npx tsx scripts/bench-extension-state.mjs [--store DIR] [--runs N] [--describe-runs N] [--skip-describe] [--label TEXT]')
        process.exit(0)
        break
      default:
        throw new Error('unknown argument ' + JSON.stringify(arg) + ' (try --help)')
    }
  }
  return options
}

/** Parse a positive integer flag value. */
function positiveInteger(value, flag) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(flag + ' must be a positive integer, got ' + JSON.stringify(value))
  return parsed
}

/** Census one directory tree: file count, byte count and newest mtime. */
function census(directory) {
  let files = 0
  let bytes = 0
  let newestMtimeMs = 0
  const stack = [directory]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      let stat
      try {
        stat = lstatSync(path)
      } catch {
        continue
      }
      if (stat.isDirectory()) stack.push(path)
      else if (stat.isFile()) {
        files += 1
        bytes += stat.size
        if (stat.mtimeMs > newestMtimeMs) newestMtimeMs = stat.mtimeMs
      }
    }
  }
  return { files, bytes, newestMtimeMs }
}

/** Round a duration to a tenth of a millisecond. */
function tenths(value) {
  return Math.round(value * 10) / 10
}

/** Min/median/max/mean of a timing array, in ms. */
function summary(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return {
    min: tenths(sorted[0]),
    median: tenths(median),
    max: tenths(sorted[sorted.length - 1]),
    mean: tenths(values.reduce((total, value) => total + value, 0) / values.length),
  }
}

/** The state facts worth comparing between runs. */
function stateFacts(result) {
  const integrity = { unchanged: 0, changed: 0, unknown: 0 }
  let installed = 0
  let active = 0
  let blocked = 0
  for (const row of result.extensions) {
    integrity[row.integrity] = (integrity[row.integrity] ?? 0) + 1
    if (row.installed) installed += 1
    if (row.active) active += 1
    if (row.blocked) blocked += 1
  }
  return { rows: result.extensions.length, installed, active, blocked, integrity }
}

/** Time one async call. */
async function timed(run) {
  const start = performance.now()
  const value = await run()
  return { ms: performance.now() - start, value }
}

/** Human-readable bytes. */
function humanBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KiB'
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MiB'
  return (bytes / 1024 ** 3).toFixed(2) + ' GiB'
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const storeDir = resolve(options.store)
  const startedAt = new Date().toISOString()

  console.log('bench-extension-state')
  console.log('label: ' + options.label)
  console.log('started: ' + startedAt)
  console.log('store: ' + storeDir)
  console.log('node: ' + process.version + ' (' + process.platform + '/' + process.arch + ')')

  const before = census(storeDir)
  console.log('store before: ' + before.files + ' files, ' + humanBytes(before.bytes) + ' (' + before.bytes + ' bytes), newest mtime ' + new Date(before.newestMtimeMs).toISOString())

  const service = new ExtensionsService({ storeDir, profile: 'default' })
  const store = new ExtensionStore(storeDir)

  const lockTimed = await timed(() => store.readLock())
  const lock = lockTimed.value
  const records = lock.corrupt ? [] : lock.value.extensions
  console.log('readLock: ' + tenths(lockTimed.ms) + ' ms, corrupt=' + lock.corrupt + ', records=' + records.length)

  const fastRuns = []
  let fastFacts = null
  console.log('describeFast (' + options.runs + ' run' + (options.runs === 1 ? '' : 's') + '):')
  for (let run = 0; run < options.runs; run += 1) {
    const measured = await timed(() => service.describeFast())
    fastRuns.push(measured.ms)
    fastFacts = stateFacts(measured.value)
    console.log(
      '  run ' + (run + 1) + ': ' + tenths(measured.ms) + ' ms, rows=' + fastFacts.rows
      + ', installed=' + fastFacts.installed + ', active=' + fastFacts.active + ', blocked=' + fastFacts.blocked
      + ', integrity=' + JSON.stringify(fastFacts.integrity),
    )
  }
  console.log('  summary: ' + JSON.stringify(summary(fastRuns)))

  const verify = { record: null, installBytes: 0, runs: [], unchanged: null, digestMatches: null }
  if (records.length === 0) {
    console.log('verifyUnchanged: skipped (no installed records in the lock)')
  } else {
    const record = records[0]
    const recordCensus = census(record.installPath)
    verify.record = { extensionId: record.extensionId, version: record.version, installPath: record.installPath }
    verify.installBytes = recordCensus.bytes
    console.log(
      'verifyUnchanged first record: ' + record.extensionId + '@' + record.version
      + ' (' + recordCensus.files + ' files, ' + humanBytes(recordCensus.bytes) + ')',
    )
    for (let run = 0; run < options.runs; run += 1) {
      const measured = await timed(() => store.verifyUnchanged(record))
      verify.runs.push(measured.ms)
      verify.unchanged = measured.value.unchanged
      verify.digestMatches = measured.value.contentDigest === record.contentDigest
      console.log(
        '  run ' + (run + 1) + ': ' + tenths(measured.ms) + ' ms, unchanged=' + measured.value.unchanged
        + ', digestMatches=' + verify.digestMatches
        + (measured.value.diagnostic === undefined ? '' : ', diagnostic=' + JSON.stringify(measured.value.diagnostic)),
      )
    }
    console.log('  summary: ' + JSON.stringify(summary(verify.runs)))
  }

  const describeRuns = []
  let fullFacts = null
  if (options.skipDescribe) {
    console.log('describe: skipped (--skip-describe)')
  } else {
    console.log('describe (' + options.describeRuns + ' run' + (options.describeRuns === 1 ? '' : 's') + '):')
    for (let run = 0; run < options.describeRuns; run += 1) {
      const measured = await timed(() => service.describe())
      describeRuns.push(measured.ms)
      fullFacts = stateFacts(measured.value)
      console.log(
        '  run ' + (run + 1) + ': ' + tenths(measured.ms) + ' ms, rows=' + fullFacts.rows
        + ', installed=' + fullFacts.installed + ', active=' + fullFacts.active + ', blocked=' + fullFacts.blocked
        + ', integrity=' + JSON.stringify(fullFacts.integrity),
      )
    }
    console.log('  summary: ' + JSON.stringify(summary(describeRuns)))
  }

  const after = census(storeDir)
  const storeUnchanged = after.files === before.files
    && after.bytes === before.bytes
    && after.newestMtimeMs === before.newestMtimeMs
  console.log('store after: ' + after.files + ' files, ' + humanBytes(after.bytes) + ' (' + after.bytes + ' bytes), newest mtime ' + new Date(after.newestMtimeMs).toISOString())
  console.log('storeUnchanged: ' + storeUnchanged + (storeUnchanged ? '' : ' (a concurrently running host may have written; this script only reads)'))

  const result = {
    label: options.label,
    startedAt,
    finishedAt: new Date().toISOString(),
    storeDir,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    store: { files: before.files, bytes: before.bytes, newestMtimeMs: before.newestMtimeMs },
    storeUnchanged,
    readLockMs: tenths(lockTimed.ms),
    lockRecords: records.length,
    describeFastMs: fastRuns.map(tenths),
    describeFastSummary: summary(fastRuns),
    describeFastFacts: fastFacts,
    verifyUnchanged: {
      ...verify,
      runs: verify.runs.map(tenths),
      summary: summary(verify.runs),
    },
    describeMs: describeRuns.map(tenths),
    describeSummary: summary(describeRuns),
    describeFacts: fullFacts,
  }
  console.log('RESULT ' + JSON.stringify(result))
}

main().catch((error) => {
  console.error('bench-extension-state failed: ' + (error instanceof Error ? error.stack ?? error.message : String(error)))
  process.exitCode = 1
})
