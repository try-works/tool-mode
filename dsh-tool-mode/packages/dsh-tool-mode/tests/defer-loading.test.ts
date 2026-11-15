/**
 * P3 of the agent tool-selection plan: deferred loading for heavy schemas.
 *
 * The selection is a PURE decision over (explicit ids, a byte threshold and the config
 * switch), and the registration functions must carry that decision onto the definition as
 * `deferLoading: true` without changing the name, description or parameter schema. These
 * tests capture exactly what the DSH registry receives, so the assertion is about the
 * registered tool rather than about a helper called beside it.
 *
 * The byte delta measured here is the model-facing declaration payload (name + description
 * + parameters) that a provider MAY omit from context for a deferred tool. DSH's DeepSeek
 * serializer still writes the full schema and appends `defer_loading`; the provider-side
 * accounting is therefore a contract, not a local wire-byte reduction. That limit is stated
 * in the config documentation and in the task report.
 */

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { STANDARD_CONTRACTS, toDshParameters } from '@try-works/tool-mode-contracts'

import { Config } from '../src/index.ts'
import { loadCatalog } from '../src/catalog.ts'
import {
  buildParameters,
  DEFER_HEAVY_SCHEMA_THRESHOLD_BYTES,
  registerModelTool,
  shouldDeferHeavySchema,
  toolSchemaBytes,
} from '../src/registrar.ts'
import {
  registerContractImplementationTool,
  registerContractTool,
  type HostIdentity,
} from '../src/bindings.ts'
import { catalogToolDescription, contractToolDescription } from '../src/tool-description.ts'
import type { ModelAdapter } from '../src/adapters/index.ts'
import { cleanup } from './helpers.ts'

after(async () => { await cleanup() })

interface CapturedDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
  readonly deferLoading?: true
}

function captureCtx() {
  const definitions: CapturedDefinition[] = []
  return {
    definitions,
    ctx: { tools: { register(definition: CapturedDefinition): () => void { definitions.push(definition); return () => {} } } },
  }
}

const fakeAdapter = (modelId: string): ModelAdapter => ({ modelId, invoke: async () => ({}) })

function fakeHost(): HostIdentity {
  return {
    extension: '@try-works/dsh-tool-mode',
    extensionVersion: '0.0.0-test',
    activationGeneration: 1,
    nextReceiptId: () => 'rcpt_test_1',
    grant: {
      grantId: 'test-grant',
      allowedTools: ['lang_detect', 'stt_transcribe', 'multimodal_embed'],
      approvedRoots: [],
      remoteDestinations: [],
      allowedHarnessProfiles: [],
      modelCapabilities: ['text'],
      hostedCode: false,
      recordingPolicy: 'none',
      limits: {
        maxInputBytes: 8192,
        maxAudioSeconds: 60,
        maxResultBytes: 1048576,
        maxModelCalls: 1,
        maxOutputTokens: 1024,
        maxImages: 1,
        deadlineMs: 60000,
      },
    },
    callerKind: 'interactive',
  }
}

const contractFor = (toolName: string) => {
  const contract = STANDARD_CONTRACTS.find(candidate => candidate.toolName === toolName)
  assert.ok(contract !== undefined, toolName + ' must be a standard contract')
  return contract
}

