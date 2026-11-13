/**
 * Pure Mirage option and result layer (no WASM, no filesystem).
 *
 * The engine is a small on-device VLM. This layer keeps the tool contract narrow:
 * caller options are bounded and named, engine output is re-validated, and every
 * field is ordinary JSON. It deliberately does not turn a null enum or the engine's
 * "-" abstain probability into a chosen option.
 */

export const MIRAGE_MODEL_ID = 'mirage'

export const MIRAGE_SECTIONS = ['scene', 'objects', 'text', 'relations', 'reasoning'] as const
export type MirageSection = typeof MIRAGE_SECTIONS[number]

export const MIRAGE_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl'] as const
export type MirageLanguage = typeof MIRAGE_LANGUAGES[number]

export const MIRAGE_LIMITS = {
  maxObjects: 64,
  maxTextLines: 128,
  maxFields: 16,
  maxEnumOptions: 32,
  maxStringLength: 200,
  maxImageBytes: 16 * 1024 * 1024,
  maxPixels: 40_000_000,
  maxOutputBytes: 16 * 1024 * 1024,
} as const

export const MIRAGE_IMPLEMENTATION_IDS = {
  describe: 'mirage-wasm-describe',
  detect: 'mirage-wasm-detect',
  ocr: 'mirage-wasm-ocr',
  extract: 'mirage-wasm-extract',
} as const

/** The three field kinds the form decoder accepts. */
export interface MirageField {
  readonly name: string
  readonly kind: 'enum' | 'integer' | 'string' | 'box'
  /** For a box field, the earlier enum field whose object box is requested. */
  readonly of?: string
  readonly options?: readonly string[]
  readonly minimum?: number
  readonly maximum?: number
  readonly maxLength?: number
}

/** Throw a named input error. */
export function invalid(message: string): never {
  throw new Error(`MIRAGE_INVALID_INPUT: ${message}`)
}

