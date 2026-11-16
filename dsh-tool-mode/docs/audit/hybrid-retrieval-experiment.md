# Hybrid retrieval experiment (pre-registered)

**Status:** plan only. No ranker default has been changed.

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
