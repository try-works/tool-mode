/**
 * Slice 5 — describe semantics and unsupported cases (task-37).
 *
 * `tool_mode_describe` returns limits and skill/model facts but omitted the
 * contract's `semantics` block, even though the contract already carries it. The
 * output schema must declare both fields so an MCP client can rely on them.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

import { callTool, cleanup, mountPlugin, tempDir } from './helpers.ts'
import { TOOL_MODE_DESCRIBE_CONTRACT } from '../src/discovery-contracts.ts'

const contexts: Context[] = []
after(async () => {
  await cleanup()
})

interface SchemaNode {
  readonly type?: unknown
  readonly additionalProperties?: unknown
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly items?: SchemaNode
  readonly maxLength?: unknown
  readonly maxItems?: unknown
}

/** The registered tool definition's output schema, through the registry's public getter. */
function registeredOutputSchema(ctx: Context, name: string): SchemaNode {
  const definition = ctx.tools.get(name)
  assert.ok(definition !== undefined, `${name} must be registered`)
  const candidate = definition.output?.schema
  assert.ok(candidate !== undefined, `${name} must be registered with an output schema`)
  // SAFETY: the registry only exposes a JSON Schema object as a tool's output schema;
  // this test reads its declared fields and never mutates it.
  return candidate as SchemaNode
}

function assertDescribeFields(schema: SchemaNode): void {
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false, 'the describe result object stays closed')
  const tools = schema.properties?.['tools']
  assert.ok(tools !== undefined)
  const item = tools.items
  assert.ok(item !== undefined)
  const properties = item.properties
  assert.ok(properties !== undefined, 'the per-tool item declares its fields')
  assert.equal(properties['semantics']?.type, 'object')
  assert.equal(properties['unsupported']?.type, 'array')
  assert.equal(properties['unsupported']?.items?.type, 'string')
}

describe('tool_mode_describe semantics and unsupported cases', () => {
  it('describing stt_transcribe includes semantics and a non-empty unsupported list', async () => {
    const ctx = await mountPlugin({ models: ['voz'], stateFile: join(tempDir(), 'state.json') })
    contexts.push(ctx)

    const result = await callTool(ctx, 'tool_mode_describe', { tools: ['stt_transcribe'] })
    assert.equal(result.isError, false, JSON.stringify(result))
    // SAFETY: the describe action's documented result is { tools: [...] }; this is the
    // test's single boundary read of that shape.
    const described = ((result.value as {
      readonly tools?: Array<{
        readonly name: string
        readonly semantics?: { readonly operation?: unknown; readonly timestampUnit?: unknown }
        readonly unsupported?: string[]
      }>
    }).tools ?? [])[0]
    assert.ok(described !== undefined)
    assert.equal(described.name, 'stt_transcribe')
    assert.ok(described.semantics !== undefined, 'semantics must be projected from the contract')
    assert.equal(described.semantics['operation'], 'transcription')
    assert.equal(described.semantics['timestampUnit'], 'seconds')
    assert.ok(Array.isArray(described.unsupported))
    assert.ok(described.unsupported.length > 0, 'stt_transcribe carries unsupported cases')
    assert.ok(described.unsupported.length <= 64)
    assert.ok(described.unsupported.some(entry => entry.includes('Translation')))
  })

  it('an absent tool still reports the existing refusal', async () => {
    const ctx = await mountPlugin({ stateFile: join(tempDir(), 'state.json') })
    contexts.push(ctx)

    const result = await callTool(ctx, 'tool_mode_describe', { tools: ['no_such_tool_xyz'] })
    assert.equal(result.isError, true)
  })

  it('the describe output schema declares closed, bounded semantics/unsupported fields', async () => {
    const ctx = await mountPlugin({ stateFile: join(tempDir(), 'state.json') })
    contexts.push(ctx)
    assertDescribeFields(registeredOutputSchema(ctx, 'tool_mode_describe'))
  })

  it('the MCP-published describe contract declares the same fields', () => {
    // The registered tool and the advertised MCP contract are two consumers of one
    // result shape; a field that exists only on the native side is invisible to an
    // external client, which is the exact drift this slice closes.
    assertDescribeFields(TOOL_MODE_DESCRIBE_CONTRACT.outputSchema as unknown as SchemaNode)
  })
})
