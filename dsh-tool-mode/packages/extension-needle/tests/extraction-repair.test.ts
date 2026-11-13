/**
 * `extract_with_repair`: ONE retry, never a loop (DECL-02, DECL-03, MOD-19, MOD-20).
 *
 * Three properties are measured here rather than asserted by prose:
 *
 * 1. **At most two engine calls.** The fake `extract` counts its invocations, so a
 *    hidden third call (a retry loop, a re-read) fails the test instead of costing a
 *    caller an extra second of inference in production.
 * 2. **The repair feedback is the validator's own findings.** The second call receives
 *    the FIRST attempt's issues, unchanged, and the instruction is preserved.
 * 3. **A failure is an error.** An engine error thrown by the callback propagates; it is
 *    never converted into `{ extraction: null }`, because an empty record is
 *    indistinguishable from "nothing matched".
 *
 * The provider tests at the end assert the ordering that matters when nothing is
 * prepared: argument and schema refusals happen BEFORE artifact resolution, and the
 * engine branch then refuses honestly rather than returning an empty result.
 *
 * Requirement links: DECL-02, DECL-03, MOD-19, MOD-20.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import {
  type ExtensionContextV1,
  type InvocationContextV1,
  type JsonObject,
  type ModelProviderV1,
} from '@try-works/tool-mode-extension-sdk'

import extension from '../src/index.ts'
import type { EngineEnvelope } from '../src/engine.ts'
import { checkArguments, extractionTool, prepareExtractionSchema } from '../src/validation.ts'
import {
  extractWithRepair,
  readAttempt,
  withRepairFeedback,
  type ExtractionAttempt,
} from '../src/extraction.ts'

/** A schema a caller might reasonably write for an invoice. */
const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    invoice_number: { type: 'string' },
    total_amount: { type: 'number' },
    currency: { type: 'string', enum: ['USD', 'EUR', 'GBP', 'CNY'] },
  },
  required: ['invoice_number', 'total_amount', 'currency'],
}

/** The extraction function the schema is offered under. */
const TOOL = extractionTool(prepareExtractionSchema(INVOICE_SCHEMA), 'record the invoice')

/** One decoded engine envelope, with only the fields that matter set. */
function envelope(overrides: Partial<EngineEnvelope> = {}): EngineEnvelope {
  return {
    type: 'call',
    success: true,
    error: null,
    errorCode: null,
    reason: null,
    functionCalls: [],
    suppressedCalls: [],
    reasoning: 'because',
    confidence: 0.5,
    validation: null,
    raw: {},
    ...overrides,
  }
}

/** One attempt value, built without an engine. */
function attempt(overrides: Partial<ExtractionAttempt> = {}): ExtractionAttempt {
  return {
    extraction: { invoice_number: 'AC-4471', total_amount: 418.75, currency: 'EUR' },
    proposed: true,
    valid: true,
    issues: [],
    reasoning: 'fake',
    confidence: 0.5,
    grounding: undefined,
    ...overrides,
  }
}

/** A host-issued context with nothing but what EXT-18 allows. */
function context(): ExtensionContextV1 {
  return {
    extensionId: '@try-works/extension-needle',
    extensionVersion: '0.1.3',
    activationGeneration: 1,
    storage: { directory: '', async read() { return undefined }, async write() { /* no-op */ } },
    logger: { log: () => { /* silent */ } },
    signal: new AbortController().signal,
    configuration: {},
  }
}

/** A call-scoped context that records the paths it was asked to authorize. */
function invocation(): InvocationContextV1 & { resolved: string[] } {
  const resolved: string[] = []
  return {
    resolved,
    invocationId: 'repair-test',
    signal: new AbortController().signal,
    limits: { maxInputBytes: 1024 * 1024, maxAudioSeconds: 60, maxResultBytes: 1024 * 1024 },
    resolvePath(candidate) {
      resolved.push(candidate)
      return candidate
    },
  }
}

/** A provider whose resolution environment is fixed EMPTY, so the unprepared path runs everywhere. */
async function provider(): Promise<ModelProviderV1> {
  const configuration: JsonObject = { resolutionEnv: {} }
  const instance = await extension.create({ ...context(), configuration })
  return instance.createProvider({ modelId: 'needle3', configuration })
}

describe('readAttempt — one projection, shared with structured_extract', () => {
  it('reports "nothing matched" as data, with no invented issue', () => {
    const read = readAttempt(envelope(), TOOL)
    assert.equal(read.extraction, null)
    assert.equal(read.proposed, false)
    assert.equal(read.valid, false)
    assert.deepEqual(read.issues, [])
    assert.equal(read.reasoning, 'because')
  })

  it('reports the validator\'s own issues for a returned call', () => {
    const args = { invoice_number: 'AC-4471', total_amount: 'not a number', currency: 'JPY' }
    const read = readAttempt(envelope({ functionCalls: [{ name: 'record_extraction', arguments: args }] }), TOOL)
    assert.equal(read.proposed, true)
    assert.equal(read.extraction, args)
    assert.equal(read.valid, false)
    assert.deepEqual(read.issues, checkArguments(TOOL, args).issues)
  })

  it('carries the engine\'s grounding report through unchanged', () => {
    const grounding = { ungrounded: ['AC-0000'], negation: true }
    const read = readAttempt(envelope({ validation: grounding }), TOOL)
    assert.deepEqual(read.grounding, grounding)
  })
})

