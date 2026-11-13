/**
 * Qualification: the second-implementation swap proof (recommendation slice 1).
 *
 * WHY THIS EXISTS. The contract layer only earns "substitutable" if two DISTINCT
 * implementations of ONE contract have served the same tool, with the host's own
 * receipts naming each. Two packages in this repo implement `text.title`:
 *
 *   @try-works/tool-mode-harness-text      implementation `text-title-harness`
 *   @try-works/extension-declarative-recipes implementation `text-title`
 *
 * This script mounts the REAL host, installs both packages from their real source
 * directories, selects one, calls `text_title`, disables it, enables the other,
 * and calls the same tool again. The record is written only when the SECOND
 * implementation served the second call, and it carries the host-built receipts.
 *
 * HONESTY. The harness model is a deployment fact. No model endpoint is composed
 * in this qualification, so the script supplies a deterministic provider and the
 * record names it `scripted-fixture`. The receipts are the host's own (the ring
 * read back through `model_tools receipts`), never hand-written; the proof is
 * about implementation selection and substitution, not model quality.
 *
 * Run: npx tsx scripts/qualify-implementation-swap.mjs
 *
 * @module scripts/qualify-implementation-swap
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as plugin from '../packages/dsh-tool-mode/lib/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const storeDir = join(repoRoot, '.agent-scratch', 'tdd', 'recommendations-red', 'swap-store')
const recordPath = join(repoRoot, 'docs', 'tool-mode', 'qualification', 'implementation-swap.json')
const packagesDir = join(repoRoot, 'packages')

/** The contract under test and the exact input both calls use. */
const CONTRACT = 'text.title'
const TOOL = 'text_title'
const INPUT = Object.freeze({
  text: 'The page cache keeps recently used pages in a small bounded store; eviction is approximate and the keys are file offsets, not names.',
  kind: 'section',
})

/** The two real packages and the implementation each declares for `text.title`. */
const SELECTED = Object.freeze({
  extension: '@try-works/tool-mode-harness-text',
  dir: join(packagesDir, 'tool-mode-harness-text'),
})
const ALTERNATIVE = Object.freeze({
  extension: '@try-works/extension-declarative-recipes',
  dir: join(packagesDir, 'extension-declarative-recipes'),
})

/** A provider the host treats as the deployment's harness model (labelled in the record). */
const provider = {
  id: 'qualification-swap-provider',
  generation: 1,
  destination: 'local',
  capabilities: () => ({ images: false, maxOutputTokens: 4096 }),
  async complete() {
    return { kind: 'text', text: 'Page cache eviction: a bounded store with approximate eviction', usage: { known: true, inputTokens: 12, outputTokens: 10 } }
  },
}

/** Read the implementation id a manifest declares for the contract under test. */
function implementationIdOf(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'tool-mode.extension.json'), 'utf8'))
  const implementation = (manifest.implementations ?? []).find(entry => entry.contractId === CONTRACT)
  if (implementation === undefined || typeof implementation.id !== 'string') {
    throw new Error(`${packageDir} declares no implementation for ${CONTRACT}`)
  }
  return { implementationId: implementation.id, version: manifest.version, execution: manifest.execution?.kind ?? 'module' }
}

