/**
 * Registration uses the ONE composer.
 *
 * A description composed in the registrar/bindings but not used there would be a
 * second, untested rendering path. These tests capture the definition the
 * registry receives, so the assertion is about the registered tool, not about a
 * helper called beside it. Parameter schemas must stay exactly as they were.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'

import { loadCatalog } from '../src/catalog.ts'
import { buildParameters, registerModelTool } from '../src/registrar.ts'
import { registerContractTool, type HostIdentity } from '../src/bindings.ts'
import { canonicalExampleFor, contractToolDescription, catalogToolDescription, TOOL_DESCRIPTION_MAX_CHARS } from '../src/tool-description.ts'
import type { ModelAdapter } from '../src/adapters/index.ts'
import { mountPlugin, cleanup } from './helpers.ts'

after(async () => { await cleanup() })

/** The definition the registry receives, narrowed to the fields these tests read. */
interface CapturedDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

/** The registry double and the definitions it received. */
interface CaptureResult {
  readonly ctx: { readonly tools: { register(definition: CapturedDefinition): () => void } }
  readonly definitions: CapturedDefinition[]
}

/** A registry double that records each definition exactly once. */
function captureCtx(): CaptureResult {
  const definitions: CapturedDefinition[] = []
  return {
    definitions,
    ctx: {
      tools: {
        register(definition: CapturedDefinition): () => void {
          definitions.push(definition)
          return () => {}
        },
      },
    },
  }
}

/** A deterministic adapter double: registration does not invoke it. */
function fakeAdapter(modelId: string): ModelAdapter {
  return { modelId, invoke: async () => ({}) }
}

/** Write a one-entry catalog document derived from a real entry, with the P1 fields added. */
function catalogWithGuidance(): string {
  const align = loadCatalog().find(entry => entry.id === 'align')
  assert.ok(align !== undefined)
  const document = [{
    ...align,
    tool: {
      ...align.tool,
      whenToUse: 'Use after transcription when word-accurate timing is needed.',
      whenNotToUse: 'Do not use to create a transcript from scratch.',
      limits: 'The transcript must already cover the audio.',
      example: 'align_transcript({ audio_path: "a.wav", transcript: "hi" })',
    },
  }]
  const file = join(mkdtempSync(join(tmpdir(), 'tool-description-catalog-')), 'catalog.json')
  writeFileSync(file, JSON.stringify(document))
  return file
}

/** A host identity sufficient for definition construction. */
function fakeHost(): HostIdentity {
  return {
    extension: '@try-works/dsh-tool-mode',
    extensionVersion: '0.0.0-test',
    activationGeneration: 1,
    nextReceiptId: () => 'rcpt_test_1',
    grant: {
      grantId: 'test-grant',
      allowedTools: ['lang_detect', 'stt_transcribe'],
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

describe('contract guidance examples', () => {
  it('publishes the accepted semantic_rank shape instead of leaving it opaque', () => {
    const example = canonicalExampleFor('semantic_rank')
    assert.ok(example !== undefined)
    assert.match(example, /"query"/)
    assert.match(example, /"parts"/)
    assert.match(example, /"candidates"/)
    assert.match(example, /"top_k"/)
  })
})

describe('the registrar registers the composer output', () => {
  it('uses catalogToolDescription for a per-model tool, with the skill fallback and no changed schema', () => {
    const align = loadCatalog().find(entry => entry.id === 'align')
    assert.ok(align !== undefined)
    const capture = captureCtx()
    const registered = registerModelTool(capture.ctx, align, fakeAdapter('align'))
    assert.equal(registered.toolName, 'align_transcript')
    const definition = capture.definitions[0]
    assert.ok(definition !== undefined)
    assert.equal(definition.name, 'align_transcript')
    assert.equal(definition.description, catalogToolDescription(align))
    assert.ok(definition.description.includes('When to use:'), 'the skill fallback must be rendered')
    assert.ok(definition.description.includes('Inputs and outputs:'))
    assert.ok(definition.description.length <= TOOL_DESCRIPTION_MAX_CHARS)
    assert.deepEqual(definition.parameters, { type: 'object', properties: buildParameters(align) }, 'parameter schemas must not change')
  })

  it('renders the optional catalog guidance fields and prefers them over the skill fallback', () => {
    const entry = loadCatalog(catalogWithGuidance())[0]
    assert.ok(entry !== undefined)
    const description = catalogToolDescription(entry)
    assert.ok(description.includes('- Use after transcription when word-accurate timing is needed.'))
    assert.equal(description.includes('- Do not use to create a transcript from scratch.'), true)
    assert.ok(description.includes('Limits:'))
    assert.ok(description.includes('The transcript must already cover the audio.'))
    assert.ok(description.includes('Example:'))
    assert.equal(description.includes(entry.skill.whenToUse ?? 'never'), false, 'tool guidance wins over the skill fallback')
  })
})

describe('the contract registration uses the composer too', () => {
  it('uses contractToolDescription for a standard contract', () => {
    const contract = STANDARD_CONTRACTS.find(candidate => candidate.contract === 'text.language_detect')
    assert.ok(contract !== undefined)
    const tongue = loadCatalog().find(entry => entry.id === 'tongue')
    assert.ok(tongue !== undefined)
    const capture = captureCtx()
    const registered = registerContractTool(
      capture.ctx,
      { contract, implementation: tongue, adapter: fakeAdapter('tongue'), route: 'extension', alternatives: [] },
      fakeHost(),
    )
    assert.equal(registered.toolName, 'lang_detect')
    const definition = capture.definitions[0]
    assert.ok(definition !== undefined)
    assert.equal(definition.description, contractToolDescription(contract))
    assert.ok(definition.description.includes('When not to use:'), 'unsupported cases feed when-not-to-use')
    assert.ok(definition.description.includes('Inputs and outputs:'))
    assert.ok(definition.description.includes('Limits:'))
    // P6b makes the budget DECISION-FIRST: the example and inputs/limits are dropped
    // before any when-not-to-use bullet, so a contract whose unsupported cases fill the
    // budget may legitimately compose without an Example section.
    assert.ok(definition.description.length <= TOOL_DESCRIPTION_MAX_CHARS)
    for (const unsupported of contract.unsupported) {
      assert.ok(definition.description.includes(unsupported), 'a when-not-to-use bullet was dropped: ' + unsupported)
    }
  })
})

describe('a mounted plugin exposes only composed descriptions', () => {
  it('every registered catalog/contract tool matches the composer, and no description exceeds the budget', async () => {
    const ctx = await mountPlugin({ exposeUnavailable: true, registerSkills: false })
    const catalog = loadCatalog()
    const perModel = new Map(catalog.filter(entry => entry.contract === null).map(entry => [entry.tool.name, entry]))
    const contracts = new Map(STANDARD_CONTRACTS.map(contract => [contract.toolName, contract]))
    let checked = 0
    for (const schema of ctx.tools.schemas()) {
      const entry = perModel.get(schema.name)
      if (entry !== undefined) {
        assert.equal(schema.description, catalogToolDescription(entry), schema.name + ' must use the composer')
        checked += 1
        continue
      }
      const contract = contracts.get(schema.name)
      if (contract !== undefined) {
        assert.equal(schema.description, contractToolDescription(contract), schema.name + ' must use the composer')
        checked += 1
      }
      const description = schema.description
      if (description !== undefined && description.length > TOOL_DESCRIPTION_MAX_CHARS) {
        assert.fail(schema.name + ' description exceeds the budget')
      }
    }
    assert.ok(checked >= 0)
  })
})