describe('extractWithRepair — one initial attempt, at most one repair', () => {
  it('stops after ONE call when the first attempt is admissible', async () => {
    const feedbacks: (readonly string[] | undefined)[] = []
    const result = await extractWithRepair(async feedback => {
      feedbacks.push(feedback)
      return attempt()
    })
    assert.equal(feedbacks.length, 1)
    assert.equal(feedbacks[0], undefined)
    assert.equal(result.valid, true)
    assert.equal(result.repaired, false)
    assert.deepEqual(result.issues, [])
    assert.deepEqual(result.attempts, [{ valid: true, issues: [] }])
  })

  it('repairs once, with the FIRST attempt\'s issues as the feedback', async () => {
    const issues = ['(root).currency must be equal to one of the allowed values']
    const feedbacks: (readonly string[] | undefined)[] = []
    const result = await extractWithRepair(async feedback => {
      feedbacks.push(feedback)
      if (feedback === undefined) return attempt({ valid: false, issues })
      return attempt({ extraction: { invoice_number: 'AC-4471', total_amount: 1, currency: 'USD' } })
    })
    assert.equal(feedbacks.length, 2)
    assert.equal(feedbacks[0], undefined)
    assert.deepEqual(feedbacks[1], issues)
    assert.equal(result.valid, true)
    assert.equal(result.repaired, true)
    assert.deepEqual(result.attempts, [{ valid: false, issues }, { valid: true, issues: [] }])
    assert.ok(result.extraction !== null)
    assert.equal(result.extraction.currency, 'USD')
  })

  it('never makes a THIRD call when the repair is also rejected', async () => {
    let calls = 0
    const result = await extractWithRepair(async () => {
      calls += 1
      return attempt({ valid: false, issues: [`issue ${calls}`] })
    })
    assert.equal(calls, 2, 'the bound is two engine calls, not a loop')
    assert.equal(result.valid, false)
    assert.equal(result.repaired, true)
    // The LAST attempt's finding is what a caller must see; the first is in `attempts`.
    assert.deepEqual(result.issues, ['issue 2'])
    assert.deepEqual(result.attempts, [
      { valid: false, issues: ['issue 1'] },
      { valid: false, issues: ['issue 2'] },
    ])
  })

  it('does NOT repair a "nothing matched" answer, because there is no feedback to give', async () => {
    let calls = 0
    const result = await extractWithRepair(async () => {
      calls += 1
      return attempt({ extraction: null, proposed: false, valid: false, issues: [] })
    })
    // A second, identical call would be a coin flip dressed up as a repair.
    assert.equal(calls, 1)
    assert.equal(result.valid, false)
    assert.equal(result.repaired, false)
    assert.equal(result.extraction, null)
    assert.deepEqual(result.attempts, [{ valid: false, issues: [] }])
  })

  it('never reports valid while an issue is unresolved, even from an inconsistent callback', async () => {
    // The validator cannot produce this pair, but an injected callback can. The verdict must
    // not take `valid: true` on faith.
    const result = await extractWithRepair(async () => attempt({ valid: true, issues: ['still wrong'] }))
    assert.equal(result.valid, false)
    assert.equal(result.attempts.length, 2)
  })

  it('never reports valid without an extraction', async () => {
    const result = await extractWithRepair(async () => attempt({ extraction: null, proposed: false }))
    assert.equal(result.valid, false)
    assert.equal(result.extraction, null)
  })

  it('SURFACES an engine failure instead of returning an empty record', async () => {
    let calls = 0
    await assert.rejects(
      extractWithRepair(async () => {
        calls += 1
        throw new Error('the engine exited with code 1: cannot load needle3.cact')
      }),
      /cannot load needle3\.cact/,
    )
    assert.equal(calls, 1, 'a failure must not be retried as if it were a validation verdict')
  })

  it('surfaces a failure of the REPAIR call too, and reports the attempt count', async () => {
    let calls = 0
    await assert.rejects(
      extractWithRepair(async () => {
        calls += 1
        if (calls === 2) throw new Error('the engine exceeded its 120000 ms budget')
        return attempt({ valid: false, issues: ['(root).currency is invalid'] })
      }),
      /exceeded its 120000 ms budget/,
    )
    assert.equal(calls, 2)
  })
})

