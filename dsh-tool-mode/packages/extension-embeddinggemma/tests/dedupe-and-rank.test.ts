/**
 * `dedupe_and_rank` tests (MOD-10, MOD-12; TOOL-05, DECL-02, DECL-03).
 *
 * Two kinds of evidence, and neither is model evidence.
 *
 * The PURE tests exercise the composition of the two reviewed operations the tool exposes in one
 * pass: greedy representative clustering ({@link deduplicateGroups}) followed by representative
 * ranking ({@link rankBySimilarity}). The fixtures are 2-dimensional unit vectors at exact angles
 * (or exact integer vectors), so every expected score is derivable rather than recorded, and the
 * tie-break is exercised with a fixture that produces a BIT-IDENTICAL cosine.
 *
 * The PROVIDER tests run the argument validators with no weights loaded: a valid call must fail
 * for the honest unprepared reason (the same text-backbone preparation every other tool needs),
 * while an argument outside the contract must fail for its OWN reason BEFORE any model work.
 * `top_k` above the representative count is refused rather than clamped, and the schemas are
 * compiled and exercised as closed documents.
 *
 * Passing here says nothing about the model's retrieval quality: MOD-16 (pinned golden fixtures)
 * and MOD-17 (real cross-modal retrieval) still require the qualified artifact.
 *
 * Requirement links: MOD-10, MOD-12, MOD-04, MOD-05, TOOL-05, DECL-02, DECL-03.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { Ajv2020 } from 'ajv/dist/2020.js'
import type { AnySchema } from 'ajv'
import {
  activateExtension,
  type ExtensionContextV1,
  type InvocationContextV1,
  type JsonObject,
  type ModelProviderV1,
} from '@try-works/tool-mode-extension-sdk'

import extension from '../src/index.ts'
import { CALL_LIMITS } from '../src/contracts.ts'
import { cosineSimilarity, dedupeAndRank, type IdentifiedVector } from '../src/vectors.ts'

/** This package's directory, resolved from this file rather than from a node_modules link. */
const PACKAGE_DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** A 2-dimensional unit vector at an angle in degrees; its cosines with others are exact. */
function unit2(degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180
  return [Math.cos(radians), Math.sin(radians)]
}

/** The cosine between two unit vectors at the given angles, computed independently of the module. */
function expectedCosine(leftDegrees: number, rightDegrees: number): number {
  return Math.cos(((leftDegrees - rightDegrees) * Math.PI) / 180)
}

/** A host-issued context (the same shape the other package tests use). */
function context(): ExtensionContextV1 {
  return {
    extensionId: '@try-works/extension-embeddinggemma',
    extensionVersion: '0.1.2',
    activationGeneration: 1,
    storage: { directory: '', async read() { return undefined }, async write() { /* no-op */ } },
    logger: { log: () => { /* silent */ } },
    signal: new AbortController().signal,
    configuration: {},
  }
}

/** The call-scoped invocation context. */
function invocation(): InvocationContextV1 {
  return {
    invocationId: 'dedupe-and-rank-test',
    signal: new AbortController().signal,
    limits: { maxInputBytes: 8 * 1024 * 1024, maxAudioSeconds: 300, maxResultBytes: 4 * 1024 * 1024 },
    resolvePath: (candidate: string) => candidate,
  }
}

/** Create the provider under test. It is a handle: creating it loads nothing. */
async function provider(): Promise<ModelProviderV1> {
  const instance = await activateExtension(extension, context())
  return instance.createProvider({ modelId: 'embeddinggemma-2', configuration: {} })
}

/** Invoke one implementation and return the rejection for inspection. */
async function refusal(implementationId: string, input: JsonObject): Promise<Error> {
  const instance = await provider()
  try {
    await instance.invoke({ implementationId, input, context: invocation() })
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  throw new Error(`${implementationId} resolved, but an unprepared provider must refuse`)
}

/** The narrowest valid text item for the shared multimodal vocabulary. */
const TEXT_ITEM: JsonObject = { id: 'item-1', parts: [{ kind: 'text', text: 'a short passage' }] }

/** Compile one shipped schema with the 2020-12 dialect it declares. */
function validator(file: string) {
  const schema: AnySchema = JSON.parse(readFileSync(join(PACKAGE_DIR, 'schema', file), 'utf8'))
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema)
}

