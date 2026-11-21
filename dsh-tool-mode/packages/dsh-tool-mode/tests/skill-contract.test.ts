/**
 * The skill contract: identity (digest), size (budgets) and conflict rules (C1-C9).
 *
 * These are the pure functions Phase 3 of docs/reuse-evidence-plan.md depends on. They
 * are tested here without a mounted plugin, because each one must be decidable from the
 * declaration and the rendered body alone: a rule that needs a model call is not a rule
 * this module may carry.
 *
 * @module tests/skill-contract
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_SKILL_BUDGETS,
  checkSkillBudgets,
  estimateSkillTokens,
  lintSkills,
  parseDisabledSkills,
  skillDigest,
  skillKindOf,
  type SkillLintInput,
} from '../src/skill-contract.ts'

/** A structural skill used by the lint tests; overridden per case. */
function skill(overrides: Partial<SkillLintInput> = {}): SkillLintInput {
  return {
    id: 'fixture/' + (overrides.name ?? 'alpha'),
    name: 'alpha',
    description: 'Alpha guidance.',
    kind: 'tool',
    requiresTools: ['alpha_tool'],
    whenToUse: ['call alpha_tool when you need an alpha'],
    whenNotToUse: ['do not use alpha_tool for beta'],
    pairsWith: [],
    body: 'Call alpha_tool. It returns an alpha.',
    tokens: 40,
    ...overrides,
  }
}

describe('skill kind', () => {
  it('is a tool skill when it declares no tool or exactly one', () => {
    assert.equal(skillKindOf([]), 'tool')
    assert.equal(skillKindOf(['alpha_tool']), 'tool')
  })

  it('is a flow skill when it declares two or more tools', () => {
    assert.equal(skillKindOf(['alpha_tool', 'beta_tool']), 'flow')
  })
})

describe('token estimate', () => {
  it('is zero for an empty body', () => {
    assert.equal(estimateSkillTokens(''), 0)
  })

  it('rounds up from bytes rather than characters', () => {
    assert.equal(estimateSkillTokens('abcd'), 1)
    assert.equal(estimateSkillTokens('abcde'), 2)
    // Four-byte characters count as their UTF-8 size, not their code-point count.
    assert.equal(estimateSkillTokens('\u{1F600}'), 1)
    assert.equal(estimateSkillTokens('\u{1F600}\u{1F600}'), 2)
  })
})

describe('skill digest', () => {
  const input = {
    rendererVersion: 'render-1',
    toolName: 'lang_detect',
    sourceDigest: 'sha256:source',
    declaration: { name: 'alpha', description: 'Alpha guidance.', whenToUse: 'call it' },
    bodyDigest: 'sha256:body',
  }

  it('is stable for the same inputs', () => {
    assert.equal(skillDigest(input), skillDigest(input))
  })

  it('is insensitive to property order', () => {
    const reordered = {
      bodyDigest: input.bodyDigest,
      declaration: { whenToUse: input.declaration.whenToUse, description: input.declaration.description, name: input.declaration.name },
      sourceDigest: input.sourceDigest,
      toolName: input.toolName,
      rendererVersion: input.rendererVersion,
    }
    assert.equal(skillDigest(input), skillDigest(reordered))
  })

  it('changes when the body or any declaration field changes', () => {
    assert.notEqual(skillDigest(input), skillDigest({ ...input, bodyDigest: 'sha256:other' }))
    assert.notEqual(
      skillDigest(input),
      skillDigest({ ...input, declaration: { ...input.declaration, whenToUse: 'call it differently' } }),
    )
    assert.notEqual(skillDigest(input), skillDigest({ ...input, rendererVersion: 'render-2' }))
    assert.notEqual(skillDigest(input), skillDigest({ ...input, sourceDigest: 'sha256:other-source' }))
  })
})

