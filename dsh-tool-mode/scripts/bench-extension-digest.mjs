#!/usr/bin/env node
/**
 * Read-only benchmark: sync vs async extension content digest (task-28).
 *
 * Usage:
 *   node scripts/bench-extension-digest.mjs <storeDir> [extensionId] [--concurrency N]
 *
 * <storeDir> is a store root containing extensions.lock.json. With no extensionId the first
 * record is measured. The script never writes to the store; it reads files and reports timing.
 * It imports the BUILT SDK, so run `npm run build:sdk` first.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { cpus } from 'node:os'

let api
try {
  api = await import('../packages/tool-mode-extension-sdk/lib/install/store.js')
} catch (error) {
  console.error('the built SDK is missing; run: npm run build:sdk')
  console.error(String(error && error.message ? error.message : error))
  process.exit(2)
}
const { digestInstalledContent, digestInstalledContentAsync, ExtensionStore, installContentFingerprint } = api

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help') {
  console.log('usage: node scripts/bench-extension-digest.mjs <storeDir> [extensionId] [--concurrency N]')
  process.exit(args.length === 0 ? 2 : 0)
}

const storeDir = resolve(args[0])
let extensionId
let concurrency
for (let index = 1; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--concurrency') {
    index += 1
    concurrency = Number(args[index])
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      console.error('--concurrency must be a positive integer')
      process.exit(2)
    }
  } else if (extensionId === undefined) {
    extensionId = arg
  } else {
    console.error('unexpected argument: ' + arg)
    process.exit(2)
  }
}

const lock = JSON.parse(readFileSync(join(storeDir, 'extensions.lock.json'), 'utf8'))
const records = Array.isArray(lock.extensions) ? lock.extensions : []
if (records.length === 0) {
  console.error('the lock has no installations: ' + join(storeDir, 'extensions.lock.json'))
  process.exit(1)
}
const record = extensionId === undefined ? records[0] : records.find((entry) => entry.extensionId === extensionId)
if (record === undefined) {
  console.error('no record for ' + JSON.stringify(extensionId) + '; available: ' + records.map((entry) => entry.extensionId + '@' + entry.version).join(', '))
  process.exit(1)
}

const fingerprint = installContentFingerprint(record.installPath)
const defaultWorkers = Math.max(1, Math.min(8, cpus().length - 1))
console.log('store          ' + storeDir)
console.log('record         ' + record.extensionId + '@' + record.version)
console.log('installPath    ' + record.installPath)
console.log('files (content) ' + fingerprint.fileCount + '   bytes ' + fingerprint.totalSize + ' (' + (fingerprint.totalSize / (1024 * 1024)).toFixed(1) + ' MiB)')
console.log('cpus           ' + cpus().length + '   default async workers ' + defaultWorkers + (concurrency === undefined ? '' : '   requested ' + concurrency))
console.log('')

const syncStart = performance.now()
const syncDigest = digestInstalledContent(record.installPath)
const syncMs = performance.now() - syncStart

const asyncStart = performance.now()
const asyncDigest = await digestInstalledContentAsync(
  record.installPath,
  concurrency === undefined ? {} : { concurrency },
)
const asyncMs = performance.now() - asyncStart

const identical = syncDigest === asyncDigest
console.log('sync digest    ' + syncMs.toFixed(1) + ' ms')
console.log('async digest   ' + asyncMs.toFixed(1) + ' ms')
console.log('speedup        ' + (asyncMs === 0 ? 'n/a' : (syncMs / asyncMs).toFixed(2) + 'x'))
console.log('identical      ' + (identical ? 'yes' : 'NO (FAILURE)'))
console.log('matches record ' + (asyncDigest === record.contentDigest ? 'yes' : 'no'))
if (!identical) process.exitCode = 1

const store = new ExtensionStore(storeDir)
const coldStart = performance.now()
const cold = await store.verifyUnchangedAsync(record)
const coldMs = performance.now() - coldStart
const warmStart = performance.now()
const warm = await store.verifyUnchangedAsync(record)
const warmMs = performance.now() - warmStart
console.log('')
console.log('verify (cold)  ' + coldMs.toFixed(1) + ' ms   unchanged=' + cold.unchanged + ' cached=' + cold.cached)
console.log('verify (warm)  ' + warmMs.toFixed(1) + ' ms   unchanged=' + warm.unchanged + ' cached=' + warm.cached + '   speedup ' + (warmMs === 0 ? 'n/a' : (coldMs / warmMs).toFixed(1) + 'x'))
