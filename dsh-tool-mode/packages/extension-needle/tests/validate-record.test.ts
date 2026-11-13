/**
 * `validate_record`: the pure verdict, and the property that it cannot disagree with an
 * extraction (DECL-02, DECL-03, MOD-20).
 *
 * The decisive test is the EQUIVALENCE one: given the same schema and the same record,
 * `validateRecord` and the extraction path (`prepareExtractionSchema` ->
 * `extractionTool` -> `checkArguments`) must report the same issues, in the same order.
 * If they ever diverge, a record that `structured_extract` returned fails its own report
 * in a different tool, which is worse than either tool being wrong on its own.
 *
 * The second property is structural: the `validate_record` branch must call no resolver,
 * no engine and no file reader. That is asserted against the source text rather than by
 * timing, because a slow machine is not evidence of anything.
 *
 * Requirement links: DECL-02, DECL-03, MOD-20.
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
import {
  checkArguments,
  extractionTool,
  prepareExtractionSchema,
  SchemaRefusal,
  validateRecord,
} from '../src/validation.ts'

/** A schema a caller might reasonably write for an invoice. */
const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    invoice_number: { type: 'string' },
    total_amount: { type: 'number' },
    currency: { type: 'string', enum: ['USD', 'EUR', 'GBP', 'CNY'] },
    due_date: { type: ['string', 'null'] },
    line_items: { type: 'array', items: { type: 'string' } },
  },
  required: ['invoice_number', 'total_amount', 'currency', 'due_date', 'line_items'],
}

/** One record that satisfies {@link INVOICE_SCHEMA}. */
const VALID_RECORD = {
  invoice_number: 'AC-4471',
  total_amount: 418.75,
  currency: 'EUR',
  due_date: '2026-04-01',
  line_items: ['3x aluminium bracket', '1x shipping'],
}

/**
 * The issues the EXTRACTION path reports for a record.
 *
 * Deliberately spelled out as the three calls the extraction branch makes, so the
 * equivalence test compares against the real path rather than against a second copy of
 * `validateRecord`.
 * @param schema - the caller's schema.
 * @param record - the record to check.
 * @returns the path-qualified issues.
 */
