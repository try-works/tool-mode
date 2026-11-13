# Tool expansion — results and evidence (2026-10-20)

Scope: the six deliverables from [tool-expansion-plan.md](./tool-expansion-plan.md), reduced
to what a single extension can actually back (one tool = one model). Three tools were built
and verified; two chains are documented and exercised as flows.

## Evidence (real calls, host receipts)

| Tool | Extension | Version | Call | Result | Receipt |
|---|---|---|---|---|---|
| `validate_record` | needle | 0.1.3 | `{schema, record}` | `valid: true`, `issues: []`, `record {name:"Alice", age:31}` | `rcpt_000001` |
| `extract_with_repair` | needle | 0.1.3 | Alice passage + 3-field schema | `extraction {name:"Alice",age:31,city:"Berlin"}`, `valid: true`, `repaired: false`, `attempts: 1` | `rcpt_000001` |
| `dedupe_and_rank` | embeddinggemma | 0.1.2 | two near-identical deploys + one unrelated, query "release broke overnight", threshold 0.8 | groups: `a`+`b` (0.9983557726220545), `c` alone; ranking `a` 0.8177615258153402 > `c` 0.6579465978889777 | `rcpt_000001` |
| Flow: audio locate → transcribe → score | embeddinggemma + voz | 0.1.2 / 0.1.5 | 22050 Hz, 3.373923 s fixture | window `0.44825–2.44825 s` score `0.6987753731922857`; transcript "Brown fox jumps over the lazy dog"; similarity `0.8761789517669837` | similarity only |
| Flow: semantic gate | embeddinggemma + laya | 0.1.2 / 1.0.3 | positive pair 0.9570278349433732 | gate opens at caller threshold 0.75; `decision_test` "no" (0.6779, uncalibrated); control 0.6449570288026811 keeps the gate closed | similarity only |

All calls ran through the real host pipeline in-process (`verify-one.mjs`,
`verify-flows.mjs`), on disposable stores with the prepared-asset cache.

## Findings

1. **Receipts are conditional on the schema.** The host stamps `meta` only when the tool's
   output schema lists `meta` in `required` (`index.ts` dispatch). `stt_transcribe`,
   `media_find_moments` and `decision_test` therefore return `receiptId: null`, while
   `semantic_similarity` returns one — in the SAME flow. `stt_transcribe`'s description claims
   the host attaches `meta`, so prose and behaviour disagree. `dedupe_and_rank` was changed to
   require `meta` so its evidence carries a receipt.
2. **Non-16 kHz audio was admitted at the wrong duration — FIXED.** `decodeWav` mapped the
   caller's range (in source seconds) to source frames with the MODEL's 16 kHz rate, so a
   22050 Hz file was read as `sourceDuration × 16000/22050`. Measured on the flow fixture:
   windows planned over `2.44825 s` of a `3.373923 s` file (`admittedFraction 0.725639`).
   The mapping now uses the source rate (`packages/extension-embeddinggemma/src/media.ts`),
   with a regression test at 22050 Hz, and the flow re-run measures
   `admittedFraction 1.000004`, `covered: true`, 4 windows instead of 2. 16 kHz sources were
   unaffected by the bug and are unaffected by the fix.
3. **`validate_record` cannot be used before preparation.** Activation is gated per
   extension (`enable()` refuses with `extension-preparation-required`), and every dispatch
   calls `provider.load()`, which needle refuses while its bytes are unverified. So a
   no-engine tool is still unreachable until the model is prepared — the modelId-free
   publication path does not change that.
