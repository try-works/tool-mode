/**
 * Runtime package verification gate.
 *
 * The runtime layer (docs/runtime/PLAN.md) is the runtime packages plus the redact extension,
 * host stays untouched. This gate answers three questions for every one of them: does it
 * build, does it typecheck, and do its tests pass? It is deliberately a RUNNER, not a
 * re-implementation: each package's own tsconfig and tests stay the source of truth.
 *
 * BUILD COMES FIRST, and the order is load-bearing. By repo convention a cross-package
 * import resolves through the package name to @try-works/<pkg>/lib/index.js, so a consumer
 * needs its dependency BUILT, not merely present. Packages are therefore verified in
 * dependency order (core -> processors -> litert -> dsh -> runtime-recipes -> runtime-onnx ->
 * extension-redact -> extension-shapes-recipe -> extension-uhm-recipe ->
 * extension-clear-recipe -> extension-moderator-recipe -> extension-ear-recipe ->
 * extension-emo-recipe), and each one runs:
 *
 *   1. tsc -p tsconfig.build.json      writes lib/, which consumers import by name
 *   2. tsc --noEmit -p tsconfig.json   checks src + tests against the package config
 *   3. tsx --test tests/*.test.ts      runs the suite
 *
 * Binaries are resolved from the repository's own node_modules and executed through
 * `process.execPath`, so the gate never needs npm, a network call, or a shell. On Windows
 * that also avoids `.cmd` shim quoting entirely.
 *
 * A missing package is NOT a pass. The gate exits nonzero when a package is absent unless
 * `--allow-missing` is passed, because a green gate over zero packages is a false claim of
 * coverage.
 *
 * @module scripts/verify-runtime
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * Packages this gate covers, in DEPENDENCY order: a consumer is verified only after the
 * packages it imports have been built, because it imports their lib/ by package name.
 * `phase` is the PLAN phase that introduces the package.
 */
export const PACKAGES = [
  { name: 'tool-mode-runtime-core', phase: 0 },
  { name: 'tool-mode-runtime-processors', phase: 1 },
  { name: 'tool-mode-runtime-litert', phase: 1 },
  { name: 'tool-mode-runtime-dsh', phase: 0 },
  { name: 'tool-mode-runtime-recipes', phase: 2 },
  { name: 'tool-mode-runtime-onnx', phase: 3 },
  { name: 'extension-redact', phase: 1 },
  { name: 'extension-shapes-recipe', phase: 2, kind: 'tests-only' },
  { name: 'extension-uhm-recipe', phase: 3, kind: 'tests-only' },
  { name: 'extension-clear-recipe', phase: 3, kind: 'tests-only' },
  { name: 'extension-moderator-recipe', phase: 4, kind: 'tests-only' },
  { name: 'extension-ear-recipe', phase: 4, kind: 'tests-only' },
  { name: 'extension-emo-recipe', phase: 4, kind: 'tests-only' },
]

/** Result labels rendered in the table. */
export const PASS = 'PASS'
export const FAIL = 'FAIL'
export const MISSING = 'MISSING'
/** A step a package is not supposed to have (no TypeScript in a code-free package). */
export const NOT_APPLICABLE = 'N/A'

/** Default per-command budget. Inference tests are slow; a hung one must not hang the gate. */
const DEFAULT_TIMEOUT_MS = 300_000

/** Longest child output tail printed for a failing command. */
const OUTPUT_TAIL_LINES = 120

/**
 * Locate a tool inside the repository's node_modules.
 * @param {string} root - repository root.
 * @param {string} name - package name to resolve, e.g. 'tsx'.
 * @param {readonly string[]} candidates - paths relative to `node_modules/<name>`.
 * @returns {string | undefined} absolute path to the entry file, or undefined when absent.
 */
export function resolveTool(root, name, candidates) {
  for (const candidate of candidates) {
    const absolute = join(root, 'node_modules', name, candidate)
    if (existsSync(absolute)) return absolute
  }
  return undefined
}

/** Tools this gate needs, resolved once. */
export function resolveTools(root) {
  return {
    tsc: resolveTool(root, 'typescript', ['bin/tsc']),
    tsx: resolveTool(root, 'tsx', ['dist/cli.mjs']),
  }
}

/**
 * Run one command and capture its output.
 * @param {readonly string[]} command - argv, executable first.
 * @param {{cwd: string, timeoutMs?: number, env?: Record<string, string | undefined>}} options
 * @returns {Promise<{code: number, stdout: string, stderr: string, timedOut: boolean, durationMs: number}>}
 */
export function run(command, options) {
  const [executable, ...args] = command
  const startedAt = Date.now()
  return new Promise((resolvePromise) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      stdio: 'pipe',
      env: { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      killSignal: 'SIGTERM',
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      resolvePromise({ code: 1, stdout, stderr: stderr + String(error), timedOut: false, durationMs: Date.now() - startedAt })
    })
    child.on('close', (code, signal) => {
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr,
        timedOut: signal === 'SIGTERM',
        durationMs: Date.now() - startedAt,
      })
    })
  })
}

