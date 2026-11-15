# P3 / P6 independent verification (task-43)

Status: verified 2026-11-15 against the uncommitted P3/P6 working tree. Only this report was
written by the verifier; no source file was edited. The full host suite was not run (the Lead
runs it separately).

Scope: P3 deferred loading (task-36) and P6 family disambiguation (task-42), including the
ARCH-06 reword the Lead applied while this verification was running.

## Verdict

**P3 passes its stated contract with three gaps.** `deferHeavySchemas` defaults off
(`index.ts:801`, test `defer-loading.test.ts:254-258`); the marker is supported by the SDK
(`@deepseek-ai/dsh-tools` declares `readonly deferLoading?: true`, and `dsh-llm` documents
`defer_loading`) and is carried on the DSH definition for model tools, contract tools and
contract-implementation tools. The config JSDoc states the DSH activation caveat explicitly.
Gaps: the caveat is only in code documentation/settings schema, not in a Markdown audit page;
two extension registration paths (declarative lane and recipe) do not pass the marker; and the
plan's harness-level serializer assertion and "measured context-byte reduction" are not
demonstrated (the config correctly calls it a provider hint, not a local byte reduction).

**P6 is mostly correct but not complete.** All 14 table keys are real
`STANDARD_CONTRACTS` tool names (17 contracts exist; `lang_detect`, `stt_transcribe`,
`structured_extract` have no family row by design). The docs table matches, every
`whenToUse` cue survives composition, registry==MCP parity holds for all 14 family tools
(direct probe: 0 mismatches), and every description is <=700 chars. Two substantive problems:
1. **`dedupe_and_rank` is missing.** The P6 plan names it (`docs/audit/agent-tool-optimization-plan.md:230-233`),
   it is a real registered tool (`packages/extension-embeddinggemma/tool-mode.extension.json:91`),
   but it is absent from `CONTRACT_DISAMBIGUATION`, the family test's `FAMILY` list and the
   families docs table. Its model-facing text remains the manifest description with no sibling
   cue, so the `semantic_deduplicate` vs `dedupe_and_rank` confusion P6 exists to remove remains.
2. **Budget truncation drops sibling cues and the no-OCR caveat.** `whenToUse` always survives,
   but 7 of 14 tools lose at least one `whenNotToUse` bullet because the composer truncates
   sections evenly (see table below). In particular `describe_image` loses
   "No OCR contract exists; this is image description, not transcription." from the composed
   (and golden) text, even though the source line is present and ARCH-06 now passes.

**Resolved finding (ARCH-06).** The Lead's reword at `tool-description.ts:258` is present
("No OCR contract exists; this is image description, not transcription."), `architecture.test.ts`
is 27/27, and `node packages/dsh-tool-mode/scripts/gen-tool-descriptions.mjs --check` reports the
golden current (33 tools). The reworded line still carries the no-OCR caveat in SOURCE, but (see
P6-2) it is truncated out of the composed/golden description, so the model does not see it.

## P3 evidence

- **Selection is pure and measurable.** `DEFER_HEAVY_SCHEMA_TOOL_IDS` and the 1024-byte
  threshold are in `registrar.ts:16-75`; `shouldDeferHeavySchema` selects an explicit id even
  when small, matches the `semantic_*` prefix, and uses strictly-greater-than at the threshold
  (`registrar.ts:62-76`). Tests cover all four behaviours (`defer-loading.test.ts:95-130`).
- **Carried on the definition** for model tools (`registrar.ts:219-235`), contract tools
  (`bindings.ts:201-215`) and contract-implementation tools (`bindings.ts:344-356`); module
  extension tools compute it in `index.ts:5275-5285` and contract implementations call through
  at `index.ts:5514`. Captured-definition tests assert the marker and that name, description
  and parameters are unchanged (`defer-loading.test.ts:169-236`).
- **Default off and no marker leakage to MCP.** `Config({}).deferHeavySchemas === false`;
  absent/false options register no marker (`defer-loading.test.ts:188-197`); the MCP binding
  never reads the marker.
- **Caveat documented, but only here.** `index.ts:632-651` has a paragraph explicitly headed
  "DSH CAVEAT": the serializer still writes name/description/input_schema and appends
  `defer_loading`; activation needs a `developer/message` `tool-addition`, which is emitted
  when the tool LIST changes, so a stable first-party list may leave selected tools unactivated;
  the flag is a provider loading hint, and default off keeps probes unchanged. The same caveat
  is restated in the `defer-loading.test.ts:10-14` header. It is **not** in the Markdown plan
  or any audit page, and `deferHeavySchemas` is a plain `z.boolean()` rather than a
  `settingsField`, so the Settings UI has no description carrying the warning.

### P3 concerns

1. **Caveat placement — medium.** `index.ts:632-651` documents the activation risk well, but
   only in source. Add the same paragraph to
   `docs/audit/agent-tool-optimization-plan.md` (P3 section) or a short P3 note, and consider
   `settingsField` so the operator sees it where the flag is enabled. Keep the flag off.
