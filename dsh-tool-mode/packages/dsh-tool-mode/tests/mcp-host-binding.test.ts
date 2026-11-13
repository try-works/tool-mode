/**
 * MCP host-binding tests (MCP-08, MCP-09, MCP-11, MCP-12).
 *
 * These verify where the data COMES FROM, which is what both requirements are
 * about. MCP-09 is satisfied only if the output schema is taken from the contract
 * rather than from DSH's model-facing projection, and MCP-08 only if invocation goes
 * through the host's execute path with a server-issued identity. Neither is visible
 * from the shape of a response, so the tests assert provenance instead.
 *
 * Requirement links: MCP-08, MCP-09, MCP-11, MCP-12, MCP-13.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Ajv2020 from 'ajv/dist/2020.js'

import * as plugin from '../src/index.ts'
import { createMcpHost, derivePayloadSchema, type HostSurface, type PublishedTool } from '../src/mcp/host-binding.ts'
import { dispatch } from '../src/mcp/server.ts'
import { META_KEYS, PROTOCOL_VERSION, type WireRequest } from '../src/mcp/protocol.ts'
import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'
import { setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import { TOOL_MODE_RUN_CONTRACT } from '../src/tool-mode-run.ts'
import { callTool, cleanup, isolatedStateFile, mountPlugin, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

/** A contract with a meta envelope, as the standard contracts have. */
const CONTRACT = STANDARD_CONTRACTS.find(contract => contract.toolName === 'lang_detect')!