/**
 * Does a directory holding a package's sources exist?
 * @param {string} root - repository root.
 * @param {string} name - package directory name.
 * @returns {{present: boolean, directory: string, hasTsconfig: boolean, hasBuildTsconfig: boolean, tests: readonly string[]}}
 */
export function inspectPackage(root, name) {
  const directory = join(root, 'packages', name)
  const present = existsSync(directory) && statSync(directory).isDirectory()
  const hasTsconfig = present && existsSync(join(directory, 'tsconfig.json'))
  const hasBuildTsconfig = present && existsSync(join(directory, 'tsconfig.build.json'))
  const testsDirectory = join(directory, 'tests')
  const tests = present && existsSync(testsDirectory)
    ? readdirSync(testsDirectory).filter((entry) => entry.endsWith('.test.ts')).sort().map((entry) => join(testsDirectory, entry))
    : []
  return { present, directory, hasTsconfig, hasBuildTsconfig, tests }
}

/**
 * Verify one package.
 * @param {string} root - repository root.
 * @param {{name: string, phase: number, kind?: string}} pkg - package under test.
 * @param {{tools: ReturnType<typeof resolveTools>, timeoutMs: number}} context - the resolved tools and budget.
 * @returns {Promise<{name: string, phase: number, build: string, typecheck: string, tests: string, result: string, detail: string}>}
 */
export async function verifyPackage(root, pkg, context) {
  const inspected = inspectPackage(root, pkg.name)
  const base = { name: pkg.name, phase: pkg.phase }
  const testsOnly = pkg.kind === 'tests-only'

  if (!inspected.present) {
    return { ...base, build: MISSING, typecheck: MISSING, tests: MISSING, result: MISSING, detail: 'package directory absent' }
  }
  const needsTsc = !testsOnly
  if ((needsTsc && context.tools.tsc === undefined) || context.tools.tsx === undefined) {
    const absent = [needsTsc && context.tools.tsc === undefined ? 'typescript' : undefined, context.tools.tsx === undefined ? 'tsx' : undefined].filter(Boolean)
    return { ...base, build: FAIL, typecheck: FAIL, tests: FAIL, result: FAIL, detail: `cannot run: missing ${absent.join(', ')} in node_modules` }
  }
  const notes = []
  const tsc = context.tools.tsc

  const tsconfig = join('packages', pkg.name, 'tsconfig.json')

  // 1. Build first. It writes lib/, which is what a dependent package imports by name. A
  // code-free package has nothing to build, so it reports N/A instead of a FAIL that would
  // blame it for a config it is not supposed to have.
  let build = NOT_APPLICABLE
  if (!testsOnly) {
    build = FAIL
    if (inspected.hasBuildTsconfig) {
      const buildRun = await run([process.execPath, tsc, '-p', join('packages', pkg.name, 'tsconfig.build.json')], {
        cwd: root,
        timeoutMs: context.timeoutMs,
      })
      build = buildRun.code === 0 ? PASS : FAIL
      if (buildRun.code !== 0) notes.push(summarize('build', buildRun))
    } else {
      notes.push('build: tsconfig.build.json missing, so consumers cannot import lib/')
    }
  }

  // 2. Typecheck and 3. tests both run from the REPOSITORY ROOT, which is this repo's
  // convention: the root `npm test` script passes package-relative test paths, and existing
  // suites resolve their fixtures against process.cwd(). Running from the package directory
  // makes those fixtures resolve as packages/<pkg>/packages/<pkg>/..., which is how this gate
  // first discovered the convention.
  let typecheck = NOT_APPLICABLE
  if (!testsOnly) {
    typecheck = FAIL
    if (inspected.hasTsconfig) {
      const typecheckRun = await run([process.execPath, tsc, '--noEmit', '-p', tsconfig], {
        cwd: root,
        timeoutMs: context.timeoutMs,
      })
      typecheck = typecheckRun.code === 0 ? PASS : FAIL
      if (typecheckRun.code !== 0) notes.push(summarize('typecheck', typecheckRun))
    } else {
      notes.push('typecheck: tsconfig.json missing')
    }
  }

  let tests = MISSING
  if (inspected.tests.length > 0) {
    const testsRun = await run([process.execPath, context.tools.tsx, '--test', ...inspected.tests], {
      cwd: root,
      timeoutMs: context.timeoutMs,
    })
    tests = testsRun.code === 0 ? PASS : FAIL
    if (testsRun.code !== 0) notes.push(summarize('tests', testsRun))
  } else {
    notes.push('tests: no tests/*.test.ts found (TDD violation)')
  }

  const result = testsOnly
    ? (tests === PASS ? PASS : FAIL)
    : (build === PASS && typecheck === PASS && tests === PASS ? PASS : FAIL)
  return { ...base, build, typecheck, tests, result, detail: notes.join(' | ') }
}

