#!/usr/bin/env node
/**
 * Seed the content-addressed prepared-assets cache from artifacts produced by a
 * documented local export.
 *
 * Why this exists: some extension locks record the artifact's PROVENANCE as
 * prose ("the split export of the pinned checkpoint") instead of a download
 * URL, because the pinned upstream checkpoint has no public ONNX export to
 * fetch. The host refuses such locks at prepare time (ASSET_SOURCE_UNAVAILABLE)
 * unless the bytes are already in the content-addressed cache, where a later
 * acquisition re-verifies them against the pinned digest. This script is the
 * missing, documented bridge: it takes the exported files, verifies size and
 * SHA-256 against the lock, and copies each one into the cache under its
 * digest — the exact filename `firstUnavailableAssetSource` and `prepare`
 * probe.
 *
 * It never downloads anything and never invents a digest: a file whose size or
 * hash disagrees with the lock is refused, and the copy is atomic
 * (write-then-rename), so an interrupted seed cannot leave a blob that a
 * digest check would trust.
 *
 * Usage:
 *   node scripts/seed-prepared-assets.mjs \
 *     --lock packages/extension-laya/models.lock.json \
 *     --asset-set laya-decision-onnx \
 *     --from E:\tmp\laya-investigation\laya\model-ml \
 *     --cache-root E:\dsh-asset-cache \
 *     [--dry-run] [--json]
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function parseArgs(argv) {
  const options = { dryRun: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    switch (token) {
      case '--lock': options.lock = argv[++index]; break
      case '--asset-set': options.assetSet = argv[++index]; break
      case '--from': options.from = argv[++index]; break
      case '--cache-root': options.cacheRoot = argv[++index]; break
      case '--dry-run': options.dryRun = true; break
      case '--json': options.json = true; break
      case '--help': case '-h': options.help = true; break
      default: throw new Error(`unknown argument: ${token}`)
    }
  }
  return options
}

function usage() {
  return [
    'seed-prepared-assets --lock <models.lock.json> --asset-set <id> --from <export dir> --cache-root <dir>',
    '  [--dry-run] [--json]',
    '',
    'Verifies every lock asset against its pinned size + SHA-256 and copies it',
    'into the cache under its digest, so a prose-source lock can be prepared.',
  ].join('\n')
}

/** Every asset of one asset set, in lock order. */
function assetsOf(lock, assetSetId) {
  const set = lock?.assetSets?.[assetSetId]
  if (set === undefined) throw new Error(`the lock declares no asset set "${assetSetId}"`)
  if (!Array.isArray(set.groups)) throw new Error(`asset set "${assetSetId}" declares no groups`)
  return set.groups.flatMap(group => {
    if (!Array.isArray(group.assets)) throw new Error(`group "${group.id}" declares no assets`)
    return group.assets.map(asset => ({
      id: `${group.id}/${asset.id}`,
      file: asset.file,
      bytes: asset.bytes,
      digest: asset.digest,
      source: asset.source,
    }))
  })
}

function sha256(path) {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex').toUpperCase()
}

function seedOne(asset, fromDir, cacheRoot, dryRun) {
  const from = join(fromDir, asset.file)
  if (!existsSync(from)) return { ...asset, ok: false, reason: `missing export file ${from}` }
  const size = statSync(from).size
  if (typeof asset.bytes !== 'number' || size !== asset.bytes) {
    return { ...asset, ok: false, reason: `size ${size} does not match the pinned ${asset.bytes}` }
  }
  const digest = sha256(from)
  if (typeof asset.digest !== 'string' || digest !== asset.digest.toUpperCase()) {
    return { ...asset, ok: false, reason: `sha256 ${digest} does not match the pinned ${asset.digest}` }
  }
  const to = join(cacheRoot, asset.digest)
  if (existsSync(to) && statSync(to).size === size) {
    return { ...asset, ok: true, seeded: false, path: to }
  }
  if (dryRun) return { ...asset, ok: true, seeded: false, wouldSeed: true, path: to }
  mkdirSync(dirname(to), { recursive: true })
  const staging = `${to}.seed-${process.pid}`
  copyFileSync(from, staging)
  try {
    renameSync(staging, to)
  } catch (error) {
    rmSync(staging, { force: true })
    throw error
  }
  return { ...asset, ok: true, seeded: true, path: to }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help !== true && (options.lock === undefined || options.assetSet === undefined
    || options.from === undefined || options.cacheRoot === undefined)) {
    throw new Error(`missing arguments\n\n${usage()}`)
  }
  const lockPath = resolve(options.lock)
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  const fromDir = resolve(options.from)
  const cacheRoot = resolve(options.cacheRoot)
  const assets = assetsOf(lock, options.assetSet)
  if (assets.length === 0) throw new Error(`asset set "${options.assetSet}" has no assets`)

  const results = assets.map(asset => seedOne(asset, fromDir, cacheRoot, options.dryRun))
  const failed = results.filter(result => !result.ok)
  const report = {
    lock: lockPath,
    assetSet: options.assetSet,
    from: fromDir,
    cacheRoot,
    dryRun: options.dryRun,
    assets: results.map(({ id, file, bytes, digest, ok, seeded, wouldSeed, path, reason }) => ({
      id, file, bytes, digest, ok, seeded: seeded === true, wouldSeed: wouldSeed === true, path, reason,
    })),
    ok: failed.length === 0,
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    for (const asset of report.assets) {
      const state = asset.ok ? (asset.seeded ? 'seeded' : asset.wouldSeed ? 'would seed' : 'cached') : 'REFUSED'
      process.stdout.write(`${state.padEnd(10)} ${asset.id} (${asset.bytes} bytes)\n`)
      if (!asset.ok) process.stdout.write(`           ${asset.reason}\n`)
    }
    process.stdout.write(`${report.ok ? 'OK' : 'FAILED'}: ${report.assets.length - failed.length}/${report.assets.length} assets verified`
      + `${report.dryRun ? ' (dry run)' : ''} -> ${cacheRoot}\n`)
  }
  process.exitCode = report.ok ? 0 : 1
}

main()