describe('MOD-10 + MOD-12 — the pure composition groups, then ranks the representatives', () => {
  it('groups near-duplicates in input order and ranks only the representatives', () => {
    // 0° and 20° are near-duplicates at 0.9 (cos 20° ≈ 0.94); 60° and 90° are each their own
    // representative (cos 60° = 0.5 and cos 90° = 0 against the first representative).
    const items: IdentifiedVector[] = [
      { id: 'a', vector: unit2(0) },
      { id: 'b', vector: unit2(20) },
      { id: 'c', vector: unit2(60) },
      { id: 'd', vector: unit2(90) },
    ]
    const query = unit2(10)
    const combined = dedupeAndRank(items, query, 0.9)
    assert.deepEqual(combined.groups.map(group => group.representativeId), ['a', 'c', 'd'])
    assert.deepEqual(combined.groups[0]?.members.map(member => member.id), ['a', 'b'])
    // Ranking is over the representatives, not over every item: b is represented by a.
    assert.deepEqual(combined.ranking.map(entry => entry.id), ['a', 'c', 'd'])
    assert.ok(Math.abs((combined.ranking[0]?.score ?? 0) - expectedCosine(10, 0)) < 1e-12)
    assert.ok(Math.abs((combined.ranking[1]?.score ?? 0) - expectedCosine(10, 60)) < 1e-12)
    // The representative's own member score is exactly 1, as semantic_deduplicate reports it.
    assert.deepEqual(combined.groups[0]?.members[0], { id: 'a', score: 1 })
  })

  it('defaults top_k to every representative and honours a smaller top_k', () => {
    const items: IdentifiedVector[] = [
      { id: 'a', vector: unit2(0) },
      { id: 'b', vector: unit2(20) },
      { id: 'c', vector: unit2(60) },
      { id: 'd', vector: unit2(90) },
    ]
    const query = unit2(10)
    assert.equal(dedupeAndRank(items, query, 0.9).ranking.length, 3)
    assert.deepEqual(dedupeAndRank(items, query, 0.9, 2).ranking.map(entry => entry.id), ['a', 'c'])
    assert.deepEqual(dedupeAndRank(items, query, 0.9, 1).ranking.map(entry => entry.id), ['a'])
  })

  it('breaks an exact representative score tie by INPUT order, not by id', () => {
    // [1, 1] and [1, -1] both score EXACTLY 0.5 against [1, 0] (same denominator, same
    // numerator), so this fixture exercises the tie-break rather than a near-tie.
    const query = [1, 0]
    assert.equal(cosineSimilarity(query, [1, 1]), cosineSimilarity(query, [1, -1]))
    const ordered: IdentifiedVector[] = [
      { id: 'first', vector: [1, 1] },
      { id: 'second', vector: [1, -1] },
    ]
    // cos([1,1], [1,-1]) = 0, so at 0.5 the two remain separate representatives.
    assert.deepEqual(dedupeAndRank(ordered, query, 0.5).ranking.map(entry => entry.id), ['first', 'second'])
    const reordered: IdentifiedVector[] = [
      { id: 'second', vector: [1, -1] },
      { id: 'first', vector: [1, 1] },
    ]
    assert.deepEqual(dedupeAndRank(reordered, query, 0.5).ranking.map(entry => entry.id), ['second', 'first'])
  })

  it('is deterministic across repeated calls and does not reorder the caller input', () => {
    const items: IdentifiedVector[] = [
      { id: 'a', vector: unit2(0) },
      { id: 'b', vector: unit2(20) },
      { id: 'c', vector: unit2(60) },
      { id: 'd', vector: unit2(90) },
    ]
    const query = unit2(10)
    const first = dedupeAndRank(items, query, 0.9)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.deepEqual(dedupeAndRank(items, query, 0.9), first)
    }
    assert.deepEqual(items.map(item => item.id), ['a', 'b', 'c', 'd'])
  })

  it('does not merge a chain merely because A is near B and B is near C', () => {
    const items: IdentifiedVector[] = [
      { id: 'a', vector: unit2(0) },
      { id: 'b', vector: unit2(30) },
      { id: 'c', vector: unit2(60) },
    ]
    // c is compared with the representative a: cos 60° = 0.5 < 0.8, so c is its own group even
    // though cos(b, c) = cos 30° would have qualified. The combined tool inherits that rule.
    const combined = dedupeAndRank(items, unit2(0), 0.8)
    assert.deepEqual(combined.groups.map(group => group.representativeId), ['a', 'c'])
    assert.equal(combined.ranking.some(entry => entry.id === 'b'), false)
  })

  it('refuses top_k above the representative count instead of clamping', () => {
    // Two items are ONE group at 0.9, so one representative exists and top_k 2 cannot be met.
    const items: IdentifiedVector[] = [
      { id: 'a', vector: unit2(0) },
      { id: 'b', vector: unit2(10) },
    ]
    assert.throws(
      () => dedupeAndRank(items, unit2(0), 0.9, 2),
      /topK 2 exceeds the 1 group representative\(s\) produced at threshold 0.9/,
    )
    // The boundary itself is legal: one representative and top_k 1.
    assert.equal(dedupeAndRank(items, unit2(0), 0.9, 1).ranking.length, 1)
  })

  it('refuses a threshold outside the open interval (-1, 1), an empty item list and a bad top_k', () => {
    const items: IdentifiedVector[] = [{ id: 'a', vector: [1, 0] }]
    for (const threshold of [1, -1, 1.5, -1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => dedupeAndRank(items, [1, 0], threshold), /outside the open interval \(-1, 1\)/)
    }
    assert.throws(() => dedupeAndRank([], [1, 0], 0.5), /items must be a non-empty array/)
    for (const topK of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => dedupeAndRank(items, [1, 0], 0.5, topK), /topK must be a positive integer/)
    }
  })

  it('propagates the reviewed refusals: duplicate ids, width mismatches and a zero query', () => {
    const duplicate: IdentifiedVector[] = [
      { id: 'same', vector: [1, 0] },
      { id: 'same', vector: [0, 1] },
    ]
    assert.throws(() => dedupeAndRank(duplicate, [1, 0], 0.5), /duplicate item id "same"/)
    const mismatched: IdentifiedVector[] = [
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [1, 0, 0] },
    ]
    assert.throws(() => dedupeAndRank(mismatched, [1, 0], 0.5), /item "b" has 3 dimension\(s\) where "a" has 2/)
    // The query is only compared with representatives, so a query width mismatch is refused by
    // the ranking half, naming the representative it could not compare.
    assert.throws(
      () => dedupeAndRank([{ id: 'a', vector: [1, 0] }], [1, 0, 0], 0.5),
      /candidate "a" has 2 dimension\(s\) where the query has 3/,
    )
    assert.throws(() => dedupeAndRank([{ id: 'a', vector: [1, 0] }], [0, 0], 0.5), /zero vector/)
  })
})

