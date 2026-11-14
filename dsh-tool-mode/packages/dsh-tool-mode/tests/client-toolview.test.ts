/**
 * The chat tool view: registration, summaries, and the wiring that makes it load.
 *
 * The cards are INLINED into the generated `client/index.js` (see
 * `scripts/gen-client-catalog.mjs`), because the client module service serves only a
 * plugin's declared bundle file: a sibling chunk answers 404 and the view silently falls
 * back to the generic card. These tests therefore load the authoring source
 * (`client/toolmode-toolview.js`) as a factory, and separately assert that the generated
 * bundle carries it inline with no chunk fetch.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode')
const SOURCE = join(PACKAGE_DIR, 'client', 'toolmode-toolview.js')

/** A createElement stub that records the tree it is asked to build. */
function stubReact() {
  return {
    createElement(type: unknown, props: unknown, ...children: unknown[]) {
      return { type, props: props ?? {}, children }
    },
  }
}

/** Load the authoring source and build the view surface. */
function loadToolviews(): Record<string, unknown> {
  const source = readFileSync(SOURCE, 'utf8')
  assert.ok(source.includes('function createToolviews'), 'the source must expose the factory')
  const factory = new Function(`${source}\nreturn createToolviews`)() as (element: unknown) => Record<string, unknown>
  return factory(stubReact().createElement)
}

test('the module registers one keyed toolview per known tool', () => {
  const views = loadToolviews()
  const names = views['TOOL_NAMES'] as readonly string[]
  for (const expected of ['validate_record', 'extract_with_repair', 'dedupe_and_rank', 'decision_score', 'multimodal_embed', 'tool_mode_run']) {
    assert.ok(names.includes(expected), `${expected} must have a card`)
  }
  const registered: { name: string; key: string; component: unknown }[] = []
  const ctx = {
    slots: {
      inject(_name: string, factory: () => () => void) {
        const dispose = factory()
        return () => dispose()
      },
      register(spec: { name: string; key: string }, component: unknown) {
        registered.push({ ...spec, component })
        return () => {}
      },
    },
    effect(fn: () => () => void) {
      fn()
    },
  }
  ;(views['register'] as (context: typeof ctx) => void)(ctx)
  assert.equal(registered.length, names.length, 'every known tool must be registered')
  for (const spec of registered) assert.equal(spec.name, 'tool.call.toolview')
  assert.equal(new Set(registered.map(spec => spec.key)).size, names.length, 'keys must be unique')
  const runEntry = registered.find(spec => spec.key === 'tool_mode_run')
  assert.equal(runEntry?.component, views['ToolModeRunCard'], 'Code Mode must use its own card')
})

test('summaries describe each tool family and never invent fields', () => {
  const views = loadToolviews()
  const summary = views['summaryFor'] as (tool: string, payload: unknown) => string[]
  const embed = summary('multimodal_embed', {
    vectors: [{ dimensions: 768, normalized: true, values: [0.1, 0.2, 0.3], embeddingSpaceId: 'space-1' }],
  })
  assert.ok(embed.some(line => line.includes('dimensions 768')), JSON.stringify(embed))
  assert.ok(embed.some(line => line.includes('0.1, 0.2, 0.3')), 'the first three values are shown')

  const score = summary('decision_score', { score: 'medium', confidence: 0.0128, calibrated: false })
  assert.ok(score.some(line => line === 'score medium'))
  assert.ok(score.some(line => line.includes('calibrated false')))

  const repaired = summary('extract_with_repair', { valid: true, repaired: false, attempts: [{ valid: true, issues: [] }] })
  assert.ok(repaired.some(line => line.includes('1 attempt(s)')), JSON.stringify(repaired))

  const dedupe = summary('dedupe_and_rank', { groups: [{}, {}], ranking: [{}], threshold: 0.8 })
  assert.ok(dedupe.some(line => line.includes('2 group(s)') && line.includes('1 ranked')))

  // A shape the branch does not recognize yields NO sentence, never a guess.
  assert.deepEqual(summary('validate_record', { unexpected: true }), [])
  // A null payload is a value, not a crash.
  assert.deepEqual(summary('decision_test', null), [])
})

