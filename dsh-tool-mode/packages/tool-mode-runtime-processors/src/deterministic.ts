/**
 * Deterministic PII detection: the layer under the model.
 *
 * Only patterns that can be validated are reported: Luhn for cards and IMEI, mod-97 for IBAN.
 * A bare 13+ digit run is never called a phone, because that is how a card number or an IMEI
 * leaks into the wrong label. Overlaps are resolved by specificity, so an IBAN that contains
 * phone-shaped digit groups is reported once, as an IBAN.
 *
 * Offsets are UTF-16 code units into the caller's text, and the reported text is the slice at
 * those offsets, so a caller can replace the span without recomputing anything.
 *
 * @module @try-works/tool-mode-runtime-processors/deterministic
 */

/** One deterministically detected span. */
export interface DeterministicSpan {
  readonly start: number
  readonly end: number
  readonly label: string
  readonly text: string
  readonly score: number
}

/** Stable label names shared with the model's taxonomy. */
export const DETERMINISTIC_LABELS = {
  /** An email address. */
  email: 'EMAIL',
  /** A phone number with phone-like formatting. */
  phone: 'PHONE',
  /** A payment card number that passes the Luhn check. */
  creditCard: 'CREDIT_CARD',
  /** An IBAN that passes the mod-97 check. */
  iban: 'IBAN',
  /** A 15-digit device identity that passes the Luhn check. */
  imei: 'IMEI',
} as const

const PRIORITY = {
  email: 100,
  iban: 90,
  creditCard: 80,
  imei: 70,
  phone: 60,
} as const

const EMAIL_SOURCE =
  '(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}(?![A-Za-z0-9-])'
const IBAN_SOURCE = '(?<![A-Za-z0-9])[A-Za-z]{2}\\d{2}(?: ?[A-Za-z0-9]){10,30}(?![A-Za-z0-9])'
const CARD_SOURCE = '(?<![A-Za-z0-9])\\d[\\d -]{9,25}\\d(?![A-Za-z0-9])'
const IMEI_SOURCE = '(?<![A-Za-z0-9+])\\d{15}(?![A-Za-z0-9])'
const PHONE_SOURCE = '(?<![A-Za-z0-9+])(?:\\+\\d{1,3}[ -]?)?(?:\\(\\d{1,4}\\)[ -]?)?\\d[\\d ().-]{4,17}\\d(?![A-Za-z0-9])'

/** A candidate before overlap resolution. */
interface Candidate {
  readonly start: number
  readonly end: number
  readonly label: string
  readonly priority: number
  readonly score: number
}

