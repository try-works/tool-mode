/**
 * Skill contract: identity, size and conflict rules for one published skill.
 *
 * A tool schema says what the model *can* call; a skill says when the call is the right
 * move. This module is the part of that guidance that can be decided mechanically - a
 * content digest of the inputs the body was produced from, an honest token estimate, the
 * budget findings, and the cross-skill conflict rules C1-C9 of
 * docs/reuse-evidence-plan.md §9.5.
 *
 * Everything here is pure: no registry, no model call, no clock, no filesystem path. That
 * is deliberate. A rule that needs a model call is not a rule this module may carry, and a
 * digest that depends on where the package is installed cannot be compared across machines.
 *
 * @module @try-works/dsh-tool-mode/skill-contract
 */

import { createHash } from 'node:crypto'

/** Whether a skill covers one tool or a composition of several. */
export type SkillKind = 'tool' | 'flow'

/** The token budgets a skill set is held to. */
export interface SkillBudgets {
  /** Maximum estimated tokens for one skill. */
  readonly perSkill: number
  /** Maximum estimated tokens across every injected skill. */
  readonly aggregate: number
  /** Fraction of a cap at which a warning is reported before the cap is reached. */
  readonly warnAt: number
}

/** The shipping defaults: 1200 tokens per skill, 4000 composed. */
export const DEFAULT_SKILL_BUDGETS: SkillBudgets = Object.freeze({
  perSkill: 1200,
  aggregate: 4000,
  warnAt: 0.8,
})

/** One skill's size, as the budget check sees it. */
export interface SkillBudgetInput {
  readonly name: string
  readonly tokens: number
}

/** One budget finding, reported separately from the conflict rules. */
export interface SkillBudgetFinding {
  readonly kind: 'per-skill' | 'aggregate'
  readonly severity: 'error' | 'warn'
  readonly message: string
  readonly skills: readonly string[]
  readonly tokens: number
  readonly limit: number
}

/**
 * Whether the declared tools make this a tool skill or a flow skill.
 * @param requiresTools - the tools the skill declares it needs.
 * @returns 'flow' when two or more tools are declared, 'tool' otherwise.
 */
export function skillKindOf(requiresTools: readonly string[]): SkillKind {
  return requiresTools.length >= 2 ? 'flow' : 'tool'
}

/**
 * Estimate a skill body's token count from its UTF-8 size.
 *
 * The estimate is four bytes per token, rounded up. It is an estimate and every report says
 * so: billing the exact tokenizer count would need the target model's tokenizer, which a
 * provider-agnostic tool layer does not have.
 * @param body - the rendered skill body.
 * @returns the estimated token count, zero for an empty body.
 */
export function estimateSkillTokens(body: string): number {
  return Math.ceil(Buffer.byteLength(body, 'utf8') / 4)
}

/** The inputs a skill's identity is derived from. */
export interface SkillDigestInput {
  /** The renderer version, so a change in body shape changes the digest. */
  readonly rendererVersion: string
  /** The tool the skill is published with. */
  readonly toolName: string
  /** A digest of the inputs the body came from: playbook + catalog, or the SKILL.md bytes. */
  readonly sourceDigest: string
  /** The digest of the rendered body itself. */
  readonly bodyDigest: string
  /** The part of the declaration an author may edit. */
  readonly declaration: {
    readonly name: string
    readonly description: string
    readonly whenToUse?: string
  }
}

/**
 * Hash a skill's identity from the inputs that produced it.
 *
 * The fields are written in a fixed order, so property order is irrelevant, and every field
 * is length-prefixed so that two different declarations cannot serialize to the same
 * material. Editing any declaration field changes the digest, which is what stops evidence
 * from silently outliving the guidance it was measured against.
 * @param input - the digest inputs.
 * @returns the lowercase hex sha256 digest.
 */
export function skillDigest(input: SkillDigestInput): string {
  const parts = [
    'skill-contract-v1',
    field('renderer', input.rendererVersion),
    field('tool', input.toolName),
    field('source', input.sourceDigest),
    field('body', input.bodyDigest),
    field('name', input.declaration.name),
    field('description', input.declaration.description),
    field('whenToUse', input.declaration.whenToUse ?? ''),
  ]
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')
}

/**
 * Length-prefix one digest field so concatenation cannot be ambiguous.
 * @param name - the field name.
 * @param value - the field value.
 * @returns the encoded field.
 */
function field(name: string, value: string): string {
  return name + ':' + value.length + ':' + value
}

