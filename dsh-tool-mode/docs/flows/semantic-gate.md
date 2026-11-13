# Flow: semantic gate (similarity → caller threshold → decision)

**Status:** verified on this host, 2026-10-20, exit code 0.
**Verifier:** `scripts/verify-flows.mjs` (flow 2). Command: `node scripts/verify-flows.mjs`.

This is a **flow**, not a tool. The agent — or, here, the caller — composes
`semantic_similarity` and `decision_test` and owns the comparison between them that
turns a score into a gate. **No tool calls another tool, and neither tool knows the
threshold.**

```
caller
  │  1. semantic_similarity   (EmbeddingGemma)  → score, scoreKind, embeddingSpaceId
  │  2. IF score >= threshold THEN …            ← CALLER policy: the gate
  │  3. decision_test         (Laya)            → advisory yes/no + UNCALIBRATED confidence
  │  4. negative control pair (semantic_similarity; gate stays closed, decision_test not called)
  ▼
```

## Purpose

Turn a cosine similarity into a policy decision *without letting either model own the
policy*. The embedding model reports a distance in a named space; the decision model
reports an uncalibrated yes/no; the **caller** compares the score with its own
threshold, and optionally asks the decision model for a second, advisory opinion. The
threshold never enters a model prompt, and a model's answer never opens the gate.

## Prerequisites

| Requirement | What this run used |
| --- | --- |
| Extensions (installed from source, then prepared, then enabled) | `@try-works/extension-embeddinggemma` 0.1.2, `@try-works/extension-laya` 1.0.3 |
| Assets | EmbeddingGemma blobs in `E:/dsh-asset-cache`; Laya's six artifacts (encoder/head + external data, tokenizer, `rl_agent_config.json`) already in the same content-addressed cache. Every locked digest was present before the run, so `prepare` returned `prepared: true, activationReady: true` for both without needing a transfer |
| Store | a **fresh** scratch store under `D:/DEV/verify-flows/` (≈1 GB per flow: installed dependencies are copied beside the extension; the verifier prunes abandoned `run-*` directories older than an hour) |
| Policy | caller threshold `0.75` (a CLI knob in the verifier, not a tool input) |

## Exact call sequence

### 1. Score the pair — `semantic_similarity`

```json
{
  "left":  { "id": "a", "parts": [{ "kind": "text", "text": "The quick brown fox jumps over the lazy dog." }] },
  "right": { "id": "b", "parts": [{ "kind": "text", "text": "A quick brown fox is jumping over a lazy dog." }] },
  "dimensions": 768
}
```

Verified result:

```json
{
  "score": 0.9570278349433732,
  "scoreKind": "cosine_similarity",
  "embeddingSpaceId": "embeddinggemma-2/text/daa72c512439-9fd452bfc691",
  "meta": {
    "contract": "@try-works/extension-embeddinggemma/semantic_similarity",
    "contractVersion": "1.0.0",
    "implementationId": "embeddinggemma2-similarity",
    "extension": "@try-works/extension-embeddinggemma",
    "extensionVersion": "0.1.2",
    "activationGeneration": 3,
    "executionLocation": "device",
    "receiptId": "rcpt_000001",
    "warnings": []
  }
}
```

### 2. Apply the caller's gate (not a tool call)

```
score      = 0.9570278349433732
threshold  = 0.75                  ← caller policy, chosen above this model's
                                     unrelated-pair baseline (0.6173 measured in
                                     docs/tool-mode/qualification/embeddinggemma.json)
opens      = (score >= threshold)  = true
```

The comparison is evaluated by the caller. Neither tool receives the threshold, and
`semantic_similarity` has no policy parameter that could express it.

### 3. Advisory decision — `decision_test` (only because the gate opened)

```json
{
  "prompt": "Do these two texts describe the same event? Text A: \"The quick brown fox jumps over the lazy dog.\" Text B: \"A quick brown fox is jumping over a lazy dog.\"",
  "allow_abstain": true
}
```

Verified result:

```json
{
  "decision": "no",
  "confidence": 0.6779,
  "calibrated": false,
  "probabilities": { "yes": 0.3221, "no": 0.6779 },
  "abstained": false,
  "action": { "act_probability": 1 }
}
```

**This is the flow's most important observation.** The cosine is 0.957 and the
decision model says **no** with an *explicitly uncalibrated* 0.6779. That disagreement
is exactly why the gate belongs to the caller: the embedding score opened it, Laya's
answer did not change it, and the caller records Laya's answer as advisory evidence.
`calibrated: false` is not a caveat appended to the result — it is a required constant
of the contract (DEC-08). `abstained` is the *model's* act gate; it is not the caller's
gate.

### 4. Negative control — gate stays closed

