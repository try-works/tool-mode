/**
 * Author-kit reference test host and scripted harness broker (EXT-36).
 *
 * This is the smallest supported way to exercise a package outside DSH:
 * - `createAuthorTestHost` loads a real module entry and activates it with a
 *   host-issued context (no DSH, no credentials);
 * - `createScriptedHarnessBroker` builds a real HarnessBroker with a scripted
 *   provider and a recording journal, for declarative recipes.
 *
 * The fake provider is explicitly scripted: it is not a model and proves request
 * shape/failure behavior, never model quality.
 */
import { createAuthorTestHost } from '@try-works/tool-mode-extension-sdk'
import { HarnessBroker } from '@try-works/tool-mode-recipes'

export { createAuthorTestHost }

/**
 * Build a planner-facing tool-schema snapshot from only the tools a HOST
 * authorizer admits (NDL-08). An unauthorized tool is omitted, never included
 * with a redacted schema.
 * @param {readonly {name: string, description?: string, inputSchema?: object, outputSchema?: object}[]} tools
 * @param {(name: string) => boolean} authorize
 * @returns {{name: string, description: string, inputSchema: object, outputSchema: object}[]}
 */
export function createToolSchemaSnapshot(tools, authorize) {
  const snapshot = []
  for (const tool of tools) {
    if (!authorize(tool.name)) continue
    snapshot.push({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: structuredClone(tool.inputSchema ?? { type: 'object' }),
      outputSchema: structuredClone(tool.outputSchema ?? { type: 'json' }),
    })
  }
  return snapshot
}

/**
 * Create a real harness broker over a scripted provider.
 * @param {object} [options]
 * @param {readonly string[]} [options.replies] - scripted completions in call order; the last repeats.
 * @param {boolean} [options.images] - whether the scripted provider claims image support.
 * @param {number} [options.maxOutputTokens] - the provider ceiling.
 * @returns {{broker: HarnessBroker, provider: object, journal: object[]}}
 */
export function createScriptedHarnessBroker(options = {}) {
  const replies = options.replies ?? ['{"title":"Scripted","description":"A scripted completion."}']
  const journal = []
  let call = 0
  const provider = {
    id: 'author-kit-scripted',
    generation: 1,
    destination: 'local',
    capabilities: () => ({ images: options.images === true, maxOutputTokens: options.maxOutputTokens ?? 1024 }),
    async complete() {
      const reply = replies[Math.min(call, replies.length - 1)]
      call += 1
      return { kind: 'text', text: reply }
    },
  }
  const broker = new HarnessBroker({ record: record => journal.push(record) })
  return { broker, provider, journal }
}
