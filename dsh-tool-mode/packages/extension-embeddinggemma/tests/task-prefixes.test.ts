/** MOD-06 — the pinned official task-prefix recipes, pinned as strings. */

import assert from 'node:assert/strict'
import test from 'node:test'

import { EMBEDDING_TASK_RECIPE_VERSION, formatEmbeddingText } from '../src/prompt.ts'

test('MOD-06: retrieval query and document templates match the pinned model card', () => {
  assert.equal(
    formatEmbeddingText('retrieval', 'query', 'Which planet is the Red Planet?'),
    'task: search result | query: Which planet is the Red Planet?',
  )
  assert.equal(
    formatEmbeddingText('retrieval', 'document', 'Mars is known for its reddish appearance.', 'planets'),
    'title: planets | text: Mars is known for its reddish appearance.',
  )
  assert.equal(
    formatEmbeddingText('code_retrieval', 'query', 'read a CSV'),
    'task: code retrieval | query: read a CSV',
  )
  assert.equal(
    formatEmbeddingText('code_retrieval', 'document', 'export const x = 1', 'a.ts'),
    'title: a.ts | text: export const x = 1',
  )
  assert.equal(
    formatEmbeddingText('retrieval', 'document', 'no title here'),
    'title: none | text: no title here',
  )
})

test('MOD-06: symmetric purposes use the same query prefix on both sides', () => {
  assert.equal(formatEmbeddingText('similarity', 'symmetric', 'two cats'), 'task: sentence similarity | query: two cats')
  assert.equal(formatEmbeddingText('classification', 'symmetric', 'refund request'), 'task: classification | query: refund request')
  assert.equal(formatEmbeddingText('clustering', 'symmetric', 'theme'), 'task: clustering | query: theme')
  assert.equal(EMBEDDING_TASK_RECIPE_VERSION, 'embeddinggemma-2-task-prefixes-v1')
})
