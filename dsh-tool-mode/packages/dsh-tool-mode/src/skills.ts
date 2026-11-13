/**
 * Skill publication: teaches an agent when and how to use each model tool.
 *
 * A tool schema tells the model what it *can* call; a skill tells it when the
 * call is the right move, when it is the wrong one, and how the result should be
 * used downstream. This module renders one skill body per registered model from
 * the catalog plus that model's playbook entry.
 *
 * @module @try-works/dsh-tool-mode/skills
 */

import type { ModelCatalogEntry } from './types.ts'
import type { ModelPlaybook } from './playbook.ts'

/**
 * Render the instruction body for one model's skill.
 *
 * The body is deliberately procedural: it names the tool, states the trigger
 * conditions, states the anti-triggers, and describes what to do with the
 * result. Sections with no content are omitted rather than rendered empty, so a
 * sparse playbook still produces a clean skill.
 * @param entry - the catalog entry.
 * @param playbook - the model's playbook, when one is authored.
 * @returns the markdown skill body.
 */
export function renderSkillBody(entry: ModelCatalogEntry, playbook?: ModelPlaybook): string {
  const lines: string[] = []
  lines.push(`# ${entry.name}`, '')
  lines.push(entry.summary, '')
  lines.push(`Call the \`${entry.tool.name}\` tool. ${entry.tool.returns}`, '')

  lines.push('## When to use', '')
  if (playbook !== undefined && playbook.whenToUse.length > 0) {
    for (const item of playbook.whenToUse) lines.push(`- ${item}`)
  } else if (entry.skill.whenToUse !== undefined) {
    lines.push(`- ${entry.skill.whenToUse}`)
  } else {
    lines.push(`- ${entry.summary}`)
  }
  lines.push('')

  if (playbook !== undefined && playbook.whenNotToUse.length > 0) {
    lines.push('## When not to use', '')
    for (const item of playbook.whenNotToUse) lines.push(`- ${item}`)
    lines.push('')
  }

  if (playbook !== undefined && playbook.useCases.length > 0) {
    lines.push('## Use cases', '')
    for (const item of playbook.useCases) lines.push(`- ${item}`)
    lines.push('')
  }

  lines.push('## Calling it', '')
  lines.push(`- Tool: \`${entry.tool.name}\``)
  lines.push(`- Primary input: ${entry.input}`)
  lines.push(`- Runs: ${describeRoute(entry)}`)
  lines.push('')
  for (const [name, param] of Object.entries(entry.tool.params)) {
    lines.push(`- \`${name}\` (${param.type ?? 'string'}): ${param.description}`)
  }
  lines.push('')

  if (playbook !== undefined && playbook.workflow.length > 0) {
    lines.push('## Workflow', '')
    playbook.workflow.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
    lines.push('')
  }

  if (playbook !== undefined && playbook.pairsWith.length > 0) {
    lines.push('## Pairs with', '')
    for (const item of playbook.pairsWith) lines.push(`- ${item}`)
    lines.push('')
  }

  /**
   * Native AND Code Mode examples, generated from the tool's parameter map so a
   * changed parameter changes the example rather than leaving hand-written prose to
   * drift (DECL-05).
   */
  lines.push('## Examples', '')
  const example = exampleArguments(entry)
  lines.push('Native call:', '')
  lines.push('```json', JSON.stringify({ tool: entry.tool.name, arguments: example }, null, 2), '```', '')
  lines.push('Code Mode:', '')
  lines.push('```js')
  lines.push(`const result = await tools.${entry.tool.name}(${JSON.stringify(example)});`)
  lines.push('return result;')
  lines.push('```', '')

  lines.push('## Unsupported', '')
  const unsupported = playbook?.whenNotToUse ?? []
  if (unsupported.length === 0) {
    lines.push('- No additional unsupported cases are declared for this tool.')
  } else {
    for (const item of unsupported) lines.push(`- ${item}`)
  }
  lines.push('')

  lines.push('## Data handling', '')
  lines.push(`- ${describeDataHandling(entry)}`)
  lines.push('')

  lines.push('## Recovery', '')
  lines.push(
    '- If the tool is unavailable, prepare and enable the model through the operator surface; do not install an '
    + 'arbitrary package to work around it.',
  )
  lines.push(
    '- If the call reports a validation error, fix the named argument; do not retry the same input unchanged.',
  )
  lines.push(
    '- If the model returns a refusal or a model error, surface it to the caller. Do not silently fall back to a '
    + 'remote provider or convert the input to another modality.',
  )
  lines.push('')

  if (playbook !== undefined && playbook.caveats.length > 0) {
    lines.push('## Caveats', '')
    for (const item of playbook.caveats) lines.push(`- ${item}`)
    lines.push('')
  }

  lines.push('## Licensing', '')
  lines.push(
    `The ${entry.name} weights are licensed under the Desert Ant Labs Source-Available License `
    + `(https://license.desertant.com/1.0), not an open-source license. Inference is unlimited and free below `
    + '100,000 monthly active devices per platform per model; attribution is required and the models may not be '
    + 'redistributed or re-hosted as a service. Run it locally through this tool rather than proxying it to others.',
    '',
  )
  return lines.join('\n')
}

/**
 * A locally useful data-handling statement derived from the catalog route (DECL-05).
 * @param entry - the catalog entry.
 * @returns one sentence about where the input goes.
 */
export function describeDataHandling(entry: ModelCatalogEntry): string {
  switch (entry.windowsSupport) {
    case 'native-node':
    case 'onnxruntime-node':
    case 'browser-only':
      return `Runs in-process through ${entry.npmPackage}; this tool does not send the input to a remote service.`
    case 'apple-only':
      return 'Runs on an Apple device through the Swift SDK; this Node process cannot execute it without an explicitly configured bridge.'
    case 'no-sdk':
      return 'No runtime is available here, so the tool cannot receive input at all.'
    /* v8 ignore next -- closed union; a new member must fail compilation here. */
    default:
      return 'The execution route does not declare where input goes; treat that as unknown rather than as local.'
  }
}

/** A schema-shaped example argument object from the catalog parameter map. */
function exampleArguments(entry: ModelCatalogEntry): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entry.tool.params).map(([name, param]) => [name, sampleValue(param.type)]),
  )
}

/** One representative value per declared JSON type. */
function sampleValue(type: string | undefined): unknown {
  switch (type) {
    case 'integer':
    case 'number': return 1
    case 'boolean': return true
    case 'string[]': return ['example']
    default: return 'example'
  }
}

/** A short human description of how this model reaches its runtime. */
function describeRoute(entry: ModelCatalogEntry): string {
  switch (entry.windowsSupport) {
    case 'native-node':
      return `in-process through ${entry.npmPackage}`
    case 'onnxruntime-node':
      return `in-process through ${entry.npmPackage} with ${entry.requiresRuntime.join(', ')}`
    case 'browser-only':
      return `in-process through ${entry.npmPackage}${entry.npmSubpath ?? ''} on linux-x64, linux-arm64 and darwin-arm64`
    case 'apple-only':
      return 'on Apple platforms only, through the Swift SDK; not available to this process'
    case 'no-sdk':
      return 'nowhere yet: the weights are published but no SDK ships them'
    /* v8 ignore next -- closed union; a new member must fail compilation here. */
    default:
      return 'by an unspecified route'
  }
}
