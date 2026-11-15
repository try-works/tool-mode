/**
 * P6: the embedding/ranking family must be distinguishable from its descriptions
 * alone, without changing the contracts package.
 *
 * The reviewed table lives in src/tool-description.ts; these tests pin that it
 * covers every family member, that each member names at least one sibling to
 * prefer instead, that the cues actually reach the composed description, and
 * that the P1 character budget still holds.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'
import {
  CONTRACT_DISAMBIGUATION,
  EXTENSION_TOOL_DISAMBIGUATION,
  TOOL_DESCRIPTION_MAX_CHARS,
  contractToolDescription,
  extensionToolDescription,
} from '../src/tool-description.ts'

const DOCS = join(process.cwd(), 'packages', 'dsh-tool-mode', 'docs', 'audit', 'tool-description-families.md')

/** The family the plan names, in the REAL contract tool names. */
const FAMILY = ['text_embed', 'text_rerank', 'text_title', 'describe_image', 'multimodal_embed',
  'semantic_similarity', 'semantic_rank', 'semantic_classify', 'semantic_deduplicate',
  'media_find_moments', 'decision_choose', 'decision_test', 'decision_score', 'tools_plan'] as const

/** The extension-tool family, composed by extensionToolDescription from its table. */
const EXTENSION_FAMILY = ['dedupe_and_rank'] as const

/** The manifest description of an extension tool, read from its shipped package. */
function extensionManifestDescription(toolName: string): string {
  const manifestPath = join(process.cwd(), 'packages', 'extension-embeddinggemma', 'tool-mode.extension.json')
  // SAFETY: the shipped extension manifest is repository JSON; only a tool description is read.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { tools?: readonly { name: string; description: string }[] }
  const tool = manifest.tools?.find(candidate => candidate.name === toolName)
  assert.ok(tool !== undefined, 'missing extension tool ' + toolName)
  return tool.description
}

/** One reviewed guidance row. */
interface ContractGuidance {
  readonly whenToUse: readonly string[]
  readonly whenNotToUse: readonly string[]
}

/** The table entry for one tool, asserted present. */
function guidanceFor(toolName: string): ContractGuidance {
  const entry = CONTRACT_DISAMBIGUATION[toolName]
  assert.ok(entry !== undefined, 'missing disambiguation for ' + toolName)
  return entry
}

/** The standard contract with this tool name, asserted present. */
function contractFor(toolName: string) {
  const contract = STANDARD_CONTRACTS.find(candidate => candidate.toolName === toolName)
  assert.ok(contract !== undefined, 'missing standard contract ' + toolName)
  return contract
}

/** The siblings a guidance row names (other family tool names). */
function siblingsIn(text: string): string[] {
  return FAMILY.filter(name => name !== text && new RegExp('\\b' + name + '\\b').test(text))
}

