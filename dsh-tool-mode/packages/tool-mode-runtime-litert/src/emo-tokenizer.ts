/**
 * The emo front end: the EMTK semantic tokenizer and the hashed n-gram featurizer.
 *
 * PRIMARY SOURCE (Desert-Ant-Labs/desert-ant-core @ baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7):
 * - Sources/Emo/Tokenizer.swift:5-13   FNV-1a (offset 0xCBF29CE484222325, prime 0x100000001B3)
 * - Sources/Emo/Tokenizer.swift:15-43  NGram.encode: five bucket seeds, impSeed
 *                                      0xFF51AFD7ED558CCD, bucket = h % nBuckets,
 *                                      sign from bit 63, importance = h(impSeed) % nImportance
 * - Sources/Emo/Tokenizer.swift:45-96  per-script features: Latin w:/g:, Indic a:/k:,
 *                                      CJK c:/j:, SEA s:
 * - Sources/Emo/Tokenizer.swift:98-110 NFKC + lowercase normalization and word runs
 * - Sources/Emo/Tokenizer.swift:112-163 clusters, Jamo, category predicates
 * - Sources/Emo/Tokenizer.swift:166-203 EMTK container: magic EMTK, offset 6, u32 unkID,
 *                                      u32 k, k float32 scores, k uint16 byte lengths, UTF-8
 *                                      pieces back to back, maxLen = min(maxScalars, 24)
 * - Sources/Emo/Tokenizer.swift:205-242 Viterbi: window maxLen, strict-greater tie-break,
 *                                      unk fallback with the unk score
 * - Sources/Emo/Tokenizer.swift:276-366 byte-exact vocabulary keys; duplicate byte pieces
 *                                      make the container malformed
 *
 * EQUIVALENCE RISK (recorded verbatim in the lock qualification): the Swift front end uses
 * TextNormalization NFKC plus Swift Unicode category predicates; this port uses the JavaScript
 * engine's NFKC/Unicode data. Arithmetic is pinned by independent Python FNV goldens and by our
 * own tokenizer vectors, but Swift <-> JS NFKC equality and Viterbi tie-order equivalence are
 * NOT independently proven (no ground-truth tokenizer vectors were available).
 */

/** FNV-1a 64-bit offset basis. */
export const EMO_OFFSET_BASIS = 0xcbf29ce484222325n

/** FNV-1a 64-bit prime. */
export const EMO_PRIME = 0x100000001b3n

const MASK64 = 0xffffffffffffffffn

/** The five bucket seeds (Tokenizer.swift:38-41). */
export const EMO_BUCKET_SEEDS: readonly bigint[] = [
  0x9e3779b97f4a7c15n,
  0xc2b2ae3d27d4eb4fn,
  0x165667b19e3779f9n,
  0x27d4eb2f165667c5n,
  0x85ebca77c2b2ae63n,
]

/** The importance seed (Tokenizer.swift:42). */
export const EMO_IMPORTANCE_SEED = 0xff51afd7ed558ccdn

/** The Viterbi window cap (Tokenizer.swift:201). */
export const EMO_MAX_TOKEN_SCALARS = 24

const ENCODER = new TextEncoder()

/** FNV-1a over the UTF-8 bytes of a string (Tokenizer.swift:5-13). */
export function fnv64(text: string, seed: bigint): bigint {
  let hash = (EMO_OFFSET_BASIS ^ seed) & MASK64
  for (const byte of ENCODER.encode(text)) {
    hash ^= BigInt(byte)
    hash = (hash * EMO_PRIME) & MASK64
  }
  return hash
}

/** The longest piece in scalars, measured as non-continuation bytes (Tokenizer.swift:190-193). */
const scalarCount = (bytes: Uint8Array): number => {
  let count = 0
  for (const byte of bytes) if ((byte & 0xc0) !== 0x80) count += 1
  return count
}

const hexKey = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

const utf8Width = (codePoint: number): number =>
  codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4

/** A parsed EMTK tokenizer. */
export interface EmtTokenizer {
  readonly vocabSize: number
  readonly unkID: number
  /** The float32 piece scores, in id order. */
  readonly scores: readonly number[]
  /** The longest piece in scalars, capped at 24. */
  readonly maxLen: number
  /** Tokenize one phrase to ids (Tokenizer.swift:205-242). */
  readonly encode: (text: string) => readonly number[]
}