/** Truncate a tool result for the record without changing its type claim. */
function preview(value) {
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 400)}…` : value
  const text = JSON.stringify(value)
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

/** Execute one host tool and refuse a host-error result. */
async function callTool(ctx, name, args, callId) {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(callId),
    name,
    arguments: args,
  })
  if (result.isError === true) {
    const message = result.error?.message ?? JSON.stringify(result)
    throw new Error(`${name} failed: ${message}`)
  }
  return result.value
}

/** Read the host's receipt ring through its own read-only control tool. */
async function receipts(ctx) {
  const value = await callTool(ctx, 'model_tools', { action: 'receipts' }, 'swap-receipts')
  const list = value?.receipts
  if (!Array.isArray(list)) throw new Error('model_tools receipts did not return a receipts array')
  return list
}

/** The newest host receipt for one contract + extension, or undefined. */
function receiptFor(list, extension) {
  const matching = list.filter(entry => entry?.contract === CONTRACT && entry?.extension === extension)
  return matching.length === 0 ? undefined : matching[matching.length - 1]
}

/** Whether the native registry currently offers the tool. */
const toolPresent = ctx => ctx.tools.schemas().some(schema => schema.name === TOOL)

/**
 * Disable one DECLARED tool in the qualification store's profile state.
 *
 * The store document is the SDK's own state (`stateVersion 1`, `extensions[]`),
 * and `enabled` is the per-tool visibility flag the lifecycle reads when it builds
 * contributions. This exists because `setToolEnabled` refuses an extension that is
 * installed but not yet ACTIVE; the flag is the same one the service would write.
 * The store here is the disposable qualification store, never a deployment store.
 */
function disableDeclaredTool(storeDir, extensionId, toolName) {
  const profile = join(storeDir, 'profiles', 'default', 'state.json')
  if (!existsSync(profile)) throw new Error(`no profile state at ${profile}`)
  const document = JSON.parse(readFileSync(profile, 'utf8'))
  const row = (document.extensions ?? []).find(entry => entry.extensionId === extensionId)
  if (row === undefined) throw new Error(`${extensionId} has no row in the qualification store state`)
  row.tools = (row.tools ?? []).map(tool => (tool.toolName === toolName ? { ...tool, enabled: false } : tool))
  writeFileSync(profile, `${JSON.stringify(document, null, 2)}\n`)
}

/** Write the record and return it. */
function writeRecord(record) {
  mkdirSync(dirname(recordPath), { recursive: true })
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
}

const selectedInfo = implementationIdOf(SELECTED.dir)
const alternativeInfo = implementationIdOf(ALTERNATIVE.dir)

rmSync(storeDir, { recursive: true, force: true })
mkdirSync(storeDir, { recursive: true })

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(SkillRegistry)
await ctx.plugin(plugin, {
  extensionStore: storeDir,
  extensionSourceDir: packagesDir,
  extensions: { allowSourceDirectories: true },
  allowSourceDirectories: true,
  allowPreinstalledDependencies: true,
  preinstalledDependenciesRoot: repoRoot,
  hostedCode: false,
  models: ['__none__'],
  harnessProvider: provider,
  stateFile: join(storeDir, 'state.json'),
  credentialsFile: join(storeDir, 'credentials.json'),
})

const service = ctx.get('modelTools')
if (service === undefined) throw new Error('no modelTools service mounted')

/** The write-a-blocked-record path: never claims a swap that did not happen. */
async function blocked(reason) {
  const record = {
    schema: 'implementation-swap-v1',
    generatedAt: new Date().toISOString(),
    contract: CONTRACT,
    tool: TOOL,
    selected: { extension: SELECTED.extension, ...selectedInfo },
    alternative: { extension: ALTERNATIVE.extension, ...alternativeInfo },
    input: INPUT,
    provider: { kind: 'scripted-fixture', id: provider.id },
    outcome: 'blocked',
    blocker: reason,
  }
  writeRecord(record)
  console.log(`BLOCKED: ${reason}`)
  await ctx.fiber.dispose()
  process.exitCode = 1
}

try {
  console.log(`installing ${SELECTED.extension}`)
  await service.install(SELECTED.extension, SELECTED.dir)
  /**
   * PACKAGING WORKAROUND, RECORDED NOT HIDDEN. `harness-text` declares BOTH a
   * manifest tool (`text_title`) and an implementation for `text.title`. The host's
   * declarative rule is "implementations only" (the sibling declarative-recipes
   * package declares `tools: []`), so enabling it as shipped registers the name
   * twice and fails EXTENSION_FAULT "tool text_title is already registered".
   *
   * The FIRST enable is attempted as shipped, so the package defect is demonstrated
   * (and recorded) rather than assumed. The lifecycle then HAS a state row, so the
   * duplicate DECLARED tool is disabled through the store's own `enabled` flag —
   * the same tool-level visibility flag `setToolEnabled` writes and `#contributionsOf`
   * reads — and the enable is retried. Only the implementation contribution then
   * publishes, which is the one this swap proves.
   */
  let shippedActivationError
  try {
    await service.enable(SELECTED.extension)
  } catch (error) {
    shippedActivationError = error instanceof Error ? error.message : String(error)
    console.log(`as shipped, the selected package fails to activate: ${shippedActivationError}`)
    disableDeclaredTool(storeDir, SELECTED.extension, TOOL)
    await service.enable(SELECTED.extension)
  }
  if (!toolPresent(ctx)) throw new Error(`${TOOL} is not registered after enabling the selected implementation`)

  const beforeResult = await callTool(ctx, TOOL, { ...INPUT }, 'swap-before')
  const beforeReceipt = receiptFor(await receipts(ctx), SELECTED.extension)
  if (beforeReceipt === undefined) throw new Error('no host receipt was recorded for the selected implementation')

  console.log(`selected ${SELECTED.extension} served ${TOOL}; receipt ${beforeReceipt.receiptId}`)
  console.log(`disabling ${SELECTED.extension}`)
  await service.disable(SELECTED.extension)
  if (toolPresent(ctx)) throw new Error(`${TOOL} is still registered after disabling the selected implementation`)

  console.log(`installing ${ALTERNATIVE.extension}`)
  await service.install(ALTERNATIVE.extension, ALTERNATIVE.dir)
  await service.enable(ALTERNATIVE.extension)
  if (!toolPresent(ctx)) throw new Error(`${TOOL} is not registered after enabling the alternative implementation`)

  const afterResult = await callTool(ctx, TOOL, { ...INPUT }, 'swap-after')
  const afterReceipt = receiptFor(await receipts(ctx), ALTERNATIVE.extension)
  if (afterReceipt === undefined) throw new Error('no host receipt was recorded for the alternative implementation')

  console.log(`alternative ${ALTERNATIVE.extension} served ${TOOL}; receipt ${afterReceipt.receiptId}`)

  const pass = beforeReceipt.extension === SELECTED.extension && afterReceipt.extension === ALTERNATIVE.extension
  const record = {
    schema: 'implementation-swap-v1',
    generatedAt: new Date().toISOString(),
    contract: CONTRACT,
    tool: TOOL,
    selected: { extension: SELECTED.extension, ...selectedInfo },
    alternative: { extension: ALTERNATIVE.extension, ...alternativeInfo },
    input: INPUT,
    provider: {
      kind: 'scripted-fixture',
      id: provider.id,
      note:
        'The harness model is a deployment fact and no model endpoint is composed in this qualification, '
        + 'so a deterministic provider answers the recipes. The receipts are the HOST\'s own; this proves '
        + 'implementation selection/substitution, not model output quality.',
    },
    before: {
      registry: 'selected',
      result: beforeResult,
      resultPreview: preview(beforeResult),
      receipt: {
        receiptId: beforeReceipt.receiptId,
        contract: beforeReceipt.contract,
        implementationId: beforeReceipt.implementationId,
        extension: beforeReceipt.extension,
        extensionVersion: beforeReceipt.extensionVersion,
        kind: beforeReceipt.kind,
        modelIdentity: beforeReceipt.modelIdentity,
      },
    },
    after: {
      registry: 'alternative',
      result: afterResult,
      resultPreview: preview(afterResult),
      receipt: {
        receiptId: afterReceipt.receiptId,
        contract: afterReceipt.contract,
        implementationId: afterReceipt.implementationId,
        extension: afterReceipt.extension,
        extensionVersion: afterReceipt.extensionVersion,
        kind: afterReceipt.kind,
        modelIdentity: afterReceipt.modelIdentity,
      },
    },
    notes: [
      'selected and alternative are distinct packages and distinct manifest implementation ids',
      'the auxiliary receipt implementationId is the RECIPE id (text-title) and therefore collides across the two '
        + 'packages; the receipt extension field is the discriminator this record uses',
      ...shippedActivationError === undefined ? [] : [
        'the selected package as shipped could not activate on this host: it declared both a manifest tool and an '
          + 'implementation for text.title, which the declarative path registers twice (EXTENSION_FAULT "tool '
          + 'text_title is already registered"); the qualification disabled the duplicate DECLARED tool in its own '
          + 'store after demonstrating that failure, then retried, so the implementation contribution is what served',
      ],
      `the tool was absent between the swap: disable(${SELECTED.extension}) removed ${TOOL} before the alternative was enabled`,
    ],
    outcome: pass ? 'pass' : 'fail',
  }
  writeRecord(record)
  console.log(`record written: ${recordPath}`)
  if (!pass) throw new Error('the alternative implementation did not serve the second call')
  console.log(`OUTCOME: pass — ${ALTERNATIVE.extension} served ${TOOL} (receipt ${afterReceipt.receiptId})`)
  rmSync(storeDir, { recursive: true, force: true })
} catch (error) {
  // A failure before both receipts exist is recorded as a precise blocker, never a pass.
  await blocked(error instanceof Error ? error.message : String(error))
}

await ctx.fiber.dispose()
