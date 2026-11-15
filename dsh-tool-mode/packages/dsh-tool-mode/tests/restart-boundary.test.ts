/**
 * P8: the restart boundary is explicit, on the Settings page AND in the docs.
 *
 * Registration is pinned at plugin load. The Settings page can install, prepare,
 * enable and disable an extension, but none of those mutates the list of tools the
 * running host advertises; the change applies on the next host load. That is a
 * user-visible semantic, so the copy and the docs must say it in the same words.
 *
 * The test reads the SHIPPED bundle too: a template edit without regenerating
 * client/index.js would leave the page telling the old story.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = process.cwd()

/** The one sentence the Settings copy and the docs must carry. */
const RESTART_BOUNDARY =
  'Model and tool registration changes apply on the next host load; install, prepare, enable and disable do not mutate the pinned list mid-session.'

/** Read a repository file by its path relative to the repository root. */
function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

const COPIES = [
  'packages/dsh-tool-mode/client/index.template.js',
  'packages/dsh-tool-mode/client/index.js',
  'README.md',
  'docs/guide/guides/settings.md',
  'docs/guide/concepts/models-and-availability.md',
] as const

test('the restart boundary sentence is in every Settings/doc copy', () => {
  for (const file of COPIES) {
    assert.ok(read(file).includes(RESTART_BOUNDARY), file + ' must state the restart boundary')
  }
})

test('the old vague restart sentence is replaced, not left beside the new one', () => {
  const template = read('packages/dsh-tool-mode/client/index.template.js')
  assert.equal(
    template.includes('Model and tool registration changes apply after restart.'),
    false,
    'the old one-line notice must be replaced by the explicit boundary sentence',
  )
})