/**
 * Parse the EMTK container (Tokenizer.swift:166-203).
 *
 * @param bytes - the whole emo_tokenizer.bin
 * @returns the tokenizer
 * @throws Error naming the malformed part
 */
export const parseEmtTokenizer = (bytes: Uint8Array): EmtTokenizer => {
  if (bytes.length < 14) throw new Error('the EMTK tokenizer is truncated: shorter than its header')
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0)
  if (magic !== 'EMTK') throw new Error('the tokenizer is not an EMTK container: bad magic ' + JSON.stringify(magic))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const require = (offset: number, need: number, part: string): void => {
    if (offset + need > bytes.length) throw new Error('the EMTK tokenizer is truncated in its ' + part)
  }
  let offset = 6
  require(offset, 8, 'unk/k header')
  const unkID = view.getUint32(offset, true)
  offset += 4
  const k = view.getUint32(offset, true)
  offset += 4
  if (k === 0) throw new Error('the EMTK tokenizer has no pieces')
  if (unkID >= k) throw new Error('the EMTK unk id ' + String(unkID) + ' is outside its ' + String(k) + '-piece vocabulary')

  require(offset, k * 4, 'scores')
  const scores: number[] = []
  for (let index = 0; index < k; index += 1) {
    scores.push(view.getFloat32(offset, true))
    offset += 4
  }

  require(offset, k * 2, 'piece lengths')
  const lengths: number[] = []
  for (let index = 0; index < k; index += 1) {
    lengths.push(view.getUint16(offset, true))
    offset += 2
  }

  const vocabulary = new Map<string, number>()
  let maxScalars = 1
  for (let index = 0; index < k; index += 1) {
    const length = lengths[index] ?? 0
    require(offset, length, 'pieces')
    const piece = bytes.subarray(offset, offset + length)
    offset += length
    const key = hexKey(piece)
    if (vocabulary.has(key)) throw new Error('the EMTK tokenizer contains duplicate piece bytes at id ' + String(index))
    vocabulary.set(key, index)
    const scalars = scalarCount(piece)
    if (scalars > maxScalars) maxScalars = scalars
  }

  const unkScore = scores[unkID] ?? 0
  const maxLen = Math.min(maxScalars, EMO_MAX_TOKEN_SCALARS)

  const encode = (text: string): readonly number[] => {
    const marker = '\u2581'
    const lowered = text.toLowerCase().normalize('NFKC')
    let normalized = marker
    for (const character of lowered) normalized += character === ' ' ? marker : character
    const scalars = Array.from(normalized)
    const n = scalars.length
    if (n === 0) return []
    const utf8 = ENCODER.encode(normalized)
    const span = new Array<number>(n + 1)
    span[0] = 0
    for (let index = 0; index < n; index += 1) {
      const scalar = scalars[index] ?? ''
      span[index + 1] = (span[index] ?? 0) + utf8Width(scalar.codePointAt(0) ?? 0)
    }

    const best = new Float64Array(n + 1)
    best.fill(-1e18)
    best[0] = 0
    const backPos = new Int32Array(n + 1)
    backPos.fill(-1)
    const backID = new Int32Array(n + 1)
    backID.fill(-1)
    for (let i = 1; i <= n; i += 1) {
      const lo = Math.max(0, i - maxLen)
      for (let j = lo; j < i; j += 1) {
        const start = span[j] ?? 0
        const end = span[i] ?? start
        const id = vocabulary.get(hexKey(utf8.subarray(start, end)))
        if (id === undefined) continue
        const score = (best[j] ?? -1e18) + (scores[id] ?? 0)
        if (score > (best[i] ?? -1e18)) {
          best[i] = score
          backPos[i] = j
          backID[i] = id
        }
      }
      const fallback = (best[i - 1] ?? -1e18) + unkScore
      if (fallback > (best[i] ?? -1e18)) {
        best[i] = fallback
        backPos[i] = i - 1
        backID[i] = unkID
      }
    }
    const ids: number[] = []
    let position = n
    while (position > 0) {
      const id = backID[position] ?? -1
      if (id < 0) break
      ids.push(id)
      position = backPos[position] ?? 0
    }
    return ids.reverse()
  }

  return { vocabSize: k, unkID, scores, maxLen, encode }
}

