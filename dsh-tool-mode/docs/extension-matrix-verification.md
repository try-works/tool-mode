# Full extension matrix — verification record (2026-10-20)

Every first-party extension was exercised on a disposable host, not by inspection:
install from source → prepare pinned assets → enable → invoke the declared tool(s)
and read the returned value. Host: profile `verify-all` (plugin 0.5.1), scratch store
`D:/DEV/dsh-verify-all-state/extensions`, asset cache `E:/dsh-asset-cache`, port 3092.
The live `web` profile was read, never written, for extension verification.

## Result

| # | Extension | Install | Prepare | Enable | Real tool call | Evidence |
|---|---|---|---|---|---|---|
| 1 | tongue (0.1.3) | PASS | PASS (zero-asset) | PASS | **PASS** `lang_detect` | `fr`, `reliability: confident`, p ≈ 1.0, runner-ups `nl`/`ca` |
| 2 | voz (0.1.5) | PASS | PASS | PASS | **PASS** `stt_transcribe` | "The quick brown fox jumps over the lazy dog." + 9 word spans, `coverage.complete: true` |
| 3 | embeddinggemma (0.1.1) | PASS | PASS (11 assets, ≈2.9 GB) | PASS | **PASS** all 6 tools | embed 768-d; similarity 0.8203; rank a=0.9124 > b=0.6243; classify `animals` 0.6522; dedupe {a,b}+{c} at 0.9; moments 0.5–1.5 s @0.6939 |
| 4 | laya (1.0.3) | PASS | PASS (6 assets) | PASS | **PASS** `decision_choose`, `decision_test`, `decision_score` | choose → "delay for testing" (0.6021); test → "yes" (0.6479); score → **"medium"** |
| 5 | minilm-embed (1.0.0) | PASS | PASS | PASS | **PASS** `text_embed` | 384-d, L2 norm 1.0000000024, first3 `-0.034477…, 0.031023…, 0.006735…` |
| 6 | minilm-rerank (1.0.0) | PASS | PASS | PASS | **PASS** `text_rerank` | a=8.5007, c=-2.5410, b=-11.0136, `scoreKind: ranking_logit` |
| 7 | needle (0.1.2) | PASS | PASS (executable assets downloaded) | PASS | **PASS** `structured_extract`, `tools_plan` | `{"name":"Alice","city":"Berlin"}`, valid, 0.5918; plan `get_weather{city:"Shanghai"}` 0.9745 |
| 8 | declarative-recipes (0.1.0) | PASS | n/a (no model) | PASS | **PASS** `text_title`, `describe_image` | live host with the composed harness model: title "Tool Mode: Installing Local Model Packages as Agent Tools"; image description named the red square and blue circle and reported no readable text |

## Defects found by this matrix, fixed in this round

1. **Dependency-graph package bound (host).** The host forwarded a depth bound but not a
   package-count bound, so the SDK's default of 64 refused the real
   `@huggingface/transformers` and both minilm engine trees. The host now has
   `extensionDependencyPackages` (default **256**) forwarded on both install arms; regression
   test added in `tests/extension-dependencies.test.ts`.
2. **`decision_score` output (Laya).** The runtime reports a score question as an *expected
   value* (`Σ i·p_i`, a float) plus per-index probabilities; the contract requires a level
   label. Passing the float through violated the declared schema. The label is now the
   argmax of the runtime's probabilities — the vendored runtime's own `best()` — mapped
   through the caller's levels, and the payload carries only the schema's fields.
   `pure.ts:scoreLevelFromProbabilities` is pinned by a weight-free test.
3. **`text.rerank` top_k clamping (minilm-rerank).** `top_k` larger than the candidate count
   was silently clamped; it now refuses by name (MOD-10), with two tests.
4. **Client catalogue staleness.** `client/index.js` was stale after the rebuild; regenerated
   (`npm run build:host`) — the package test enforces it.
5. **Superseded versions were served after a restart (host, found 2026-10-20).**
   `listInstalled().find(id)` returns the OLDEST recorded version. Restore used it to pick the
   version to activate, and dispatch, the module/declarative registrars and the prepare surface
   used it to pick the bytes and manifest. With 1.0.1, 1.0.2 and 1.0.3 installed, the host
   therefore activated and served 1.0.1 on every restart while `describe()` reported 1.0.3 —
   which is why the fixed `decision_score` kept returning the old schema error even after a
   restart. `selectInstalled` (EXT-30 pointer, else the last appended record) is now the single
   selection at every host lookup, pinned by a two-version restore test in
   `tests/host-restore.test.ts`.

## Note: declarative-recipes looked blocked, but was not

An earlier reading of this matrix called it blocked because `describe()` reports `tools: []`.
That list projects the manifest's `tools` array, and a declarative package has none by design —
its tool names come from resolved recipes. The recipe tools ARE registered through
`ctx.tools.register` and both work on the live host with the composed harness model
(`deepseek-official/deepseek-flash`):

- `text_title` returned a bounded title and description (structured output from the recipe's
  JSON reply).
- `describe_image` returned a real description of the 264-byte PNG fixture. Image arguments
  cross the tool boundary as `{ mediaType, bytes: number[] }` — the host converts that
  JSON-safe form into the `Uint8Array` the recipe binding requires. A plain `{path}` is
  refused on purpose (never a path, never a URL crossing that boundary).

Lesson recorded for future harnesses: a `tools: []` row for a declarative package means "no
manifest tools", not "no tools". Verify by invoking the recipe tool names directly.

## Environment notes

- `E:/dsh-asset-cache` now holds the embeddinggemma (11 blobs), laya (6), minilm (2×2),
  needle (2) and voz (vendor cache) artifacts; prepare verifies every digest before use.
- Restart durability was re-confirmed: a fresh process with no install/enable calls
  registered minilm's tools through the startup restore path and answered (9.3 s / 8.4 s
  to first call).
- The `web` profile's live host keeps the first activation's tool binding; `decision_score`
  changes take effect for it on the next restart (0.5.1 + Laya 1.0.3 are staged).