describe('DECL-02 / TOOL-05 — the shipped schemas are closed and enforced', () => {
  const validInput = {
    items: [TEXT_ITEM],
    query: TEXT_ITEM,
    threshold: 0.8,
    top_k: 1,
    dimensions: 128,
  }

  it('accepts a well-formed input and rejects every shape the implementation must also refuse', () => {
    const validate = validator('dedupe-and-rank.input.json')
    assert.equal(validate(validInput), true, JSON.stringify(validate.errors))
    // Closed root: an unlisted field is a rejection, not something ignored.
    assert.equal(validate({ ...validInput, extra: 1 }), false)
    // The threshold is the open interval (-1, 1); 1 and -1 are refused at both ends.
    for (const threshold of [1, -1, 1.5, -1.5]) {
      assert.equal(validate({ ...validInput, threshold }), false, `threshold ${threshold}`)
    }
    // The query is required and must be a full item.
    const { query: _omitted, ...withoutQuery } = validInput
    assert.equal(validate(withoutQuery), false)
    assert.equal(validate({ ...validInput, query: { id: 'q', parts: [] } }), false)
    // Items are a non-empty, bounded array, and top_k is a positive integer.
    assert.equal(validate({ ...validInput, items: [] }), false)
    assert.equal(validate({ ...validInput, top_k: 0 }), false)
    assert.equal(validate({ ...validInput, top_k: 1.5 }), false)
    // The width is a documented EmbeddingGemma 2 space, never an arbitrary integer.
    assert.equal(validate({ ...validInput, dimensions: 384 }), false)
  })

  it('accepts the documented payload and rejects a result that omits or widens it', () => {
    // The host OMITS the root `meta` from a provider's payload and stamps it only when the
    // declared output schema REQUIRES it. This contract is payload-only, so `meta` is optional
    // and must not be required (EXT-17).
    const output = {
      groups: [
        { representativeId: 'a', members: [{ id: 'a', score: 1 }, { id: 'b', score: 0.94 }] },
        { representativeId: 'c', members: [{ id: 'c', score: 1 }] },
      ],
      ranking: [{ id: 'a', score: 0.98 }, { id: 'c', score: 0.5 }],
      threshold: 0.9,
      embeddingSpaceId: 'embeddinggemma-2/text/daa72c512439-9fd452bfc691',
      processing: [
        {
          id: 'a',
          modalities: ['text'],
          sourceRanges: [],
          sampledVideoFrames: [],
          observedAudioSampleRates: [],
          truncated: false,
        },
        {
          id: 'item-1',
          modalities: ['text'],
          sourceRanges: [],
          sampledVideoFrames: [],
          observedAudioSampleRates: [],
          truncated: false,
        },
      ],
    }
    const validate = validator('dedupe-and-rank.output.json')
    // DECL-03 / EXT-17: the host stamps this envelope, and the schema REQUIRES it so the
    // call carries a receipt; a payload without it must not validate.
    const withMeta = {
      ...output,
      meta: {
        contract: '@try-works/extension-embeddinggemma/dedupe_and_rank',
        contractVersion: '1.0.0',
        implementationId: 'embeddinggemma2-dedupe-rank',
        extension: '@try-works/extension-embeddinggemma',
        extensionVersion: '0.1.2',
        activationGeneration: 1,
        executionLocation: 'device',
        receiptId: 'rcpt_000001',
        warnings: [],
      },
    }
    assert.equal(validate(withMeta), true, JSON.stringify(validate.errors))
    assert.equal(validate(output), false, 'a result without the stamped envelope must not validate')
    assert.equal(validate({ ...output, extra: 1 }), false)
    const { processing: _omitted, ...withoutProcessing } = output
    assert.equal(validate(withoutProcessing), false)
    // A score is a cosine and stays inside [-1, 1].
    assert.equal(
      validate({ ...output, ranking: [{ id: 'a', score: 2 }] }),
      false,
    )
    assert.equal(
      validate({
        ...output,
        groups: [{ representativeId: 'a', members: [{ id: 'a', score: 1 }, { id: 'b', score: 2 }] }],
      }),
      false,
    )
  })
})