2. **Declarative lane and recipe tools are not deferred — medium.**
   `index.ts:5695` (lane `defineTool`) and `index.ts:5795` (recipe `defineTool`) do not
   compute `shouldDeferHeavySchema` or spread a marker (grep: `deferMarker` appears only at
   `:5280` and in bindings). Recipe/lane schemas can be large; the plan says "extension
   registration" without excluding them. Either apply the helper or state the exclusion.
3. **Plan acceptance is not demonstrated — low.** `defer-loading.test.ts:238-251` "measured
   schema-byte delta" is arithmetic over synthetic declarations; it does not measure a context
   reduction, and the caveat correctly says there is none locally. The plan's
   "Harness-level: assert the DeepSeek serializer emits `defer_loading`"
   (`agent-tool-optimization-plan.md:156-157`) has no test in this tree. Amend the acceptance
   to "the declaration carries the hint; provider-side savings are the provider's contract",
   or add the serializer probe.

## P6 evidence

- **Keys are real contract tool names.** A direct probe found all 14
  `CONTRACT_DISAMBIGUATION` keys in `STANDARD_CONTRACTS` (17 total; the 3 without a row are
  `lang_detect`, `stt_transcribe`, `structured_extract`). The family test asserts the same
  membership and rejects the dead draft names `suggest_title`/`extract_fields`
  (`tool-description-family.test.ts:55-66`). The docs table lists the same 14 rows
  (`packages/dsh-tool-mode/docs/audit/tool-description-families.md:16-31`).
- **Composition and parity.** Guidance is merged into the P1 section order in
  `contractToolDescription` (`tool-description.ts:343-360`). A direct probe built an MCP host
  for each of the 14 real contracts and compared `listTools()[].description` with
  `contractToolDescription`: **0 mismatches**, so `descriptionFor`
  (`mcp/host-binding.ts:93-102`) keeps registry==MCP for real contracts (it composes when a
  contract carries `unsupported` + `limits`, and only falls back to the raw description for
  contract-shaped test doubles).
- **Cue survival within 700.** Every `whenToUse` cue survives; every composed description is
  <=700 (max 691, `semantic_classify`). But the "names a sibling" guarantee is weak: the
  family test only requires one sibling (`tool-description-family.test.ts:77-88`), and
  truncation removes other cues. Measured missing `whenNotToUse` bullets:

  | Tool | Missing bullet(s) from composed text |
  | --- | --- |
  | text_embed | "Use multimodal_embed..."; "Use semantic_rank to order existing candidates..." |
  | text_rerank | "Use semantic_rank when embedding cosine ranking is enough." |
  | describe_image | "No OCR contract exists; this is image description, not transcription." |
  | multimodal_embed | "Use semantic_similarity to compare two items..." |
  | media_find_moments | "Use text_rerank for text documents..." |
  | decision_choose | "Use tools_plan to propose tool calls..." |

  `describe_image` is the sharpest case: the reworded ARCH-06 line is in source and golden,
  but the composed string is 575 chars only because 1 section was cut, and the cut is exactly
  the no-OCR caveat (golden `describe_image` shows the when-not-to-use section ending
  "place an image description into a fi…"; "OCR" does not appear).

### P6 concerns

1. **`dedupe_and_rank` has no disambiguation row — medium.** Plan line 232 names it; the real
   tool is declared at `packages/extension-embeddinggemma/tool-mode.extension.json:91` and its
   description comes through the extension path (`extensionToolDescription`), which has no
   table hook. Add a host-side extension-guidance row/skill, or document the exclusion in
   `tool-description-families.md` alongside the `extract_fields` note.
2. **Composer truncation drops disambiguation — medium.** Prioritize `whenToUse`+`whenNotToUse`
   over limits/example when fitting 700 chars (or shorten the purpose/limits for family
   contracts), and add a test that every guidance bullet survives, not just one sibling.
   Until then, P6's acceptance ("a reader can pick the right member from its description
   alone") is not met for the tools in the table above.
3. **Resolved:** the ARCH-06 reword is accepted; source line 258 is declarative, still says
   no OCR/not transcription, and `architecture.test.ts` is 27/27. The golden is current
   (`--check` exit 0). This finding is recorded as resolved; the truncation in (2) is a
   separate P6 issue, not an ARCH-06 regression.

## Gates (verifier, current tree)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json` | exit 0 |
| `npx tsx --test tests/defer-loading.test.ts tests/tool-description.test.ts tests/tool-description-golden.test.ts tests/tool-description-registration.test.ts tests/tool-description-surfaces.test.ts tests/tool-description-family.test.ts tests/mcp-host-binding.test.ts tests/contracts-registration.test.ts tests/discovery-provenance.test.ts` | 94 tests, 94 pass, 0 fail, 0 skipped |
| `node packages/dsh-tool-mode/scripts/gen-tool-descriptions.mjs --check` | exit 0, "tool descriptions current: 33 tools" |
| `npx tsx --test tests/architecture.test.ts` (extra, confirms the ARCH-06 reword) | 27 tests, 27 pass |
| `anti_slop_lint` on changed files | new files clean; see below |

