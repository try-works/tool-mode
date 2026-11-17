# Hybrid retrieval experiment (pre-registered)

**Status:** scored on 2026-11-17 after the prepared assets were restored. The hybrid is
**rejected** by the pre-registered rule; no ranker default has been changed.

## Result

Corpus: `task-F4-v2.json` (52 documents, 3 expected aspects `d1,d2,d3`), query
"How do honeybees find their way back to the hive?". Three warm repetitions per arm;
p50/p95 are wall-clock per query.

| Arm | hit@1 | expected in top 3 | recall@20 | p50 | p95 |
| --- | --- | --- | --- | --- | --- |
| A `semantic_rank` all | d2 (1/1) | 2/3 (0.67) | 3/3 | 18.0 s | 19.1 s |
| B `text_embed` + cosine | d9 (0/1) | 1/3 (0.33) | 3/3 | 3.3 s | 3.9 s |
| B hybrid (cosine top 20 → `text_rerank`) | d9 (0/1) | 1/3 (0.33) | 3/3 | 4.8 s | 5.3 s |
| C `text_rerank` all | d9 (0/1) | 1/3 (0.33) | 2/3 | 1.6 s | 1.8 s |
| D model reading (previous baseline) | correct | — | — | — | 18 s |

Decision: **do not adopt**. Rule 1 fails: the hybrid's top-3 recovery (0.33) is not
strictly above arm A (0.67) and only equals arm C (0.33). Rule 3 (second corpus) was not
reached. The cross-encoder prefers topical bee documents but not the homing aspect; the
embedding-only arm is more accurate on this query despite being the slowest.

Keep the published descriptions' warning: `semantic_rank` is not reliably faster or more
accurate than a model reading a small corpus, and `text_rerank` is not a drop-in
improvement over it.


## Question

Does embedding recall followed by cross-encoder reranking beat either tool alone on the
52-document aspect-retrieval corpus, at a latency a caller would accept?

The measured baseline is uncomfortable: `semantic_rank` took 27.9 s and placed two
distractors in the top three; `text_embed` + cosine took 7.3 s and was also wrong; a model
reading the documents took 18 s and was right on the easy corpus. A change to the default
ranker is only justified if the hybrid clears both accuracy and latency.

## Arms

| Arm | Procedure | What it measures |
| --- | --- | --- |
| A | `semantic_rank` directly over all candidates | current embedding-only default |
| B | `text_embed` once, cosine recall top 20, then `text_rerank` those 20 | recall + cross-encoder |
| C | `text_rerank` over every candidate | cross-encoder-only ceiling |
| D | model reads the corpus and answers | external baseline |

## Metrics

- aspect accuracy: fraction of questions whose top result matches the hand-checked aspect;
- recall@20 for arm B's first stage (is the target even in the shortlist?);
- p50/p95 wall-clock latency per question;
- LLM token cost for arm D, when measured.

## Decision rule

Adopt hybrid only when, on the same corpus and host:

1. arm B's aspect accuracy is at least arm C's and strictly above arm A;
2. arm B's p95 latency is below the model-reading arm's p95, or the accuracy gain is large
   enough to justify the difference explicitly;
3. the result survives a second corpus that is not built from the same documents.

Until then the published tool descriptions must state the measured failure, not claim
"faster and at least as accurate".

## Blocked on

The MiniLM/EmbeddingGemma assets must be prepared and their tools enabled. This workspace
has the code but not a verified prepared deployment at the time of writing, so the
experiment has not been scored. Running it against a fixture-only fake would answer a
different question.
