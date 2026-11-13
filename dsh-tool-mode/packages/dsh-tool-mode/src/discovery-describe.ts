/**
 * DECL-07 describe helpers: turn a tool's selected JSON schemas into the TypeScript
 * bindings, examples and skill instructions a tool-only MCP client can consume.
 *
 * The helpers are deliberately small and schema-driven: the described tool's own
 * schemas are the source, so a changed schema changes the binding and example rather
 * than leaving hand-written prose to drift.
 */

/** Convert a JSON-schema type to a TypeScript type expression. */
function schemaType(schema: unknown): string {
  if (schema === null || typeof schema !== 'object') return 'unknown'
  const value = schema as Record<string, unknown>
  if (Array.isArray(value.enum) && value.enum.length > 0) {
    return value.enum.map(entry => JSON.stringify(entry)).join(' | ')
  }
  if (value.const !== undefined) return JSON.stringify(value.const)
  const type = value.type
  if (Array.isArray(type)) return type.map(single => schemaType({ ...value, type: single })).join(' | ')
  switch (type) {
    case 'string': return 'string'
    case 'integer':
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'null': return 'null'
    case 'array': return `Array<${schemaType(value.items)}>`
    case 'object': {
      const properties = value.properties
      if (properties === null || typeof properties !== 'object') return 'Record<string, unknown>'
      const required = new Set(Array.isArray(value.required) ? value.required as string[] : [])
      const fields = Object.entries(properties as Record<string, unknown>)
        .map(([key, property]) => `${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${schemaType(property)}`)
      return fields.length === 0 ? 'Record<string, never>' : `{ ${fields.join('; ')} }`
    }
    default: return 'unknown'
  }
}

/** Pascal-case a tool name for an interface identifier. */
function pascalCase(name: string): string {
  return name.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map(part => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join('') || 'Tool'
}

/**
 * Render TypeScript bindings for one schema.
 * @param name - the tool name.
 * @param suffix - `Input` or `Output`.
 * @param schema - the selected JSON schema.
 * @returns an exported interface/type declaration.
 */
export function typescriptBindings(name: string, suffix: 'Input' | 'Output', schema: unknown): string {
  const identifier = `${pascalCase(name)}${suffix}`
  if (schema === null || typeof schema !== 'object' || (schema as Record<string, unknown>).type !== 'object') {
    return `export type ${identifier} = ${schemaType(schema)}`
  }
  return `export interface ${identifier} ${schemaType(schema)}`
}

/** Build one example value from a JSON schema (required and optional fields included). */
export function exampleFromSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') return null
  const value = schema as Record<string, unknown>
  if (Array.isArray(value.enum) && value.enum.length > 0) return value.enum[0]
  if (value.const !== undefined) return value.const
  switch (value.type) {
    case 'object': {
      const properties = value.properties
      if (properties === null || typeof properties !== 'object') return {}
      return Object.fromEntries(
        Object.entries(properties as Record<string, unknown>).map(([key, property]) => [key, exampleFromSchema(property)]),
      )
    }
    case 'array': return [exampleFromSchema(value.items)]
    case 'string': return 'example'
    case 'integer':
    case 'number': return 1
    case 'boolean': return true
    default: return null
  }
}

/** The skill facts a model-backed tool advertises (DECL-07). */
export interface DescribeSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse: string
}

/**
 * Project a catalog skill declaration into the describe payload.
 * @param skill - the declaration, if the tool has one.
 * @returns the skill facts, or undefined.
 */
export function describeSkill(skill: {
  readonly name?: unknown
  readonly description?: unknown
  readonly whenToUse?: unknown
} | undefined): DescribeSkill | undefined {
  if (skill === undefined || typeof skill.name !== 'string' || skill.name.length === 0) return undefined
  return {
    name: skill.name,
    description: typeof skill.description === 'string' ? skill.description : '',
    whenToUse: typeof skill.whenToUse === 'string' ? skill.whenToUse : '',
  }
}
