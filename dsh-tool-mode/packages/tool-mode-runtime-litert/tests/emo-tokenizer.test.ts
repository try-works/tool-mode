/**
 * The emo tokenizer and featurizer against the primary source's own arithmetic.
 *
 * PROVENANCE (Desert-Ant-Labs/desert-ant-core @ baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7):
 * - Sources/Emo/Tokenizer.swift:5-13   FNV-1a (offset 0xCBF29CE484222325, prime 0x100000001B3)
 * - Sources/Emo/Tokenizer.swift:15-43  NGram.encode, the five bucket seeds, impSeed, hash count,
 *                                      bucket/sign/importance arithmetic
 * - Sources/Emo/Tokenizer.swift:45-96  per-script feature extraction (Latin/Indic/CJK/SEA)
 * - Sources/Emo/Tokenizer.swift:98-110 NFKC lowercased normalization and word runs
 * - Sources/Emo/Tokenizer.swift:112-163 clusters, Jamo, category predicates
 * - Sources/Emo/Tokenizer.swift:166-203 EMTK container parse (magic, unkID, k, f32 scores,
 *                                      u16 byte lengths, UTF-8 pieces, maxLen = min(maxScalars, 24))
 * - Sources/Emo/Tokenizer.swift:205-242 Viterbi (window maxLen, strict-greater tie-break, unk fallback)
 * - Sources/Emo/TModel.swift byte-exact vocabulary keys (UTF-8 bytes, duplicate pieces refused)
 * - Sources/Emo/Model.swift:43-75       fixed-window packing and the six tensor names/shapes
 *
 * The FNV goldens in emo-fixtures.ts were computed independently in Python; the feature list is
 * derived by hand from the Latin branch. NFKC and Unicode whitespace may differ by ICU version
 * from the Swift implementation, which PHASE4 records as an honest, unproven equivalence risk.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  EMO_MAX_TOKEN_SCALARS,
  EMO_OFFSET_BASIS,
  EMO_PRIME,
  emoFeatureList,
  encodeNgrams,
  fnv64,
  parseEmtTokenizer,
} from '../src/emo-tokenizer.ts'
import { EMO_GOLDEN, EMO_VOCAB, encodeEmtTokenizer } from './emo-fixtures.ts'

const messageOf = (error: unknown): string => {
  assert.ok(error instanceof Error)
  return error.message
}

describe('FNV-1a', () => {
  it('matches the documented offset basis and multiplication', () => {
    assert.equal(fnv64('', 0n), EMO_OFFSET_BASIS)
    assert.equal(fnv64('a', 0n), ((EMO_OFFSET_BASIS ^ 0x61n) * EMO_PRIME) & 0xffffffffffffffffn)
    assert.equal(fnv64('a', 0n) & 0xffffffffffffffffn, fnv64('a', 0n))
  })
})

describe('EMTK container', () => {
  it('parses magic, unkID, k, f32 scores and u16-length UTF-8 pieces', () => {
    const tokenizer = parseEmtTokenizer(encodeEmtTokenizer({ pieces: EMO_VOCAB, unkID: 3 }))
    assert.equal(tokenizer.vocabSize, 6)
    assert.equal(tokenizer.unkID, 3)
    assert.deepEqual(Array.from(tokenizer.scores), [0, -1, -2, -5, -3, -4])
    // longest piece is 6 scalars ("▁bills"), under the 24 cap
    assert.equal(tokenizer.maxLen, 6)
  })

  it('refuses a bad magic, truncation, empty vocab, out-of-range unk and duplicates', () => {
    assert.throws(() => parseEmtTokenizer(new TextEncoder().encode('XXXX not emtk')), (e) => /magic|EMTK/.test(messageOf(e)))
    assert.throws(() => parseEmtTokenizer(new Uint8Array(10)), (e) => /truncated|short/.test(messageOf(e)))
    assert.throws(() => parseEmtTokenizer(encodeEmtTokenizer({ pieces: [] })), (e) => /empty|no pieces/.test(messageOf(e)))
    assert.throws(
      () => parseEmtTokenizer(encodeEmtTokenizer({ pieces: EMO_VOCAB, unkID: 9 })),
      (e) => /unk/.test(messageOf(e)),
    )
    assert.throws(
      () => parseEmtTokenizer(encodeEmtTokenizer({ pieces: [{ piece: 'x', score: 0 }, { piece: 'x', score: 1 }] })),
      (e) => /duplicate/.test(messageOf(e)),
    )
    const bytes = encodeEmtTokenizer({ pieces: EMO_VOCAB, unkID: 3 })
    assert.throws(() => parseEmtTokenizer(bytes.slice(0, bytes.length - 3)), (e) => /truncated|piece/.test(messageOf(e)))
  })

  it('caps the Viterbi window at 24 scalars', () => {
    const long = '▁' + 'a'.repeat(29)
    const tokenizer = parseEmtTokenizer(encodeEmtTokenizer({ pieces: [{ piece: long, score: 0 }, { piece: 'a', score: -1 }] }))
    assert.equal(tokenizer.maxLen, EMO_MAX_TOKEN_SCALARS)
  })
})

describe('SemTokenizer Viterbi', () => {
  const tokenizer = parseEmtTokenizer(encodeEmtTokenizer({ pieces: EMO_VOCAB, unkID: 3 }))

  it('prepends the word marker, lowercases and maps spaces to it', () => {
    assert.deepEqual(Array.from(tokenizer.encode('Pay my bills')), [0, 1, 2])
    assert.deepEqual(Array.from(tokenizer.encode('pay my bills')), [0, 1, 2])
  })

  it('falls back to the unk id for uncovered scalars', () => {
    assert.deepEqual(Array.from(tokenizer.encode('pay my bills!')), [0, 1, 2, 3])
    assert.deepEqual(Array.from(tokenizer.encode('xyz')), [4, 3, 3, 3])
  })

  it('tokenizes empty text as just the word marker (the API layer rejects empty input first)', () => {
    // Swift always prefixes the marker, so encode("") is the piece for the marker. Emo's public
    // API returns [] for empty text before reaching the model; the processor refuses it earlier.
    assert.deepEqual(Array.from(tokenizer.encode('')), [4])
  })
})

describe('per-script feature extraction', () => {
  it('produces the hand-derived Latin features for "pay my bills"', () => {
    assert.deepEqual([...emoFeatureList(EMO_GOLDEN.text)], [...EMO_GOLDEN.features])
  })

  it('drops punctuation and normalizes internal whitespace', () => {
    assert.deepEqual([...emoFeatureList('  pay,   my bills!  ')], [...EMO_GOLDEN.features])
  })

  it('uses the empty-text sentinel', () => {
    assert.deepEqual([...emoFeatureList('')], ['w:\u0000'])
    assert.deepEqual([...emoFeatureList('   ')], ['w:\u0000'])
  })

  it('uses CJK char n-grams with the c: tag', () => {
    assert.deepEqual([...emoFeatureList('日本')], ['c:日', 'c:本', 'c:日本'])
  })

  it('uses the s: tag for a SEA run and the j:/c: pair for Hangul', () => {
    const thai = emoFeatureList('ไทย')
    assert.ok(thai.length > 0 && thai.every((feature) => feature.startsWith('s:')), JSON.stringify(thai))
    const hangul = emoFeatureList('한')
    assert.ok(hangul.some((feature) => feature.startsWith('j:')))
    assert.ok(hangul.some((feature) => feature.startsWith('c:')))
  })
})

describe('NGram hashing', () => {
  const geometry = { nBuckets: 44000, nHashes: 3, nImportance: 16000, maxFeatures: 512 }

  it('matches the independent Python goldens for "pay my bills"', () => {
    const ngrams = encodeNgrams(EMO_GOLDEN.text, geometry)
    assert.equal(ngrams.count, EMO_GOLDEN.features.length)
    assert.deepEqual(Array.from(ngrams.buckets), [...EMO_GOLDEN.buckets])
    assert.deepEqual(Array.from(ngrams.signs), [...EMO_GOLDEN.signs])
    assert.deepEqual(Array.from(ngrams.importance), [...EMO_GOLDEN.importance])
  })

  it('keeps bucket, sign and importance in range and truncates at maxFeatures', () => {
    const ngrams = encodeNgrams(EMO_GOLDEN.text, { ...geometry, maxFeatures: 5 })
    assert.equal(ngrams.count, 5)
    assert.equal(ngrams.buckets.length, 15)
    for (const bucket of ngrams.buckets) assert.ok(bucket >= 0 && bucket < geometry.nBuckets)
    for (const sign of ngrams.signs) assert.ok(sign === 1 || sign === -1)
    for (const value of ngrams.importance) assert.ok(value >= 0 && value < geometry.nImportance)
  })
})