/** Read a bounded number. */
export function boundedNumber(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${name} must be a finite number in [${minimum}, ${maximum}]`)
  }
  return value
}

/** Read a bounded integer. */
export function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    invalid(`${name} must be an integer in [${minimum}, ${maximum}]`)
  }
  return value
}

/** Read one documented language. */
export function readLanguage(value: unknown): MirageLanguage | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !(MIRAGE_LANGUAGES as readonly string[]).includes(value)) {
    invalid(`language must be one of ${MIRAGE_LANGUAGES.join(', ')}`)
  }
  return value as MirageLanguage
}

/** Read and de-duplicate requested sections. */
export function readSections(value: unknown): readonly MirageSection[] {
  if (value === undefined) return MIRAGE_SECTIONS
  if (!Array.isArray(value) || value.length === 0 || value.length > MIRAGE_SECTIONS.length) {
    invalid(`sections must be 1–${MIRAGE_SECTIONS.length} of ${MIRAGE_SECTIONS.join(', ')}`)
  }
  const out: MirageSection[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !(MIRAGE_SECTIONS as readonly string[]).includes(entry)) {
      invalid(`sections contains ${JSON.stringify(entry)}, which is not a known section`)
    }
    if (!out.includes(entry as MirageSection)) out.push(entry as MirageSection)
  }
  return out
}

/** Read an image path from the caller. */
export function readImagePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) invalid('image must be a non-empty host-authorized path')
  if (value.length > 4096) invalid('image path is longer than 4096 characters')
  return value
}

/** Build the native options for `mirage_describe`. */
export function describeOptions(input: Readonly<Record<string, unknown>>): { options: Record<string, unknown>; language?: MirageLanguage } {
  const options: Record<string, unknown> = { sections: [...readSections(input.sections)] }
  if (input.maxObjects !== undefined) options.max_objects = boundedInteger(input.maxObjects, 'maxObjects', 1, MIRAGE_LIMITS.maxObjects)
  if (input.maxTextLines !== undefined) options.max_text_lines = boundedInteger(input.maxTextLines, 'maxTextLines', 1, MIRAGE_LIMITS.maxTextLines)
  if (input.conf !== undefined) options.conf = boundedNumber(input.conf, 'conf', 0, 1)
  if (input.textConf !== undefined) options.text_conf = boundedNumber(input.textConf, 'textConf', 0, 1)
  const language = readLanguage(input.language)
  return { options, ...language === undefined ? {} : { language } }
}

/** Build the native options for `mirage_detect`. */
export function detectOptions(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const maskFormat = input.maskFormat ?? 'none'
  if (maskFormat !== 'none' && maskFormat !== 'bitmap' && maskFormat !== 'polygons') {
    invalid('maskFormat must be none, bitmap or polygons')
  }
  const fields = ['bbox', 'score', ...maskFormat === 'none' ? [] : ['mask']]
  const options: Record<string, unknown> = { sections: ['objects'], fields }
  if (input.maxObjects !== undefined) options.max_objects = boundedInteger(input.maxObjects, 'maxObjects', 1, MIRAGE_LIMITS.maxObjects)
  if (input.conf !== undefined) options.conf = boundedNumber(input.conf, 'conf', 0, 1)
  if (maskFormat !== 'none') options.mask_format = maskFormat
  return options
}

/** Build the native options for `mirage_ocr`. */
export function ocrOptions(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const options: Record<string, unknown> = { sections: ['text'], fields: ['bbox', 'score'] }
  if (input.maxTextLines !== undefined) options.max_text_lines = boundedInteger(input.maxTextLines, 'maxTextLines', 1, MIRAGE_LIMITS.maxTextLines)
  if (input.textConf !== undefined) options.text_conf = boundedNumber(input.textConf, 'textConf', 0, 1)
  return options
}

/** Validate and normalize the ordered fields of a form. */
export function readFields(value: unknown): { readonly fields: readonly MirageField[]; readonly form: Record<string, unknown> } {
  if (!Array.isArray(value) || value.length === 0 || value.length > MIRAGE_LIMITS.maxFields) {
    invalid(`fields must be 1–${MIRAGE_LIMITS.maxFields} entries`)
  }
  const fields: MirageField[] = []
  const form: Record<string, unknown> = {}
  const names = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) invalid('each field must be an object')
    const entry = raw as Record<string, unknown>
    const name = entry.name
    if (typeof name !== 'string' || name.length === 0 || name.length > 64 || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) {
      invalid('field names must be 1–64 identifier-like characters')
    }
    if (names.has(name)) invalid(`field ${JSON.stringify(name)} is duplicated`)
    names.add(name)
    if (entry.kind === 'enum') {
      const options = entry.options
      if (!Array.isArray(options) || options.length < 2 || options.length > MIRAGE_LIMITS.maxEnumOptions) {
        invalid(`field ${name} enum needs 2–${MIRAGE_LIMITS.maxEnumOptions} options`)
      }
      const labels = options.map((option) => {
        if (typeof option !== 'string' || option.length === 0 || option.length > 128) invalid(`field ${name} has an invalid option`)
        return option
      })
      if (new Set(labels).size !== labels.length) invalid(`field ${name} options must be distinct`)
      fields.push({ name, kind: 'enum', options: labels })
      form[name] = { enum: labels }
    } else if (entry.kind === 'integer') {
      const minimum = entry.minimum === undefined ? 0 : boundedInteger(entry.minimum, `${name}.minimum`, -1_000_000, 1_000_000)
      const maximum = entry.maximum === undefined ? 100 : boundedInteger(entry.maximum, `${name}.maximum`, -1_000_000, 1_000_000)
      if (minimum > maximum || maximum - minimum > 10_000) invalid(`field ${name} integer bounds are invalid`)
      fields.push({ name, kind: 'integer', minimum, maximum })
      form[name] = { type: 'integer', minimum, maximum }
    } else if (entry.kind === 'box') {
      const of = entry.of
      if (typeof of !== 'string' || of.length === 0) invalid(`field ${name} box needs an of reference`)
      const referenced = fields.find(field => field.name === of)
      if (referenced === undefined || referenced.kind !== 'enum') {
        invalid(`field ${name} box must reference an earlier enum field`)
      }
      fields.push({ name, kind: 'box', of })
      form[name] = { 'x-source': 'bbox', 'x-of': of }
    } else if (entry.kind === 'string') {
      const maxLength = entry.maxLength === undefined ? 40 : boundedInteger(entry.maxLength, `${name}.maxLength`, 1, MIRAGE_LIMITS.maxStringLength)
      fields.push({ name, kind: 'string', maxLength })
      form[name] = { type: 'string', maxLength }
    } else {
      invalid(`field ${name} kind must be enum, integer, string or box`)
    }
  }
  return { fields, form }
}

/** Wrap a validated form for the native describe call. */
export function extractOptions(form: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { form }
}

/** Read an object or null. */
function objectOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Read an array or an empty array. */
function arrayOf(value: unknown, max: number, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  if (value.length > max) throw new Error(`MIRAGE_ENGINE_OUTPUT: ${label} returned ${value.length} entries, over ${max}`)
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`MIRAGE_ENGINE_OUTPUT: ${label}[${index}] is not an object`)
    }
    return entry as Record<string, unknown>
  })
}

/** Read a string or null. */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** The normalized describe result. */
export interface MirageDescribeResult extends Record<string, unknown> {
  readonly scene: Record<string, unknown> | null
  readonly objects: readonly Record<string, unknown>[]
  readonly text: readonly Record<string, unknown>[]
  readonly relations: readonly Record<string, unknown>[]
  readonly reasoning: string | null
  readonly language: MirageLanguage
}

/** Normalize `mirage_describe` output without inventing fields. */
export function normalizeDescribe(parsed: unknown, language: MirageLanguage): MirageDescribeResult {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('MIRAGE_ENGINE_OUTPUT: the engine did not return a JSON object')
  }
  const root = parsed as Record<string, unknown>
  const pick = (source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const key of keys) if (source[key] !== undefined) out[key] = source[key]
    return out
  }
  const objects = arrayOf(root.objects, MIRAGE_LIMITS.maxObjects, 'objects').map(object => {
    const out = pick(object, ['id', 'name', 'bbox', 'score', 'position'])
    const description = objectOrNull(object.description)
    if (description !== null) out.description = pick(description, ['color', 'shape', 'material', 'pattern', 'text', 'size'])
    return out
  })
  const relations = arrayOf(root.relations, MIRAGE_LIMITS.maxObjects, 'relations').map(relation => pick(relation, ['subject', 'predicate', 'object']))
  const scene = objectOrNull(root.scene)
  return {
    scene: scene === null ? {} : pick(scene, ['setting', 'background', 'surface', 'lighting', 'weather', 'time_of_day', 'sky', 'style', 'position']),
    objects,
    text: arrayOf(root.text, MIRAGE_LIMITS.maxTextLines, 'text'),
    relations,
    reasoning: stringOrNull(root.reasoning),
    language,
  }
}

/** Normalize `mirage_detect` output and keep only the requested mask form. */
export function normalizeDetect(parsed: unknown, maskFormat: 'none' | 'bitmap' | 'polygons'): Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('MIRAGE_ENGINE_OUTPUT: the engine did not return a JSON object')
  }
  const objects = arrayOf((parsed as Record<string, unknown>).objects, MIRAGE_LIMITS.maxObjects, 'objects').map((object) => {
    const out: Record<string, unknown> = {
      id: object.id,
      name: object.name,
      bbox: object.bbox,
      score: object.score,
    }
    if (typeof object.position === 'string') out.position = object.position
    if (maskFormat !== 'none') out.mask = object.mask ?? null
    return out
  })
  return { objects, maskFormat }
}

/** Normalize `mirage_ocr` output: engine `string` becomes the tool field `text`. */
export function normalizeOcr(parsed: unknown): { readonly text: readonly Record<string, unknown>[] } {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('MIRAGE_ENGINE_OUTPUT: the engine did not return a JSON object')
  }
  const text = arrayOf((parsed as Record<string, unknown>).text, MIRAGE_LIMITS.maxTextLines, 'text').map((line) => {
    if (typeof line.string !== 'string') throw new Error('MIRAGE_ENGINE_OUTPUT: a text line has no string')
    return { text: line.string, bbox: line.bbox, score: line.score }
  })
  return { text }
}

/** Normalize the native form result; values, probabilities and "-" abstention are preserved. */
export function normalizeExtract(parsed: unknown, fieldOrder: readonly string[], language: MirageLanguage): Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('MIRAGE_ENGINE_OUTPUT: the engine did not return a JSON object')
  }
  const form = objectOrNull((parsed as Record<string, unknown>).form)
  if (form === null) throw new Error('MIRAGE_ENGINE_OUTPUT: the engine returned no form')
  const fields = fieldOrder.map((name) => {
    const entry = form[name]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return { name }
    const record = entry as Record<string, unknown>
    const probabilities = record.probabilities
    return {
      name,
      ...record.value === undefined ? {} : { value: record.value },
      ...probabilities === undefined || typeof probabilities !== 'object' || probabilities === null || Array.isArray(probabilities)
        ? {}
        : { probabilities: Object.entries(probabilities as Record<string, unknown>).map(([key, probability]) => ({ key, probability })) },
      ...typeof record.probability === 'number' ? { probability: record.probability } : {},
    }
  })
  return { fields, language }
}