```json
{
  "left":  { "id": "a", "parts": [{ "kind": "text", "text": "The quick brown fox jumps over the lazy dog." }] },
  "right": { "id": "c", "parts": [{ "kind": "text", "text": "Quarterly revenue grew twelve percent year over year." }] },
  "dimensions": 768
}
```

Verified result: `score = 0.6449570288026811` (receipt `rcpt_000002`) →
`0.6449 < 0.75` → the gate **does not open** and `decision_test` is **not called** for
this pair. The verifier prints this as a `gate` line with
`"opens": false`; no tool skipped the call, the caller did.

## What each receipt proves

| Call | `meta.receiptId` in the result | Why |
| --- | --- | --- |
| `semantic_similarity` (positive) | `rcpt_000001` | Its declared output schema requires `meta`, so the host stamps the envelope and records the invocation receipt. |
| `decision_test` | **absent** (`null`) | Its output schema does not require `meta`, so the host stamps nothing and records no invocation receipt for this call. |
| `semantic_similarity` (control) | `rcpt_000002` | Same contract as the first similarity call; a new invocation, a new receipt. |

So:

- **`rcpt_000001` / `rcpt_000002`** bind a score to the declaring extension
  (`@try-works/extension-embeddinggemma` 0.1.2), the contract and version
  (`.../semantic_similarity` 1.0.0), the implementation (`embeddinggemma2-similarity`),
  the host activation generation (3), and the execution location (`device`). They
  prove *which implementation produced which number under which activation*. They do
  **not** prove the number is correct, comparable outside its `embeddingSpaceId`, or
  meaningful without the caller's threshold.
- **`decision_test`'s `null`** means Laya's answer carries **no host provenance** in
  the result: the caller can see `decision`, `confidence`, `calibrated: false`,
  `probabilities`, `abstained` and `action`, but nothing ties the answer to an
  extension version or activation generation. That asymmetry is the same one flow 1
  documents: the host stamps `meta` only when the declared output schema requires it.
  The verifier prints `receiptId: null` with the reason rather than inventing a
  receipt; nothing about the answer is retracted, but nothing about its provenance can
  be claimed either.

## Failure modes

| Failure | Where it surfaces | What it means |
| --- | --- | --- |
| Gate closed | caller line `"opens": false` | The flow stops by design: there is no tool that would call `decision_test` on its own. A closed gate is a *policy outcome*, not an error in the score. |
| Threshold outside `[-1, 1]` | verifier usage error | A cosine threshold outside its range is met by every pair or by none; it is a caller bug, not a policy. |
| Empty or non-finite score | result contract violation | Must be refused, never treated as below/above threshold. |
| `abstained: true` | `decision_test` | The model's act gate declined. Keep it as an abstention in the record; do not coerce it to `no`. |
| Confidence read as probability | misuse | `calibrated` is always `false` and the model card ships uncalibrated logits with a clamping warning. Never threshold on `confidence`. |
| Prompt too long | `decision_test` input validation | The prompt is capped at 4096 characters; a longer prompt is refused, not truncated. |
| Managed-process failure | first Laya call | Laya runs in a managed child process (`isolation: managed-process`); if the child cannot start, the call errors and the flow reports it. |
| Negative control crosses threshold | caller line with a warning | Threshold too low for this space. The composition still ran; the threshold is the caller's to fix. |
| Upgrade refusal on install | install line `skipped: true` | The store already held the extension; prepare/enable the installed copy instead. |

## What is caller policy (and what is not)

- **The threshold.** `0.75` is the verifier's policy. No tool input exists for it.
- **The ordering.** Score first, then compare, then (only if the caller decides)
  consult the decision model. No tool fetches a score to pass to another tool.
- **The gate semantics.** `>=` vs `>`, the value used, and what happens when the gate
  is closed are the caller's to define and record.
- **The prompt.** The yes/no question is caller-authored; it deliberately does not
  contain the threshold, because the model must not be asked to apply policy.
- **What a model answer means.** The decision model's answer is advisory, not
  authoritative — the run above shows it disagreeing with a 0.957 cosine.
- **Not policy:** the score kind (`cosine_similarity`), the space id, and
  `calibrated: false` are contract facts, not caller choices.

**No tool calls another tool.** The similarity tool returns a number; the decision
tool answers a question; the join between them exists only in the caller.

## Reproduce

```powershell
node scripts/verify-flows.mjs --flow 2 --threshold 0.75
```

The run exits 0 only when the gate opened for the positive pair and `decision_test`
returned a decision. Every line is JSON; the final line for the flow is
`{"flow":2,"phase":"flow-complete","ok":true,...}`.

## Remainders

- Laya's confidence is uncalibrated by contract; this flow uses it as a ranking-free
  advisory answer only.
- The positive/control separation is a property of this embedding space, not a general
  constant; a different `dimensions` width is a different space and needs its own
  threshold.
- `decision_test` results carry no host receipt (see above).