/**
 * Render the useful part of a failed command: its exit, its timeout, and the output tail.
 * @param {string} label - command label.
 * @param {{code: number, stdout: string, stderr: string, timedOut: boolean, durationMs: number}} outcome - captured result.
 * @returns {string} a compact description.
 */
export function summarize(label, outcome) {
  const reason = outcome.timedOut ? `timed out after ${outcome.durationMs}ms` : `exit ${outcome.code}`
  const output = (outcome.stderr.trim() || outcome.stdout.trim()).split('\n')
  const tail = output.slice(-OUTPUT_TAIL_LINES).join('\n')
  return `${label} ${reason}:\n${tail}`
}

/**
 * Read the Effect version installed at the repository root, and any nested duplicates.
 * PLAN.md's "one hoisted copy" is a non-negotiable, so a duplicate is worth reporting even
 * though this gate treats it as a warning rather than a failure.
 * @param {string} root - repository root.
 * @returns {{version: string | undefined, duplicates: readonly string[]}}
 */
export function inspectEffect(root) {
  const readVersion = (directory) => {
    const manifest = join(directory, 'package.json')
    if (!existsSync(manifest)) return undefined
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      return typeof parsed.version === 'string' ? parsed.version : undefined
    } catch {
      return undefined
    }
  }
  const hoisted = join(root, 'node_modules', 'effect')
  const version = existsSync(hoisted) ? readVersion(hoisted) : undefined

  const duplicates = []
  const nodeModules = join(root, 'node_modules')
  if (existsSync(nodeModules)) {
    for (const entry of readdirSync(nodeModules)) {
      if (entry.startsWith('.')) continue
      const owners = entry.startsWith('@')
        ? readdirSync(join(nodeModules, entry)).map((child) => join(nodeModules, entry, child))
        : [join(nodeModules, entry)]
      for (const owner of owners) {
        if (existsSync(join(owner, 'node_modules', 'effect'))) duplicates.push(owner.replace(root, '.'))
      }
    }
  }
  return { version, duplicates }
}

/**
 * Render the results as a fixed-width table.
 * @param {readonly {name: string, phase: number, build: string, typecheck: string, tests: string, result: string}[]} rows - results.
 * @returns {string} the table.
 */
export function formatTable(rows) {
  const header = ['Package', 'Phase', 'Build', 'Typecheck', 'Tests', 'Result']
  const body = rows.map((row) => [row.name, String(row.phase), row.build, row.typecheck, row.tests, row.result])
  const widths = header.map((label, index) => Math.max(label.length, ...body.map((cells) => cells[index].length)))
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd()
  return [line(header), widths.map((width) => '-'.repeat(width)).join('  '), ...body.map(line)].join('\n')
}

/**
 * CLI entry point.
 * @param {readonly string[]} argv - process argv.
 * @returns {Promise<number>} the exit code.
 */
export async function main(argv) {
  const root = resolve(import.meta.dirname, '..')
  const allowMissing = argv.includes('--allow-missing')
  const only = argv.flatMap((argument, index) => (argument === '--package' ? [argv[index + 1]] : [])).filter((value) => typeof value === 'string')

  const selected = only.length > 0 ? PACKAGES.filter((pkg) => only.includes(pkg.name)) : PACKAGES
  if (selected.length === 0) {
    console.error(`No known package matched ${only.join(', ')}. Known: ${PACKAGES.map((pkg) => pkg.name).join(', ')}`)
    return 1
  }

  const tools = resolveTools(root)
  const effect = inspectEffect(root)
  console.log(`runtime gate  node ${process.version}`)
  console.log(`  effect: ${effect.version ?? 'NOT INSTALLED'}${effect.version === '4.1.2' ? '' : ' (PLAN requires 4.1.2)'}`)
  if (effect.duplicates.length > 0) console.log(`  WARNING nested effect copies: ${effect.duplicates.join(', ')} (PLAN requires one hoisted copy)`)
  if (tools.tsc === undefined) console.log('  WARNING typescript not found in node_modules')
  if (tools.tsx === undefined) console.log('  WARNING tsx not found in node_modules')
  console.log('')

  const rows = []
  for (const pkg of selected) {
    const row = await verifyPackage(root, pkg, { tools, timeoutMs: DEFAULT_TIMEOUT_MS })
    rows.push(row)
    console.log(`${row.result.padEnd(7)} ${row.name}`)
  }

  console.log('')
  console.log(formatTable(rows))

  const failures = rows.filter((row) => row.result === FAIL)
  const missing = rows.filter((row) => row.result === MISSING)
  for (const row of [...failures, ...missing]) {
    if (row.detail !== '') console.log(`\n--- ${row.name} ---\n${row.detail}`)
  }

  console.log('')
  console.log(`${rows.filter((row) => row.result === PASS).length} passed, ${failures.length} failed, ${missing.length} missing`)

  if (failures.length > 0) return 1
  if (missing.length > 0) {
    if (allowMissing) return 0
    console.log('rerun with --allow-missing to treat absent packages as outside this gate')
    return 2
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2))
}
