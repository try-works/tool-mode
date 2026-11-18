/**
 * The capability-card projection for model tools.
 *
 * Pure formatting: catalog + verdict in, a card a caller can plan from out. It
 * lives outside index.ts because none of it needs the plugin context, and the
 * discovery/describe handlers stay readable when they are not wrapped around
 * 200 lines of prose generation.
 *
 * @module model-cards
 */

import { modelOperations } from './catalog.ts'
import type { ResolvedModel } from './capability.ts'
import { exampleFromSchema } from './discovery-describe.ts'
import { cardExample as verifiedCardExample } from './authoring-quality.ts'
import type { JsonValue } from './adapters/types.ts'
import type { ModelCatalogEntry, ModelOperationSpec } from './types.ts'

/** One model as the `model_tools` control tool reports it. */
export interface ModelDescriptor {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly capability: string
  /** The contract this model implements, or null when it keeps a per-model tool. */
  readonly contract: string | null
  readonly input: string
  /** The catalog's declared RESULT SHAPE, in prose a caller can plan around. */
  readonly output: string
  readonly tool: string
  readonly skill: string
  readonly runnable: boolean
  readonly route: string
  readonly reason: string
  readonly languages: number | null
  readonly license: string
  readonly docs: string
  /** One entry per accepted argument, so a caller can compose without an extra call. */
  readonly parameters: ModelParameterCard[]
  /** Every callable operation this model declares, primary first. */
  readonly operations: ModelOperationCard[]
  /** What the tool returns, in the catalog's own words. */
  readonly returns: string
  /** Platform and packaging facts that decide whether the model can run here. */
  readonly runtime: ModelRuntimeCard
  readonly whenToUse?: string
  readonly whenNotToUse?: string
  readonly limits?: string
  readonly example?: string
}

/** One accepted model-tool argument, rendered for capability discovery. */
export interface ModelParameterCard {
  readonly name: string
  readonly type: string
  readonly description: string
}

/** One callable operation, with the schema a caller needs to invoke it. */
export interface ModelOperationCard {
  readonly id: string
  readonly tool: string
  readonly contract: string | null
  readonly description: string
  readonly parameters: ModelParameterCard[]
  /** A JSON-Schema view of the operation arguments. */
  readonly inputSchema: Record<string, JsonValue>
  readonly returns: string
  readonly whenToUse?: string
  readonly whenNotToUse?: string
  readonly limits?: string
  readonly example?: string
}

/** How the model's weights are packaged and where they can run. */
export interface ModelRuntimeCard {
  readonly windowsSupport: string
  readonly verifiedRunnableOnWindows: boolean
  readonly closedBeta: boolean
  readonly modelSizeMB: number | null
  readonly requiresRuntime: string[]
}

/** Render the model list the control tool returns, and the plugin logs. */
export function describeModelCard(descriptor: ModelDescriptor, extension: string | null): ModelDescriptor & {
  readonly extension: string | null
} {
  return { ...descriptor, extension }
}

/** One parameter card from a tool declaration. */
function parameterCards(tool: ModelCatalogEntry['tool']): ModelParameterCard[] {
  return Object.entries(tool.params).map(([name, param]) => ({
    name,
    type: param.type ?? 'string',
    description: param.description,
  }))
}

/** A JSON-Schema view of one operation's arguments. */
function operationInputSchema(tool: ModelCatalogEntry['tool']): Record<string, JsonValue> {
  const properties: Record<string, JsonValue> = {}
  for (const [name, param] of Object.entries(tool.params)) {
    const type = param.type ?? 'string'
    properties[name] = type === 'string[]'
      ? { type: 'array', items: { type: 'string' }, description: param.description }
      : { type, description: param.description }
  }
  return { type: 'object', properties, required: [] }
}

/**
 * The prose a card can honestly supply when the catalog declaration leaves it out.
 *
 * The model catalog carries the skill's `whenToUse` and the runtime envelope; it
 * does not carry a hand-written example or quota prose for every model. Leaving
 * those fields absent made every card look unpopulated, so derive them from facts
 * the catalog already pins: the skill trigger, the measured on-device size, the
 * declared input modality and the generated argument schema. This is a fallback,
 * not invented capability: an explicit declaration always wins.
 */
function cardWhenToUse(entry: ModelCatalogEntry, tool: ModelCatalogEntry['tool']): string {
  return tool.whenToUse ?? entry.skill.whenToUse ?? tool.description
}

function cardLimits(entry: ModelCatalogEntry, tool: ModelCatalogEntry['tool']): string {
  if (tool.limits !== undefined) return tool.limits
  const parts: string[] = []
  if (entry.modelSizeMB !== null) parts.push(`${entry.modelSizeMB} MB on device`)
  parts.push(`input: ${entry.input}`)
  if (entry.languages !== null) parts.push(`${entry.languages} language(s)`)
  parts.push(`Windows support: ${entry.windowsSupport}`)
  if (entry.closedBeta) parts.push('closed beta')
  return parts.join('; ')
}

function cardExample(tool: ModelCatalogEntry['tool']): string | undefined {
  const inputSchema = operationInputSchema(tool)
  // An explicit example is authoritative. Without one, derive a candidate from
  // the schema and publish it ONLY when it validates; an invalid candidate is
  // omitted, never published as a plausible-looking lie.
  const candidate = tool.example ?? JSON.stringify(exampleFromSchema(inputSchema))
  return verifiedCardExample({
    inputSchema,
    example: candidate,
  }).example
}

/** Render one operation as a capability card. */
function operationCard(entry: ModelCatalogEntry, operation: ModelOperationSpec): ModelOperationCard {
  return {
    id: operation.id,
    tool: operation.tool.name,
    contract: operation.contract,
    description: operation.tool.description,
    parameters: parameterCards(operation.tool),
    inputSchema: operationInputSchema(operation.tool),
    returns: operation.tool.returns,
    whenToUse: cardWhenToUse(entry, operation.tool),
    ...operation.tool.whenNotToUse === undefined ? {} : { whenNotToUse: operation.tool.whenNotToUse },
    limits: cardLimits(entry, operation.tool),
    ...cardExample(operation.tool) === undefined ? {} : { example: cardExample(operation.tool) as string },
  }
}

/** Render the model list the control tool returns, and the plugin logs. */
export function describeModels(resolved: readonly ResolvedModel[]): ModelDescriptor[] {
  return resolved.map(({ entry, verdict }) => ({
    id: entry.id,
    name: entry.name,
    summary: entry.summary,
    capability: entry.capability,
    contract: entry.contract,
    input: entry.input,
    output: entry.output,
    tool: entry.tool.name,
    skill: entry.skill.name,
    runnable: verdict.runnable,
    route: verdict.route,
    reason: verdict.reason,
    languages: entry.languages,
    license: entry.license,
    docs: entry.docsUrl,
    parameters: parameterCards(entry.tool),
    operations: modelOperations(entry).map(operation => operationCard(entry, operation)),
    returns: entry.tool.returns,
    runtime: {
      windowsSupport: entry.windowsSupport,
      verifiedRunnableOnWindows: entry.verifiedRunnableOnWindows,
      closedBeta: entry.closedBeta,
      modelSizeMB: entry.modelSizeMB,
      requiresRuntime: [...entry.requiresRuntime],
    },
    whenToUse: cardWhenToUse(entry, entry.tool),
    ...entry.tool.whenNotToUse === undefined ? {} : { whenNotToUse: entry.tool.whenNotToUse },
    limits: cardLimits(entry, entry.tool),
    ...cardExample(entry.tool) === undefined ? {} : { example: cardExample(entry.tool) as string },
  }))
}
