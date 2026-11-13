/**
 * The live Tool Inventory snapshot (plan §3.3).
 *
 * Inventory is deliberately NOT a projection: it reads the registry's model-facing
 * schemas and the extension store's `describe()` live, so a tool that was never called
 * still appears, and an installed-but-inactive extension's tools appear with their
 * derived state instead of vanishing. Usage columns join from the report by name; a
 * tool with no row is `never called` (zeros), never hidden.
 *
 * No payload reaches a row: the registry contributes name/description/argument count,
 * never a schema body, and nothing here carries arguments, results, tokens or paths.
 *
 * @module @try-works/dsh-tool-mode/tool-inventory
 */

import { resolveToolOwner, type ToolKind, type ToolOrigin } from './tool-sources.ts'

/** What an inventory row says about availability. */
export type InventoryState = 'active' | 'prepared-cold' | 'failed'

/** One requirement fact the state derivation reads (structural subset of `ExtensionRequirement`). */
export interface InventoryRequirement {
  readonly kind: string
  readonly satisfied: boolean
}

/** One extension, as the store's `describe()` reports it (structural subset). */
export interface InventoryExtension {
  readonly id: string
  readonly installed: boolean
  readonly active: boolean
  readonly tools: readonly string[]
  /** Installed version, when the input carries it. */
  readonly version?: string | null
  readonly requirements?: readonly InventoryRequirement[]
}

/** One registered tool's model-facing schema projection (structural subset of `ToolSchema`). */
export interface RegistryToolDescription {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
}

/** The usage columns the report joins by name. */
export interface InventoryUsageRow {
  readonly name: string
  readonly calls: number
  readonly errors: number
  readonly lastUsed: number | null
}

/** Everything the snapshot needs. */
export interface InventoryInput {
  readonly registry: readonly RegistryToolDescription[]
  readonly extensions: readonly InventoryExtension[]
  readonly usage: readonly InventoryUsageRow[]
  /** Tool names the MCP export surface actually publishes. */
  readonly mcpExposed: readonly string[]
  /** User-authored tools, attributed to their owning profile record. */
  readonly customTools?: readonly {
    readonly name: string
    readonly id: string
    readonly title: string
  }[]
}

/** One inventory row. */
export interface ToolInventoryRow {
  readonly name: string
  readonly description: string
  readonly owner: string
  readonly kind: ToolKind
  readonly origin: ToolOrigin
  readonly state: InventoryState
  /** The owning extension id, when an extension declares the tool. */
  readonly extension: string | null
  readonly version: string | null
  /** Alias of {@link ToolInventoryRow.version} for the client's flat contract. */
  readonly extensionVersion: string | null
  /** The implementation contract version, when the host knows one (not derivable from `describe()`). */
  readonly contractVersion: string | null
  /** The number of declared argument properties, never the schema body. */
  readonly argumentCount: number
  /** When the tool was last registered; null when the host cannot observe it. */
  readonly lastRegistered: number | null
  readonly mcpExposed: boolean
  readonly calls: number
  readonly success: number
  readonly lastUsed: number | null
}

/** The number of top-level declared argument properties. */
function argumentCount(parameters: Readonly<Record<string, unknown>>): number {
  const properties = parameters['properties']
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return 0
  return Object.keys(properties).length
}

/** Whether an installed extension has its declared assets prepared. */
function assetsReady(extension: InventoryExtension): boolean {
  return (extension.requirements ?? []).some(requirement => requirement.kind === 'assets' && requirement.satisfied)
}

/** Derive the availability state of an installed, unregistered extension tool. */
function extensionState(extension: InventoryExtension): InventoryState {
  if (extension.active) return 'active'
  return assetsReady(extension) ? 'prepared-cold' : 'failed'
}

/** The usage columns joined onto one tool row. */
interface UsageJoin {
  readonly calls: number
  readonly success: number
  readonly lastUsed: number | null
}

/** Usage columns for a name, with never-called expressed as zeros and null. */
function usageFor(usage: ReadonlyMap<string, InventoryUsageRow>, name: string): UsageJoin {
  const row = usage.get(name)
  if (row === undefined) return { calls: 0, success: 0, lastUsed: null }
  return { calls: row.calls, success: Math.max(0, row.calls - row.errors), lastUsed: row.lastUsed }
}

/**
 * Build the inventory snapshot.
 * @param input - the live registry, store rows, usage join and MCP surface.
 * @returns every row, sorted by name for a deterministic page.
 */
export function buildToolInventory(input: InventoryInput): readonly ToolInventoryRow[] {
  const rows = new Map<string, ToolInventoryRow>()
  const usage = new Map(input.usage.map(row => [row.name, row]))
  const exposed = new Set(input.mcpExposed)
  const custom = new Map((input.customTools ?? []).map(tool => [tool.name, tool]))

  for (const tool of input.registry) {
    const customTool = custom.get(tool.name)
    const owner = customTool === undefined
      ? resolveToolOwner(tool.name, input.extensions)
      : { owner: customTool.id, kind: 'custom' as const, origin: 'custom' as const }
    const extension = owner.kind === 'extension' ? input.extensions.find(candidate => candidate.id === owner.owner) : undefined
    rows.set(tool.name, {
      name: tool.name,
      description: tool.description,
      owner: owner.owner,
      kind: owner.kind,
      origin: owner.origin,
      state: 'active',
      extension: extension?.id ?? null,
      version: extension?.version ?? null,
      extensionVersion: extension?.version ?? null,
      contractVersion: null,
      lastRegistered: null,
      argumentCount: argumentCount(tool.parameters),
      // model_tools is host-local by design; the surface can never expose it.
      mcpExposed: tool.name !== 'model_tools' && exposed.has(tool.name),
      ...usageFor(usage, tool.name),
    })
  }

  for (const extension of input.extensions) {
    if (!extension.installed) continue
    for (const name of extension.tools) {
      if (rows.has(name)) continue
      rows.set(name, {
        name,
        // The store reports tool NAMES, not their descriptions; inventing prose would
        // be worse than the empty string the schema has no registry row for.
        description: '',
        owner: extension.id,
        kind: 'extension',
        origin: 'extension',
        state: extensionState(extension),
        extension: extension.id,
        version: extension.version ?? null,
        extensionVersion: extension.version ?? null,
        contractVersion: null,
        lastRegistered: null,
        argumentCount: 0,
        mcpExposed: name !== 'model_tools' && exposed.has(name),
        ...usageFor(usage, name),
      })
    }
  }

  return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name))
}