describe('skill budgets', () => {
  it('passes when every skill and the aggregate are within budget', () => {
    assert.deepEqual(checkSkillBudgets([{ name: 'a', tokens: 100 }], { perSkill: 200, aggregate: 1000, warnAt: 0.8 }), [])
  })

  it('refuses an over-budget skill by name', () => {
    const findings = checkSkillBudgets([{ name: 'a', tokens: 300 }], { perSkill: 200, aggregate: 1000, warnAt: 0.8 })
    assert.equal(findings.length, 1)
    assert.equal(findings[0]?.kind, 'per-skill')
    assert.equal(findings[0]?.severity, 'error')
    assert.match(findings[0]?.message ?? '', /a/)
    assert.equal(findings[0]?.tokens, 300)
  })

  it('names the composing skills when the aggregate is over budget', () => {
    const findings = checkSkillBudgets(
      [{ name: 'big', tokens: 400 }, { name: 'small', tokens: 200 }],
      { perSkill: 1000, aggregate: 500, warnAt: 0.8 },
    )
    assert.equal(findings.length, 1)
    assert.equal(findings[0]?.kind, 'aggregate')
    assert.deepEqual(findings[0]?.skills, ['big', 'small'])
    assert.match(findings[0]?.message ?? '', /big \(400/)
  })

  it('warns before the cap rather than only at it', () => {
    const findings = checkSkillBudgets([{ name: 'a', tokens: 170 }], { perSkill: 200, aggregate: 1000, warnAt: 0.8 })
    assert.equal(findings.length, 1)
    assert.equal(findings[0]?.severity, 'warn')
  })

  it('ships a default budget', () => {
    assert.equal(DEFAULT_SKILL_BUDGETS.perSkill, 1200)
    assert.equal(DEFAULT_SKILL_BUDGETS.aggregate, 4000)
  })
})

describe('disabled skills', () => {
  it('is empty when neither the config nor the environment names one', () => {
    assert.equal(parseDisabledSkills(undefined, undefined).size, 0)
    assert.equal(parseDisabledSkills([], '').size, 0)
  })

  it('merges the config list and the environment list', () => {
    const disabled = parseDisabledSkills(['a'], 'b, c ,,')
    assert.deepEqual([...disabled].sort(), ['a', 'b', 'c'])
  })

  it('ignores surrounding whitespace and empty entries', () => {
    assert.deepEqual([...parseDisabledSkills(['  a  ,b'], undefined)], ['a', 'b'])
    assert.deepEqual([...parseDisabledSkills(undefined, '   ')], [])
  })
})

describe('conflict lint', () => {
  it('C1 flags a tool that one skill forbids and another recommends', () => {
    const findings = lintSkills([
      skill({ name: 'alpha', whenToUse: ['call alpha_tool'], whenNotToUse: ['do not call beta_tool'] }),
      skill({
        name: 'beta',
        requiresTools: ['beta_tool'],
        whenToUse: ['call beta_tool for beta work'],
        whenNotToUse: [],
      }),
    ])
    const c1 = findings.filter(finding => finding.rule === 'C1')
    assert.equal(c1.length, 1)
    assert.equal(c1[0]?.severity, 'error')
    assert.deepEqual([...(c1[0]?.skills ?? [])].sort(), ['alpha', 'beta'])
  })

  it('C1 does not fire on the same skill contradicting only itself', () => {
    const findings = lintSkills([
      skill({ whenToUse: ['call alpha_tool'], whenNotToUse: ['do not call alpha_tool in beta'] }),
    ])
    assert.equal(findings.filter(finding => finding.rule === 'C1').length, 0)
  })

  it('C2 flags a duplicated trigger line across skills', () => {
    const line = 'Call alpha_tool when the input is a short message.'
    const findings = lintSkills([
      skill({ name: 'alpha', whenToUse: [line] }),
      skill({ name: 'beta', whenToUse: ['  call ALPHA_TOOL when the input is a short message  '] }),
    ])
    const c2 = findings.filter(finding => finding.rule === 'C2')
    assert.equal(c2.length, 1)
    assert.equal(c2[0]?.severity, 'error')
  })

  it('C3 flags contradictory recovery advice', () => {
    const findings = lintSkills([
      skill({ name: 'alpha', body: 'On a validation error, retry once with the fixed argument.' }),
      skill({ name: 'beta', body: 'On a validation error, do not retry the same call.' }),
    ])
    const c3 = findings.filter(finding => finding.rule === 'C3')
    assert.equal(c3.length, 1)
    assert.equal(c3[0]?.severity, 'error')
  })

  it('C4 flags an unknown pair and a cycle', () => {
    const unknown = lintSkills([skill({ pairsWith: ['gamma_tool'] })])
    assert.equal(unknown.filter(finding => finding.rule === 'C4' && finding.severity === 'error').length, 1)

    const cycle = lintSkills([
      skill({ name: 'alpha', pairsWith: ['beta'] }),
      skill({ name: 'beta', id: 'fixture/beta', pairsWith: ['alpha'] }),
    ])
    assert.equal(cycle.filter(finding => finding.rule === 'C4' && finding.severity === 'warn').length, 1)
  })

  it('C5 flags a tool the body mentions but the skill does not declare', () => {
    const findings = lintSkills([
      skill({ requiresTools: ['alpha_tool'], body: 'Call alpha_tool, then pass the result to beta_tool.' }),
    ], { toolNames: ['alpha_tool', 'beta_tool'] })
    const c5 = findings.filter(finding => finding.rule === 'C5')
    assert.equal(c5.length, 1)
    assert.equal(c5[0]?.severity, 'warn')
  })

  it('C6 refuses a skill over its budget', () => {
    // Isolate the per-skill rule: a 5000-token skill would also breach the aggregate cap.
    const findings = lintSkills([skill({ tokens: 5000 })], {
      budgets: { perSkill: 1200, aggregate: 10_000, warnAt: 0.8 },
    })
    assert.equal(findings.filter(finding => finding.rule === 'C6' && finding.severity === 'error').length, 1)
  })

  it('C7 warns when a flow skill declares tools its guidance never mentions', () => {
    const findings = lintSkills([
      skill({
        kind: 'flow',
        requiresTools: ['alpha_tool', 'beta_tool'],
        whenToUse: ['use this for alpha'],
        body: 'Call alpha_tool.',
      }),
    ])
    const c7 = findings.filter(finding => finding.rule === 'C7')
    assert.equal(c7.length, 1)
    assert.equal(c7[0]?.severity, 'warn')
  })

  it('C8 reports near-duplicate triggers only when a similarity function is supplied', () => {
    const skills = [skill({ name: 'alpha' }), skill({ name: 'beta', id: 'fixture/beta' })]
    assert.equal(lintSkills(skills).filter(finding => finding.rule === 'C8').length, 0)

    const findings = lintSkills(skills, { similarity: () => 0.99, similarityThreshold: 0.9 })
    const c8 = findings.filter(finding => finding.rule === 'C8')
    assert.equal(c8.length, 1)
    assert.equal(c8[0]?.severity, 'comment')
  })

  it('C9 warns about a tool the platform cannot run', () => {
    const findings = lintSkills([skill()], { unavailableTools: ['alpha_tool'] })
    const c9 = findings.filter(finding => finding.rule === 'C9')
    assert.equal(c9.length, 1)
    assert.equal(c9[0]?.severity, 'warn')
  })

  it('is clean for a well-formed tool skill', () => {
    assert.deepEqual(lintSkills([skill()], { toolNames: ['alpha_tool', 'beta_tool'] }), [])
  })
})