/**
 * Merge the configured and environment disabled-skill lists.
 *
 * Both sources are comma-tolerant, because an operator putting the list in a config
 * document and the same list in an environment variable should not have to format them
 * differently.
 * @param configured - entries from the plugin config, if any.
 * @param environment - the environment variable's raw value, if set.
 * @returns the disabled names, trimmed and de-duplicated.
 */
export function parseDisabledSkills(
  configured: readonly string[] | undefined,
  environment: string | undefined,
): ReadonlySet<string> {
  const disabled = new Set<string>()
  const add = (entry: string): void => {
    for (const piece of entry.split(',')) {
      const name = piece.trim()
      if (name.length > 0) disabled.add(name)
    }
  }
  for (const entry of configured ?? []) if (typeof entry === 'string') add(entry)
  if (environment !== undefined) add(environment)
  return disabled
}

/** The lint rules this module implements. */
export type SkillLintRule = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9'

/** One finding from the cross-skill lint. */
export interface SkillLintFinding {
  /** The rule number from the plan (§9.5). */
  readonly rule: SkillLintRule
  readonly severity: 'error' | 'warn' | 'comment'
  readonly message: string
  /** The skills the finding involves, by name. */
  readonly skills: readonly string[]
}

/** The structured view of one skill the lint reads. */
export interface SkillLintInput {
  /** Stable id, used to resolve a pairsWith reference to a skill. */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly kind: SkillKind
  readonly requiresTools: readonly string[]
  readonly whenToUse: readonly string[]
  readonly whenNotToUse: readonly string[]
  readonly pairsWith: readonly string[]
  readonly body: string
  /** The estimated token count, as produced by {@link estimateSkillTokens}. */
  readonly tokens: number
}

/** What the lint may consult beyond the skills themselves. */
export interface SkillLintOptions {
  /** Budgets to apply; defaults to {@link DEFAULT_SKILL_BUDGETS}. */
  readonly budgets?: SkillBudgets
  /** Every tool the platform registers, so a body can be checked for undeclared mentions. */
  readonly toolNames?: readonly string[]
  /** Tools this platform cannot run, so a skill may warn instead of promising them. */
  readonly unavailableTools?: readonly string[]
  /**
   * A similarity function for C8. C8 is COMMENT-only and never fails a build: a cosine
   * score routes a skill to a human, it does not decide anything.
   */
  readonly similarity?: (left: string, right: string) => number
  /** The C8 threshold; defaults to 0.86. */
  readonly similarityThreshold?: number
}

/**
 * Check one skill set against its size budgets.
 *
 * Per-skill overflow is an error naming the skill; aggregate overflow is an error naming the
 * composing skills and their sizes, because "over budget" without the breakdown cannot be
 * acted on. A skill is never silently truncated.
 * @param skills - the skills and their estimated sizes.
 * @param budgets - the caps; defaults to {@link DEFAULT_SKILL_BUDGETS}.
 * @returns the findings, empty when everything fits.
 */
export function checkSkillBudgets(
  skills: readonly SkillBudgetInput[],
  budgets: SkillBudgets = DEFAULT_SKILL_BUDGETS,
): readonly SkillBudgetFinding[] {
  const findings: SkillBudgetFinding[] = []
  for (const skill of skills) {
    if (skill.tokens > budgets.perSkill) {
      findings.push({
        kind: 'per-skill',
        severity: 'error',
        message: 'skill ' + skill.name + ' is ' + skill.tokens + ' tokens, over its '
          + budgets.perSkill + '-token budget',
        skills: [skill.name],
        tokens: skill.tokens,
        limit: budgets.perSkill,
      })
    } else if (skill.tokens >= budgets.perSkill * budgets.warnAt) {
      findings.push({
        kind: 'per-skill',
        severity: 'warn',
        message: 'skill ' + skill.name + ' is ' + skill.tokens + ' tokens, near its '
          + budgets.perSkill + '-token budget',
        skills: [skill.name],
        tokens: skill.tokens,
        limit: budgets.perSkill,
      })
    }
  }
  const total = skills.reduce((sum, skill) => sum + skill.tokens, 0)
  if (total > budgets.aggregate) {
    const composing = [...skills].sort((left, right) => right.tokens - left.tokens)
    findings.push({
      kind: 'aggregate',
      severity: 'error',
      message: 'composed skills are ' + total + ' tokens, over the ' + budgets.aggregate
        + '-token aggregate budget: '
        + composing.map(skill => skill.name + ' (' + skill.tokens + ' tokens)').join(', '),
      skills: composing.map(skill => skill.name),
      tokens: total,
      limit: budgets.aggregate,
    })
  }
  return findings
}