describe('shouldDeferHeavySchema', () => {
  it('selects the explicit ids even when their schema is small', () => {
    for (const toolName of ['multimodal_embed', 'media_find_moments', 'extract_with_repair', 'structured_extract', 'tools_plan']) {
      assert.equal(shouldDeferHeavySchema({ toolName, schemaBytes: 1, enabled: true }), true, toolName)
    }
  })

  it('matches the semantic_* wildcard but not unrelated names', () => {
    for (const toolName of ['semantic_similarity', 'semantic_rank', 'semantic_classify', 'semantic_deduplicate']) {
      assert.equal(shouldDeferHeavySchema({ toolName, schemaBytes: 1, enabled: true }), true, toolName)
    }
    assert.equal(shouldDeferHeavySchema({ toolName: 'semantic', schemaBytes: 1, enabled: true }), false)
    assert.equal(shouldDeferHeavySchema({ toolName: 'text_embed', schemaBytes: 1, enabled: true }), false)
  })

  it('selects a schema only when it EXCEEDS the threshold', () => {
    const threshold = 1024
    assert.equal(shouldDeferHeavySchema({ toolName: 'big_tool', schemaBytes: threshold, enabled: true, thresholdBytes: threshold }), false)
    assert.equal(shouldDeferHeavySchema({ toolName: 'big_tool', schemaBytes: threshold + 1, enabled: true, thresholdBytes: threshold }), true)
  })

  it('selects nothing when disabled, whatever the id or size', () => {
    assert.equal(shouldDeferHeavySchema({ toolName: 'multimodal_embed', schemaBytes: 1_000_000, enabled: false }), false)
  })

  it('honours an explicit override of ids and threshold', () => {
    assert.equal(shouldDeferHeavySchema({ toolName: 'custom_heavy', schemaBytes: 10, enabled: true, explicitIds: ['custom_heavy'] }), true)
    assert.equal(shouldDeferHeavySchema({ toolName: 'multimodal_embed', schemaBytes: 10, enabled: true, explicitIds: [] }), false)
  })

  it('has a documented default threshold', () => {
    assert.equal(DEFER_HEAVY_SCHEMA_THRESHOLD_BYTES, 1024)
    assert.equal(shouldDeferHeavySchema({ toolName: 'around_the_edge', schemaBytes: 1025, enabled: true }), true)
    assert.equal(shouldDeferHeavySchema({ toolName: 'around_the_edge', schemaBytes: 1024, enabled: true }), false)
  })
})

describe('the selected real tools', () => {
  it('selects the heavy contracts and the two largest catalog schemas, and leaves the rest eager', () => {
    const catalog = loadCatalog()
    const catalogCandidates = catalog.filter(entry => entry.contract === null).map(entry => ({
      toolName: entry.tool.name,
      schemaBytes: toolSchemaBytes({
        name: entry.tool.name,
        description: catalogToolDescription(entry),
        parameters: parameterSchemaSpecToJsonSchema(buildParameters(entry)),
      }),
    }))
    const contractCandidates = STANDARD_CONTRACTS.map(contract => ({
      toolName: contract.toolName,
      schemaBytes: toolSchemaBytes({
        name: contract.toolName,
        description: contractToolDescription(contract),
        parameters: toDshParameters(contract),
      }),
    }))
    const selected = [...catalogCandidates, ...contractCandidates]
      .filter(candidate => shouldDeferHeavySchema({ ...candidate, enabled: true }))
      .map(candidate => candidate.toolName)
      .sort()

    for (const expected of [
      'multimodal_embed', 'media_find_moments', 'structured_extract', 'tools_plan',
      'semantic_classify', 'semantic_deduplicate', 'semantic_rank', 'semantic_similarity',
      'stt_transcribe', 'classify_nsfw',
    ]) {
      assert.ok(selected.includes(expected), expected + ' must be selected')
    }
    for (const eager of ['lang_detect', 'align_transcript', 'text_embed', 'suggest_title']) {
      assert.equal(selected.includes(eager), false, eager + ' must stay eager')
    }
  })
})