Anti-slop on changed lines: `tool-description.ts` (the 205-380 addition, including the whole
table) is clean; `host-binding.ts` changed lines are clean; both new tests are clean;
`registrar.ts` additions are clean (the findings at `:214`/`:238`/`:242` are pre-existing
register-signature and render casts). `bindings.ts:205` (the `toDshParameters(...) as unknown as
ParameterSchemaSpec` cast moved into a variable by P3) is flagged for a missing `SAFETY:` tag;
the neighbouring comment explains the invariant but predates the tag convention. `index.ts`
changed lines add no findings (the flagged `:2788`/`:2830`/`:2862`/`:2848` lines are
pre-existing call-site casts/context).

## P3b/P6b closure + wiring (task-44/45 + Lead wiring)

Re-verified 2026-11-15 on the current tree. Only this report was edited; no source file was
changed.

1. **Declarative/recipe lanes and the documentation caveat - fixed.**
   `defer-loading-paths.test.ts:102-140` installs copied declarative and model-runtime fixtures,
   activates them through the real extension service, and asserts `ctx.tools.schemas()` carries
   `deferLoading: true` for `multimodal_embed` when the switch is on and omits the marker when
   off (4 tests). The code matches: the declarative lane (`index.ts:5699-5715`) and the recipe
   lane (`:5811-5827`) compute `shouldDeferHeavySchema` and spread the marker. The caveat now
   lives in `docs/audit/deferred-loading.md:58-88` (activation requires a `tool-addition`;
   a stable first-party list may leave selected tools unactivated; keep the flag false) and in
   the Config schema description (`index.ts:802-812`, including "provider loading hint, not a
   local byte reduction" and the docs pointer); default remains false.
2. **Decision-first budget - fixed.** `boundPurpose`/`bounded` (`tool-description.ts:128-198`)
   preserve the when-to-use and when-not-to-use sections before inputs/limits/example. Recomputed
   all 14 family contracts: 510-691 characters, **0 dropped decision bullets**; `describe_image`
   includes "No OCR contract exists; this is image description, not transcription." and the
   golden carries it (`packages/dsh-tool-mode/docs/audit/tool-description-golden.md:112`). The
   family test asserts every bullet plus the OCR line (`tool-description-family.test.ts:104-127`).
   Trade-off, intended by decision-first: 6/14 family descriptions now omit `Example:`, and
   `text_embed` omits `Limits:`, because lower-priority sections yield to the decision text.
3. **`dedupe_and_rank` - fixed.** `EXTENSION_TOOL_DISAMBIGUATION` (`tool-description.ts:365-375`)
   keys the tool; `extensionToolDescription` applies it only when `toolName` is supplied
   (`:73-84`), and every production call site now passes it - module (`index.ts:5168-5169`),
   lane (`:5699-5700`), recipe (`:5811-5812`). Composing the real manifest description from
   `extension-embeddinggemma` yields 674 characters with all three sibling bullets and the cue
   (<=700); the family test pins the composed text and the "unnamed call cannot apply the table"
   case (`tool-description-family.test.ts:149-173`).
4. **Golden - current.** `--check` exits 0 with "tool descriptions current: 33 tools"; the
   golden's `describe_image` section now carries the no-OCR caveat (line 112).

Gates (verifier, current tree):

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json` | exit 0 |
| `npx tsx --test tests/defer-loading.test.ts tests/defer-loading-paths.test.ts tests/tool-description.test.ts tests/tool-description-golden.test.ts tests/tool-description-registration.test.ts tests/tool-description-surfaces.test.ts tests/tool-description-family.test.ts tests/mcp-host-binding.test.ts tests/architecture.test.ts` | 98 tests, 98 pass, 0 fail, 0 skipped |
| `node packages/dsh-tool-mode/scripts/gen-tool-descriptions.mjs --check` | exit 0, "tool descriptions current: 33 tools" |
| `anti_slop_lint` on changed files | tool-description changed ranges clean; both new tests clean; index changed lines clean (the `:5295` cast is a pre-existing line) |

Remaining minor concerns:

- **`deferred-loading.md:36-52` byte table is not exactly reproducible (low).** The selected set
  matches exactly (same 11 tools), but a recomputation using the registration serialization gives
  10,024 B of 26,525 B (37.8%, eager 16,501) versus the doc's 10,172 B of 26,563 B (38.3%, eager
  16,391); per-tool deltas reach ~6% (stt_transcribe 1,328 vs 1,379; media_find_moments 738 vs
  792). This changes no selection; label the measurement method (projection versus registration
  bytes) or refresh the table.
- **`dedupe_and_rank` has unit + call-site coverage but no mounted-fixture description test
  (low).** The deferral lanes now have that; a fixture assertion on the registered description
  would prove the wiring end to end rather than by inspection.
- **Config description placement (note).** The caveat is in the Config schema via
  `.description(...)` on a plain `z.boolean()` (`index.ts:802-812`), not `settingsField`; whether
  the Settings UI renders non-`settingsField` descriptions was not verified here.

No blocker remains for P3/P6. The full host suite was not run (Lead runs it separately); no
source file was edited.