4. **The repair loop did not fire on a real document.** With three required fields and a
   document supplying two, the engine produced no call at all (`extraction: null`,
   `issues: []`, one attempt). By design that is not repaired (nothing to quote), so the
   second-call path remains covered only by the counting-fake unit tests. The grammar
   constrains shape, so a structurally invalid record is rare; the practical trigger is a
   keyword the grammar ignores. A follow-up observation sharpens this: the SAME facts in a
   natural sentence ("Alice is 31 years old and lives in Berlin." with "Extract name, age and
   city") produced no call and a reported `valid: false`, while the labelled form
   ("Name: Alice. Age: 31. City: Berlin." with "Extract the person name, age and city as JSON")
   returned `{name:"Alice",age:31,city:"Berlin"}`, `valid: true`. So "nothing matched" is
   phrasing-sensitive, the tool reports it honestly instead of inventing a record, and callers
   should prefer explicit labels and a phrased instruction.
5. **Laya is advisory.** For a 0.957 cosine pair it answered "no" with 0.6779. The caller's
   threshold — not the decision tool — is the gate; the flow doc prints the threshold as
   policy on every run.
6. **An in-process upgrade kept serving the superseded module (found on the live host).**
   The host's module/instance cache was keyed by extension identity alone, so after needle
   0.1.3 (or embeddinggemma 0.1.2) was installed and activated, the NEW tools registered —
   their schemas come from the selected manifest — but every call reached the OLD
   implementation: `this extension implements "needle3-native-structured-extract", not
   "needle3-native-validate-record"`. The cache key is now `identity@version`
   (`index.ts`), with a same-process upgrade regression test that fails without the change.
   The live host must be restarted once to clear the cache it holds; after that, the first
   activation loads the selected version and the new tools are callable.
7. **A restart lost the prepared readiness, and `enable` alone cannot publish new tools.**
   After the 0.5.5 restart, needle came back `active` but `needs-preparation`, laya `failed
   inspection`, and declarative-recipes `failed` — the state file recorded none of them as
   callable, so their tools were withheld and every call answered `unknown tool`. Calling
   `prepare` (a cache hit) restored all three; but the needle tools still did not appear
   until a **disable→enable** cycle, because `enable()` treats an already-active extension
   with a live owner as a no-op and never re-publishes its contributions. Both are real
   operator-facing defects to fix in the host: readiness restore must not downgrade a
   verified cache, and an activation whose selected version differs from the published one
   must re-publish.
   **Status (0.5.7/0.5.8):** `enable()` now always calls `activate`, which the SDK documents
   as the way to pick up newly recorded readiness and which reconciles the surface; the
   regression test fails without the change. A failed startup restore is no longer
   log-only: the host records its reason per extension and the row reads
   `prepared assets could not be restored from the cache: <reason>; run prepare for this
   extension`, so a missing or resized cache file is distinguishable from a model that was
   never prepared. The readiness-downgrade itself did not reproduce on the following
   restart, so its cause is still unproven; if it recurs, the row now carries the reason.
8. **An extension's extra client chunk is not served.** The first chat-card version loaded
   `./toolmode-toolview.js` with `require.async`; the client module service serves only the
   bundle a plugin declares as its client entry, so the chunk answered 404, `apply` warned,
   and every Tool Mode call stayed on the generic card. The cards are now inlined into
   `client/index.js` by `scripts/gen-client-catalog.mjs`, with a test that forbids the chunk
   fetch returning.

## Verification of the changes themselves

- Full suite: 2,229 tests, 2,217 pass, 0 fail, 12 skipped (after the decoder fix).
- Extension packages: needle 164 tests (158 pass, 6 pinned-engine skips), embeddinggemma 140
  pass (plus the new WAV range test).
- Contract layer: all eight needle schemas compile under strict 2020-12 after adding the
  required `type: "array"` on conditional `issues`/`attempts` subschemas.

## Live profile promotion (after the fix)

The `web` profile now has `@try-works/extension-needle` **0.1.3** and
`@try-works/extension-embeddinggemma` **0.1.2** installed from source and **active**
(verified through `modelTools/describe`: `installed: true`, `active: true`,
`blocked: false`). Installed via the Remote wire method `modelTools/installExtension`
(POST `/api/modelTools/installExtension`, `{args:{id, source}}`); `modelTools/install` is not a
route and returns a plain-text 404. The new tools appear in an agent's tool list on the next
turn, not within the request that enabled them.