describe('MCP-09 — schemas come from the contract', () => {
  it('removes ONLY the reserved meta property from the payload schema', () => {
    const payload = derivePayloadSchema(CONTRACT.outputSchema)
    const properties = payload.properties as Record<string, unknown>
    // §16.4: the payload schema is the final tool schema with only the reserved
    // `meta` property and its required entry removed.
    assert.equal('meta' in properties, false, 'meta must be removed')
    assert.equal((payload.required as unknown[] | undefined)?.includes('meta'), false)
    // Everything else survives: a schema that dropped more would under-declare the
    // result the contract actually enforces.
    const original = Object.keys(CONTRACT.outputSchema.properties as Record<string, unknown>)
      .filter(key => key !== 'meta')
    assert.deepEqual(Object.keys(properties).sort(), original.sort())
  })

  it('preserves the remaining constraints verbatim', () => {
    const payload = derivePayloadSchema(CONTRACT.outputSchema)
    const original = structuredClone(CONTRACT.outputSchema as Record<string, unknown>)
    delete (original.properties as Record<string, unknown>).meta
    original.required = (original.required as unknown[]).filter(entry => entry !== 'meta')
    assert.deepEqual(payload, original)
  })

  it('does not mutate the contract it derived from', () => {
    const before = JSON.stringify(CONTRACT.outputSchema)
    derivePayloadSchema(CONTRACT.outputSchema)
    // The contract is shared and validated against elsewhere; a derivation that
    // edited it in place would corrupt every later validation.
    assert.equal(JSON.stringify(CONTRACT.outputSchema), before)
  })

  it('exports an output schema for every published tool', () => {
    const surface: HostSurface = {
      published: [{ toolName: CONTRACT.toolName, contract: CONTRACT }],
      execute: async () => ({ isError: false, value: {} }),
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const [tool] = host.listTools()
    // DSH's model-facing `schemas()` omits output, so a tool published from it would
    // have no declared result shape at all.
    assert.ok(tool?.outputSchema, 'every exported tool must declare its result shape')
    assert.ok(tool?.inputSchema)
    assert.equal(tool?.importedFromMcp, false)
  })
})

describe('MCP-08 — invocation goes through the host path', () => {
  it('passes a server-issued call id and the CALLER signal', async () => {
    const seen: { callId?: string; signal?: AbortSignal; name?: string } = {}
    const surface: HostSurface = {
      published: [{ toolName: CONTRACT.toolName, contract: CONTRACT }],
      async execute({ name, callId, signal }) {
        seen.name = name
        seen.callId = callId
        seen.signal = signal
        return { isError: false, value: { reliability: 'confident', tooCloseToCall: false, candidates: [{ language: 'de', probability: 1 }] } }
      },
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const callerSignal = new AbortController().signal
    await host.callTool(CONTRACT.toolName, { text: 'hallo' }, callerSignal)

    assert.equal(seen.name, CONTRACT.toolName)
    // Server-issued, so a caller cannot forge the identity a receipt records.
    assert.match(String(seen.callId), /^mcp_/)
    // The CALLER's signal, so cancellation reaches the actual work.
    assert.equal(seen.signal, callerSignal)
  })

  it('validates a 2020-12 extension output schema instead of refusing the call', async () => {
    // Laya declares draft 2020-12 output schemas. Compiling them with the draft-07
    // compiler threw "no schema with key or ref", so the three tools were LISTED and
    // every call failed. The compiler now follows the schema's own $schema.
    const extensionContract = {
      contract: 'fixture/laya-like',
      contractVersion: '1.0.0',
      toolName: 'decision_choose',
      description: 'A 2020-12 result schema, as an extension declares it.',
      inputSchema: { type: 'object', additionalProperties: true },
      outputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        required: ['choice'],
        properties: { choice: { type: 'string' }, meta: { type: 'object' } },
      },
    } as unknown as typeof CONTRACT
    const surface: HostSurface = {
      published: [{ toolName: 'decision_choose', contract: extensionContract }],
      async execute() { return { isError: false, value: { choice: 'yes' } } },
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const outcome = await host.callTool('decision_choose', {}, new AbortController().signal)
    assert.notEqual(outcome.isError, true, JSON.stringify(outcome))
    assert.deepEqual(outcome.structured, { choice: 'yes' })
  })

  it('validates each tool against ITS schema, not the first compiled one', async () => {
    // The leak: extension contracts have no contract id, so every extension shared
    // cache key `undefined` and decision_choose's validator rejected multimodal_embed.
    const first = {
      description: 'first',
      inputSchema: { type: 'object', additionalProperties: true },
      outputSchema: {
        type: 'object', additionalProperties: false, required: ['chosen'],
        properties: { chosen: { type: 'string' }, meta: { type: 'object' } },
      },
    } as unknown as typeof CONTRACT
    const second = {
      description: 'second',
      inputSchema: { type: 'object', additionalProperties: true },
      outputSchema: {
        type: 'object', additionalProperties: false, required: ['dimensions'],
        properties: { dimensions: { type: 'number' }, meta: { type: 'object' } },
      },
    } as unknown as typeof CONTRACT
    const surface: HostSurface = {
      published: [
        { toolName: 'decision_choose', contract: first },
        { toolName: 'text_embed', contract: second },
      ],
      async execute({ name }) {
        return name === 'decision_choose'
          ? { isError: false, value: { chosen: 'development' } }
          : { isError: false, value: { dimensions: 384 } }
      },
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const a = await host.callTool('decision_choose', {}, new AbortController().signal)
    const b = await host.callTool('text_embed', {}, new AbortController().signal)
    assert.notEqual(a.isError, true, JSON.stringify(a))
    assert.notEqual(b.isError, true, JSON.stringify(b))
    assert.deepEqual(b.structured, { dimensions: 384 })
  })

  it('issues a distinct call id per invocation', async () => {
    const ids: string[] = []
    const surface: HostSurface = {
      published: [{ toolName: 't', contract: CONTRACT }],
      async execute({ callId }) { ids.push(callId); return { isError: false, value: {} } },
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    await host.callTool('t', {}, new AbortController().signal)
    await host.callTool('t', {}, new AbortController().signal)
    assert.notEqual(ids[0], ids[1])
  })

  it('reports a host failure as a tool error, not a fabricated success', async () => {
    const surface: HostSurface = {
      published: [{ toolName: 't', contract: CONTRACT }],
      async execute() { return { isError: true, message: 'the model is unprepared' } },
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const outcome = await host.callTool('t', {}, new AbortController().signal)
    assert.equal(outcome.isError, true)
    assert.match(outcome.text, /unprepared/)
    assert.equal(outcome.structured, null)
  })

  it('returns the schema-valid MCP payload, with only reserved meta removed', async () => {
    const value = {
      reliability: 'confident',
      tooCloseToCall: false,
      candidates: [{ language: 'de', probability: 0.98 }],
      meta: { hostOnly: true },
    }
    const surface: HostSurface = {
      published: [{ toolName: 't', contract: CONTRACT }],
      async execute() { return { isError: false, value } },
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const outcome = await host.callTool('t', {}, new AbortController().signal)
    assert.equal(outcome.isError, undefined)
    assert.deepEqual(outcome.structured, {
      reliability: 'confident',
      tooCloseToCall: false,
      candidates: [{ language: 'de', probability: 0.98 }],
    })
  })

  it('rejects a host success whose structured value violates the advertised output schema', async () => {
    const surface: HostSurface = {
      published: [{ toolName: 't', contract: CONTRACT }],
      async execute() {
        return {
          isError: false,
          value: {
            reliability: 'not-a-contract-value',
            tooCloseToCall: false,
            candidates: [{ language: 'de', probability: 0.98 }],
          },
        }
      },
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const outcome = await host.callTool('t', {}, new AbortController().signal)
    assert.equal(outcome.isError, true)
    assert.match(outcome.text, /advertised MCP output schema/)
    assert.equal(outcome.structured, null)
  })

  it('bounds the model-readable rendering', async () => {
    const surface: HostSurface = {
      published: [{ toolName: 't', contract: CONTRACT }],
      async execute() {
        return {
          isError: false,
          value: { reliability: 'confident', tooCloseToCall: false, candidates: [{ language: 'x'.repeat(200_000), probability: 1 }] },
        }
      },
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const outcome = await host.callTool('t', {}, new AbortController().signal)
    // The bound is the slice, plus the truncation marker appended after it.    assert.ok(outcome.text.length <= 100_100, 'the rendering is copied into a context and must be bounded')
    assert.match(outcome.text, /truncated/)
  })
})

describe('MCP-12 — a tool that cannot be exported faithfully is withheld', () => {
  it('omits it entirely and reports the reason', () => {
    const withheld: PublishedTool[] = []
    const surface: HostSurface = {
      published: [
        { toolName: 'good', contract: CONTRACT },
        { toolName: 'ui_only', contract: CONTRACT, notExportableReason: 'uses a UI-only API' },
      ],
      execute: async () => ({ isError: false, value: {} }),
    }
    const host = createMcpHost({
      surface,
      serverInfo: { name: 'x', version: '1' },
      onWithheld: tool => withheld.push(tool),
    })
    const names = host.listTools().map(tool => tool.name)
    // Partly serializing it would tell a client the tool exists and then fail in a
    // way the client cannot interpret.
    assert.deepEqual(names, ['good'])
    assert.equal(withheld[0]?.toolName, 'ui_only')
    assert.match(String(withheld[0]?.notExportableReason), /UI-only/)
  })

  it('refuses to call a withheld tool even if asked by name', async () => {
    const surface: HostSurface = {
      published: [{ toolName: 'ui_only', contract: CONTRACT, notExportableReason: 'non-JSON callback' }],
      execute: async () => ({ isError: false, value: {} }),
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const outcome = await host.callTool('ui_only', {}, new AbortController().signal)
    assert.equal(outcome.isError, true)
    assert.match(outcome.text, /withheld: non-JSON callback/)
  })
})

describe('MCP-08 / MCP-09 — end to end through the plugin', () => {
  let counter = 0
  function request(method: string, params: Record<string, unknown> = {}): WireRequest {
    return {
      jsonrpc: '2.0',
      id: `host-${++counter}`,
      method,
      params: {
        ...params,
        _meta: {
          [META_KEYS.protocolVersion]: PROTOCOL_VERSION,
          [META_KEYS.clientInfo]: { name: 'binding-test', version: '1.0.0' },
          [META_KEYS.clientCapabilities]: {},
        },
      },
    }
  }

  it('the control tool exposes what MCP would export', async () => {
    const ctx = await mountPlugin()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('mcp-list'),
      name: 'model_tools',
      arguments: { action: 'mcp' },
    })
    if (result.isError) throw new Error(`expected success: ${result.error.message}`)
    const exported = (result.value as { mcp: { name: string; hasOutputSchema: boolean }[] }).mcp
    assert.ok(exported.length > 0, 'the plugin publishes at least one contract tool')
    // The MCP-09 fact, observable: every exported tool declares its result shape.
    for (const tool of exported) {
      assert.equal(tool.hasOutputSchema, true, `${tool.name} must declare an output schema`)
    }
  })

  it('DECL-07: serves tool_mode_list and tool_mode_describe to an external caller', async () => {
    const ctx = await mountPlugin()
    const host = ctx.get('model-tools.mcp-host') as {
      listTools(): readonly { name: string }[]
      callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ isError?: boolean; text?: string }>
    }
    const names = host.listTools().map(tool => tool.name)
    assert.ok(names.includes('tool_mode_list'), `tool_mode_list must be externally visible; got ${names.join(',')}`)
    assert.ok(names.includes('tool_mode_describe'), 'tool_mode_describe must be externally visible')

    const listed = await host.callTool('tool_mode_list', {}, new AbortController().signal)
    assert.equal(listed.isError, undefined)
    assert.match(listed.text ?? '', /catalogRevision/)
    const described = await host.callTool('tool_mode_describe', { tools: ['tool_mode_list'] }, new AbortController().signal)
    assert.equal(described.isError, undefined)
    assert.match(described.text ?? '', /catalogRevision/)
  })

  it('DECL-07: tool_mode_describe returns output type, examples and skill instructions', async () => {
    const ctx = await mountPluginWithTongue({ stateFile: isolatedStateFile(), models: ['title'] })
    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))
    const described = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('decl07-describe'),
      name: 'tool_mode_describe',
      arguments: { tools: ['lang_detect', 'tool_mode_list'] },
    })
    assert.equal(described.isError, false, JSON.stringify(described))
    if (described.isError) throw new Error('expected success')
    const tools = (described.value as { tools: Record<string, unknown>[] }).tools
    const lang = tools[0]!
    assert.ok(lang.outputSchema, 'the selected output schema must be returned')
    assert.match(String((lang.typescript as { input?: string }).input), /interface/)
    assert.ok(Array.isArray(lang.examples) && lang.examples.length > 0)
    assert.ok(Array.isArray(lang.unsupported), 'unsupported cases must be part of discovery')
    assert.equal(typeof lang.dataHandling, 'string')
    assert.equal(typeof lang.recovery, 'string')
    assert.equal((lang.skill as { name?: string } | undefined)?.name, 'desert-ant-tongue')
    assert.equal(typeof lang.catalogRevision, 'string')
  })

  it('MCP-07: a cached tool list never grants continuing authority after disable', async () => {
    const ctx = await mountPluginWithTongue({ models: ['title'] })
    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))
    const host = ctx.get('model-tools.mcp-host') as {
      listTools(): readonly { name: string }[]
      callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ isError?: boolean; text?: string }>
    }
    const cached = host.listTools().map(tool => tool.name)
    assert.ok(cached.includes('lang_detect'), 'the tool must be visible before revocation')

    const disabled = await callTool(ctx, 'model_tools', { action: 'disable', model: 'tongue' })
    assert.equal(disabled.isError, false, JSON.stringify(disabled))

    // The client still holds the old list, but execution re-checks the live surface.
    const revoked = await host.callTool('lang_detect', { text: 'kann ich das haben' }, new AbortController().signal)
    assert.equal(revoked.isError, true)
    assert.doesNotMatch(revoked.text ?? '', /"language"/)
  })

  it('exports exactly the tools the host registered', async () => {
    const ctx = await mountPlugin()
    const listed = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('mcp-vs-registry'),
      name: 'model_tools',
      arguments: { action: 'mcp' },
    })
    if (listed.isError) throw new Error('expected success')
    const exported = (listed.value as { mcp: { name: string }[] }).mcp.map(tool => tool.name).sort()    /**
     * HOST CONTROL TOOLS ARE NAMED, not filtered by an ad-hoc string comparison.
     *
     * `model_tools`/`model_tools_manage` are the native control surfaces and
     * `tool_mode_run` is program execution without the exposure grant, so none is a
     * model tool. `tool_mode_list`/`tool_mode_describe` ARE exported (DECL-07) and
     * therefore stay in the registry comparison.
     */
    const HOST_CONTROL_TOOLS = new Set(['model_tools', 'model_tools_manage', 'tool_mode_run'])
    const registered = ctx.tools.schemas()
      .map(schema => schema.name)
      .filter(name => !HOST_CONTROL_TOOLS.has(name))
      .sort()
    // The MCP surface is built from `registeredContracts`, so it cannot advertise a
    // tool the publication surface withheld.
    assert.deepEqual(exported, registered)
    // And the withheld control tool really is absent from the external surface, which is
    // the half CODE-08 depends on.
    assert.equal(exported.includes('tool_mode_run'), false, 'program execution must not be exported')
  })

  it('EXPORTS tool_mode_run when the gate opens (confinement evidence AND operator consent)', async () => {
    // The round-44 review named this the testability wall: the export branch had
    // no seam to open, so its first execution would have been in production. The
    // seam is the confinement-evidence setter, which requires the operator
    // environment marker (the setter ships in the built artifact and must be
    // inert without it). Set the marker, flip, and restore both in finally so no
    // other test sees an open gate.
    const originalMarker = process.env.DSH_PTC_CONFINEMENT_SEAM
    process.env.DSH_PTC_CONFINEMENT_SEAM = 'open-for-acceptance-test'
    setConfinementDemonstratedForTest(true)
    try {
      const ctx = await mountPlugin({ hostedCode: true })
      const listed = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('mcp-open-gate'),
        name: 'model_tools',
        arguments: { action: 'mcp' },
      })
      if (listed.isError) throw new Error('expected success')
      const exported = (listed.value as { mcp: { name: string }[] }).mcp
      const entry = exported.find(tool => tool.name === 'tool_mode_run')
      assert.ok(entry, `tool_mode_run must be exported when both gate facts hold, saw: ${exported.map(tool => tool.name).join(', ')}`)
    } finally {
      setConfinementDemonstratedForTest(false)
      if (originalMarker === undefined) delete process.env.DSH_PTC_CONFINEMENT_SEAM
      else process.env.DSH_PTC_CONFINEMENT_SEAM = originalMarker
    }
  })

  it('the tool_mode_run MCP projection conforms to the PINNED schema before it ever ships (P26-13)', () => {
    // The round-44 review's deeper point: the hand-written contract must be
    // schema-validated before its first live tools/list, not inspected. This
    // builds the SAME projection the binding builds and validates it against the
    // pinned $defs.Tool with Ajv 2020 — the exact validator the live suite uses.
    const surface: HostSurface = {
      published: [{ toolName: 'tool_mode_run', contract: TOOL_MODE_RUN_CONTRACT as never }],
      execute: async () => ({ isError: false, value: {} }),
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'tool-mode', version: '0.1.3' } })
    const listed = host.listTools()
    const entry = listed.find(tool => tool.name === 'tool_mode_run')
    assert.ok(entry, 'the projection must include the tool')

    const schema = JSON.parse(readFileSync('docs/tool-mode/specs/mcp-2026-07-28/schema.json', 'utf8')) as {
      $defs?: Record<string, unknown>
      definitions?: Record<string, unknown>
    }
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    ajv.addSchema(schema as object, 'pinned')
    const defs = schema.$defs ?? schema.definitions ?? {}
    const toolDef = defs.Tool
    assert.ok(toolDef !== undefined, 'the pinned schema must define Tool')
    const validate = ajv.compile({ $ref: 'pinned#/$defs/Tool' })
    const projected = {
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema,
    }
    assert.equal(validate(projected), true, `tool_mode_run projection violates the pinned Tool: ${JSON.stringify(validate.errors)}`)
  })

  it('a tools/list over the binding returns contract-derived schemas', async () => {
    const ctx = await mountPlugin()
    const listed = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('mcp-schemas'),
      name: 'model_tools',
      arguments: { action: 'mcp' },
    })
    if (listed.isError) throw new Error('expected success')
    const exported = (listed.value as { mcp: { name: string }[] }).mcp
    const surface: HostSurface = {
      published: exported.map(entry => ({
        toolName: entry.name,
        contract: STANDARD_CONTRACTS.find(contract => contract.toolName === entry.name) ?? {
          contract: `host.${entry.name}`,
          version: '1.0.0',
          toolName: entry.name,
          description: entry.name,
          inputSchema: { type: 'object', additionalProperties: false, properties: {} },
          outputSchema: { type: 'object', additionalProperties: true },
          semantics: {},
          limits: {},
          unsupported: [],
        },
      })),
      execute: async () => ({ isError: false, value: { reliability: 'confident', tooCloseToCall: false, candidates: [{ language: 'de', probability: 1 }] } }),
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'dsh-tool-mode', version: '0.1.0' } })
    const { response } = await dispatch(request('tools/list'), host)
    const tools = (response?.result as { tools: { name: string; outputSchema: unknown }[] }).tools
    for (const tool of tools) {
      assert.ok(tool.outputSchema, `${tool.name} must carry an output schema over the wire`)
    }
  })
})
