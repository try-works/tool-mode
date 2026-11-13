/** EXT-36 — the shipped author kit is consumable and its test host works. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'
import { parseRecipe } from '@try-works/tool-mode-recipes'
import { discoverExtension } from '@try-works/tool-mode-extension-sdk'

import { createAuthorTestHost, createScriptedHarnessBroker, createToolSchemaSnapshot } from '../../../author-kit/test-host.mjs'

const KIT = resolve(process.cwd(), 'author-kit')
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

test('the kit bundles the exact manifest and recipe schemas it claims', () => {
  assert.equal(
    sha256(join(KIT, 'schemas', 'extension-manifest.schema.json')),
    sha256(join(process.cwd(), 'packages', 'tool-mode-extension-sdk', 'schema', 'extension-manifest-1.1.0.schema.json')),
  )
  assert.equal(
    sha256(join(KIT, 'schemas', 'harness-model-recipe.schema.json')),
    sha256(join(process.cwd(), 'packages', 'tool-mode-recipes', 'schema', 'harness-model-recipe.schema.json')),
  )
})

test('both templates are valid extensions and the module template activates', async () => {
  const moduleDir = join(KIT, 'templates', 'module')
  const moduleDiscovery = discoverExtension(moduleDir)
  assert.equal(moduleDiscovery.manifest.execution.kind, 'module')
  const declarativeDir = join(KIT, 'templates', 'declarative')
  const declarativeDiscovery = discoverExtension(declarativeDir)
  assert.equal(declarativeDiscovery.manifest.execution.kind, 'declarative')

  const host = await createAuthorTestHost({ entryPath: join(moduleDir, 'index.mjs') })
  const provider = await host.instance.createProvider({ modelId: 'demo', configuration: {} }) as {
    invoke(request: unknown): Promise<unknown>
    dispose?(): Promise<void>
  }
  const result = await provider.invoke({
    implementationId: 'demo',
    input: { hello: 'author' },
    context: { signal: new AbortController().signal },
  }) as { echo?: { hello?: string } }
  assert.equal(result.echo?.hello, 'author')
  await provider.dispose?.()
  await host.dispose()
})

test('the declarative template parses and runs through the scripted fake harness broker', async () => {
  const recipe = JSON.parse(readFileSync(join(KIT, 'templates', 'declarative', 'recipes', 'text-title.json'), 'utf8'))
  const parsed = parseRecipe(recipe)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const { broker, provider, journal } = createScriptedHarnessBroker()
  broker.authorize('text_title', provider)
  const outcome = await broker.run(parsed.recipe, { text: 'Author kit test', kind: 'section' })
  assert.equal(outcome.kind, 'completed')
  assert.equal(journal.length, 1)
})

test('the planner snapshot includes only host-authorized tool schemas (NDL-08)', () => {
  const snapshot = createToolSchemaSnapshot([
    { name: 'allowed_tool', description: 'allowed', inputSchema: { type: 'object' }, outputSchema: { type: 'string' } },
    { name: 'forbidden_tool', description: 'forbidden', inputSchema: { type: 'object' } },
  ], name => name === 'allowed_tool')
  assert.deepEqual(snapshot.map(tool => tool.name), ['allowed_tool'])
  assert.deepEqual(snapshot[0]?.inputSchema, { type: 'object' })
})

test('standard descriptors and the guide topics are shipped', () => {
  assert.ok(STANDARD_CONTRACTS.length > 0)
  const guide = readFileSync(join(KIT, 'README.md'), 'utf8')
  for (const topic of ['Build and pack', 'Publication and distribution', 'Verified model assets', 'Windows qualification', 'Cancellation and disposal', 'Typed results, skills and licensing', 'Version migration']) {
    assert.ok(guide.includes(topic), `missing guide topic: ${topic}`)
  }
})