/** Luhn check over a digit-only string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false
  let sum = 0
  let alternate = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const character = digits.charAt(index)
    let value = Number(character)
    if (Number.isNaN(value)) return false
    if (alternate) {
      value *= 2
      if (value > 9) value -= 9
    }
    sum += value
    alternate = !alternate
  }
  return sum % 10 === 0
}

/** Mod-97 check over a compacted IBAN (letters and digits, no spaces). */
export function ibanValid(compact: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false
  const rearranged = compact.slice(4) + compact.slice(0, 4)
  let remainder = 0
  for (const character of rearranged) {
    const value = character >= 'A' && character <= 'Z' ? character.charCodeAt(0) - 55 : Number(character)
    if (Number.isNaN(value)) return false
    for (const digit of String(value)) {
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }
  return remainder === 1
}

/** Whether a digit string starts with a payment-network prefix this layer recognises. */
function hasCardIssuerPrefix(digits: string): boolean {
  const first = digits.charAt(0)
  if (first === '4' || first === '5' || first === '6') return true
  if (first === '3') {
    const two = digits.slice(0, 2)
    return two === '34' || two === '37' || two === '30' || two === '36' || two === '38' || two === '39'
  }
  if (first === '2' && digits.length >= 4) {
    const four = Number(digits.slice(0, 4))
    return four >= 2221 && four <= 2720
  }
  return false
}

/** Digits in a string. */
function digitsOf(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

/** Characters that can belong to a numeric run around a candidate. */
const RUN_CHARACTER = /[0-9 ().-]/

/** Push every accepted regex match as a candidate. */
function collectMatches(
  text: string,
  source: string,
  label: string,
  priority: number,
  score: number,
  accept: (raw: string, start: number) => boolean,
  candidates: Candidate[],
): void {
  const pattern = new RegExp(source, 'g')
  for (const match of text.matchAll(pattern)) {
    const raw = match[0]
    const start = match.index
    if (raw === undefined || start === undefined || raw.length === 0) continue
    if (!accept(raw, start)) continue
    candidates.push({ start, end: start + raw.length, label, priority, score })
  }
}

/**
 * A phone candidate is only a phone if its surrounding numeric run is phone-sized.
 * This is what stops a card number, an IMEI or an account number being reported as a phone.
 */
function isPhoneLike(text: string, raw: string, start: number): boolean {
  const digits = digitsOf(raw)
  if (digits.length < 7 || digits.length > 15) return false
  if (digits.length === raw.length && digits.length >= 13) return false
  let runStart = start
  while (runStart > 0 && RUN_CHARACTER.test(text.charAt(runStart - 1))) runStart -= 1
  let runEnd = start + raw.length
  while (runEnd < text.length && RUN_CHARACTER.test(text.charAt(runEnd))) runEnd += 1
  return digitsOf(text.slice(runStart, runEnd)).length <= 15
}

/**
 * Detect PII with deterministic rules only.
 *
 * @param text - the caller's text.
 * @returns non-overlapping spans in reading order.
 */
export function deterministicPii(text: string): readonly DeterministicSpan[] {
  if (typeof text !== 'string') throw new Error('deterministicPii: text must be a string')
  if (text.length === 0) return []
  const candidates: Candidate[] = []

  collectMatches(
    text,
    EMAIL_SOURCE,
    DETERMINISTIC_LABELS.email,
    PRIORITY.email,
    1,
    () => true,
    candidates,
  )

  collectMatches(
    text,
    IBAN_SOURCE,
    DETERMINISTIC_LABELS.iban,
    PRIORITY.iban,
    1,
    raw => ibanValid(raw.replace(/ /g, '').toUpperCase()),
    candidates,
  )

  collectMatches(
    text,
    CARD_SOURCE,
    DETERMINISTIC_LABELS.creditCard,
    PRIORITY.creditCard,
    1,
    raw => {
      const digits = digitsOf(raw)
      if (digits.length < 13 || digits.length > 19) return false
      if (!luhnValid(digits)) return false
      return hasCardIssuerPrefix(digits) || digits.length >= 16
    },
    candidates,
  )

  collectMatches(
    text,
    IMEI_SOURCE,
    DETERMINISTIC_LABELS.imei,
    PRIORITY.imei,
    1,
    raw => luhnValid(raw) && !hasCardIssuerPrefix(raw),
    candidates,
  )

  collectMatches(
    text,
    PHONE_SOURCE,
    DETERMINISTIC_LABELS.phone,
    PRIORITY.phone,
    0.9,
    (raw, start) => isPhoneLike(text, raw, start),
    candidates,
  )

  const ordered = candidates.slice().sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start
    if (left.priority !== right.priority) return right.priority - left.priority
    return right.end - right.start - (left.end - left.start)
  })

  const accepted: Candidate[] = []
  let lastEnd = -1
  for (const candidate of ordered) {
    if (candidate.start < lastEnd) continue
    accepted.push(candidate)
    lastEnd = candidate.end
  }
  return accepted.map(candidate => ({
    start: candidate.start,
    end: candidate.end,
    label: candidate.label,
    text: text.slice(candidate.start, candidate.end),
    score: candidate.score,
  }))
}
