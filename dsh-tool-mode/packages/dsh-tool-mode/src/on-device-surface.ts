/**
 * R16: the on-device model capability index for the standing section.
 *
 * E45/E46 showed that adoption follows the DIGEST SURFACE: tools listed there get used,
 * tools absent from it stay invisible even when they are the right tool. The library digest
 * names authored `agent_*` artifacts only, so the catalog's model tools were adoption-inert.
 *
 * This module renders a bounded, NON-IMPERATIVE capability index of the model tools that are
 * REGISTERED RIGHT NOW. It deliberately carries no `Use ...` line: the artifact directive must
 * stay the single imperative, or a weak model tool displaces the artifact the caller needs
 * (E46 used the lang detector on a greeting task because the digest named it).
 *
 * E47/R17 NARROWED the surface: adoption flips only for a per-item, clause-bearing wrapper,
 * and a weak judgment tool that gets used is pure overhead (Laya 1/6, 2/6 accuracy, overridden
 * by the solver). The index therefore promotes only the payoff band — high-volume detection,
 * speech/OCR, embeddings and extraction of large inputs — and deliberately does NOT list
 * judgment (or planning) tools the solver dominates.
 *
 * @module on-device-surface
 */

import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'

/** The capability classes, in render order. */
const CAPABILITY_ORDER = [
  'extraction', 'embedding', 'vision', 'speech', 'language', 'text',
] as const
type Capability = typeof CAPABILITY_ORDER[number]

/**
 * R16: the capability of each standard contract.
 *
 * A contract is a STABLE tool identity, so this mapping does not rot with an extension's
 * model id. A contract absent here is not surfaced (an unknown class would be a guess).
 */
const CONTRACT_CAPABILITY: Readonly<Record<string, Capability>> = Object.freeze({
  /**
   * R17: judgment is INTENTIONALLY absent. E47 measured 0/3 -> 2/2 adoption for a per-item
   * Laya wrapper, but both solvers overrode its 1/6 and 2/6 verdicts: the call bought no
   * information, so listing it here made solvers spend a call and discard the answer.
   */
  structured_extract: 'extraction',
  extract_with_repair: 'extraction',
  multimodal_embed: 'embedding',
  semantic_classify: 'embedding',
  semantic_deduplicate: 'embedding',
  semantic_rank: 'embedding',
  semantic_similarity: 'embedding',
  text_embed: 'embedding',
  text_rerank: 'embedding',
  media_find_moments: 'embedding',
  describe_image: 'vision',
  stt_transcribe: 'speech',
  lang_detect: 'language',
  text_title: 'text',
  /** R17: planning is the solver's own reasoning band; not promoted for the same reason. */
})

/** One callable catalog model, with the name it is ACTUALLY registered under. */
export interface OnDeviceCatalogModel {
  readonly tool: string
  readonly capability: string
}

/** The live facts the index is rendered from. */
export interface OnDeviceCapabilityInput {
  /** Every tool name registered for this caller RIGHT NOW (`ctx.tools.schemas()`). */
  readonly registeredTools: readonly string[]
  /** Installed catalog models whose published tool is registered. */
  readonly catalogModels?: readonly OnDeviceCatalogModel[]
}

/** Bounds: a section may never crowd out the artifact directive. */
export const ON_DEVICE_MAX_NAMES_PER_CLASS = 8
export const ON_DEVICE_MAX_CLASSES = 6
export const ON_DEVICE_MAX_CHARS = 900

/** Map a catalog capability (for example `audio.spoken-language-identification`) to a class. */
function catalogCapability(capability: string): Capability | undefined {
  const family = capability.split('.')[0]
  switch (family) {
    case 'audio': return 'speech'
    case 'text': return 'text'
    case 'image':
    case 'video':
    case 'stroke': return 'vision'
    default: return undefined
  }
}

/** Whether a standard contract belongs to a class this build can name. */
function contractClass(toolName: string): Capability | undefined {
  const declared = CONTRACT_CAPABILITY[toolName]
  if (declared !== undefined) return declared
  const contract = STANDARD_CONTRACTS.find(candidate => candidate.toolName === toolName)
  return contract === undefined ? undefined : CONTRACT_CAPABILITY[contract.toolName]
}

/**
 * Render the on-device capability index.
 *
 * Only REGISTERED tools are listed (a catalog row whose tool is not callable would be a dead
 * route, the F3 defect in another surface). The result is empty when nothing callable names a
 * known capability, so a host with no model tools pays no prompt tokens.
 * @param input - the live registered names and callable catalog models.
 * @returns one bounded, non-imperative line, or an empty string.
 */
export function buildOnDeviceCapabilityIndex(input: OnDeviceCapabilityInput): string {
  const registered = new Set(input.registeredTools)
  const groups = new Map<Capability, string[]>()
  const add = (tool: string, capability: Capability | undefined): void => {
    if (capability === undefined || !registered.has(tool)) return
    for (const existing of groups.values()) {
      if (existing.includes(tool)) return
    }
    const names = groups.get(capability) ?? []
    names.push(tool)
    groups.set(capability, names)
  }
  for (const name of input.registeredTools) add(name, contractClass(name))
  for (const model of input.catalogModels ?? []) add(model.tool, catalogCapability(model.capability))

  const rendered = CAPABILITY_ORDER
    .filter(capability => groups.has(capability))
    .slice(0, ON_DEVICE_MAX_CLASSES)
    .map(capability => capability + ' — '
      + (groups.get(capability) ?? []).slice(0, ON_DEVICE_MAX_NAMES_PER_CLASS).join(', '))
  if (rendered.length === 0) return ''
  /**
   * R17: guidance, not promotion. The solver is told when these tools pay off and when the
   * solver's own answer is better, and that reuse needs the per-item + clause shape.
   */
  const text = 'On-device model tools (registered now): ' + rendered.join('; ') + '. '
    + 'They run locally and pay off where you are genuinely worse or slower: high-volume detection, '
    + 'speech/OCR, embeddings, and extraction of large inputs. Judgment tools are deliberately not '
    + 'listed — a verdict you would override is overhead, not evidence. To reuse one, wrap it in an '
    + 'artifact that runs it per item and states a verification clause; a single-record wrapper earns '
    + 'no adoption (E47).'
  return text.length <= ON_DEVICE_MAX_CHARS ? text : text.slice(0, ON_DEVICE_MAX_CHARS - 1).trimEnd() + '…'
}
