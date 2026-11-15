/**
 * The MODEL-FACING result envelope must be uniform (task-54).
 *
 * The report found contract tools returning raw provider text (`text_title` returned a JSON
 * STRING with no meta) and host-defined decision tools with no envelope at all. The rule this
 * file pins: a MODEL-FACING result that has a contract is the validated contract OBJECT with a
 * `meta` envelope whose provenance fields come from the host, never from the model.
 *
 * Control/discovery tools (model_tools, tool_mode_*) are deliberately EXEMPT: their result is
 * the control surface's own payload, and an envelope there would duplicate the purpose of the
 * tool without telling a caller anything it does not already get from the call.
 *
 * @module tests/result-envelope
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'

import { DECISION_COMBINE_CONTRACT } from '../src/decision-combine.ts'
import { DECISION_EVALUATE_CONTRACT, DECISION_ROUTE_CONTRACT } from '../src/decision-evaluate.ts'
import { cleanup, mountPlugin, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

let counter = 0

/** Invoke one registered tool through the real pipeline. */
async function call(ctx: Awaited<ReturnType<typeof mountPlugin>>, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`envelope-${++counter}`),
    name,
    arguments: args,
  })
  if (result.isError) throw new Error(`${name} failed: ${result.error?.message ?? 'unknown'}`)
  // SAFETY: the registered definition validates every success against its output schema; this
  // test reads the validated value, never an unvalidated provider result.
  return result.value as Record<string, unknown>
}

/** The meta fields every host-authored envelope carries. */
function assertMeta(value: Record<string, unknown>, contract: string, contractVersion: string): void {
  const meta = value['meta'] as Record<string, unknown>
  assert.ok(typeof meta === 'object' && meta !== null, `${contract}: meta must be an object`)
  assert.equal(meta['contract'], contract)
  assert.equal(meta['contractVersion'], contractVersion)
  assert.ok(typeof meta['implementationId'] === 'string' && meta['implementationId'].length > 0)
  assert.ok(typeof meta['extension'] === 'string' && meta['extension'].length > 0)
  assert.ok(typeof meta['extensionVersion'] === 'string' && meta['extensionVersion'].length > 0)
  assert.ok(Number.isInteger(meta['activationGeneration']))
  assert.equal(meta['executionLocation'], 'host')
  assert.ok(typeof meta['receiptId'] === 'string' && meta['receiptId'].length > 0)
  assert.ok(Array.isArray(meta['warnings']))
  // Provenance is HOST state, never model output: the reserved fields are not extra payload.
  assert.equal(Object.keys(value).includes('contractVersion'), false)
}

describe('task-54 — decision_* results carry the host-authored meta envelope', () => {
  it('stamps decision.combine', async () => {
    const ctx = await mountPlugin()
    const result = await call(ctx, 'decision_combine', {
      facts: { a: 1 },
      judgments: {},
      rules: [{ id: 'r1', when: [{ source: 'fact', key: 'a', op: 'eq', value: 1 }], exit: 'yes' }],
      fallback: 'no-match',
    })
    assert.equal(result['exit'], 'yes')
    assertMeta(result, 'decision.combine', '1.1.0')
    assert.equal((result['meta'] as Record<string, unknown>)['implementationId'], 'host')
  })

  it('stamps decision.route', async () => {
    const ctx = await mountPlugin()
    const result = await call(ctx, 'decision_route', { probability: 0.5 })
    assertMeta(result, 'decision.route', '1.1.0')
  })

  it('stamps decision.evaluate', async () => {
    const ctx = await mountPlugin()
    const result = await call(ctx, 'decision_evaluate', { cases: [{ expected: true, probability: 0.8 }] })
    assertMeta(result, 'decision.evaluate', '1.1.0')
  })

  it('declares meta in the REGISTERED schema and in the MCP contract alike (no drift)', async () => {
    const ctx = await mountPlugin()
    for (const [name, contract] of [
      ['decision_combine', DECISION_COMBINE_CONTRACT],
      ['decision_route', DECISION_ROUTE_CONTRACT],
      ['decision_evaluate', DECISION_EVALUATE_CONTRACT],
    ] as const) {
      const registered = ctx.tools.get(name)?.output.schema as { properties?: Record<string, unknown> } | undefined
      assert.ok(registered?.properties !== undefined, `${name}: registered output schema must declare properties`)
      assert.ok('meta' in registered.properties, `${name}: registered schema must declare meta`)

      const advertised = contract.outputSchema as { properties?: Record<string, unknown>; required?: readonly string[] }
      assert.ok('meta' in (advertised.properties ?? {}), `${name}: MCP contract must declare meta`)
      assert.ok(advertised.required?.includes('meta'), `${name}: MCP contract must REQUIRE meta`)
      assert.equal(contract.version, '1.1.0')
    }
  })
})

describe('task-54 — contract-backed tools return the contract object, never a bare string', () => {
  it('lang_detect keeps its contract shape with meta', async () => {
    const ctx = await mountPluginWithTongue()
    const enabled = await call(ctx, 'model_tools', { action: 'enable', model: 'tongue' }).catch(error => error as Error)
    assert.ok(!(enabled instanceof Error), String(enabled))
    const result = await call(ctx, 'lang_detect', { text: 'kann ich das haben' })
    assert.equal(typeof result, 'object')
    assert.ok('language' in result, 'the contract payload field is present')
    assertMeta(result, 'text.language_detect', '1.0.0')
  })

  it('every contract with meta declares it in its output schema', () => {
    // The contract side of the same rule: a contract whose results carry meta must SAY so,
    // or a caller validating the result would reject the host's own envelope.
    for (const contract of STANDARD_CONTRACTS) {
      const schema = contract.outputSchema as { required?: readonly string[]; properties?: Record<string, unknown> }
      assert.ok(schema.required?.includes('meta'), `${contract.contract}: output schema must require meta`)
      assert.ok('meta' in (schema.properties ?? {}), `${contract.contract}: output schema must declare meta`)
    }
  })
})
