/**
 * Shared test helpers: small inline vocabs and logit matrices.
 *
 * Nothing here reads a file. The real tokenizer.json is a deployed asset; these tests
 * prove the processor contract against fixtures whose expected output can be written down.
 */
export function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

/** Build a vocabulary map from literal pairs, in insertion order. */
export function vocab(entries: readonly (readonly [string, number])[]): ReadonlyMap<string, number> {
  return new Map(entries)
}

/**
 * One-hot logits: the chosen label gets 0 and every other label -20, so softmax is ~1.
 * The choices array holds one label index per token.
 */
export function oneHotLogits(tokens: number, labels: number, choices: readonly number[]): Float32Array {
  if (choices.length !== tokens) throw new Error('choices must have one label index per token')
  const data = new Float32Array(tokens * labels).fill(-20)
  for (let token = 0; token < tokens; token += 1) {
    const choice = requireValue(choices[token], 'missing choice for token ' + String(token))
    data[token * labels + choice] = 0
  }
  return data
}

/** Explicit row-major logits, for tests that need a known probability rather than ~1. */
export function logitsFromRows(rows: readonly (readonly number[])[]): Float32Array {
  const width = rows[0]?.length ?? 0
  const data = new Float32Array(rows.length * width)
  rows.forEach((row, token) => {
    if (row.length !== width) throw new Error('every logits row must have the same width')
    row.forEach((value, label) => {
      data[token * width + label] = value
    })
  })
  return data
}