/** Unicode White_Space (what Swift's isWhitespace covers for this purpose). */
const isWhitespace = (codePoint: number): boolean =>
  codePoint === 0x20
  || (codePoint >= 0x09 && codePoint <= 0x0d)
  || codePoint === 0x85
  || codePoint === 0xa0
  || codePoint === 0x1680
  || (codePoint >= 0x2000 && codePoint <= 0x200a)
  || codePoint === 0x2028
  || codePoint === 0x2029
  || codePoint === 0x202f
  || codePoint === 0x205f
  || codePoint === 0x3000

const WORD = /[\p{L}\p{M}\p{N}]/u
const MARK = /\p{M}/u

const isWordScalar = (value: string): boolean => WORD.test(value)
const isMark = (value: string): boolean => MARK.test(value)

const isHangul = (codePoint: number): boolean => codePoint >= 0xac00 && codePoint <= 0xd7a3
const isSEA = (codePoint: number): boolean =>
  (codePoint >= 0x0e00 && codePoint <= 0x0eff)
  || (codePoint >= 0x1000 && codePoint <= 0x109f)
  || (codePoint >= 0x1780 && codePoint <= 0x17ff)
const isIndic = (codePoint: number): boolean => codePoint >= 0x0900 && codePoint <= 0x0dff
const isCJK = (codePoint: number): boolean =>
  (codePoint >= 0x4e00 && codePoint <= 0x9fff)
  || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
  || (codePoint >= 0x2_0000 && codePoint <= 0x2_a6df)
  || (codePoint >= 0xf900 && codePoint <= 0xfaff)
  || (codePoint >= 0x3040 && codePoint <= 0x30ff)
  || (codePoint >= 0x31f0 && codePoint <= 0x31ff)
  || isHangul(codePoint)

/** NFKC then lowercase, with whitespace runs collapsed to one space (Tokenizer.swift:98-101). */
const normalizeForNgrams = (text: string): string => {
  const normalized = text.normalize('NFKC').toLowerCase()
  const words: string[] = []
  let current = ''
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0
    if (isWhitespace(codePoint)) {
      if (current.length > 0) {
        words.push(current)
        current = ''
      }
    } else {
      current += character
    }
  }
  if (current.length > 0) words.push(current)
  return words.join(' ')
}

/** Word runs: scalar sequences of letters, marks and numbers (Tokenizer.swift:103-110). */
const wordRuns = (text: string): string[][] => {
  const runs: string[][] = []
  let current: string[] = []
  for (const character of text) {
    if (isWordScalar(character)) {
      current.push(character)
    } else if (current.length > 0) {
      runs.push(current)
      current = []
    }
  }
  if (current.length > 0) runs.push(current)
  return runs
}

const scalarsText = (characters: readonly string[]): string => {
  let out = ''
  for (const character of characters) out += character
  return out
}

const charGrams = (characters: readonly string[], lo: number, hi: number, tag: string): string[] => {
  const out: string[] = []
  for (let size = lo; size <= hi; size += 1) {
    if (characters.length < size) continue
    for (let index = 0; index <= characters.length - size; index += 1) {
      out.push(tag + scalarsText(characters.slice(index, index + size)))
    }
  }
  return out
}

const clusters = (characters: readonly string[]): string[][] => {
  const out: string[][] = []
  let current: string[] = []
  for (const character of characters) {
    if (current.length === 0) {
      current = [character]
      continue
    }
    const previous = current[current.length - 1]
    const value = previous?.codePointAt(0) ?? 0
    const virama = value >= 0x0900 && value <= 0x0dff && ((value & 0xff) === 0x4d || (value & 0xff) === 0xcd)
    if (isMark(character) || virama) current.push(character)
    else {
      out.push(current)
      current = [character]
    }
  }
  if (current.length > 0) out.push(current)
  return out
}

const clusterGrams = (clusterList: readonly (readonly string[])[], lo: number, hi: number, tag: string): string[] => {
  const out: string[] = []
  for (let size = lo; size <= hi; size += 1) {
    if (clusterList.length < size) continue
    for (let index = 0; index <= clusterList.length - size; index += 1) {
      out.push(tag + scalarsText(clusterList.slice(index, index + size).flat()))
    }
  }
  return out
}

