# Status re-adjudication — 2026-11-01 (task-23)

Scope: the six status-changing stale rows from
[docs/implementation-audit-2026-11-01.md](../implementation-audit-2026-11-01.md) plus the
evidence-only rows MOD-20 and DEC-01/DEC-02. Each row was re-checked against the current
source, tests and qualification artifacts; a row changed status only where a cited artifact
decides it, and `TOOL-02` stays PARTIAL because three clauses are still unmet.

`docs/tool-mode/status.json` is the source of truth; `TRACEABILITY.md` and the
`verification/` artifacts are generated and were not hand-edited.

## Counts (227 requirement rows)

| Status | Before | After | Delta |
| --- | --- | --- | --- |
| DONE | 18 | **23** | +5 |
| PARTIAL | 186 | **185** | −1 |
| NOT_RUN | 20 | **19** | −1 |
| BLOCKED | 3 | **0** | −3 |
| **Total** | 227 | **227** | 0 |

`verifiedAt` moved from `2026-10-16` to `2026-11-01`.

## Row-by-row

| ID | Before | After | Deciding evidence |
| --- | --- | --- | --- |
| MODEL-02 | BLOCKED | **DONE** | `packages/extension-laya/src/index.ts:23` imports the vendored `laya-ts` `Agent`/`createNodeProvider`/`decide`; `:88-93` builds the ONNX provider over the prepared `text-backbone` group; `:139` runs `decide()`. Lock pins the six split artifacts (encoder.onnx+data, head.onnx+data, rl_agent_config.json, tokenizer.json); `docs/tool-mode/qualification/laya.json` records 6/6 measured digests + 3 real calls (choose/test/score, 293/326 ms). Repo grep for `qwen` over `packages/*/src`, `packages/*/recipes`, catalog: no hits, so no chat-recipe decision default. `semantic_classify` documents itself as "not the dedicated decision model". Jev remains a documented remote alternative (spec §8.2 `@try-works/tool-mode-jev`), own status DEC-07. |
| TOOL-02 | BLOCKED | **PARTIAL** | The blocker is false — tools ship and register (`extension-laya/tool-mode.extension.json` tools+implementations; typed API `src/index.ts:139`; `src/pure.ts:63-74` enforces 2..32 unique non-empty options). Three clauses remain: (1) the registered tools use an extension-local contract (`schema/decision-choose.input.json`: `prompt`+`options`, output `chosen` = label string) instead of the standard `decision.choose` (`packages/tool-mode-contracts/src/contracts/standard.ts:324-355`: `decision`+`options` → `chosen` INTEGER + `reason`, maxOptions 16), so that contract's shape rules are unenforced; (2) the answer is not re-validated against the full option set — `renderAnswer` (`src/index.ts:44-59`) trusts the runtime label and degrades a malformed probabilities map to `{}` instead of erroring; (3) the Jev native-API mapping is unimplemented (DEC-07 NOT_RUN, no Jev package in the workspace). |
| MODEL-03 | BLOCKED | **DONE** | `extension-needle` declares `tools_plan`, `structured_extract`, `validate_record`, `extract_with_repair` with contracts/schemas and runs low-level inference through the pinned managed process (`src/process-bridge.ts`, `src/engine.ts`; 8 test files). The prohibition is data: `src/contracts.ts:6-17` (no dispatcher, no registry), `:66` ("nothing in this package can execute it"), `:93-94` (inert proposals). No general-purpose chat advertisement in the manifest. |
| MOD-11 | NOT_RUN | **DONE** | Declared in `extension-embeddinggemma/tool-mode.extension.json`, implemented `src/index.ts:1028-1062` (one item embedding scored against every label, all scores in deterministic label order, abstention only below `min_score` or `min_margin`, validation `:426-456`), raw cosines with `calibrated: false` and explicitly not the decision model. Tests `tests/derived-tools.test.ts:34` (both score AND margin required), `:104` (duplicate ids / bad margins refused), `:153` (declared, separate from decision_choose). |
| MOD-12 | PARTIAL | **DONE** | The old remainder "the tool itself is not registered" is false: `semantic_deduplicate` is declared and implemented (`src/index.ts:1063+`, validator `:457`). Deterministic greedy representative grouping in input order, ties by representative order, member score relative to its own representative, chain non-transitivity preserved, no file mutation, O(n²) bounded by `MAX_DEDUPLICATION_ITEMS` before any quadratic work. Tests `tests/derived-tools.test.ts:136` and `tests/dedupe-and-rank.test.ts:106-124`. |
| TOOL-06 | PARTIAL | **DONE** | `packages/tool-mode-harness-text` ships the declarative `text_title` tool (`tool-mode.extension.json`: contractId `text.title`, implementation `kind: harness-model`, recipe `./recipes/text-title.json`) and the recipe engine enforces the rules: refusals/incomplete generations carry no title field (`tests/builtins.test.ts:6-8`), invented numbers rejected by provenance, changed meaning rejected by source overlap, lengths in `TEXT_TITLE_CONTRACT`, repair attempts counted by `mayRepairTitle`, and no tool-call field to dispatch another tool. |
| MOD-20 | DONE | **DONE** | Status unchanged; evidence refreshed. The manifest declares **7** tools (not the 3 the row claimed): multimodal_embed, semantic_similarity, semantic_rank, semantic_classify, semantic_deduplicate, dedupe_and_rank, media_find_moments. Descriptions state the real adapter support ("reads text, code, image and audio parts; a video part is refused by name"), the restriction is data (`SUPPORTED_PART_KINDS`) and refused by name rather than silently embedded; no claim of image description, transcription, OCR or calibrated decisions. |
| DEC-01 | DONE | DONE | Status unchanged (already DONE); the **stale note** "VERIFIED BLOCKER: npm `laya-ts` 404" contradicted the row and has been replaced. The npm route is not the shipped route: `extension-laya` vendors `laya-ts` and loads the pinned split-ONNX group (6/6 digests, 3 real calls in `qualification/laya.json`). |
| DEC-02 | DONE | DONE | Status unchanged; the **stale note** "BLOCKED on the same missing `laya-ts`" replaced. Maintainer export + parity are recorded in `docs/tool-mode/LAYA-INTEGRATION-FINDINGS.md`; the Node consumer runs the vendored runtime and pinned artifacts with no Python, no torch, and no npm dependency on the unpublished name. |

Rows left unchanged and why: every other row was outside this task's cited scope; no status
was changed without a cited artifact. `DEC-01`/`DEC-02` are evidence-only edits — their DONE
status was already correct, only the contradictory notes were stale.

## Regeneration (not hand-edited)

```powershell
node scripts/gen-traceability.mjs
node scripts/gen-verification.mjs
node scripts/gen-final-report.mjs
```

Status checks: `node scripts/gen-traceability.mjs --check`,
`npm run verify:verification` (models-index check + verification check + final-report check).

## Invariant this fixes

`TRACEABILITY.md` concatenates `status.json` `notes` into the status cell, which is how
DEC-01/DEC-02 read "DONE … VERIFIED BLOCKER" in one cell. With the notes corrected the cell
carries one status and one consistent explanation, and the generator output is regenerated
rather than patched.
