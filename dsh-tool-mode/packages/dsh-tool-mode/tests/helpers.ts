/**
 * Shared test harness.
 *
 * Every test mounts the plugin through {@link mountPlugin}, which always points
 * the durable state at a throwaway directory. That is not a convenience: the
 * plugin writes the user's enable/disable choices into `DSH_HOME` by default, so
 * a test that forgets to isolate would edit the developer's real configuration —
 * and a later test would then read those edits as if the user had made them.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ExtensionStore, stagedInstallFromDirectory } from '@try-works/tool-mode-extension-sdk'

import * as plugin from '../src/index.ts'

/** The deterministic Tongue stand-in (see tests/fixtures/tongue-extension). */
const TONGUE_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/tongue-extension', import.meta.url))
/** The extension id the fixture package declares (the SAME id the catalog binds). */
export const TONGUE_FIXTURE_ID = '@try-works/extension-desert-ant-tongue'

/** Process-wide cancellation signal for tool calls made by tests. */
export const testSignal = new AbortController().signal

const tempDirs: string[] = []
const contexts: Context[] = []
let callCounter = 0

/** A fresh directory that is removed when the process exits. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'model-as-tool-test-'))
  tempDirs.push(dir)
  return dir
}

/** A fresh state file inside its own throwaway directory. */
export function isolatedStateFile(): string {
  return join(tempDir(), 'state.json')
}

/**
 * Install the deterministic Tongue fixture into an extension store.
 *
 * The fixture is INSTALLED but deliberately NOT ACTIVATED: the production catalogue
 * enable path is what these tests must exercise, and an active extension would own
 * `lang_detect` and pre-empt it. The store is what makes the host's provider
 * inspection report `prepared-cold` instead of the correct `failed` a storeless
 * mount produces.
 * @param storeDir - an existing store directory, or undefined for a fresh one.
 * @returns the store directory the fixture was installed into.
 */
export async function installTongueFixture(storeDir: string = tempDir()): Promise<string> {
  const installed = new ExtensionStore(storeDir).listInstalled().value
  if (installed.some(record => record.extensionId === TONGUE_FIXTURE_ID)) return storeDir
  await stagedInstallFromDirectory({
    sourceDir: TONGUE_FIXTURE_DIR,
    storeDir,
    allowSourceDirectories: true,
  })
  return storeDir
}

/**
 * A mount fixture with the Tongue extension installed in an isolated store.
 *
 * Used by the legacy model-management suites, which predate the extension-first
 * catalogue: production still requires an installed extension for provider
 * readiness, and this helper supplies one without weakening that rule.
 * @param config - plugin configuration; `extensionStore` defaults to a fixture store.
 * @returns the mounted context.
 */
export async function mountPluginWithTongue(config: plugin.Config = {}): Promise<Context> {
  const extensionStore = config.extensionStore ?? await installTongueFixture()
  return mountPlugin({ ...config, extensionStore })
}

/**
 * Mount the plugin on a real context with the shipping service stack.
 *
 * `stateFile` is always set: an explicit value in `config` wins, otherwise each
 * mount gets its own throwaway file.
 * @param config - plugin configuration; `stateFile` defaults to an isolated path.
 * @returns the mounted context.
 */
export async function mountPlugin(config: plugin.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  // The suite exercises management behavior through the explicit management
  // grant; production defaults it OFF (BASE-07/SEC-09).
  await ctx.plugin(plugin, { stateFile: isolatedStateFile(), managementGrant: true, ...config })
  /**
   * Legacy test ergonomics: production callers use the separate management tool.
   * Existing suites invoke the management actions through `model_tools`; route
   * those calls only in the harness. `managementGrant:false` mounts bypass this,
   * which is what the control-surface test uses to pin the real split.
   */
  if (config.managementGrant !== false) {
    const execute = ctx.tools.execute.bind(ctx.tools)
    ctx.tools.execute = ((request: Parameters<typeof execute>[0]) => {
      const args = request.arguments as Record<string, unknown> | undefined
      const action = typeof args?.['action'] === 'string' ? args['action'] : undefined
      const sub = typeof args?.['sub'] === 'string' ? args['sub'] : undefined
      const management = action !== undefined
        && (MANAGEMENT_ACTIONS.has(action) || (action === 'credentials' && sub !== 'list'))
      return execute(management ? { ...request, name: 'model_tools_manage' } : request)
    }) as typeof ctx.tools.execute
  }
  contexts.push(ctx)
  return ctx
}

/** Actions that require the separate management tool (BASE-07/SEC-09). */
const MANAGEMENT_ACTIONS = new Set([
  'enable', 'disable', 'reset',
  'extensions-approve', 'extensions-deny', 'extensions-commit', 'extensions-rollback',
  'extensions-prepare', 'extensions-license-basis',
])

/** Invoke a registered tool through the real registry pipeline. */
export function callTool(ctx: Context, name: string, args: unknown) {
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : undefined
  const action = typeof record?.['action'] === 'string' ? record['action'] : undefined
  const sub = typeof record?.['sub'] === 'string' ? record['sub'] : undefined
  const resolvedName = name !== 'model_tools'
    ? name
    : action !== undefined
      && (MANAGEMENT_ACTIONS.has(action) || (action === 'credentials' && sub !== 'list'))
      ? 'model_tools_manage'
      : name
  return ctx.tools.execute({
    signal: testSignal,
    callId: ToolCallId(`test-${++callCounter}`),
    name: resolvedName,
    arguments: args,
  })
}

/** Concatenate the text blocks of a tool result. */
export function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Dispose every mounted context and delete every throwaway directory. */
export async function cleanup(): Promise<void> {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}
