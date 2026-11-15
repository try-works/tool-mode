/**
 * The ONE model-facing tool-description composer (P1).
 *
 * Every registered tool description is assembled here, in one fixed section
 * order, so a caller reading two tools sees the same shape in both: purpose,
 * when to use, when not to use, inputs/outputs, limits, one example, and a
 * pointer to the skill that explains the workflow. Empty sections are omitted
 * and the total is bounded, because a description is prompt text and its length
 * is a real budget.
 *
 * @module @try-works/dsh-tool-mode/tool-description
 */

import type { ToolContract } from '@try-works/tool-mode-contracts'
import type { ModelCatalogEntry, ModelParam } from './types.ts'

/** The most characters a composed description may occupy. */
export const TOOL_DESCRIPTION_MAX_CHARS = 700

/** The skill pointer a description may end with. */
export interface ToolDescriptionSkill {
  /** The catalog skill that carries the full workflow. */
  readonly name: string
  /** Routing guidance used when the tool itself declares no when-to-use text. */
  readonly whenToUse?: string | undefined
}

/** Everything the composer can be given; every optional part is omitted when absent. */
export interface ToolDescriptionInput {
  /** One sentence saying what the tool does. Required. */
  readonly purpose: string
  /** When to call it: a sentence or a list of them. */
  readonly whenToUse?: string | readonly string[] | undefined
  /** When NOT to call it, including cases the implementation refuses. */
  readonly whenNotToUse?: string | readonly string[] | undefined
  /** A compact description of the accepted inputs. */
  readonly inputs?: string | undefined
  /** A compact description of what the caller receives. */
  readonly outputs?: string | undefined
  /** Resource limits the caller should plan around. */
  readonly limits?: string | readonly string[] | undefined
  /** Worked example(s); at most the first is rendered. */
  readonly example?: string | readonly string[] | undefined
  /** The skill pointer, with fallback routing guidance. */
  readonly skill?: ToolDescriptionSkill | undefined
}

/** The declaration an extension/recipe tool supplies to the composer. */
export interface ExtensionToolDescriptionInput {
  /** The description the manifest or recipe declares, when it declares one. */
  readonly description?: string | undefined
  /** The owner sentence used when no description is declared. */
  readonly fallback: string
  /** The extension skill guidance that applies to this tool, when declared. */
  readonly skill?: {
    readonly name: string
    readonly description: string
  } | undefined
}

/**
 * The composed description for a tool a manifest or recipe declares.
 *
 * An extension declares its tool text; the host composes it through the same
 * budget and section order as every other tool, using the extension's declared
 * skill guidance as the when-to-use line. Without declared guidance the manifest
 * description is the purpose and the remaining sections are omitted.
 * @param input - the declared description, a fallback, and any skill guidance.
 * @returns the bounded composed description.
 */
export function extensionToolDescription(input: ExtensionToolDescriptionInput): string {
  const declared = (input.description ?? '').trim()
  return composeToolDescription({
    purpose: declared.length > 0 ? declared : input.fallback.trim(),
    whenToUse: input.skill?.description,
    skill: input.skill === undefined ? undefined : { name: input.skill.name },
  })
}

/** One row of the reviewed model-facing golden list. */
export interface GoldenDescriptionRow {
  /** The registered tool name. */
  readonly name: string
  /** The purpose sentence the description starts with. */
  readonly purpose: string
  /** The full composed description. */
  readonly description: string
  /** How many parameters the tool declares. */
  readonly parameterCount: number
}

/** Normalize a string-or-list field into trimmed, non-empty bullets. */
function bullets(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map(item => item.trim()).filter(item => item.length > 0)
}

/** Render one bulleted section, or null when it has no content. */
function section(heading: string, lines: readonly string[]): string | null {
  return lines.length === 0 ? null : heading + '\n' + lines.map(line => '- ' + line).join('\n')
}

/** The first sentence of a longer description (the purpose line for contracts). */
function firstSentence(text: string): string {
  const trimmed = text.trim()
  const end = trimmed.search(/[.!?](?:\s|$)/)
  return end === -1 ? trimmed : trimmed.slice(0, end + 1)
}

/**
 * Hard-limit a text to the character budget, marking the cut with an ellipsis.
 *
 * The final guard is deliberately unconditional: whatever the section fitting
 * above decides, no composed description can exceed the budget.
 */
function limitText(text: string): string {
  return text.length <= TOOL_DESCRIPTION_MAX_CHARS
    ? text
    : text.slice(0, TOOL_DESCRIPTION_MAX_CHARS - 1).trimEnd() + '…'
}

/**
 * Fit the blocks into the character budget, for ANY input.
 *
 * The purpose is kept first but never occupies more than a bounded share of the
 * budget (40%); every remaining section is truncated to an equal share of what is
 * left, so the result is deterministic and always within the budget.
 */
function bounded(blocks: readonly string[]): string {
  const joined = blocks.join('\n\n')
  if (joined.length <= TOOL_DESCRIPTION_MAX_CHARS) return joined
  const purpose = blocks[0] ?? ''
  const rest = blocks.slice(1)
  const headBudget = Math.max(1, Math.floor(TOOL_DESCRIPTION_MAX_CHARS * 0.4))
  const head = purpose.length <= headBudget
    ? purpose
    : purpose.slice(0, headBudget - 1).trimEnd() + '…'
  if (rest.length === 0) return limitText(head)
  const available = TOOL_DESCRIPTION_MAX_CHARS - head.length - (rest.length - 1) * 2
  const share = Math.max(1, Math.floor(available / rest.length))
  const kept = [head]
  for (const block of rest) {
    kept.push(block.length <= share ? block : block.slice(0, Math.max(1, share - 1)).trimEnd() + '…')
  }
  return limitText(kept.join('\n\n'))
}

