#!/usr/bin/env node
/**
 * AT-26 — a clean external author fixture builds/runs using only the published
 * SDK + contracts and their declared libraries, with NO host or DSH source in
 * the dependency graph.
 *
 * Usage: node scripts/verify-author-fixture.mjs
 * Exit 0 only when the fixture runs and its installed graph contains neither
 * @try-works/dsh-tool-mode nor any @deepseek-ai/dsh-* package.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SDK = join(ROOT, 'packages', 'tool-mode-extension-sdk')
const CONTRACTS = join(ROOT, 'packages', 'tool-mode-contracts')
const scratch = mkdtempSync(join(tmpdir(), 'external-author-'))
const tarballs = join(scratch, 'tarballs')
const project = join(scratch, 'project')

function npm(args, cwd, timeout = 300_000) {
  const run = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')], {
      cwd, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
    })
    : spawnSync('npm', args, { cwd, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`npm ${args.join(' ')} failed:\n${run.stdout ?? ''}\n${run.stderr ?? ''}`)
  return run.stdout ?? ''
}

try {
  for (const dir of [tarballs, project]) mkdirSync(dir, { recursive: true })
  const useNpm = process.argv.includes('--npm')
  let dependencies
  let provenance
  if (useNpm) {
    dependencies = {
      '@try-works/tool-mode-extension-sdk': '0.1.5',
      '@try-works/tool-mode-contracts': '0.1.1',
    }
    provenance = 'npm registry exact versions'
  } else {
    const sdkPack = JSON.parse(npm(['pack', '--json', '--pack-destination', tarballs, SDK], ROOT))
    const contractsPack = JSON.parse(npm(['pack', '--json', '--pack-destination', tarballs, CONTRACTS], ROOT))
    const sdkTarball = join(tarballs, sdkPack[0].filename)
    const contractsTarball = join(tarballs, contractsPack[0].filename)
    dependencies = {
      '@try-works/tool-mode-extension-sdk': `file:${sdkTarball}`,
      '@try-works/tool-mode-contracts': `file:${contractsTarball}`,
    }
    provenance = 'local packed tarballs'
  }
  writeFileSync(join(project, 'package.json'), JSON.stringify({
    name: 'external-author-fixture',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2))
  npm(['install', '--no-audit', '--no-fund'], project)
  for (const [name, version] of Object.entries(dependencies)) {
    const installed = JSON.parse(readFileSync(join(project, 'node_modules', name, 'package.json'), 'utf8'))
    if (installed.version !== version) throw new Error(`${name} installed ${installed.version}, expected ${version}`)
  }

  writeFileSync(join(project, 'entry.mjs'), `
    export default {
      apiVersion: 1,
      async create() {
        return {
          async createProvider() {
            return {
              async inspect() { return { readiness: 'ready', features: ['fixture-add'] } },
              async load() {},
              async invoke(request) {
                const input = request.input ?? {}
                return { sum: Number(input.a) + Number(input.b) }
              },
              async unload() {},
              async dispose() {},
            }
          },
          async dispose() {},
        }
      },
    }
  `)
  writeFileSync(join(project, 'run.mjs'), `
    import { fileURLToPath } from 'node:url'
    import { createAuthorTestHost } from '@try-works/tool-mode-extension-sdk'
    import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'
    const host = await createAuthorTestHost({ entryPath: fileURLToPath(new URL('./entry.mjs', import.meta.url)) })
    const provider = await host.instance.createProvider({ modelId: 'author-fixture', configuration: {} })
    await provider.load({ assets: { get: () => undefined, assetIds: [] }, signal: new AbortController().signal })
    const output = await provider.invoke({
      implementationId: 'author-fixture-add',
      input: { a: 2, b: 3 },
      context: { invocationId: 'author-fixture', signal: new AbortController().signal, limits: {}, resolvePath: p => p },
    })
    console.log(JSON.stringify({ output, contracts: STANDARD_CONTRACTS.length }))
    await host.dispose()
  `)
  const run = spawnSync(process.execPath, [join(project, 'run.mjs')], { cwd: project, encoding: 'utf8', timeout: 120_000 })
  if (run.status !== 0) throw new Error(`author fixture failed:\n${run.stdout ?? ''}\n${run.stderr ?? ''}`)
  const result = JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1))
  if (result.output?.sum !== 5) throw new Error(`author fixture returned the wrong result: ${JSON.stringify(result)}`)
  if (!(result.contracts > 0)) throw new Error('the contracts package did not expose its standard contracts')

  const tree = JSON.parse(npm(['ls', '--all', '--json'], project))
  const names = new Set()
  const walk = node => {
    if (node === undefined || typeof node !== 'object') return
    for (const [name, value] of Object.entries(node.dependencies ?? {})) {
      names.add(name)
      walk(value)
    }
  }
  walk(tree)
  const forbidden = [...names].filter(name => name === '@try-works/dsh-tool-mode' || name.startsWith('@deepseek-ai/dsh-'))
  if (forbidden.length > 0) throw new Error(`host/DSH source leaked into the author fixture: ${forbidden.join(', ')}`)
  if (!names.has('@try-works/tool-mode-extension-sdk') || !names.has('@try-works/tool-mode-contracts')) {
    throw new Error(`the author fixture did not install the published SDK/contracts: ${[...names].join(', ')}`)
  }
  console.log(`AUTHOR-FIXTURE-OK source=${provenance} sum=${result.output.sum} contracts=${result.contracts} packages=${[...names].sort().join(',')}`)
} finally {
  try { rmSync(scratch, { recursive: true, force: true }) } catch { /* best effort */ }
}


