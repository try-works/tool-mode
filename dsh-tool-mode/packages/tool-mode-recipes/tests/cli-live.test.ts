/** RCP-08/RCP-09 — live helper and authoring grant/draft-root policy. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { runRecipeCli, type RecipeCliIo } from '../src/cli.ts'

const dirs: string[] = []
after(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(prefix = 'tmx-cli-live-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function capture(): { io: RecipeCliIo; lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { io: { out: line => lines.push(line), err: line => errors.push(line) }, lines, errors }
}

function write(path: string, content: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8')
}

function projectWithTitleRecipe(): string {
  const project = scratch()
  write(join(project, 'recipes', 'text-title.json'),
    readFileSync(join(process.cwd(), 'packages', 'tool-mode-recipes', 'recipes', 'text-title.json'), 'utf8'))
  return project
}

describe('RCP-09 — authoring grant and draft-directory policy', () => {
  it('requires the configured grant token and confines writes to the configured root', async () => {
    const root = scratch()
    const outside = scratch()
    process.env.DSH_TOOL_MODE_AUTHORING_TOKEN = 'operator-secret'
    process.env.DSH_TOOL_MODE_AUTHORING_ROOT = root
    try {
      const denied = capture()
      assert.equal(await runRecipeCli(['create', '--template', 'text-title', '--name', 'draft', '--out', join(root, 'one')], denied.io), 2)
      assert.match(denied.errors.join('\n'), /authoring-grant/)

      const escaped = capture()
      assert.equal(await runRecipeCli([
        'create', '--template', 'text-title', '--name', 'draft', '--out', join(outside, 'two'), '--authoring-grant', 'operator-secret',
      ], escaped.io), 2)
      assert.match(escaped.errors.join('\n'), /draft directory policy/)

      const allowed = capture()
      assert.equal(await runRecipeCli([
        'create', '--template', 'text-title', '--name', 'draft', '--out', join(root, 'three'), '--authoring-grant', 'operator-secret',
      ], allowed.io), 0, allowed.errors.join('\n'))
      assert.ok(existsSync(join(root, 'three', 'recipes', 'draft.json')))
    } finally {
      delete process.env.DSH_TOOL_MODE_AUTHORING_TOKEN
      delete process.env.DSH_TOOL_MODE_AUTHORING_ROOT
    }
  })
})

describe('RCP-08 — the live helper requires consent, a profile and bounded limits', () => {
  function liveSetup(): { project: string; profile: string; input: string } {
    const dir = scratch()
    const project = projectWithTitleRecipe()
    const provider = join(dir, 'provider.mjs')
    write(provider, [
      'export default function createProvider() {',
      '  return {',
      "    id: 'operator-scripted',",
      '    generation: 7,',
      "    destination: 'local',",
      '    capabilities: () => ({ images: true, maxOutputTokens: 1024 }),',
      '    async complete() {',
      "      return { kind: 'text', text: JSON.stringify({ title: 'Live title', description: 'Live description from the profile.' }) }",
      '    },',
      '  }',
      '}',
      '',
    ].join('\n'))
    const profile = join(dir, 'profile.json')
    write(profile, { module: './provider.mjs', maxOutputTokens: 512, maxImages: 1, allowRemote: false })
    const input = join(dir, 'input.json')
    write(input, { text: 'How to deploy the service safely.' })
    return { project, profile, input }
  }

  it('refuses without --consent, then runs through the operator profile', async () => {
    const { project, profile, input } = liveSetup()
    const denied = capture()
    assert.equal(await runRecipeCli(['test', project, '--live', '--profile', profile, '--input', input], denied.io), 2)
    assert.match(denied.errors.join('\n'), /--consent/)

    const run = capture()
    const code = await runRecipeCli(['test', project, '--live', '--profile', profile, '--input', input, '--consent'], run.io)
    assert.equal(code, 0, run.errors.join('\n'))
    const output = run.lines.join('\n')
    assert.match(output, /live run completed through operator-scripted/)
    assert.match(output, /limits: outputTokens=512 images=1 remote=false/)
    assert.match(output, /Live title/)
  })

  it('refuses a profile module that exports no provider factory', async () => {
    const { project, input } = liveSetup()
    const dir = scratch()
    const profile = join(dir, 'bad-profile.json')
    write(profile, { module: './bad.mjs' })
    write(join(dir, 'bad.mjs'), 'export default 42\n')
    const run = capture()
    assert.equal(await runRecipeCli(['test', project, '--live', '--profile', profile, '--input', input, '--consent'], run.io), 2)
    assert.match(run.errors.join('\n'), /provider factory/)
  })
})
