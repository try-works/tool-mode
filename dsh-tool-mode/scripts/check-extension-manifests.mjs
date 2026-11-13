#!/usr/bin/env node
/**
 * Extension-manifest drift guard (docs/plans/recommendation-execution.md, Slice 6).
 *
 * This is deliberately the FIRST DERIVABLE SLICE of "derive the manifest", not full
 * derivation. A manifest entry today is hand-written next to its package.json, and the
 * facts this check can prove without new SDK authoring metadata are:
 *
 * - `id` and `version` agree with the extension's package.json;
 * - tool ids, tool names and implementation ids are unique inside one manifest;
 * - every `inputSchema`/`outputSchema` path exists inside the package;
 * - every implementation names a contract the manifest declares, or a STANDARD contract
 *   from @try-works/tool-mode-contracts (a declarative package ships no tools of its own
 *   and binds the standard contracts);
 * - when a manifest declares a tool and an implementation for the same contract, their
 *   `contractVersion` agrees.
 *
 * Full generation (defineExtension() emitting the manifest) is still remaining work: the
 * extension entries do not carry the authoring metadata the SDK would need to derive tool
 * descriptions, permissions and models from code. This script deliberately does not claim
 * otherwise.
 *
 * Usage: node scripts/check-extension-manifests.mjs [--root <dir>]
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The standard contract ids, read from the contracts SOURCE rather than imported.
 * @param root - repository root.
 * @returns the declared `contract` strings.
 */
function standardContractIds(root) {
  const ids = new Set()
  const contractsDir = join(root, 'packages', 'tool-mode-contracts', 'src', 'contracts')
  if (!existsSync(contractsDir)) return ids
  for (const file of readdirSync(contractsDir)) {
    if (!file.endsWith('.ts')) continue
    const lines = readFileSync(join(contractsDir, file), 'utf8').split('\n')
    for (const line of lines) {
      const match = /contract:\s*'([^']+)'/.exec(line)
      if (match !== null) ids.add(match[1])
    }
  }
  return ids
}

/**
 * Check every `packages/extension-<name>/tool-mode.extension.json` under one root.
 * @param root - repository root (defaults to the current directory).
 * @returns `{ manifests, violations }`; violations are human-readable and ordered.
 */
