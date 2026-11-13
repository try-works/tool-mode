/**
 * Remote Jev adapter tests (TOOL-02, DEC-07). Fake transport only: these prove the
 * native request shape, response conversion and refusal semantics, not model quality.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildJevChoiceRequest,
  chooseWithJev,
  confidenceBucket,
  convertJevChoiceResponse,
  JEV_CONVERSION_VERSION,
  JevError,
  buildJevJudgmentsRequest,
  convertJevJudgmentsResponse,
  judgeWithJev,
} from '../src/jev.ts'
import { mountPlugin } from './helpers.ts'

const OPTIONS = ['billing', 'support', 'other']

function nativeResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'jev-1.14',
    answers: {
      choice: {
        type: 'choice',
        choice: 'option_0',
        probabilities: { option_0: 0.7, option_1: 0.2, option_2: 0.1 },
        confidence: 0.7,
      },
    },
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('TOOL-02 — Jev native request shape', () => {
  it('builds the native choice question with option ids and the pinned model', () => {
    const request = buildJevChoiceRequest('Which team?', OPTIONS, 'jev-1.14')
    assert.equal(request.model, 'jev-1.14')
    assert.deepEqual(request.questions.choice.criteria, {
      option_0: 'billing',
      option_1: 'support',
      option_2: 'other',
    })
    assert.equal(request.questions.choice.type, 'choice')
    assert.equal(request.questions.choice.instructions, 'Which team?')
  })

  it('refuses duplicate, empty, and out-of-range option sets', () => {
    assert.throws(() => buildJevChoiceRequest('x', ['a', 'a']), (error: unknown) => error instanceof JevError && error.code === 'invalid_request')
    assert.throws(() => buildJevChoiceRequest('x', ['a', '']), (error: unknown) => error instanceof JevError && error.code === 'invalid_request')
    assert.throws(() => buildJevChoiceRequest('x', ['one']), (error: unknown) => error instanceof JevError && error.code === 'invalid_request')
    assert.throws(() => buildJevChoiceRequest('x', Array.from({ length: 17 }, (_, index) => `o${index}`)), (error: unknown) => error instanceof JevError && error.code === 'invalid_request')
  })
})

describe('DEC-07 — versioned native conversion', () => {
  it('maps the native chosen id to the caller index and buckets the confidence', () => {
    const result = convertJevChoiceResponse(nativeResponse(), OPTIONS)
    assert.equal(result.chosen, 0)
    assert.equal(result.confidence, 'confident')
    assert.match(result.reason, /billing/)
    assert.match(result.reason, new RegExp(JEV_CONVERSION_VERSION.replace(/\./g, '\\.')))
  })

  it('maps a middle probability to the documented buckets', () => {
    assert.equal(confidenceBucket(0.8), 'confident')
    assert.equal(confidenceBucket(0.5), 'likely')
    assert.equal(confidenceBucket(0.2), 'tentative')
    assert.throws(() => confidenceBucket(Number.NaN), JevError)
  })

  it('refuses an unknown chosen id instead of abstaining', () => {
    const payload = nativeResponse()
    ;(payload.answers as Record<string, Record<string, unknown>>).choice!.choice = 'option_9'
    assert.throws(() => convertJevChoiceResponse(payload, OPTIONS), (error: unknown) => error instanceof JevError && error.code === 'invalid_response')
  })

  it('refuses missing/extra/unnormalized probabilities', () => {
    for (const probabilities of [
      { option_0: 0.7, option_1: 0.3 },
      { option_0: 0.7, option_1: 0.2, option_2: 0.1, option_3: 0 },
      { option_0: 0.7, option_1: 0.2, option_2: 0.2 },
      { option_0: 0.7, option_1: 0.2, option_2: Number.NaN },
    ]) {
      const payload = nativeResponse()
      ;(payload.answers as Record<string, Record<string, unknown>>).choice!.probabilities = probabilities
      assert.throws(() => convertJevChoiceResponse(payload, OPTIONS), (error: unknown) => error instanceof JevError && error.code === 'invalid_response')
    }
  })
})

describe('TOOL-02 — native HTTP transport', () => {
  it('registers the optional tool only when enabled and reports a missing key', async () => {
    const ctx = await mountPlugin({ jev: { enabled: true, apiKey: '' } })
    try {
      const names = ctx.tools.schemas().map(schema => schema.name)
      assert.ok(names.includes('decision_choose_jev'))
      assert.ok(names.includes('decision_judgments_jev'), 'atomic judgment batch registered')
      assert.ok(names.includes('decision_combine'), 'pure decision combiner registered')
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: 'jev_missing_key' as never,
        name: 'decision_choose_jev',
        arguments: { decision: 'Pick one', options: ['a', 'b'] },
      })
      assert.equal(result.isError, true)
      assert.match(result.isError ? result.error.message : '', /JEV_API_KEY_NOT_CONFIGURED/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('posts to /v1/systemone with the bearer key and returns the converted result', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const result = await chooseWithJev('Which team?', OPTIONS, {
      apiKey: 'test-key',
      baseURL: 'https://jev.example/',
      fetch: async (input, init) => {
        seen = { url: String(input), init: init ?? {} }
        return jsonResponse(nativeResponse())
      },
    })
    assert.equal(seen?.url, 'https://jev.example/v1/systemone')
    assert.equal((seen?.init.headers as Record<string, string>).Authorization, 'Bearer test-key')
    assert.equal(result.chosen, 0)
  })

  it('refuses a missing key before any request', async () => {
    let calls = 0
    await assert.rejects(
      chooseWithJev('Which team?', OPTIONS, { apiKey: '', fetch: async () => { calls += 1; return jsonResponse(nativeResponse()) } }),
      (error: unknown) => error instanceof JevError && error.code === 'api_key_missing',
    )
    assert.equal(calls, 0)
  })

  it('turns HTTP and non-JSON failures into typed errors without response bodies', async () => {
    await assert.rejects(
      chooseWithJev('Which team?', OPTIONS, { apiKey: 'k', fetch: async () => new Response('secret body', { status: 401 }) }),
      (error: unknown) => error instanceof JevError && error.code === 'http' && error.status === 401 && !String(error).includes('secret'),
    )
    await assert.rejects(
      chooseWithJev('Which team?', OPTIONS, { apiKey: 'k', fetch: async () => new Response('not json', { status: 200 }) }),
      (error: unknown) => error instanceof JevError && error.code === 'invalid_response',
    )
  })
})

describe('DEC-07 — Jev atomic judgment batches', () => {
  it('builds independent noul and choice questions in one request', () => {
    const questions = [
      { id: 'wants_money_back', type: 'boolean' as const, proposition: 'Does the customer want money back?' },
      { id: 'route', type: 'choice' as const, instructions: 'Which team?', criteria: { billing: 'money', other: 'everything else' } },
    ]
    const request = buildJevJudgmentsRequest({ ticket: 'charged twice' }, questions, 'jev-1.14')
    assert.deepEqual(request.questions, {
      wants_money_back: { type: 'noul', instructions: 'Does the customer want money back?' },
      route: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'money', other: 'everything else' } },
    })
  })

  it('returns each judgment independently with validated probabilities', () => {
    const questions = [
      { id: 'wants_money_back', type: 'boolean' as const, proposition: 'Does the customer want money back?' },
      { id: 'route', type: 'choice' as const, instructions: 'Which team?', criteria: { billing: 'money', other: 'everything else' } },
    ]
    const result = convertJevJudgmentsResponse({
      model: 'jev-1.14',
      answers: {
        wants_money_back: { type: 'noul', noul: 0.99 },
        route: { type: 'choice', choice: 'billing', probabilities: { billing: 0.8, other: 0.2 }, confidence: 0.8 },
      },
    }, questions)
    assert.equal(result.judgments.wants_money_back?.probability, 0.99)
    assert.equal(result.judgments.route?.chosen, 'billing')
    assert.deepEqual(result.judgments.route?.probabilities, { billing: 0.8, other: 0.2 })
  })

  it('refuses missing answers, unknown choices and unnormalized probabilities', () => {
    const questions = [{ id: 'route', type: 'choice' as const, instructions: 'Which?', criteria: { a: 'A', b: 'B' } }]
    assert.throws(() => convertJevJudgmentsResponse({ answers: {} }, questions), /missing question/)
    assert.throws(() => convertJevJudgmentsResponse({ answers: { route: { type: 'choice', choice: 'c', probabilities: { a: 0.5, b: 0.5 }, confidence: 0.5 } } }, questions), /not a supplied criterion/)
    assert.throws(() => convertJevJudgmentsResponse({ answers: { route: { type: 'choice', choice: 'a', probabilities: { a: 0.9, b: 0.2 }, confidence: 0.5 } } }, questions), /normalized/)
  })

  it('sends the batch with the bearer key and returns native judgments', async () => {
    let seen
    const result = await judgeWithJev({ ticket: 'x' }, [{ id: 'q', type: 'boolean', proposition: 'Is it urgent?' }], {
      apiKey: 'k', baseURL: 'https://jev.example/', fetch: async (input, init) => {
        seen = { url: String(input), body: String(init?.body) }
        return new Response(JSON.stringify({ model: 'jev-1.14', answers: { q: { type: 'noul', noul: 0.9 } } }), { status: 200 })
      },
    })
    assert.equal(seen?.url, 'https://jev.example/v1/systemone')
    assert.match(seen?.body ?? '', /"type":"noul"/)
    assert.equal(result.judgments.q?.probability, 0.9)
  })
})