describe('P6 — the family table', () => {
  it('covers every family member with a key that is a real contract tool name', () => {
    const contractNames = new Set(STANDARD_CONTRACTS.map(contract => contract.toolName))
    for (const name of Object.keys(CONTRACT_DISAMBIGUATION)) {
      assert.ok(contractNames.has(name), name + ' is not a registered contract tool name')
    }
    for (const name of FAMILY) guidanceFor(name)
    for (const name of EXTENSION_FAMILY) {
      assert.ok(EXTENSION_TOOL_DISAMBIGUATION[name] !== undefined, 'missing extension guidance for ' + name)
    }
    // The plan's draft names differ from the registered contract names: text_title is the
    // real tool, and extract_fields has no standard contract yet (closed-beta Schemer), so
    // it cannot be a live description.
    assert.equal('suggest_title' in CONTRACT_DISAMBIGUATION, false)
    assert.equal('extract_fields' in CONTRACT_DISAMBIGUATION, false)
  })

  it('gives every member a when-to-use cue and names at least one sibling to prefer', () => {
    for (const name of FAMILY) {
      const guidance = guidanceFor(name)
      assert.ok(guidance.whenToUse.length > 0, name + ' must say when to use it')
      const siblings = siblingsIn(guidance.whenNotToUse.join(' '))
      assert.ok(siblings.length > 0, name + ' must name a sibling in when-not-to-use')
    }
  })

  it('preserves EVERY decision bullet: the decision-first budget drops lower sections first', () => {
    for (const name of FAMILY) {
      const guidance = guidanceFor(name)
      const composed = contractToolDescription(contractFor(name))
      for (const bullet of guidance.whenToUse) {
        assert.ok(composed.includes(bullet), name + ' lost when-to-use bullet: ' + bullet)
      }
      for (const bullet of guidance.whenNotToUse) {
        assert.ok(composed.includes(bullet), name + ' lost when-not-to-use bullet: ' + bullet)
      }
      assert.ok(composed.length <= TOOL_DESCRIPTION_MAX_CHARS)
    }
    const image = contractToolDescription(contractFor('describe_image'))
    assert.ok(
      image.includes('No OCR contract exists; this is image description, not transcription.'),
      'the no-OCR caveat must reach the model: ' + image,
    )
  })

  it('reaches the composed description: the cue and a sibling name survive the budget', () => {
    for (const name of FAMILY) {
      const guidance = guidanceFor(name)
      const composed = contractToolDescription(contractFor(name))
      assert.ok(composed.includes('When to use:'), name + ' must compose a when-to-use section')
      const cue = guidance.whenToUse[0] ?? ''
      assert.ok(composed.includes(cue.slice(0, 24)), name + ' cue is missing from: ' + composed)
      const siblings = siblingsIn(guidance.whenNotToUse.join(' '))
      assert.ok(siblings.some(sibling => composed.includes(sibling)), name + ' must name a sibling in the composed text')
      assert.ok(composed.length <= TOOL_DESCRIPTION_MAX_CHARS, name + ' is ' + composed.length + ' characters')
    }
  })

  it('keeps the family mutually distinguishable: every cue is unique', () => {
    const cues = FAMILY.map(name => guidanceFor(name).whenToUse.join(' '))
    assert.equal(new Set(cues).size, FAMILY.length)
    const composed = FAMILY.map(name => contractToolDescription(contractFor(name)))
    assert.equal(new Set(composed).size, FAMILY.length)
    // text_embed produces vectors; multimodal_embed takes media; the semantic_* tools
    // decide over inputs. Their cues must not read as the same operation.
    assert.ok(guidanceFor('text_embed').whenToUse.join(' ').includes('vector'))
    assert.ok(guidanceFor('multimodal_embed').whenToUse.join(' ').includes('image'))
    assert.ok(guidanceFor('semantic_rank').whenToUse.join(' ').includes('order'))
  })

  it('keeps the reviewed comparison table in the docs', () => {
    const docs = readFileSync(DOCS, 'utf8')
    for (const name of FAMILY) {
      assert.ok(docs.includes(name), 'docs table must list ' + name)
    }
    for (const name of EXTENSION_FAMILY) {
      assert.ok(docs.includes(name), 'docs table must list the extension tool ' + name)
    }
  })

  it('applies the extension-tool table through extensionToolDescription when the caller passes the name', () => {
    const name = 'dedupe_and_rank'
    const guidance = EXTENSION_TOOL_DISAMBIGUATION[name]
    assert.ok(guidance !== undefined)
    const composed = extensionToolDescription({
      toolName: name,
      description: extensionManifestDescription(name),
      fallback: 'Provided by @try-works/extension-embeddinggemma.',
    })
    for (const bullet of guidance.whenToUse) {
      assert.ok(composed.includes(bullet), 'lost extension when-to-use bullet: ' + bullet)
    }
    for (const bullet of guidance.whenNotToUse) {
      assert.ok(composed.includes(bullet), 'lost extension when-not-to-use bullet: ' + bullet)
    }
    assert.ok(composed.includes('semantic_deduplicate') && composed.includes('semantic_rank'))
    assert.ok(composed.length <= TOOL_DESCRIPTION_MAX_CHARS, 'length ' + composed.length)
    // Without the name the table cannot apply; the manifest text remains the purpose.
    const unnamed = extensionToolDescription({
      description: extensionManifestDescription(name),
      fallback: 'Provided by @try-works/extension-embeddinggemma.',
    })
    assert.equal(unnamed.includes('Use semantic_deduplicate'), false)
    assert.ok(unnamed.length <= TOOL_DESCRIPTION_MAX_CHARS)
  })
})