/**
 * Compose one model-facing tool description.
 * @param input - the purpose and every optional section.
 * @returns the bounded description in the fixed section order.
 * @throws Error when the purpose is missing or blank, because a description without one is not a description.
 */
export function composeToolDescription(input: ToolDescriptionInput): string {
  const purpose = input.purpose.trim()
  if (purpose.length === 0) throw new Error('composeToolDescription: purpose must be a non-empty string')
  const io: string[] = []
  if (input.inputs !== undefined && input.inputs.trim().length > 0) io.push('Inputs: ' + input.inputs.trim())
  if (input.outputs !== undefined && input.outputs.trim().length > 0) io.push('Outputs: ' + input.outputs.trim())
  const example = bullets(input.example)[0] ?? null
  const whenToUse = bullets(input.whenToUse ?? input.skill?.whenToUse)
  const blocks = [
    purpose,
    section('When to use:', whenToUse),
    section('When not to use:', bullets(input.whenNotToUse)),
    section('Inputs and outputs:', io),
    section('Limits:', bullets(input.limits)),
    example === null ? null : 'Example:\n' + example,
    input.skill === undefined ? null : 'Skill: see the ' + input.skill.name + ' skill for the full workflow.',
  ].filter((block): block is string => block !== null)
  return bounded(blocks)
}

/** One parameter's type as the caller sees it. */
function paramType(param: ModelParam): string {
  return param.type ?? 'string'
}

/** The composed description for one catalog model's tool. */
export function catalogToolDescription(entry: ModelCatalogEntry): string {
  const inputs = Object.entries(entry.tool.params)
    .map(([name, param]) => name + ' (' + paramType(param) + ')')
    .join(', ')
  return composeToolDescription({
    purpose: entry.tool.description,
    whenToUse: entry.tool.whenToUse ?? entry.skill.whenToUse,
    whenNotToUse: entry.tool.whenNotToUse,
    inputs,
    outputs: entry.tool.returns,
    limits: entry.tool.limits,
    example: entry.tool.example,
    skill: { name: entry.skill.name },
  })
}

/** The part of a JSON Schema read for the inputs/outputs line. */
interface JsonSchemaObject {
  /** The declared property map, when the schema has one. */
  readonly properties?: object
}

/** The property names of a JSON-Schema object, for the inputs/outputs line. */
function propertyNames(schema: JsonSchemaObject): readonly string[] {
  return schema.properties === undefined ? [] : Object.keys(schema.properties)
}

/** The composed description for one standard contract's tool. */
export function contractToolDescription(contract: ToolContract): string {
  const limits = Object.entries(contract.limits).map(([name, value]) => name + ': ' + value)
  const example = contract.examples?.[0]
  // SAFETY: ToolContract.inputSchema is validated JSON Schema; only its property names are read.
  const inputs = propertyNames(contract.inputSchema as JsonSchemaObject)
  // SAFETY: ToolContract.outputSchema is validated JSON Schema; only its property names are read.
  const outputs = propertyNames(contract.outputSchema as JsonSchemaObject)
  return composeToolDescription({
    purpose: firstSentence(contract.description),
    whenNotToUse: contract.unsupported,
    inputs: inputs.join(', '),
    outputs: outputs.join(', '),
    limits,
    example: example === undefined ? undefined : JSON.stringify(example),
  })
}

/**
 * The reviewed model-facing list: one row per registered tool, in name order.
 *
 * A catalog model that binds a standard contract registers through that contract,
 * so only contract-less entries contribute their per-model tool name; listing both
 * would show a tool no caller can reach.
 */
export function goldenDescriptionRows(
  catalog: readonly ModelCatalogEntry[],
  contracts: readonly ToolContract[],
): GoldenDescriptionRow[] {
  const rows: GoldenDescriptionRow[] = []
  for (const entry of catalog) {
    if (entry.contract !== null) continue
    rows.push({
      name: entry.tool.name,
      purpose: entry.tool.description,
      description: catalogToolDescription(entry),
      parameterCount: Object.keys(entry.tool.params).length,
    })
  }
  for (const contract of contracts) {
    rows.push({
      name: contract.toolName,
      purpose: firstSentence(contract.description),
      description: contractToolDescription(contract),
      // SAFETY: ToolContract.inputSchema is validated JSON Schema; only its property names are read.
      parameterCount: propertyNames(contract.inputSchema as JsonSchemaObject).length,
    })
  }
  rows.sort((left, right) => left.name.localeCompare(right.name))
  return rows
}

/** Render the golden markdown list the reviewer diffs. */
export function renderToolDescriptionGolden(rows: readonly GoldenDescriptionRow[]): string {
  const lines = [
    '# Model-facing tool descriptions (generated)',
    '',
    'Generated by scripts/gen-tool-descriptions.mjs; do not edit by hand. Each tool lists its',
    'parameter count and the full composed description (purpose, when to use, when not to use,',
    'inputs/outputs, limits, one example, skill pointer).',
    '',
    'This is the STATIC catalog + standard-contract list. Extension-manifest and recipe tools',
    'are composed at runtime from the installed package and are not listed here.',
    '',
    'Total tools: ' + rows.length + '.',
    '',
  ]
  for (const row of rows) {
    lines.push(
      '## ' + row.name + ' (' + row.parameterCount + ' parameter' + (row.parameterCount === 1 ? '' : 's') + ')',
      '',
      row.description,
      '',
    )
  }
  return lines.join('\n')
}