test('Code Mode has its own card and reads the sub-call trace', () => {
  const views = loadToolviews()
  const trace = views['runTrace'] as (payload: unknown) => { name: string }[]
  const traced = trace({
    result: { ok: true },
    logs: ['log line'],
    meta: {
      receiptId: 'rcpt_000009',
      toolCalls: 2,
      calls: [
        { name: 'decision_choose', ok: true, elapsedMs: 812, argumentsPreview: '{"prompt":"x"}', resultPreview: '{"chosen":"y"}' },
        { name: 'semantic_similarity', ok: false, elapsedMs: 5, argumentsPreview: '{}', error: 'boom' },
        null,
        { ok: true },
      ],
    },
  })
  assert.equal(traced.length, 2, 'malformed entries are dropped, not rendered')
  assert.equal(traced[0]?.name, 'decision_choose')
  assert.deepEqual(trace(null), [])
  assert.deepEqual(trace({ meta: { calls: 'not an array' } }), [])

  const Card = views['ToolModeRunCard'] as (props: unknown) => { type: unknown }
  const rendered = Card({
    block: {
      phase: 'result',
      isError: false,
      args: { raw: JSON.stringify({ description: 'pick then compare', code: 'const a = await tools.decision_choose({prompt:"x"});', tools: ['decision_choose', 'semantic_similarity'] }) },
      content: [{
        type: 'text',
        text: JSON.stringify({
          result: { ok: true },
          logs: ['log line'],
          meta: {
            receiptId: 'rcpt_000009', elapsedMs: 1900, toolCalls: 2, catalogRevision: 'rev-1', warnings: [],
            calls: [
              { name: 'decision_choose', ok: true, elapsedMs: 812, argumentsPreview: '{"prompt":"x"}', resultPreview: '{"chosen":"y"}' },
              { name: 'semantic_similarity', ok: true, elapsedMs: 40, argumentsPreview: '{}', resultPreview: '{"score":0.9}' },
            ],
          },
        }),
      }],
    },
    toolName: 'tool_mode_run',
  })
  assert.equal(rendered.type, 'div')
  // A run with no trace says so instead of inventing calls.
  const noTrace = Card({ block: { phase: 'result', isError: false, args: { raw: '{}' }, content: [{ type: 'text', text: '{"result":null,"logs":[]}' }] }, toolName: 'tool_mode_run' })
  assert.equal(noTrace.type, 'div')
})

test('the card renders a settled call and a failed one without throwing', () => {
  const views = loadToolviews()
  const Card = views['ToolModeToolCard'] as (props: unknown) => { type: unknown }
  const settled = {
    phase: 'result',
    isError: false,
    args: { raw: '{"levels":["low","medium","high"]}' },
    content: [{
      type: 'text',
      text: JSON.stringify({
        score: 'medium', confidence: 0.0128, calibrated: false,
        meta: { extension: '@try-works/extension-laya', implementationId: 'laya-native-decision-score', extensionVersion: '1.0.3', executionLocation: 'device', receiptId: 'rcpt_000001' },
      }),
    }],
  }
  const rendered = Card({ block: settled, toolName: 'decision_score' }) as { type: unknown }
  assert.equal(rendered.type, 'div')
  const failed = Card({
    block: { phase: 'result', isError: true, error: { name: 'ToolError', code: 'NOT_PREPARED', reason: 'the engine is unprepared' }, content: [], args: { raw: '{}' } },
    toolName: 'validate_record',
  }) as { type: unknown }
  assert.equal(failed.type, 'div')
  // A half-streamed call has no result yet: the card shows the phase, not an error.
  const running = Card({ block: { phase: 'start', argsRaw: '{"text":"parti' }, toolName: 'extract_with_repair' }) as { type: unknown }
  assert.equal(running.type, 'div')
})

