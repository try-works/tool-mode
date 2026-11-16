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
  /** The caller-facing tool name, used to look up reviewed disambiguation guidance. */
  readonly toolName?: string | undefined
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
  const guidance = input.toolName === undefined ? undefined : EXTENSION_TOOL_DISAMBIGUATION[input.toolName]
  return composeToolDescription({
    purpose: declared.length > 0 ? declared : input.fallback.trim(),
    whenToUse: guidance?.whenToUse ?? input.skill?.description,
    whenNotToUse: guidance?.whenNotToUse,
    ...guidance?.limits === undefined ? {} : { limits: guidance.limits },
    ...guidance?.example === undefined ? {} : { example: guidance.example },
    skill: input.skill === undefined ? undefined : { name: input.skill.name },
  })
}

/**
 * The canonical worked example for a tool, when one is reviewed.
 * @param toolName - the caller-facing tool name.
 * @returns a JSON-shaped example string, or undefined.
 */
export function canonicalExampleFor(toolName: string): string | undefined {
  return CONTRACT_DISAMBIGUATION[toolName]?.example
    ?? EXTENSION_TOOL_DISAMBIGUATION[toolName]?.example
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

/** Bound the purpose to at most the given number of characters. */
function boundPurpose(text: string, cap: number): string {
  return text.length <= cap ? text : text.slice(0, Math.max(1, cap - 1)).trimEnd() + '…'
}

/**
 * Fit the description into the character budget, DECISION-FIRST.
 *
 * The purpose is bounded (at most 40% of the budget) and the when-to-use and
 * when-not-to-use sections — the text that actually decides WHICH tool to call —
 * are preserved in full before anything else. Inputs/outputs, limits, example and
 * the skill pointer are added only while they fit, in section order; they are the
 * first things dropped. Only if the decision sections alone exceed the budget are
 * the decision bullets themselves shortened (deterministically).
 */
function bounded(
  purposeText: string,
  decisionBlocks: readonly string[],
  lowerBlocks: readonly string[],
): string {
  const decisions = decisionBlocks.join('\n\n')
  const separator = decisionBlocks.length > 0 ? 2 : 0
  const cap = Math.max(
    1,
    Math.min(
      Math.floor(TOOL_DESCRIPTION_MAX_CHARS * 0.4),
      TOOL_DESCRIPTION_MAX_CHARS - decisions.length - separator,
    ),
  )
  const purpose = boundPurpose(purposeText, cap)
  const decisionText = [purpose, ...decisionBlocks].join('\n\n')
  if (decisionText.length > TOOL_DESCRIPTION_MAX_CHARS) {
    const available = Math.max(1, TOOL_DESCRIPTION_MAX_CHARS - purpose.length - decisionBlocks.length * 2)
    const share = Math.max(1, Math.floor(available / Math.max(1, decisionBlocks.length)))
    const shrunk = decisionBlocks.map(block => block.length <= share
      ? block
      : block.slice(0, Math.max(1, share - 1)).trimEnd() + '…')
    return limitText([purpose, ...shrunk].join('\n\n'))
  }
  let text = decisionText
  for (const block of lowerBlocks) {
    if (text.length + 2 + block.length <= TOOL_DESCRIPTION_MAX_CHARS) text += '\n\n' + block
  }
  return limitText(text)
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
  // The DECISION sections go first and are preserved; everything else is optional.
  const decisionBlocks = [
    section('When to use:', whenToUse),
    section('When not to use:', bullets(input.whenNotToUse)),
  ].filter((block): block is string => block !== null)
  const lowerBlocks = [
    section('Inputs and outputs:', io),
    section('Limits:', bullets(input.limits)),
    example === null ? null : 'Example:\n' + example,
    input.skill === undefined ? null : 'Skill: see the ' + input.skill.name + ' skill for the full workflow.',
  ].filter((block): block is string => block !== null)
  return bounded(purpose, decisionBlocks, lowerBlocks)
}

/** One parameter's type as the caller sees it. */
function paramType(param: ModelParam): string {
  return param.type ?? 'string'
}

/** The composed description for one catalog model's tool. */
export function catalogToolDescription(entry: ModelCatalogEntry, tool = entry.tool): string {
  const inputs = Object.entries(tool.params)
    .map(([name, param]) => name + ' (' + paramType(param) + ')')
    .join(', ')
  return composeToolDescription({
    purpose: tool.description,
    whenToUse: tool.whenToUse ?? entry.skill.whenToUse,
    whenNotToUse: tool.whenNotToUse,
    inputs,
    outputs: tool.returns,
    limits: tool.limits,
    example: tool.example,
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

/** One reviewed disambiguation row for a standard-contract tool. */
export interface ContractGuidance {
  /** When to choose THIS tool, in one sentence naming its distinguishing input/operation. */
  readonly whenToUse: readonly string[]
  /** Which sibling to choose instead, when this tool would be the wrong family member. */
  readonly whenNotToUse: readonly string[]
  /** One canonical input, so a caller sees the accepted shape instead of guessing it. */
  readonly example?: string
  /** Input bounds the schema alone does not make obvious. */
  readonly limits?: readonly string[]
}

/** The reviewed disambiguation table, keyed by caller-facing contract tool name. */
export interface ContractDisambiguationTable {
  readonly [toolName: string]: ContractGuidance
}

/**
 * The reviewed host-side disambiguation for the embedding/ranking family (P6).
 *
 * These tools are STANDARD CONTRACTS: their name, description, schemas and limits
 * come from the contracts package, which carries no when-to-use metadata. Changing
 * that package is a separate release, so the distinguishing guidance lives here,
 * reviewed like the golden list, and is composed into the same section order.
 * Keys are the CALLER-FACING contract tool names (not the contract ids).
 */
export const CONTRACT_DISAMBIGUATION: ContractDisambiguationTable = {
  text_embed: {
    whenToUse: ['Use when you need reusable 384-dimensional text vectors for an index, search or clustering.'],
    whenNotToUse: [
      'Use text_rerank when you need cross-encoder relevance logits rather than vectors.',
      'Use multimodal_embed when the input includes an image or audio.',
      'Use semantic_rank to order existing candidates instead of producing embeddings.',
    ],
  },
  text_rerank: {
    whenToUse: ['Use when a known list of documents must be reordered by cross-encoder relevance logits.'],
    whenNotToUse: [
      'Use text_embed when the vectors are reused across queries.',
      'Use semantic_rank when embedding cosine ranking is enough.',
    ],
  },
  text_title: {
    whenToUse: ['Use to propose a bounded title and one-sentence description for a text document.'],
    whenNotToUse: [
      'Use describe_image for an image, not a text document.',
      'Use tools_plan to propose tool calls rather than a title.',
    ],
  },
  describe_image: {
    whenToUse: ['Use to describe the visible content of one approved image, with honest uncertainty.'],
    whenNotToUse: [
      'Use text_title for written text.',
      'Use semantic_classify to place an image description into a fixed label set.',
      'No OCR contract exists; this is image description, not transcription.',
    ],
  },
  multimodal_embed: {
    whenToUse: ['Use when an image or audio input, or mixed text and media, must share one vector space.'],
    whenNotToUse: [
      'Use text_embed for text-only 384-dimensional MiniLM vectors.',
      'Use media_find_moments to locate windows inside existing media.',
      'Use semantic_similarity to compare two items rather than embed a batch.',
    ],
  },
  semantic_similarity: {
    whenToUse: ['Use to compare exactly two texts and read their 0-1 embedding cosine.'],
    whenNotToUse: [
      'Use semantic_rank to order many candidates against one query.',
      'Use text_embed when the vectors must persist for future comparisons.',
      'Use semantic_classify to pick a label rather than a score.',
    ],
  },
  semantic_rank: {
    whenToUse: ['Use to order many candidates by embedding cosine similarity to one query.'],
    whenNotToUse: [
      'Use text_rerank when relevance must come from a cross-encoder.',
      'Use semantic_similarity for a single pair.',
      'Use semantic_classify when each candidate must land in a label.',
    ],
    limits: [
      'query and each candidate are { id, parts: [{ kind: "text", text }] } (also code/image/audio);',
      'at most 256 candidates, 16 parts per item, 4096 characters per part;',
      'dimensions are 768/512/256/128 and must be the same for query and candidates;',
      'top_k must not exceed candidates.length.',
    ],
    example: '{"query":{"id":"q","parts":[{"kind":"text","text":"..."}]},"candidates":[{"id":"a","parts":[{"kind":"text","text":"..."}]}],"top_k":1,"dimensions":768}',
  },
  semantic_classify: {
    whenToUse: ['Use to assign one of a bounded label set to an item, with abstention allowed.'],
    whenNotToUse: [
      'Use semantic_rank when the candidates are free text, not a fixed label set.',
      'Use decision_choose for a stated decision over options.',
    ],
  },
  semantic_deduplicate: {
    whenToUse: ['Use to group near-duplicate texts into greedy clusters around representatives.'],
    whenNotToUse: [
      'Use semantic_rank to order items rather than group them.',
      'Use media_find_moments for media windows instead of text duplicates.',
    ],
  },
  media_find_moments: {
    whenToUse: ['Use to find the timestamped windows of approved media most relevant to a query.'],
    whenNotToUse: [
      'Use multimodal_embed to embed a whole media item.',
      'Use text_embed for text-only similarity.',
      'Use text_rerank for text documents rather than media windows.',
    ],
  },
  decision_choose: {
    whenToUse: ['Use to pick one option from a bounded set for a stated decision.'],
    whenNotToUse: [
      'Use decision_test for a yes/no predicate.',
      'Use decision_score to rate each option rather than choose one.',
      'Use tools_plan to propose tool calls instead of choosing an option.',
    ],
  },
  decision_test: {
    whenToUse: ['Use to test one binary predicate against supplied text and report the verdict.'],
    whenNotToUse: [
      'Use decision_choose to select among options.',
      'Use decision_score to grade options on a scale.',
    ],
  },
  decision_score: {
    whenToUse: ['Use to score options on the declared 0-10 scale for one criterion.'],
    whenNotToUse: [
      'Use decision_choose to return a single option.',
      'Use decision_test for a boolean verdict.',
    ],
  },
  tools_plan: {
    whenToUse: ['Use to propose a read-only tool plan for an objective against the host snapshot.'],
    whenNotToUse: [
      'Use decision_choose to choose one option, not to propose tool calls.',
      'Use text_title to propose a title instead of a plan.',
    ],
  },
}

/** The reviewed guidance for extension-manifest/recipe tools, keyed by caller-facing tool name. */
export const EXTENSION_TOOL_DISAMBIGUATION: ContractDisambiguationTable = {
  dedupe_and_rank: {
    whenToUse: ['Use when you need near-duplicate clusters AND how those clusters rank against a query, in one call.'],
    whenNotToUse: [
      'Use semantic_deduplicate when only the clusters are needed, with no query ranking.',
      'Use semantic_rank when every item is ranked individually and duplicates are not grouped.',
      'Use text_embed when you need the vectors themselves rather than clusters or ranks.',
    ],
  },
}

/** The composed description for one standard contract's tool. */
export function contractToolDescription(contract: ToolContract): string {
  const limits = Object.entries(contract.limits).map(([name, value]) => name + ': ' + value)
  const example = contract.examples?.[0]
  // SAFETY: ToolContract.inputSchema is validated JSON Schema; only its property names are read.
  const inputs = propertyNames(contract.inputSchema as JsonSchemaObject)
  // SAFETY: ToolContract.outputSchema is validated JSON Schema; only its property names are read.
  const outputs = propertyNames(contract.outputSchema as JsonSchemaObject)
  const guidance = CONTRACT_DISAMBIGUATION[contract.toolName]
  return composeToolDescription({
    purpose: firstSentence(contract.description),
    whenToUse: guidance?.whenToUse,
    whenNotToUse: [...guidance?.whenNotToUse ?? [], ...contract.unsupported],
    inputs: inputs.join(', '),
    outputs: outputs.join(', '),
    limits: [...limits, ...guidance?.limits ?? []],
    example: example === undefined ? guidance?.example : JSON.stringify(example),
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
