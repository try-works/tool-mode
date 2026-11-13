/**
 * The official EmbeddingGemma 2 text task-prefix recipes (MOD-06).
 *
 * The pinned conversion ships no template in its ONNX files; the model card for
 * the pinned revision documents the exact prefixes this module encodes. Keeping
 * them in one versioned module makes the choice reviewable and lets the tests
 * pin the wire strings rather than re-deriving them from prose.
 *
 * Source: https://huggingface.co/onnx-community/embeddinggemma-2-ONNX
 * (revision daa72c51243991dfcaf9f9137d2c573d8f7790c0), "Task Instruction Prefixes".
 */

import type { EmbeddingPurpose, EmbeddingRole } from './contracts.js'

/** The recipe set version recorded on every call that uses these prefixes. */
export const EMBEDDING_TASK_RECIPE_VERSION = 'embeddinggemma-2-task-prefixes-v1'

/** Official query instruction per asymmetric/symmetric purpose. */
const TASK_INSTRUCTION: Readonly<Record<EmbeddingPurpose, string>> = Object.freeze({
  retrieval: 'search result',
  code_retrieval: 'code retrieval',
  similarity: 'sentence similarity',
  classification: 'classification',
  clustering: 'clustering',
})

/**
 * Format one text/code part for the given purpose and role.
 *
 * Retrieval/code-retrieval documents use the model card's
 * `title: {title or none} | text: {content}` form. Every other case uses
 * `task: {instruction} | query: {content}` — including symmetric inputs, which
 * apply the same query prefix to every side being compared.
 * @param purpose - the caller's purpose.
 * @param role - the caller's role.
 * @param text - the validated text or code content.
 * @param title - the optional document title.
 * @returns the exact prefixed text sent to the tokenizer.
 */
export function formatEmbeddingText(
  purpose: EmbeddingPurpose,
  role: EmbeddingRole,
  text: string,
  title?: string,
): string {
  if (role === 'document') {
    const normalizedTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : 'none'
    return `title: ${normalizedTitle} | text: ${text}`
  }
  return `task: ${TASK_INSTRUCTION[purpose]} | query: ${text}`
}