test('EVERY extension package gets an install card, including catalogue-backed ones', () => {
  // The regression: the generator skipped an extension whose id was already represented
  // by a Desert Ant catalogue entry. That catalogue row says the model is "provided by
  // the Tool Mode extension" but offers only a model toggle — so tongue and voz had NO
  // install control anywhere in the UI and a clean host could not install them.
  const bundle = readFileSync(join(PACKAGE_DIR, 'client', 'index.js'), 'utf8')
  const start = bundle.indexOf('const EXTENSIONS =')
  assert.ok(start >= 0, 'the generated bundle must carry the extension list')
  const section = bundle.slice(start, start + 40_000)
  const packagesDir = join(process.cwd(), 'packages')
  const manifests = readdirSync(packagesDir)
    .filter(dir => dir.startsWith('extension-'))
    .map(dir => join(packagesDir, dir, 'tool-mode.extension.json'))
    .filter(path => existsSync(path))
    .map(path => JSON.parse(readFileSync(path, 'utf8')) as { id: string })
  assert.ok(manifests.length >= 8, 'the repo ships at least the eight first-party extensions')
  for (const manifest of manifests) {
    assert.ok(
      section.includes(`"id": ${JSON.stringify(manifest.id)}`),
      `${manifest.id} must have an extension card (its catalogue row cannot install it)`,
    )
  }
})

test('every tool the plugin can register has a card (no hardcoded drift)', () => {
  const views = loadToolviews()
  const names = new Set(views['TOOL_NAMES'] as readonly string[])
  const expected = new Set([
    // Host tools and host-owned contracts registered by this package.
    'tool_mode_list', 'tool_mode_describe', 'tool_mode_run', 'model_tools', 'model_tools_manage',
    'decision_combine', 'decision_evaluate', 'decision_route',
  ])
  const catalog = JSON.parse(
    readFileSync(join(PACKAGE_DIR, 'catalog', 'desert-ant-models.json'), 'utf8'),
  ) as Array<{ tool?: { name?: string } }>
  for (const model of catalog) if (typeof model.tool?.name === 'string') expected.add(model.tool.name)
  const extensionsDir = join(PACKAGE_DIR, '..')
  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('extension-')) continue
    const manifestPath = join(extensionsDir, entry.name, 'tool-mode.extension.json')
    if (!existsSync(manifestPath)) continue
    const doc = JSON.parse(readFileSync(manifestPath, 'utf8')) as { tools?: Array<{ name?: string }> }
    for (const tool of doc.tools ?? []) if (typeof tool.name === 'string') expected.add(tool.name)
  }
  const missing = [...expected].filter(name => !names.has(name)).sort()
  assert.deepEqual(missing, [], 'add every missing tool name to TOOL_NAMES so its calls get a card')
})

test('the card summary covers control and runtime-layer tools', () => {
  const views = loadToolviews()
  const summary = views['summaryFor'] as (tool: string, payload: unknown) => string[]
  const control = summary('model_tools', { action: 'list', installed: 0, runnable: 0 })
  assert.ok(control.some(line => line.includes('action list')), JSON.stringify(control))
  const nsfw = summary('classify_nsfw', { isNSFW: false, score: 0.1 })
  assert.ok(nsfw.some(line => line.includes('isNSFW false')), JSON.stringify(nsfw))
  const emoji = summary('suggest_emojis', { suggestions: [{ emoji: '💰', confidence: 0.65 }] })
  assert.ok(emoji.length === 1 && emoji[0]?.includes('💰'), JSON.stringify(emoji))
  const language = summary('identify_language', { language: 'en', confidence: 0.31, isReliable: false })
  assert.ok(language.some(line => line.includes('language en')), JSON.stringify(language))
})

test('the generated bundle carries the cards INLINE and fetches no chunk', () => {
  const bundle = readFileSync(join(PACKAGE_DIR, 'client', 'index.js'), 'utf8')
  assert.ok(bundle.includes('function createToolviews'), 'the cards must be inlined into the bundle')
  assert.ok(bundle.includes('toolviews.register(ctx)'), 'apply must register them synchronously')
  // The regression this guards: a chunk reference that the client module service answers
  // with 404, silently leaving every Tool Mode call on the generic card.
  assert.ok(!bundle.includes("require.async('./toolmode-toolview.js')"), 'no chunk fetch (404 would fall back silently)')
  assert.ok(!bundle.includes('/*__TOOLVIEW_SOURCE__*/'), 'the placeholder must be replaced')
})
