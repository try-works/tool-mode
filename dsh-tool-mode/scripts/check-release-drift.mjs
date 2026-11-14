#!/usr/bin/env node
/**
 * AT-88 — combined release drift gate.
 *
 * Checks the four lock families in ONE pass:
 *   - model asset locks (revision, asset identity, digest shape, source);
 *   - processor/tokenizer identities (when a lock declares them);
 *   - recipe vocabulary versions (schemaVersion and recipe versions);
 *   - the MCP protocol version declared by the host and supported by the manifests.
 *
 * Versioned update behavior (immutable generations, rollback, revocations, old choices,
 * borrowed assets) is covered by packages/tool-mode-extension-sdk/tests/update-flow.test.ts
 * and migration.test.ts; this gate is about LOCK/IDENTITY DRIFT, not update semantics.
 *
 * Usage: node scripts/check-release-drift.mjs [--json]
 * Exit 0 only when every check passes; a drift names the file and field.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(process.env.RELEASE_DRIFT_ROOT ?? join(import.meta.dirname, '..'))
const PACKAGES = join(ROOT, 'packages')
const problems = []
const checked = { manifests: 0, locks: 0, assets: 0, processors: 0, recipes: 0 }
const SHA = /^(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{128})$/

function fail(file, field, reason) {
  problems.push({ file: relative(ROOT, file).replace(/\\/g, '/'), field, reason })
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(path, '(json)', `cannot parse: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function walk(dir, predicate, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, predicate, out)
    else if (predicate(path)) out.push(path)
  }
  return out
}

// ---- Model / processor / protocol -------------------------------------------------------
const manifests = walk(PACKAGES, path => path.endsWith('tool-mode.extension.json'))
  .filter(path => !path.includes(`${join('packages', 'dsh-tool-mode', 'tests')}`))
for (const path of manifests) {
  const manifest = readJson(path)
  if (manifest === undefined) continue
  checked.manifests += 1
  if (manifest.protocolVersion !== '1.1.0') fail(path, 'protocolVersion', `expected 1.1.0, saw ${JSON.stringify(manifest.protocolVersion)}`)
  for (const model of Array.isArray(manifest.models) ? manifest.models : []) {
    if (typeof model.assetLock !== 'string') continue
    const lockPath = join(path, '..', model.assetLock)
    if (!existsSync(lockPath)) {
      fail(path, `models.${model.id}.assetLock`, `${model.assetLock} does not exist`)
      continue
    }
    const lock = readJson(lockPath)
    if (lock === undefined) continue
    checked.locks += 1
    const set = lock.assetSets?.[model.assetSet]
    if (set === undefined) {
      fail(lockPath, `assetSets.${model.assetSet}`, 'declared by the manifest but missing from the lock')
      continue
    }
    const managed = set.pinning?.state === 'model-managed' && Array.isArray(set.assets) && set.assets.length === 0
    if (!managed) {
      const revision = set.model?.revision ?? set.conversion?.revision ?? set.pinning?.revision
      if (typeof revision !== 'string' || revision.trim() === '') {
        fail(lockPath, `assetSets.${model.assetSet}.revision`, 'no exact revision')
      }
      if (set.engine !== undefined && (typeof set.engine.version !== 'string' || set.engine.version.trim() === '')) {
        fail(lockPath, `assetSets.${model.assetSet}.engine.version`, 'no engine version')
      }
      if (set.tokenizer !== undefined && (typeof set.tokenizer.identity !== 'string' || set.tokenizer.identity.trim() === '')) {
        fail(lockPath, `assetSets.${model.assetSet}.tokenizer.identity`, 'no tokenizer identity')
      }
    }
    const allAssets = [
      ...(Array.isArray(set.assets) ? set.assets : []),
      ...(Array.isArray(set.groups) ? set.groups.flatMap(group => Array.isArray(group.assets) ? group.assets : []) : []),
    ]
    for (const asset of allAssets) {
      checked.assets += 1
      if (typeof asset.id !== 'string' || asset.id.length === 0) fail(lockPath, 'asset.id', 'missing asset id')
      if (typeof asset.bytes !== 'number' || asset.bytes <= 0) fail(lockPath, `asset.${asset.id}.bytes`, 'missing positive byte length')
      const digest = String(asset.sha256 ?? asset.digest ?? '')
      if (!SHA.test(digest)) fail(lockPath, `asset.${asset.id}.digest`, `not a SHA-256/512 hex digest: ${JSON.stringify(digest)}`)
      const source = asset.source ?? asset.url
      if (typeof source !== 'string' || source.length === 0) fail(lockPath, `asset.${asset.id}.source`, 'missing source')
    }
    if (set.processor !== undefined) {
      checked.processors += 1
      const identity = set.processor.identity ?? set.processor.kind ?? set.processor.id
      if (typeof identity !== 'string' || identity.trim() === '') {
        fail(lockPath, `assetSets.${model.assetSet}.processor`, 'processor declared without an identity')
      }
    }
  }
}

// ---- Recipe vocabulary ------------------------------------------------------------------
const SCHEMA_VERSION = '1.0.0'
const recipes = walk(PACKAGES, path => /[\\/]recipes?[\\/].+\.json$/.test(path) && !path.includes('node_modules'))
for (const path of recipes) {
  const recipe = readJson(path)
  if (recipe === undefined) continue
  /**
   * A model-runtime recipe is a DIFFERENT vocabulary from the harness-model recipe:
   * schemaVersion is the number 1 and there is no recipe version. Its own parser
   * (@try-works/tool-mode-runtime-recipes) is the validator, so the harness drift
   * checks below would report a correct recipe as drift.
   */
  if (recipe.kind === 'model-runtime') {
    checked.modelRuntimeRecipes = (checked.modelRuntimeRecipes ?? 0) + 1
    if (recipe.schemaVersion !== 1) {
      fail(path, 'schemaVersion', 'a model-runtime recipe must declare schemaVersion 1')
    }
    continue
  }
  checked.recipes += 1
  if (recipe.schemaVersion !== undefined && recipe.schemaVersion !== SCHEMA_VERSION) {
    fail(path, 'schemaVersion', `expected ${SCHEMA_VERSION}, saw ${JSON.stringify(recipe.schemaVersion)}`)
  }
  if (typeof recipe.version !== 'string' || !/^\d+\.\d+\.\d+/.test(recipe.version)) {
    fail(path, 'version', `not a semantic version: ${JSON.stringify(recipe.version)}`)
  }
}

// ---- Protocol ---------------------------------------------------------------------------
const protocolSource = join(PACKAGES, 'dsh-tool-mode', 'src', 'mcp', 'protocol.ts')
const protocolText = readFileSync(protocolSource, 'utf8')
const protocolMatch = /PROTOCOL_VERSION = '([^']+)'/.exec(protocolText)
if (protocolMatch === null) fail(protocolSource, 'PROTOCOL_VERSION', 'constant not found')
else if (!/^2026-07-28$/.test(protocolMatch[1])) fail(protocolSource, 'PROTOCOL_VERSION', `unexpected protocol ${protocolMatch[1]}`)

const report = { ok: problems.length === 0, checked, problems }
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else if (report.ok) {
  console.log(`RELEASE-DRIFT-OK manifests=${checked.manifests} locks=${checked.locks} assets=${checked.assets} processors=${checked.processors} recipes=${checked.recipes} protocol=2026-07-28`)
} else {
  for (const problem of problems.slice(0, 40)) console.error(`DRIFT ${problem.file} ${problem.field}: ${problem.reason}`)
  if (problems.length > 40) console.error(`… ${problems.length - 40} more`)
  console.error(`release drift: ${problems.length} problem(s)`)
}
process.exit(report.ok ? 0 : 1)