describe('the manifest declares the tool and binds an implementation (EXT-21, EXT-22)', () => {
  it('declares dedupe_and_rank with its extension-scoped contract and both shipped schemas', () => {
    interface ManifestTool {
      readonly name: string
      readonly contractId: string
      readonly inputSchema: string
      readonly outputSchema: string
    }
    interface ManifestImplementation {
      readonly id: string
      readonly contractId: string
    }
    interface Manifest {
      readonly tools: readonly ManifestTool[]
      readonly implementations: readonly ManifestImplementation[]
    }
    const manifest: Manifest = JSON.parse(
      readFileSync(join(PACKAGE_DIR, 'tool-mode.extension.json'), 'utf8'),
    )
    const tool = manifest.tools.find(candidate => candidate.name === 'dedupe_and_rank')
    assert.ok(tool, 'dedupe_and_rank must be declared in the manifest')
    assert.equal(tool.contractId, '@try-works/extension-embeddinggemma/dedupe_and_rank')
    assert.equal(tool.inputSchema, './schema/dedupe-and-rank.input.json')
    assert.equal(tool.outputSchema, './schema/dedupe-and-rank.output.json')
    const implementation = manifest.implementations.find(candidate => candidate.id === 'embeddinggemma2-dedupe-rank')
    assert.ok(implementation, 'the implementation must be bound separately so per-tool toggling works')
    assert.equal(implementation.contractId, tool.contractId)
    // The schemas the manifest names must exist and compile.
    assert.doesNotThrow(() => validator('dedupe-and-rank.input.json'))
    assert.doesNotThrow(() => validator('dedupe-and-rank.output.json'))
  })
})

