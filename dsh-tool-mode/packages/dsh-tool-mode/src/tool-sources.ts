/**
 * Tool owner attribution for Tool Insights (plan §3.2).
 *
 * The owner of a tool is resolved from LIVE data first — an active extension that
 * declares the tool name owns it — and only then from deliberately static facts:
 * Tool Mode's own names, the `mcp__<server>__<tool>` grammar the MCP client mounts,
 * and a pinned first-party map. Anything else is `unattributed`: the page must be
 * able to say "we do not know" instead of guessing a package.
 *
 * The projection fold cannot see the extension store (it must be a pure, replayable
 * fold), so it uses {@link staticToolOwner}: pinned map, Tool Mode, MCP grammar, then
 * `unattributed`. Extension-owned calls are re-attributed with the live store by the
 * report/inventory readers.
 *
 * @module @try-works/dsh-tool-mode/tool-sources
 */

/** The owner label used when no fact attributes a tool. */
export const UNATTRIBUTED_OWNER = 'unattributed'

/** The package that provides Tool Mode itself. */
export const TOOL_MODE_OWNER = '@try-works/dsh-tool-mode'

/** Tool Mode's own tool names (host-local management plus the composition door). */
export const TOOL_MODE_TOOL_NAMES: readonly string[] = Object.freeze(['model_tools', 'tool_mode_run'])

/**
 * Pinned first-party tool → npm package.
 *
 * Factual pairs verified against the DSH packages that register them
 * (`D:\deepseek-harness\packages\**`). This map exists because a historical call can
 * predate the live registry observation; it is intentionally NOT a guess at the whole
 * catalogue — an unlisted name stays `unattributed`.
 */
export const PINNED_FIRST_PARTY_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  read: '@deepseek-ai/dsh-tool-fs',
  write: '@deepseek-ai/dsh-tool-fs',
  edit: '@deepseek-ai/dsh-tool-fs',
  read_image: '@deepseek-ai/dsh-tool-fs',
  glob: '@deepseek-ai/dsh-tool-fs-search',
  grep: '@deepseek-ai/dsh-tool-fs-search',
  pwsh: '@deepseek-ai/dsh-tool-pwsh',
  bash: '@deepseek-ai/dsh-tool-bash',
  web_search: '@deepseek-ai/dsh-tool-web',
  web_fetch: '@deepseek-ai/dsh-tool-web',
  job_list: '@deepseek-ai/dsh-tool-jobs',
  job_output: '@deepseek-ai/dsh-tool-jobs',
  job_kill: '@deepseek-ai/dsh-tool-jobs',
  todo_write: '@deepseek-ai/dsh-tool-todo',
  skill: '@deepseek-ai/dsh-tool-skill',
  present: '@deepseek-ai/dsh-tool-present',
  ask_user_question: '@deepseek-ai/dsh-tool-ask-user',
  lsp: '@deepseek-ai/dsh-tool-lsp',
  working_directory: '@deepseek-ai/dsh-tool-working-directory',
  schedule_create: '@deepseek-ai/dsh-tool-schedule',
  schedule_delete: '@deepseek-ai/dsh-tool-schedule',
  schedule_list: '@deepseek-ai/dsh-tool-schedule',
  schedule_update: '@deepseek-ai/dsh-tool-schedule',
  create_goal: '@deepseek-ai/dsh-tool-goal',
  get_goal: '@deepseek-ai/dsh-tool-goal',
  update_goal: '@deepseek-ai/dsh-tool-goal',
  list_agents: '@deepseek-ai/dsh-tool-subagent-control',
  send_message: '@deepseek-ai/dsh-tool-subagent-control',
  interrupt_agent: '@deepseek-ai/dsh-tool-subagent-control',
  list_subagent_models: '@deepseek-ai/dsh-tool-subagent',
  subagent: '@deepseek-ai/dsh-tool-subagent',
  workflow: '@deepseek-ai/dsh-tool-workflow',
})

/** How a tool came to be registered. */
export type ToolKind = 'built-in' | 'extension' | 'tool-mode' | 'mcp' | 'custom' | 'unknown'

/** The grouped origin the inventory renders. */
export type ToolOrigin = 'dsh-core' | 'extension' | 'tool-mode' | 'mcp' | 'custom' | 'unknown'

/** One resolved owner fact. */
export interface ToolOwner {
  /** Package/extension id, `mcp:<server>`, or {@link UNATTRIBUTED_OWNER}. */
  readonly owner: string
  readonly kind: ToolKind
  readonly origin: ToolOrigin
}

/** An extension that may own tool names, as the store describes it. */
export interface ExtensionToolOwner {
  /** The extension package identity. */
  readonly id: string
  /** Whether the store holds an installed copy. */
  readonly installed: boolean
  /** Whether the host restored it on this load. */
  readonly active: boolean
  /** Tool names the manifest declares. */
  readonly tools: readonly string[]
}

/**
 * The `mcp__<server>__<tool>` server name, or null when the name is not MCP-shaped.
 * @param name - the tool name.
 * @returns the server name, which is empty-safe.
 */
export function mcpServerOf(name: string): string | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match === null ? null : (match[1] ?? null)
}

/**
 * Resolve owner facts that need no live registry or store (pure, replayable).
 * @param name - the tool name.
 * @returns the owner fact; unknown names are explicitly `unattributed`.
 */
export function staticToolOwner(name: string): ToolOwner {
  if (TOOL_MODE_TOOL_NAMES.includes(name)) {
    return { owner: TOOL_MODE_OWNER, kind: 'tool-mode', origin: 'tool-mode' }
  }
  const server = mcpServerOf(name)
  if (server !== null) return { owner: `mcp:${server}`, kind: 'mcp', origin: 'mcp' }
  const pinned = PINNED_FIRST_PARTY_TOOLS[name]
  if (pinned !== undefined) return { owner: pinned, kind: 'built-in', origin: 'dsh-core' }
  return { owner: UNATTRIBUTED_OWNER, kind: 'unknown', origin: 'unknown' }
}

/**
 * Resolve the LIVE owner of a tool: an installed extension's declared tool wins,
 * then the static facts.
 * @param name - the tool name.
 * @param extensions - the store's extensions, as `describe()` reports them.
 * @returns the owner fact.
 */
export function resolveToolOwner(name: string, extensions: readonly ExtensionToolOwner[]): ToolOwner {
  for (const extension of extensions) {
    if (!extension.installed) continue
    if (!extension.tools.includes(name)) continue
    return { owner: extension.id, kind: 'extension', origin: 'extension' }
  }
  return staticToolOwner(name)
}

/**
 * Project the store's extensions onto a name → extension owner map.
 * @param extensions - the store's extensions.
 * @returns extension id per declared tool name (installed extensions only).
 */
export function extensionToolOwners(extensions: readonly ExtensionToolOwner[]): ReadonlyMap<string, string> {
  const owners = new Map<string, string>()
  for (const extension of extensions) {
    if (!extension.installed) continue
    for (const tool of extension.tools) owners.set(tool, extension.id)
  }
  return owners
}
