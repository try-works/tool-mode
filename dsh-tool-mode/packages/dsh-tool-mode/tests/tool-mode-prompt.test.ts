/**
 * The ONE Tool Mode system-prompt section (P5).
 *
 * WHY THIS EXISTS: the readiness vocabulary and the discovery workflow were only visible in
 * tool DESCRIPTIONS, which the agent reads one tool at a time. A short prompt section is
 * cheaper than repeating the contract in every description, and it is the only place that
 * can say "list and describe before you compose a program".
 *
 * WHAT THESE TESTS PROVE: the section is registered once, bounded, and carries the four
 * facts; a host WITHOUT the systemPrompt service still mounts (the access is defensive);
 * an agent preset with its own COMPLETE section still renders (this plugin never competes
 * for the whole prompt); and the text is pinned exactly, so a silent rewrite fails here.
 *
 * @module tests/tool-mode-prompt
 */

import { readFileSync } from 'node:fs'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { renderPrompt, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

import * as plugin from '../src/index.ts'
import { cleanup, isolatedStateFile, mountPlugin } from './helpers.ts'

after(async () => { await cleanup() })

/** The section name the plugin registers. */
const SECTION = 'tool-mode:readiness'

/** The heading the section must be findable by. */
const MARKER = '## Tool Mode'

/** The maximum size the plan allows. */
const MAX_CHARS = 1200

/** The structural surface of the systemPrompt service this test reads. */
interface PromptService {
  section(section: { readonly name: string; readonly order: number; readonly text: string; readonly complete?: boolean }): () => void
  getSectionOrder(name: string): number
  assemble(): Promise<PromptAssembly>
}

/** Mounted service, narrowed. */
function promptService(ctx: Awaited<ReturnType<typeof mountPlugin>>): PromptService {
  // SAFETY: the helpers mount the real SystemPrompt plugin, whose service this structural
  // interface mirrors; the assertion below fails loudly if that ever stops being true.
  const service = ctx.get('systemPrompt') as PromptService | undefined
  assert.ok(service !== undefined, 'the mounted host must provide systemPrompt')
  return service
}

describe('the Tool Mode prompt section', () => {
  it('registers exactly once, after the tool sections, bounded and carrying the four facts', async () => {
    const ctx = await mountPlugin()
    const service = promptService(ctx)
    // Bracketing probes, registered BEFORE the assembly so the ordering assertion reads one
    // assembly: the section must sort after the MCP tool slot and before the tools SDK slot.
    service.section({ name: 'probe:mcp', order: service.getSectionOrder('MCP_SERVERS'), text: 'PROBE MCP' })
    service.section({ name: 'probe:sdk', order: service.getSectionOrder('TOOLS_SDK'), text: 'PROBE SDK' })
    const assembly = await service.assemble()

    const mine = assembly.sections.filter(section => section.name === SECTION)
    assert.equal(mine.length, 1, 'exactly one Tool Mode section must be registered')
    const section = mine[0]!
    assert.ok(section.text.length <= MAX_CHARS, `the section must stay under ${MAX_CHARS} chars; got ${section.text.length}`)

    // AFTER THE TOOL SECTIONS, proven by where it SORTS — stronger than restating our number.
    const names = assembly.sections.map(candidate => candidate.name)
    assert.ok(names.indexOf('probe:mcp') < names.indexOf(SECTION), 'the section must sort after the MCP tool section')
    assert.ok(names.indexOf(SECTION) < names.indexOf('probe:sdk'), 'the section must sort before the tools SDK slot')

    // The rendered prompt contains the heading once, not once per tool.
    const rendered = renderPrompt(assembly)
    assert.equal(rendered.split(MARKER).length - 1, 1, 'the Tool Mode heading must appear exactly once')

    // THE FOUR FACTS, in the words the section uses.
    assert.match(section.text, /callable vs unavailable/i)
    assert.match(section.text, /unavailable/)
    assert.match(section.text, /list and describe first in Code Mode/i)
    assert.match(section.text, /prepared-cold/)
    assert.match(section.text, /first call/i)
    assert.match(section.text, /receipt/i)
  })

  it('pins the section text exactly (snapshot)', async () => {
    const ctx = await mountPlugin()
    const assembly = await promptService(ctx).assemble()
    const section = assembly.sections.find(candidate => candidate.name === SECTION)
    assert.ok(section !== undefined)
    assert.equal(section.text, `## Tool Mode
On-device model tools run beside your other tools.

- **callable vs unavailable.** \`tool_mode_list\` returns \`tools\` (names you can call now) and \`unavailable\` (catalogued models you cannot call here, each with \`state\` and \`reason\`). Only names in \`tools\` may be bound in a \`tool_mode_run\` program; binding an \`unavailable\` name refuses the whole request.
- **list and describe first in Code Mode.** Call \`tool_mode_list\`, then \`tool_mode_describe\` for the exact input/output schema. Describing a non-callable name answers \`callable: false\` with the reason and the action that would clear it, not a schema.
- **prepared-cold loads on the first call.** A \`prepared-cold\` model starts its engine when you first call it, so that call is slower and may exceed the advertised timeout; retry once before concluding it is unavailable.
- **per-call receipts.** Every invocation records a receipt (model, extension, outcome, elapsed). Read them with \`model_tools\` action \`receipts\` instead of re-running a call to see what happened.`)
  })

  it('mounts on a host with NO systemPrompt service, without throwing and without a section', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(SkillRegistry)
      // Deliberately NO SystemPrompt plugin.
      await ctx.plugin(plugin, { stateFile: isolatedStateFile() })
      assert.equal(ctx.get('systemPrompt'), undefined, 'this host has no prompt service')
      // No section can exist without the service, and mounting must not have thrown.
      // (A host without systemPrompt also has no tool registry — ToolRuntime needs it — so
      // the stronger "tools are still served" claim is asserted on the real host above.)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reads the prompt service defensively: ctx.get, never a hard ctx.systemPrompt property', async () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    assert.match(source, /ctx\.get\('systemPrompt'\)/, 'the service must be resolved through ctx.get')
    assert.doesNotMatch(source, /ctx\.systemPrompt/, 'a hard property access would break hosts without the service')
  })

  it('never competes with an agent preset that supplies a COMPLETE section', async () => {
    const ctx = await mountPlugin()
    const service = promptService(ctx)
    service.section({ name: 'preset:complete', order: 0, text: 'COMPLETE PRESET ONLY', complete: true })

    const assembly = await service.assemble()
    // The service restores the complete section as the SOLE section; our non-complete
    // contribution must not make that assembly fail with "more than one complete section".
    assert.equal(assembly.sections.length, 1)
    assert.match(renderPrompt(assembly), /COMPLETE PRESET ONLY/)
  })
})
