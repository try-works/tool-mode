/**
 * Deterministic emo fixtures: a small EMTK tokenizer container, the meta document, and the
 * FNV n-gram goldens for "pay my bills".
 *
 * The goldens in EMO_GOLDEN were computed independently in Python (2026-10-14) from the
 * algorithm and constants in Sources/Emo/Tokenizer.swift:5-43 (FNV-1a with the five bucket
 * seeds, impSeed 0xFF51AFD7ED558CCD, modulo nBuckets/nImportance), not by the TS code they
 * check.
 */

export interface VocabPiece {
  readonly piece: string
  readonly score: number
}

/**
 * Build an EMTK container (Tokenizer.swift:166-203): magic EMTK at 0, two reserved version
 * bytes at 4-5, u32 LE unkID, u32 LE k, k float32 LE scores, k uint16 LE byte lengths, then the
 * UTF-8 pieces back to back.
 */
export const encodeEmtTokenizer = (options: {
  readonly pieces: readonly VocabPiece[]
  readonly unkID?: number
  readonly magic?: string
  readonly version?: readonly [number, number]
}): Uint8Array => {
  const pieces = options.pieces
  const magic = options.magic ?? 'EMTK'
  const version = options.version ?? [1, 0]
  const encoded = pieces.map((entry) => new TextEncoder().encode(entry.piece))
  const total = 14 + pieces.length * 6 + encoded.reduce((sum, bytes) => sum + bytes.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  for (let index = 0; index < 4; index += 1) out[index] = magic.charCodeAt(index)
  out[4] = version[0]
  out[5] = version[1]
  let offset = 6
  view.setUint32(offset, options.unkID ?? 0, true)
  offset += 4
  view.setUint32(offset, pieces.length, true)
  offset += 4
  for (const entry of pieces) {
    view.setFloat32(offset, entry.score, true)
    offset += 4
  }
  for (const bytes of encoded) {
    view.setUint16(offset, bytes.length, true)
    offset += 2
  }
  for (const bytes of encoded) {
    out.set(bytes, offset)
    offset += bytes.length
  }
  return out
}

/** The 812 emoji labels the meta must carry (synthetic names are fine for unit tests). */
export const EMO_LABELS: readonly string[] = Array.from({ length: 812 }, (_, index) => 'label' + String(index))

/** The emo_meta.json document matching the pinned artifact constants. */
export const emoMetaJson = (overrides: {
  readonly labels?: readonly string[]
  readonly nHashes?: number
  readonly nBuckets?: number
  readonly nImportance?: number
  readonly semPadIndex?: number
  readonly fmax?: number
  readonly smax?: number
} = {}): string =>
  JSON.stringify({
    labels: overrides.labels ?? EMO_LABELS,
    n_hashes: overrides.nHashes ?? 3,
    n_buckets: overrides.nBuckets ?? 44000,
    n_importance: overrides.nImportance ?? 16000,
    sem_dim: 128,
    n_layers: 2,
    n_heads: 4,
    arch: 'emo',
    sem_pad_index: overrides.semPadIndex ?? 48000,
    fmax: overrides.fmax ?? 512,
    smax: overrides.smax ?? 64,
  })

/** Features and tensor values for "pay my bills", computed independently in Python. */
export const EMO_GOLDEN = {
  text: 'pay my bills',
  features: [
    'w:pay', 'g:<pa', 'g:pay', 'g:ay>', 'g:<pay', 'g:pay>', 'g:<pay>',
    'w:my', 'g:<my', 'g:my>', 'g:<my>',
    'w:bills', 'g:<bi', 'g:bil', 'g:ill', 'g:lls', 'g:ls>',
    'g:<bil', 'g:bill', 'g:ills', 'g:lls>', 'g:<bill', 'g:bills', 'g:ills>',
  ],
  buckets: [
    32369, 14847, 23165, 39656, 15094, 20540, 18689, 28207, 34733, 33515, 30733, 40223,
    26435, 15293, 36831, 6029, 22435, 13257, 12231, 23225, 3539, 39291, 9381, 663,
    23833, 10647, 34917, 30895, 1521, 42843, 41829, 31435, 27041, 6277, 27059, 337,
    7678, 14112, 10146, 4576, 16186, 39188, 18452, 19210, 25232, 39018, 13676, 30486,
    30602, 952, 42230, 26294, 39492, 38890, 4900, 36002, 25896, 5797, 43163, 22809,
    5052, 41462, 16152, 38062, 6456, 34066, 32277, 29379, 19233, 39969, 13215, 24517,
  ],
  signs: [
    1, -1, 1, 1, 1, -1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, 1, 1, -1, -1, -1, 1, -1, -1,
    1, 1, -1, 1, -1, 1, -1, 1, -1, 1, 1, -1, 1, 1, -1, -1, 1, -1, 1, -1, 1, 1, -1, 1,
    1, -1, 1, 1, -1, -1, 1, 1, 1, -1, 1, 1, -1, 1, -1, -1, -1, 1, 1, -1, 1, -1, 1, 1,
  ],
  importance: [
    13497, 13808, 2857, 3715, 7371, 5653, 11471, 7267, 10081, 1527, 8301, 5069,
    1942, 2392, 8540, 6274, 14498, 7118, 15580, 4573, 5748, 2374, 10717, 10169,
  ],
} as const

/** The small vocab the tokenizer tests use; id 3 is the unk piece. */
export const EMO_VOCAB: readonly VocabPiece[] = [
  { piece: '▁pay', score: 0 },
  { piece: '▁my', score: -1 },
  { piece: '▁bills', score: -2 },
  { piece: '?', score: -5 },
  { piece: '▁', score: -3 },
  { piece: 'p', score: -4 },
]