const jamo = (codePoint: number): string[] => {
  if (!isHangul(codePoint)) return [String.fromCodePoint(codePoint)]
  const offset = codePoint - 0xac00
  const lead = String.fromCodePoint(0x1100 + Math.trunc(offset / 588))
  const vowel = String.fromCodePoint(0x1161 + Math.trunc((offset % 588) / 28))
  return offset % 28 === 0
    ? [lead, vowel]
    : [lead, vowel, String.fromCodePoint(0x11a7 + (offset % 28))]
}

/**
 * The ordered feature strings for one phrase (Tokenizer.swift:45-96).
 *
 * Latin runs emit w: + the word, then g: n-grams over <word> sizes 3..5; Indic runs emit a:,
 * k: cluster unigrams and k: cluster bigrams/trigrams over <clusters>; CJK runs emit j: Jamo
 * n-grams for Hangul plus c: scalar n-grams sizes 1..2; SEA runs emit s: scalar n-grams 2..4.
 * Empty text produces the w:\u0000 sentinel.
 */
export const emoFeatureList = (text: string): readonly string[] => {
  const features: string[] = []
  for (const run of wordRuns(normalizeForNgrams(text))) {
    const codePoints = run.map((character) => character.codePointAt(0) ?? 0)
    if (codePoints.some(isSEA)) {
      features.push(...charGrams(run, 2, 4, 's:'))
    } else if (codePoints.some(isIndic)) {
      const clusterList = clusters(run)
      features.push('a:' + scalarsText(run))
      features.push(...clusterGrams(clusterList, 1, 1, 'k:'))
      features.push(...clusterGrams([['<'], ...clusterList, ['>']], 2, 3, 'k:'))
    } else if (codePoints.some(isCJK)) {
      const extended: string[] = []
      for (const character of run) {
        const codePoint = character.codePointAt(0) ?? 0
        if (isHangul(codePoint)) features.push(...charGrams(jamo(codePoint), 2, 4, 'j:'))
        extended.push(character)
      }
      features.push(...charGrams(extended, 1, 2, 'c:'))
    } else {
      features.push('w:' + scalarsText(run))
      features.push(...charGrams(['<', ...run, '>'], 3, 5, 'g:'))
    }
  }
  return features.length === 0 ? ['w:\u0000'] : features
}

/** The geometry the meta pins for the n-gram tensors. */
export interface EmoNgramGeometry {
  readonly nBuckets: number
  readonly nHashes: number
  readonly nImportance: number
  readonly maxFeatures: number
}

/** The flattened n-gram tensors for one phrase (before fixed-window padding). */
export interface EmoNgrams {
  /** featureCount * nHashes, feature-major. */
  readonly buckets: Int32Array
  /** featureCount * nHashes, feature-major. */
  readonly signs: Float32Array
  /** featureCount. */
  readonly importance: Int32Array
  /** The tensor value max(featureCount, 1) (Model.swift:41, :71). */
  readonly count: number
}

/** Hash the feature list into the model's bucket/sign/importance arrays (Tokenizer.swift:15-36). */
export const encodeNgrams = (text: string, geometry: EmoNgramGeometry): EmoNgrams => {
  const features = emoFeatureList(text).slice(0, geometry.maxFeatures)
  const featureCount = features.length
  const buckets = new Int32Array(featureCount * geometry.nHashes)
  const signs = new Float32Array(featureCount * geometry.nHashes)
  const importance = new Int32Array(featureCount)
  const bucketModulus = BigInt(Math.max(geometry.nBuckets, 1))
  const importanceModulus = BigInt(Math.max(geometry.nImportance, 1))
  for (let feature = 0; feature < featureCount; feature += 1) {
    const value = features[feature] ?? ''
    for (let hashIndex = 0; hashIndex < geometry.nHashes; hashIndex += 1) {
      const seed = EMO_BUCKET_SEEDS[hashIndex] ?? 0n
      const hash = fnv64(value, seed)
      buckets[feature * geometry.nHashes + hashIndex] = Number(hash % bucketModulus)
      signs[feature * geometry.nHashes + hashIndex] = ((hash >> 63n) & 1n) === 1n ? 1 : -1
    }
    importance[feature] = Number(fnv64(value, EMO_IMPORTANCE_SEED) % importanceModulus)
  }
  return { buckets, signs, importance, count: Math.max(featureCount, 1) }
}
