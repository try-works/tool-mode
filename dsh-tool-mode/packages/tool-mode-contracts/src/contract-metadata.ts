/**
 * Contract examples and policy metadata (DECL-01).
 *
 * One source for every standard descriptor's worked example and explicit policy.
 * The examples are documentation: the authoritative validation remains each
 * contract's input/output schema.
 */

import type { ContractExample, ContractPolicy } from './registry.ts'

/** One example per standard contract identity. */
export const CONTRACT_EXAMPLES: Readonly<Record<string, readonly ContractExample[]>> = {
  'stt.transcribe': [{
    input: { audio: { path: 'recording.wav' }, timestamps: 'none' },
    output: {
      text: 'Hello from the recording.',
      coverage: { complete: true, processedSeconds: 1.2, samplingInstruction: null },
      meta: {},
    },
  }],
  'text.language_detect': [{
    input: { text: 'Hello, how are you?' },
    output: { language: 'en', reliability: 'confident', candidates: [{ language: 'en', probability: 0.99 }], meta: {} },
  }],
  'text.embed': [{
    input: { text: 'A short passage.' },
    output: { embedding: [0.01, 0.02], dimensions: 2, meta: {} },
  }],
  'text.rerank': [{
    input: { query: 'deployment', documents: ['Deploy the service.', 'Unrelated.'] },
    output: { scores: [1.2, -0.4], meta: {} },
  }],
  'text.title': [{
    input: { text: 'How to configure the deployment pipeline for staging and production.' },
    output: { title: 'Deployment pipeline configuration', description: 'How to configure staging and production.', meta: {} },
  }],
  'image.describe': [{
    input: { image: { mediaType: 'image/png', bytes: [137, 80, 78, 71] }, prompt: 'Describe the interface.' },
    output: { description: 'A settings panel with a save button.', meta: {} },
  }],
  'embed.multimodal': [{
    input: { items: [{ id: 'a', parts: [{ kind: 'text', text: 'Hello' }] }], purpose: 'retrieval', role: 'query', dimensions: 2 },
    output: { embeddings: [{ id: 'a', vector: [0.1, 0.2] }], meta: {} },
  }],
  'semantic.similarity': [{
    input: { left: 'Deploy the service.', right: 'Ship the service.', dimensions: 2 },
    output: { similarity: 0.92, meta: {} },
  }],
  'semantic.rank': [{
    input: { query: 'deploy', candidates: ['ship it', 'unrelated'], topK: 1 },
    output: { ranking: [{ id: '0', score: 0.9 }], meta: {} },
  }],
  'semantic.classify': [{
    input: { item: 'The server is down.', labels: [{ id: 'outage', description: 'An outage.' }] },
    output: { label: 'outage', scores: [{ id: 'outage', score: 0.96 }], meta: {} },
  }],
  'semantic.deduplicate': [{
    input: { items: ['Deploy the service.', 'Ship the service.'], threshold: 0.9 },
    output: { groups: [{ representative: 0, members: [1] }], meta: {} },
  }],
  'media.find_moments': [{
    input: { query: 'a dog barking', media: { mediaType: 'audio/wav', bytes: [] }, windowSeconds: 2, strideSeconds: 1, topK: 1 },
    output: { moments: [{ startSeconds: 1, endSeconds: 3, score: 0.9 }], meta: {} },
  }],
  'decision.choose': [{
    input: { decision: 'Choose a deployment strategy.', options: ['blue-green', 'rolling'] },
    output: { chosen: 1, reason: 'Lower risk.', confidence: 0.7, calibrated: false, probabilities: { '0': 0.3, '1': 0.7 }, abstained: false, meta: {} },
  }],
  'decision.test': [{
    input: { claim: 'The service is healthy.', evidence: 'All probes pass.' },
    output: { verdict: 'true', confidence: 0.8, calibrated: false, meta: {} },
  }],
  'decision.score': [{
    input: { text: 'The deployment is stable.', levels: ['low', 'medium', 'high'] },
    output: { level: 'high', confidence: 0.75, calibrated: false, scores: [0.1, 0.15, 0.75], meta: {} },
  }],
  'structured.extract': [{
    input: { text: 'Ada Lovelace was born in 1815.', instruction: 'Extract the person name and year.', schema: { type: 'object', properties: { name: { type: 'string' }, year: { type: 'integer' } } } },
    output: { record: { name: 'Ada Lovelace', year: 1815 }, meta: {} },
  }],
  'plan.tools': [{
    input: { request: 'Find the language of this text.', tools: [{ name: 'lang_detect', description: 'Detect language.', parameters: { type: 'object' } }] },
    output: { proposals: [{ name: 'lang_detect', arguments: { text: 'hello' }, reasoning: 'Language detection is requested.', confidence: 0.9 }], meta: {} },
  }],
}

/** Policy metadata; recording is required by default in every standard contract. */
export const CONTRACT_POLICIES: Readonly<Record<string, ContractPolicy>> = Object.fromEntries(
  Object.keys(CONTRACT_EXAMPLES).map(contract => [contract, { recording: 'required', remote: 'allowed' }]),
)