export function checkExtensionManifests(root = process.cwd()) {
  const packagesDir = join(root, 'packages')
  if (!existsSync(packagesDir)) {
    return { manifests: [], violations: ['packages/ does not exist under ' + root] }
  }
  const manifests = []
  const violations = []
  const standardIds = standardContractIds(root)
  const packageNames = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    // Any package carrying this manifest is an extension-shaped package. Restricting
    // to the `extension-` prefix missed the two declarative harness packages, which
    // is exactly where the swap proof found a duplicate tool/implementation defect.
    if (existsSync(join(packagesDir, entry.name, 'tool-mode.extension.json'))) {
      packageNames.push(entry.name)
    }
  }
  packageNames.sort()

  for (const packageName of packageNames) {
    const packageDir = join(packagesDir, packageName)
    const manifestPath = join(packageDir, 'tool-mode.extension.json')
    const packageJsonPath = join(packageDir, 'package.json')
    if (!existsSync(manifestPath)) continue

    manifests.push({ package: packageName, path: manifestPath })
    let manifest
    let pkg
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      violations.push(packageName + ': manifest is not valid JSON (' + String(error) + ')')
      continue
    }
    try {
      pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    } catch (error) {
      violations.push(packageName + ': package.json is missing or invalid (' + String(error) + ')')
      continue
    }

    if (manifest.id !== pkg.name) {
      violations.push(packageName + ': manifest id ' + JSON.stringify(manifest.id) + ' != package.json name ' + JSON.stringify(pkg.name))
    }
    if (manifest.version !== pkg.version) {
      violations.push(packageName + ': manifest version ' + JSON.stringify(manifest.version) + ' != package.json version ' + JSON.stringify(pkg.version))
    }

    const tools = Array.isArray(manifest.tools) ? manifest.tools : []
    const implementations = Array.isArray(manifest.implementations) ? manifest.implementations : []
    const toolIds = new Set()
    const toolNames = new Set()
    const declaredContracts = []

    for (let index = 0; index < tools.length; index += 1) {
      const tool = tools[index]
      if (tool === null || typeof tool !== 'object') {
        violations.push(packageName + ': tools[' + index + '] is not an object')
        continue
      }
      for (const field of ['id', 'name']) {
        if (typeof tool[field] !== 'string' || tool[field].length === 0) {
          violations.push(packageName + ': tools[' + index + '].' + field + ' must be a non-empty string')
        }
      }
      if (toolIds.has(tool.id)) violations.push(packageName + ': duplicate tool id ' + JSON.stringify(tool.id))
      toolIds.add(tool.id)
      if (toolNames.has(tool.name)) violations.push(packageName + ': duplicate tool name ' + JSON.stringify(tool.name))
      toolNames.add(tool.name)

      if (typeof tool.contractId === 'string' && tool.contractId.length > 0) {
        let duplicate = false
        for (const declared of declaredContracts) {
          if (declared.contractId === tool.contractId) duplicate = true
        }
        if (duplicate) {
          violations.push(packageName + ': two tools declare contract ' + JSON.stringify(tool.contractId))
        } else {
          declaredContracts.push({ contractId: tool.contractId, version: tool.contractVersion })
        }
      }

      for (const field of ['inputSchema', 'outputSchema']) {
        const relative = tool[field]
        if (typeof relative !== 'string' || relative.length === 0) {
          violations.push(packageName + ': tools[' + index + '].' + field + ' is missing')
          continue
        }
        const absolute = resolve(packageDir, relative)
        const base = resolve(packageDir)
        if (absolute !== base && !absolute.startsWith(base + sep)) {
          violations.push(packageName + ': tools[' + index + '].' + field + ' escapes the package: ' + relative)
          continue
        }
        if (!existsSync(absolute)) {
          violations.push(packageName + ': tools[' + index + '].' + field + ' does not exist: ' + relative)
        }
      }
    }

    const implementationIds = new Set()
    for (let index = 0; index < implementations.length; index += 1) {
      const implementation = implementations[index]
      if (implementation === null || typeof implementation !== 'object') {
        violations.push(packageName + ': implementations[' + index + '] is not an object')
        continue
      }
      if (typeof implementation.id !== 'string' || implementation.id.length === 0) {
        violations.push(packageName + ': implementations[' + index + '].id must be a non-empty string')
      } else if (implementationIds.has(implementation.id)) {
        violations.push(packageName + ': duplicate implementation id ' + JSON.stringify(implementation.id))
      }
      implementationIds.add(implementation.id)

      const contractId = implementation.contractId
      if (typeof contractId !== 'string' || contractId.length === 0) {
        violations.push(packageName + ': implementations[' + index + '].contractId is missing')
        continue
      }
      let declaredVersion = null
      for (const declared of declaredContracts) {
        if (declared.contractId === contractId) declaredVersion = declared.version
      }
      if (declaredVersion === null && !standardIds.has(contractId)) {
        violations.push(
          packageName + ': implementation ' + JSON.stringify(implementation.id) + ' names unknown contract ' + JSON.stringify(contractId),
        )
      }
      if (declaredVersion !== null && implementation.contractVersion !== declaredVersion) {
        violations.push(
          packageName + ': implementation ' + JSON.stringify(implementation.id) + ' contractVersion '
          + JSON.stringify(implementation.contractVersion) + ' != declared tool version ' + JSON.stringify(declaredVersion),
        )
      }
    }

    for (const declared of declaredContracts) {
      let implemented = false
      for (const implementation of implementations) {
        if (implementation !== null && typeof implementation === 'object' && implementation.contractId === declared.contractId) {
          implemented = true
        }
      }
      if (!implemented) {
        violations.push(packageName + ': declared tool contract ' + JSON.stringify(declared.contractId) + ' has no implementation')
      }
    }
  }

  return { manifests, violations }
}

/** Print the verdict; used by the CLI. */
function report(root) {
  const result = checkExtensionManifests(root)
  if (result.violations.length > 0) {
    console.error('extension manifest drift: ' + result.violations.length + ' violation(s) across ' + result.manifests.length + ' manifest(s)')
    for (const violation of result.violations) console.error('  - ' + violation)
    return 1
  }
  console.log('extension manifests OK: ' + result.manifests.length + ' package(s), ' + standardContractIds(root).size + ' standard contract id(s)')
  return 0
}

const invokedDirectly = process.argv[1] !== undefined
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) {
  const rootArg = process.argv.indexOf('--root')
  const root = rootArg >= 0 ? process.argv[rootArg + 1] : process.cwd()
  if (root === undefined) {
    console.error('--root requires a directory')
    process.exit(2)
  }
  process.exitCode = report(root)
}