describe('withRepairFeedback — the findings are quoted, and bounded', () => {
  it('keeps the caller\'s instruction and appends the validator\'s findings', () => {
    const feedback = withRepairFeedback('record the invoice', ['(root).currency is invalid', '(root).x is required'])
    assert.ok(feedback.startsWith('record the invoice'))
    assert.match(feedback, /REPAIR/)
    assert.match(feedback, /\(root\)\.currency is invalid/)
    assert.match(feedback, /\(root\)\.x is required/)
  })

  it('returns the instruction unchanged when there is nothing to report', () => {
    assert.equal(withRepairFeedback('record the invoice', []), 'record the invoice')
  })

  it('bounds the quoted findings, so a pathological report cannot grow without limit', () => {
    const issues = Array.from({ length: 100 }, (_value, index) => `(root).field_${index} is invalid ${'x'.repeat(1_000)}`)
    const feedback = withRepairFeedback('record', issues)
    const appended = feedback.slice('record'.length)
    // 12 quoted lines at 200 characters plus the notice and the header/footer.
    assert.ok(appended.length < 1_500, `feedback appended ${appended.length} characters`)
    assert.match(appended, /further issue\(s\) omitted for length/)
    // No quoted line can carry the whole 1000-character issue.
    assert.equal(feedback.includes('x'.repeat(300)), false)
  })
})

describe('extract_with_repair — the provider refuses in the right order', () => {
  it('refuses a schema keyword the grammar cannot express BEFORE touching artifacts', async () => {
    await assert.rejects(
      (await provider()).invoke({
        implementationId: 'needle3-native-extract-with-repair',
        input: {
          text: 'Invoice AC-4471 for 418.75 EUR.',
          instruction: 'record the invoice',
          schema: { type: 'object', properties: { a: { type: 'string', pattern: '^AC-' } } },
        },
        context: invocation(),
      }),
      /"pattern" is not part of the engine's grammar/,
    )
  })

  it('refuses a malformed call through the shipped input schema', async () => {
    const created = await provider()
    const schema = INVOICE_SCHEMA
    // Both sources, and neither source, are refused by the `oneOf`.
    await assert.rejects(
      created.invoke({
        implementationId: 'needle3-native-extract-with-repair',
        input: { text: 'x', path: 'x.txt', instruction: 'y', schema },
        context: invocation(),
      }),
      /extract-with-repair\.input\.json/,
    )
    await assert.rejects(
      created.invoke({
        implementationId: 'needle3-native-extract-with-repair',
        input: { instruction: 'y', schema },
        context: invocation(),
      }),
      /extract-with-repair\.input\.json/,
    )
    await assert.rejects(
      created.invoke({
        implementationId: 'needle3-native-extract-with-repair',
        input: { text: 'x', instruction: 'y', schema, execute: true },
        context: invocation(),
      }),
      /extract-with-repair\.input\.json/,
    )
  })

  it('refuses honestly on an unprepared deployment rather than returning an empty record', async () => {
    await assert.rejects(
      (await provider()).invoke({
        implementationId: 'needle3-native-extract-with-repair',
        input: { text: 'Invoice AC-4471 for 418.75 EUR.', instruction: 'record the invoice', schema: INVOICE_SCHEMA },
        context: invocation(),
      }),
      /not prepared on this machine, so no inference was run/,
    )
  })

  it('validates the result shape against the SHIPPED output schema', () => {
    const schema: unknown = JSON.parse(
      readFileSync(new URL('../schema/extract-with-repair.output.json', import.meta.url), 'utf8'),
    )
    assert.ok(typeof schema === 'object' && schema !== null, 'the output schema must be a JSON object')
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
    const meta = {
      contract: '@try-works/extension-needle/extract_with_repair',
      contractVersion: '1.0.0',
      implementationId: 'needle3-native-extract-with-repair',
      extension: '@try-works/extension-needle',
      extensionVersion: '0.1.3',
      activationGeneration: 1,
      executionLocation: 'device',
      receiptId: 'test-receipt',
      warnings: [],
    }
    const repaired = {
      extraction: { invoice_number: 'AC-4471' },
      valid: true,
      issues: [],
      repaired: true,
      attempts: [{ valid: false, issues: ['(root).currency is invalid'] }, { valid: true, issues: [] }],
      meta,
    }
    assert.equal(validate(repaired), true, JSON.stringify(validate.errors))
    // Reportable outcomes still validate.
    const nothingMatched = {
      extraction: null,
      valid: false,
      issues: [],
      repaired: false,
      attempts: [{ valid: false, issues: [] }],
      meta,
    }
    assert.equal(validate(nothingMatched), true, JSON.stringify(validate.errors))
    // The field correlations are schema-enforced, not merely documented.
    assert.equal(validate({ ...repaired, issues: ['still wrong'] }), false)
    assert.equal(validate({ ...repaired, extraction: null }), false)
    assert.equal(validate({ ...repaired, repaired: false }), false)
    assert.equal(validate({ ...nothingMatched, repaired: true }), false)
  })
})