/** Whether one character can be part of a tool name. */
function wordChar(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character)
}

/** A whole-word tool-name check, so beta_tool never matches inside beta_toolbox. */
function mentions(text: string, name: string): boolean {
  let index = text.indexOf(name)
  while (index !== -1) {
    const before = index === 0 ? undefined : text[index - 1]
    const after = text[index + name.length]
    if (!wordChar(before) && !wordChar(after)) return true
    index = text.indexOf(name, index + 1)
  }
  return false
}

/** Normalize one trigger line so casing, spacing and bullet punctuation do not hide a clash. */
function normalizeTrigger(line: string): string {
  return line.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^[-*]\s+/, '').replace(/[.\u3002]+$/, '')
}

const RETRY_DIRECTIVE = /\bretry (?:once|the same|with the fixed|with the corrected|with a changed)\b/
const NO_RETRY_DIRECTIVE = /\b(?:do not|never|don't) retry\b/

/** Every structured field and the body, joined for the directive rules. */
function skillText(skill: SkillLintInput): string {
  return [...skill.whenToUse, ...skill.whenNotToUse, skill.body].join('\n').toLowerCase()
}

/**
 * Walk pairsWith as a graph over skill names and return the first cycle, if any.
 * @param skills - the structured skills.
 * @param byName - resolution from a name or id to a skill.
 * @returns the names on the cycle, empty when the graph is acyclic.
 */
function findPairCycle(
  skills: readonly SkillLintInput[],
  byName: ReadonlyMap<string, SkillLintInput>,
): readonly string[] {
  const edges = new Map<string, string>()
  for (const skill of skills) {
    for (const target of skill.pairsWith) {
      const resolved = byName.get(target)
      if (resolved !== undefined) {
        edges.set(skill.name, resolved.name)
        break
      }
    }
  }
  const visited = new Set<string>()
  for (const skill of skills) {
    const path: string[] = []
    const seen = new Set<string>()
    let cursor: string | undefined = skill.name
    while (cursor !== undefined) {
      if (seen.has(cursor)) return [...path, cursor]
      if (visited.has(cursor)) break
      seen.add(cursor)
      path.push(cursor)
      cursor = edges.get(cursor)
    }
    for (const name of seen) visited.add(name)
  }
  return []
}

/**
 * Run the cross-skill conflict rules.
 *
 * The rules are lexical by construction: whole-word tool names in structured fields, not
 * semantics. That is on purpose - the build must be able to fail on something an author can
 * see and fix. C8 is the one semantic rule; it is COMMENT-only and runs only when a
 * similarity function is supplied.
 * @param skills - the structured view of every published skill.
 * @param options - budgets, known tool names, unavailable tools and the C8 hook.
 * @returns the findings, empty when the set is consistent.
 */
export function lintSkills(
  skills: readonly SkillLintInput[],
  options: SkillLintOptions = {},
): readonly SkillLintFinding[] {
  const findings: SkillLintFinding[] = []
  const budgets = options.budgets ?? DEFAULT_SKILL_BUDGETS
  const known = new Set<string>(options.toolNames ?? [])
  for (const skill of skills) for (const tool of skill.requiresTools) known.add(tool)

  const byName = new Map<string, SkillLintInput>()
  for (const skill of skills) {
    byName.set(skill.name, skill)
    byName.set(skill.id, skill)
  }

  // C1 - one skill forbids a tool another recommends.
  for (let left = 0; left < skills.length; left += 1) {
    for (let right = left + 1; right < skills.length; right += 1) {
      const a = skills[left] as SkillLintInput
      const b = skills[right] as SkillLintInput
      for (const tool of known) {
        const conflicts = (mentions(a.whenNotToUse.join(' '), tool) && mentions(b.whenToUse.join(' '), tool))
          || (mentions(b.whenNotToUse.join(' '), tool) && mentions(a.whenToUse.join(' '), tool))
        if (conflicts) {
          findings.push({
            rule: 'C1',
            severity: 'error',
            message: a.name + ' and ' + b.name + ' disagree about ' + tool
              + ': one forbids it, the other recommends it',
            skills: [a.name, b.name],
          })
        }
      }
    }
  }

  // C2 - two skills claim the same trigger.
  const owners = new Map<string, string[]>()
  for (const skill of skills) {
    const seen = new Set<string>()
    for (const line of skill.whenToUse) {
      const key = normalizeTrigger(line)
      if (key.length === 0 || seen.has(key)) continue
      seen.add(key)
      const list = owners.get(key) ?? []
      list.push(skill.name)
      owners.set(key, list)
    }
  }
  for (const [line, names] of owners) {
    if (names.length > 1) {
      findings.push({
        rule: 'C2',
        severity: 'error',
        message: names.join(', ') + ' claim the same trigger: "' + line + '"',
        skills: names,
      })
    }
  }

  // C3 - contradictory recovery advice across skills.
  const retry = skills.filter(skill => RETRY_DIRECTIVE.test(skillText(skill))).map(skill => skill.name)
  const noRetry = skills.filter(skill => NO_RETRY_DIRECTIVE.test(skillText(skill))).map(skill => skill.name)
  if (retry.length > 0 && noRetry.length > 0) {
    findings.push({
      rule: 'C3',
      severity: 'error',
      message: retry.join(', ') + ' advise a retry while ' + noRetry.join(', ') + ' forbid it',
      skills: [...retry, ...noRetry],
    })
  }

  // C4 - a pair reference that resolves to nothing, or a cycle.
  for (const skill of skills) {
    for (const target of skill.pairsWith) {
      if (!known.has(target) && !byName.has(target)) {
        findings.push({
          rule: 'C4',
          severity: 'error',
          message: skill.name + ' pairs with "' + target + '", which is neither a tool nor a skill',
          skills: [skill.name],
        })
      }
    }
  }
  const cycle = findPairCycle(skills, byName)
  if (cycle.length > 0) {
    findings.push({
      rule: 'C4',
      severity: 'warn',
      message: 'pairsWith cycle: ' + cycle.join(' -> '),
      skills: cycle,
    })
  }

  // C5 - the body mentions a tool the skill does not declare.
  for (const skill of skills) {
    for (const tool of known) {
      if (skill.requiresTools.includes(tool)) continue
      if (mentions(skill.body, tool)) {
        findings.push({
          rule: 'C5',
          severity: 'warn',
          message: skill.name + ' mentions ' + tool + ' but does not declare it in requiresTools',
          skills: [skill.name],
        })
      }
    }
  }

  // C6 - budgets.
  for (const finding of checkSkillBudgets(
    skills.map(skill => ({ name: skill.name, tokens: skill.tokens })),
    budgets,
  )) {
    findings.push({ rule: 'C6', severity: finding.severity, message: finding.message, skills: finding.skills })
  }

  // C7 - a flow skill that declares tools its guidance never mentions.
  for (const skill of skills) {
    if (skill.kind !== 'flow') continue
    const text = skillText(skill)
    const mentioned = skill.requiresTools.filter(tool => mentions(text, tool))
    if (mentioned.length < 2) {
      findings.push({
        rule: 'C7',
        severity: 'warn',
        message: skill.name + ' declares ' + skill.requiresTools.length
          + ' tools but its guidance mentions ' + mentioned.length,
        skills: [skill.name],
      })
    }
  }

  // C8 - near-duplicate triggers, advisory only.
  const similarity = options.similarity
  if (similarity !== undefined) {
    const threshold = options.similarityThreshold ?? 0.86
    for (let left = 0; left < skills.length; left += 1) {
      for (let right = left + 1; right < skills.length; right += 1) {
        const a = skills[left] as SkillLintInput
        const b = skills[right] as SkillLintInput
        let near = false
        for (const lineA of a.whenToUse) {
          for (const lineB of b.whenToUse) {
            if (similarity(lineA, lineB) >= threshold) near = true
          }
        }
        if (near) {
          findings.push({
            rule: 'C8',
            severity: 'comment',
            message: a.name + ' and ' + b.name + ' have near-duplicate triggers; route to a reviewer',
            skills: [a.name, b.name],
          })
        }
      }
    }
  }

  // C9 - a declared tool this platform cannot run.
  const unavailable = new Set(options.unavailableTools ?? [])
  for (const skill of skills) {
    for (const tool of skill.requiresTools) {
      if (unavailable.has(tool)) {
        findings.push({
          rule: 'C9',
          severity: 'warn',
          message: skill.name + ' declares ' + tool + ', which this platform cannot run',
          skills: [skill.name],
        })
      }
    }
  }

  return findings
}