describe('registration carries deferLoading', () => {
  const byName = (definitions: readonly CapturedDefinition[], name: string): CapturedDefinition => {
    const found = definitions.find(definition => definition.name === name)
    assert.ok(found !== undefined, 'registered ' + name)
    return found
  }

  it('marks a selected per-model tool and leaves a small one eager', () => {
    const catalog = loadCatalog()
    const heavy = catalog.find(entry => entry.tool.name === 'classify_nsfw')
    const small = catalog.find(entry => entry.tool.name === 'align_transcript')
    assert.ok(heavy !== undefined && small !== undefined)
    const capture = captureCtx()
    registerModelTool(capture.ctx, heavy, fakeAdapter('classify_nsfw'), { deferHeavySchemas: true })
    registerModelTool(capture.ctx, small, fakeAdapter('align'), { deferHeavySchemas: true })
    assert.equal(byName(capture.definitions, heavy.tool.name).deferLoading, true)
    assert.equal(byName(capture.definitions, small.tool.name).deferLoading, undefined)
  })

  it('defaults to no deferral when the option is absent or false', () => {
    const catalog = loadCatalog()
    const heavy = catalog.find(entry => entry.tool.name === 'classify_nsfw')
    assert.ok(heavy !== undefined)
    for (const options of [undefined, { deferHeavySchemas: false }]) {
      const capture = captureCtx()
      registerModelTool(capture.ctx, heavy, fakeAdapter('classify_nsfw'), options)
      assert.equal(byName(capture.definitions, heavy.tool.name).deferLoading, undefined)
    }
  })

  it('marks a selected contract tool and leaves lang_detect eager', () => {
    const tongue = loadCatalog().find(entry => entry.id === 'tongue')
    assert.ok(tongue !== undefined)
    const capture = captureCtx()
    const multimodal = contractFor('multimodal_embed')
    const language = contractFor('lang_detect')
    registerContractTool(capture.ctx, { contract: multimodal, implementation: tongue, adapter: fakeAdapter('x'), route: 'extension', alternatives: [] }, fakeHost(), { deferHeavySchemas: true })
    registerContractTool(capture.ctx, { contract: language, implementation: tongue, adapter: fakeAdapter('tongue'), route: 'extension', alternatives: [] }, fakeHost(), { deferHeavySchemas: true })
    assert.equal(byName(capture.definitions, multimodal.toolName).deferLoading, true)
    assert.equal(byName(capture.definitions, language.toolName).deferLoading, undefined)
  })

  it('marks a selected extension implementation tool and leaves lang_detect eager', () => {
    const capture = captureCtx()
    const multimodal = contractFor('multimodal_embed')
    const language = contractFor('lang_detect')
    const implementation = { id: 'impl', extensionId: '@try-works/extension-embeddinggemma', modelId: 'embeddinggemma' }
    registerContractImplementationTool(capture.ctx, multimodal, fakeHost(), async () => ({}), implementation, { deferHeavySchemas: true })
    registerContractImplementationTool(capture.ctx, language, fakeHost(), async () => ({}), implementation, { deferHeavySchemas: true })
    assert.equal(byName(capture.definitions, multimodal.toolName).deferLoading, true)
    assert.equal(byName(capture.definitions, language.toolName).deferLoading, undefined)
  })

  it('changes no schema or description, only the deferLoading marker', () => {
    const contract = contractFor('multimodal_embed')
    const tongue = loadCatalog().find(entry => entry.id === 'tongue')
    assert.ok(tongue !== undefined)
    const eager = captureCtx()
    const deferred = captureCtx()
    registerContractTool(eager.ctx, { contract, implementation: tongue, adapter: fakeAdapter('x'), route: 'extension', alternatives: [] }, fakeHost())
    registerContractTool(deferred.ctx, { contract, implementation: tongue, adapter: fakeAdapter('x'), route: 'extension', alternatives: [] }, fakeHost(), { deferHeavySchemas: true })
    const eagerDefinition = byName(eager.definitions, contract.toolName)
    const deferredDefinition = byName(deferred.definitions, contract.toolName)
    assert.equal(deferredDefinition.name, eagerDefinition.name)
    assert.equal(deferredDefinition.description, eagerDefinition.description)
    assert.deepEqual(deferredDefinition.parameters, eagerDefinition.parameters)
  })
})

describe('the measured schema-byte delta', () => {
  it('is the exact serialized payload of the selected declarations', () => {
    const heavy = { name: 'heavy_tool', description: 'A heavy declaration.', parameters: { type: 'object' as const, properties: { blob: { type: 'string' as const, description: 'x'.repeat(2000) } } } }
    const small = { name: 'small_tool', description: 'A small declaration.', parameters: { type: 'object' as const, properties: { ok: { type: 'boolean' as const } } } }
    const heavyBytes = toolSchemaBytes(heavy)
    const smallBytes = toolSchemaBytes(small)
    const eagerBytes = heavyBytes + smallBytes
    const deferred = shouldDeferHeavySchema({ toolName: heavy.name, schemaBytes: heavyBytes, enabled: true, explicitIds: [heavy.name] })
    assert.equal(deferred, true)
    const eagerRemainder = eagerBytes - (deferred ? heavyBytes : 0)
    assert.equal(eagerRemainder, smallBytes)
    assert.ok(heavyBytes > 2000)
    assert.equal(eagerBytes - eagerRemainder, heavyBytes, 'the delta is the selected declaration payload')
  })
})

describe('config.default deferHeavySchemas', () => {
  it('defaults off', () => {
    const parsed = Config({})
    assert.equal(parsed.deferHeavySchemas, false)
  })
})