function extractionPathIssues(schema: unknown, record: Record<string, unknown>): readonly string[] {
  const prepared = prepareExtractionSchema(schema)
  const tool = extractionTool(prepared, 'record the invoice')
  return checkArguments(tool, record).issues
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

/** A call-scoped context. */
function invocation(): InvocationContextV1 {
  return {
    invocationId: 'validate-record-test',
    signal: new AbortController().signal,
    limits: { maxInputBytes: 1024 * 1024, maxAudioSeconds: 60, maxResultBytes: 1024 * 1024 },
    resolvePath(candidate) {
      // A validation call must never authorize a path. Returning it unchanged makes any
      // accidental read visible as a failure in the caller, not a success here.
      return candidate
    },
  }
}

/**
 * A provider whose resolution environment is FIXED EMPTY.
 *
 * `validate_record` must work on a machine with nothing prepared, and fixing the
 * environment empty means that is what this test observes on every machine — including
 * one where the pinned artifacts happen to be resolvable.
 */
async function provider(): Promise<ModelProviderV1> {
  const configuration: JsonObject = { resolutionEnv: {} }
  const instance = await extension.create({ ...context(), configuration })
  return instance.createProvider({ modelId: 'needle3', configuration })
}

describe('validateRecord — the verdict is the extraction path\'s verdict', () => {
  it('accepts a record that satisfies the schema, and returns it as plain JSON', () => {
    const verdict = validateRecord(INVOICE_SCHEMA, VALID_RECORD)
    assert.equal(verdict.valid, true)
    assert.deepEqual(verdict.issues, [])
    assert.deepEqual(verdict.record, VALID_RECORD)
    // A COPY, not the caller's object: a later mutation must not change a published verdict.
    assert.notEqual(verdict.record, VALID_RECORD)
    const mutable = { ...VALID_RECORD }
    const again = validateRecord(INVOICE_SCHEMA, mutable)
    mutable.invoice_number = 'CHANGED'
    assert.ok(again.record !== undefined)
    assert.equal(again.record.invoice_number, 'AC-4471')
  })

  it('reports the SAME issues the extraction path reports, in the same order', () => {
    const records: Record<string, unknown>[] = [
      { ...VALID_RECORD, currency: 'JPY' },
      { ...VALID_RECORD, total_amount: '418.75' },
      { ...VALID_RECORD, extra: true },
      { invoice_number: 'AC-4471' },
      { ...VALID_RECORD, line_items: [1, 2] },
    ]
    for (const record of records) {
      const verdict = validateRecord(INVOICE_SCHEMA, record)
      assert.equal(verdict.valid, false, JSON.stringify(record))
      // The property this tool exists for: one implementation of the check, so the
      // extractor's report and the validator's report cannot drift.
      assert.deepEqual(verdict.issues, extractionPathIssues(INVOICE_SCHEMA, record))
      assert.deepEqual(verdict.record, undefined)
    }
  })

  it('reports EVERY violation rather than the first', () => {
    const verdict = validateRecord(INVOICE_SCHEMA, { currency: 'JPY', total_amount: 'no' })
    assert.equal(verdict.valid, false)
    assert.ok(verdict.issues.length >= 3, JSON.stringify(verdict.issues))
    assert.ok(verdict.issues.some(issue => /invoice_number/.test(issue)))
    assert.ok(verdict.issues.some(issue => /total_amount/.test(issue)))
    assert.ok(verdict.issues.some(issue => /currency/.test(issue)))
  })

  it('refuses an unsupported schema keyword by name, as an extraction would', () => {
    // A dropped `pattern` would make this validator accept a record the caller excluded,
    // which is the one failure a validator must never have.
    assert.throws(
      () => validateRecord({ type: 'object', properties: { a: { type: 'string', pattern: '^AC-' } } }, { a: 'nope' }),
      (error: unknown) => error instanceof SchemaRefusal && /"pattern" is not part of the engine's grammar/.test(error.message),
    )
  })

  it('refuses a non-object record instead of validating something else', () => {
    for (const record of [null, 'a string', 7, [VALID_RECORD]] as const) {
      const verdict = validateRecord(INVOICE_SCHEMA, record)
      assert.equal(verdict.valid, false)
      assert.match(verdict.issues[0] ?? '', /\(root\) must be an object/)
      assert.equal(verdict.record, undefined)
    }
  })

  it('applies the extraction path\'s forced additionalProperties: false', () => {
    // The sanitiser closes every object even though the caller did not say so. This
    // validator must inherit that, or an unrequested field would pass here and fail the
    // extraction that produced the record.
    const verdict = validateRecord({ type: 'object', properties: { a: { type: 'string' } } }, { a: 'x', b: 1 })
    assert.equal(verdict.valid, false)
    assert.ok(verdict.issues.some(issue => /additional properties/.test(issue) && /\(b\)/.test(issue)))
  })
})

describe('validate_record — the provider branch is PURE and works unprepared', () => {
  it('answers on a provider whose artifacts resolve to nothing', async () => {
    const result = await (await provider()).invoke({
      implementationId: 'needle3-native-validate-record',
      input: { schema: INVOICE_SCHEMA, record: VALID_RECORD },
      context: invocation(),
    })
    assert.equal(result.valid, true)
    assert.deepEqual(result.issues, [])
    assert.deepEqual(result.record, VALID_RECORD)
  })

  it('returns the issues for an invalid record rather than throwing', async () => {
    const result = await (await provider()).invoke({
      implementationId: 'needle3-native-validate-record',
      input: { schema: INVOICE_SCHEMA, record: { ...VALID_RECORD, currency: 'JPY' } },
      context: invocation(),
    })
    assert.equal(result.valid, false)
    assert.ok(Array.isArray(result.issues))
    assert.ok(result.issues.some(issue => typeof issue === 'string' && /currency/.test(issue)))
    assert.equal(result.record, null)
  })

  it('refuses a malformed call through the shipped input schema', async () => {
    const created = await provider()
    await assert.rejects(
      created.invoke({
        implementationId: 'needle3-native-validate-record',
        // No `record`: the schema requires it.
        input: { schema: INVOICE_SCHEMA },
        context: invocation(),
      }),
      /validate-record\.input\.json/,
    )
    await assert.rejects(
      created.invoke({
        implementationId: 'needle3-native-validate-record',
        input: { schema: INVOICE_SCHEMA, record: VALID_RECORD, execute: true },
        context: invocation(),
      }),
      /validate-record\.input\.json/,
    )
  })

  it('validates the result against the SHIPPED output schema', async () => {
    const result = await (await provider()).invoke({
      implementationId: 'needle3-native-validate-record',
      input: { schema: INVOICE_SCHEMA, record: VALID_RECORD },
      context: invocation(),
    })
    const schema: unknown = JSON.parse(
      readFileSync(new URL('../schema/validate-record.output.json', import.meta.url), 'utf8'),
    )
    assert.ok(typeof schema === 'object' && schema !== null, 'the output schema must be a JSON object')
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
    const stamped = {
      ...result,
      meta: {
        contract: '@try-works/extension-needle/validate_record',
        contractVersion: '1.0.0',
        implementationId: 'needle3-native-validate-record',
        extension: '@try-works/extension-needle',
        extensionVersion: '0.1.3',
        activationGeneration: 1,
        executionLocation: 'device',
        receiptId: 'test-receipt',
        warnings: [],
      },
    }
    assert.equal(validate(stamped), true, JSON.stringify(validate.errors))
    // The field correlations are schema-enforced, not merely documented: a positive
    // verdict cannot carry a record-less result or an unresolved issue, and a negative
    // verdict cannot carry a record.
    assert.equal(validate({ ...stamped, valid: false, record: VALID_RECORD }), false)
    assert.equal(validate({ ...stamped, issues: ['x'], valid: true }), false)
    assert.equal(validate({ ...stamped, record: null, valid: true }), false)
  })

  it('calls no resolver, no engine and no file reader in its branch', () => {
    // STRUCTURAL, not timed: the claim "starts no engine and reads no model asset" is a
    // property of the code, and a wall-clock assertion would be evidence of nothing.
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const start = source.indexOf("implementationId === VALIDATE_RECORD_CONTRACT.implementationId")
    assert.ok(start > 0, 'the validate_record branch must exist')
    const end = source.indexOf('if (implementationId === EXTRACT_WITH_REPAIR_CONTRACT', start)
    assert.ok(end > start, 'the branch must be bounded by the next dispatch branch')
    const branch = source.slice(start, end)
    for (const forbidden of ['resolve(', 'runEngine(', 'invokeEngine(', 'readSource(', 'readFile']) {
      assert.equal(
        branch.includes(forbidden),
        false,
        `the validate_record branch must not reference ${forbidden}`,
      )
    }
  })
})