describe('MOD-10 / MOD-12 — the provider refuses bad arguments before touching the model', () => {
  it('accepts a well-formed call and then refuses for the honest unprepared reason', async () => {
    // The same NOT_PREPARED refusal every other tool raises: the tool rides the SAME prepared
    // text-backbone asset set and cannot run before preparation, so it can never work by another
    // route.
    const error = await refusal('embeddinggemma2-dedupe-rank', {
      items: [TEXT_ITEM],
      query: TEXT_ITEM,
      threshold: 0.8,
    })
    assert.match(error.message, /the EmbeddingGemma 2 deployment is not prepared: load\(\) must be called/)
  })

  it('refuses a threshold outside the open interval (-1, 1)', async () => {
    for (const threshold of [1, -1, 1.5]) {
      const error = await refusal('embeddinggemma2-dedupe-rank', {
        items: [TEXT_ITEM],
        query: TEXT_ITEM,
        threshold,
      })
      assert.match(error.message, /"threshold" must be a finite number in the open interval \(-1, 1\)/)
    }
  })

  it('refuses top_k that the item count cannot satisfy, and a non-positive/non-integer top_k', async () => {
    const above = await refusal('embeddinggemma2-dedupe-rank', {
      items: [TEXT_ITEM],
      query: TEXT_ITEM,
      threshold: 0.8,
      top_k: 5,
    })
    assert.match(above.message, /"top_k" 5 exceeds the 1 item\(s\) supplied/)
    for (const topK of [0, -1, 1.5]) {
      const error = await refusal('embeddinggemma2-dedupe-rank', {
        items: [TEXT_ITEM],
        query: TEXT_ITEM,
        threshold: 0.8,
        top_k: topK,
      })
      assert.match(error.message, /"top_k" must be a positive integer/)
    }
  })

  it('refuses the items-count bound, a missing query, duplicate ids and an undocumented width', async () => {
    const tooMany = await refusal('embeddinggemma2-dedupe-rank', {
      items: Array.from({ length: CALL_LIMITS.maxDedupItems + 1 }, (_unused, index) => ({
        id: `item-${index}`,
        parts: [{ kind: 'text', text: 'x' }],
      })),
      query: TEXT_ITEM,
      threshold: 0.8,
    })
    assert.match(tooMany.message, /over the 256-item limit/)
    const noQuery = await refusal('embeddinggemma2-dedupe-rank', {
      items: [TEXT_ITEM],
      threshold: 0.8,
    })
    assert.match(noQuery.message, /query must be an object/)
    const duplicate = await refusal('embeddinggemma2-dedupe-rank', {
      items: [TEXT_ITEM, TEXT_ITEM],
      query: TEXT_ITEM,
      threshold: 0.8,
    })
    assert.match(duplicate.message, /duplicate item id "item-1"/)
    const badWidth = await refusal('embeddinggemma2-dedupe-rank', {
      items: [TEXT_ITEM],
      query: TEXT_ITEM,
      threshold: 0.8,
      dimensions: 384,
    })
    assert.match(badWidth.message, /"dimensions" must be one of 768, 512, 256, 128/)
  })
})
