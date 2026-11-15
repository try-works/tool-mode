# Agent tool-selection optimization plan

Status: **complete** — P1 + P2 shipped in `@try-works/dsh-tool-mode@0.5.63`; P3 (opt-in) + P6 in `0.5.64`; P4 + P8 in `0.5.65`; P5 + P7 in `0.5.66`. Every phase is test-first and independently verified.
Related: [inventory-audit.md](./inventory-audit.md), [tool-mode-agent-flow.md](./tool-mode-agent-flow.md), [verification-p1-p2.md](./verification-p1-p2.md), [deferred-loading.md](./deferred-loading.md).

## Progress

| Phase | State | Evidence |
| --- | --- | --- |
| P1 description composer | **done** (0.5.63) | `src/tool-description.ts`, 700-char absolute budget, golden 33 tools; P1b added extension/recipe + MCP composition, P1c fixed skill-ID resolution; verifier closed all findings |
| P2 extension manifest skills | **done** (0.5.63) | `registerSkill` in `src/index.ts`; 6 tests; verifier PASS |
| P3 deferred loading | **done** (P3 + P3b, default **off**) | `src/registrar.ts` selection; [deferred-loading.md](./deferred-loading.md); 18 tests across the registrar/bindings and both recipe lanes |
| P4 discovery split | **done** (0.5.65) | `tool_mode_list` now splits into registered `tools` + `unavailable[]` with the same state/reason; `tool_mode_describe` explains a non-callable name; MCP schema updated |
| P5 prompt section | **done** (0.5.66) | one bounded Tool Mode section (`tool-mode:readiness`), non-complete, guarded on `ctx.get('systemPrompt')`; snapshot + coexistence tests |
| P6 family disambiguation | **done** (0.5.64) | decision-first budget keeps every when-not bullet; dedupe_and_rank covered via extension guidance; [tool-description-families.md](../packages/dsh-tool-mode/docs/audit/tool-description-families.md) |
| P7 MCP parity/usage | **done** (0.5.66) | registry==MCP description parity tests, model-surface agreement across `model_tools`/`tool_mode_list`, never-called rows pinned by tool-inventory/tool-insights tests; review cadence in [inventory-audit.md](./inventory-audit.md#8-shipped-update-2026-11-15) |
| P8 restart boundary | **done** (0.5.65) | explicit sentence in Settings, README and two guide pages, pinned by `restart-boundary.test.ts` |

## 0. Goal, non-goals, principles

**Goal:** the agent should know (a) which tools exist and which are deliberately absent,
(b) when to use each one and when not to, (c) what it costs to carry its schema, and
(d) how to discover tools it cannot call directly.

**Non-goals:** changing contract semantics, adding models, or reworking the runtime engines.

**Principles**

1. The model-facing tool description is a **contract**, not decoration: it is the only
   text the agent sees before choosing. Skills are depth and are loaded on demand.
2. **One composer** produces every registered tool's description. A catalog entry, a
   standard contract and an extension manifest must not each invent their own copy.
3. **Discovery is separate from execution**: listing must never advertise a name that a
   program will refuse wholesale.
4. Every change is test-first and gated by the repository's own verification suite.

## 1. Baseline (measured from the current tree)

| Fact | Value |
| --- | --- |
| Catalog model tool descriptions | 18, min 99 / avg 122 / max 149 chars — a sentence, no explicit when/when-not, limits or example |
| Standard contract descriptions | 17, min 42 / avg 146 / max 433 chars |
| Extension manifests with declared skills | Yes — but lifecycle contributes only `kind:'skill', name` and the host registrar has **no `registerSkill`**, so extension skills are dropped |
| `deferLoading` in the plugin | 0 occurrences (the harness `defineTool` supports it; `llm-deepseek` serializes `defer_loading`) |
| Discovery agreement | model_tools and tool_mode_list now share `modelSurface` state (0.5.62) |
| Tool Mode prompt section | none — the plugin injects only `tools` |

**Success metrics** (asserted in tests, reported before/after):

- coverage: every registered tool description contains a "When to use" cue and a limits
  cue; no description exceeds the agreed byte budget;
- context: measured tool-schema bytes per request drop for heavy tools when deferral is on;
- discovery: `tool_mode_list.tools` contains only registered names, and every catalog
  name that is absent appears in `unavailable` with its state and reason;
- prompt: the Tool Mode section exists exactly once and is ≤ 1200 characters;
- parity: `model_tools`, `tool_mode_list` and the MCP surface agree on
  model ↔ tool ↔ state;
- hygiene: a committed golden snapshot of the model-facing tool list makes every text
  change reviewable.

## 2. Phases

Ordered by impact and dependency. Each phase follows the same shape: **write the failing
tests first**, implement, run the phase gates, then the full gates. Phases are released
independently (patch versions) so each can be reverted alone.

### P1 — One description composer (impact 1, 6, 9)

**Why:** every tool's model-facing text is currently a one-sentence string copied from
its catalog/contract/manifest. There is no place to say when *not* to use it, what it
costs, or a short example.

**Changes**

- New `src/tool-description.ts`: pure `composeToolDescription(input)` that assembles, in
  a fixed order: purpose → **When to use** → **When not to use** → inputs/outputs →
  limits (size, units, latency class) → one short example → fallback pointer to the
  skill.
- Extend the catalog schema (`src/catalog.ts`) with optional `tool.whenToUse`,
  `tool.whenNotToUse`, `tool.limits`, `tool.example`; when absent, fall back to
  `skill.whenToUse` so the 18 entries do not all need new prose on day one.
- Use the composer in `registrar.ts` (catalog tools), `bindings.ts` (contract tools) and
  the extension tool registration path; do not change parameter schemas.
- Add a generator `scripts/gen-tool-descriptions.mjs` that prints the model-facing list
  to `docs/audit/tool-description-golden.md`; the test compares against it so text
  changes are reviewed like code.

**TDD**

- `tests/tool-description.test.ts`: section order, missing-part fallbacks, byte budget,
  no empty sections, one example maximum.
- `tests/tool-description-registration.test.ts`: mount the plugin and assert every
  registered tool's description equals the composer output (catalog, contract and
  extension tools).
- Golden test: the rendered model-facing list matches the committed snapshot.

**Gates:** `tsc`; the two new test files; discovery/control-surface suites; full host
suite; `verify:static`; `verify:docs`; anti-slop on the new module.

**Acceptance:** 100% coverage of "when to use" and limits; every description ≤ 700
characters; golden diff reviewed; no existing test rewritten except the golden.

### P2 — Register extension-manifest skills (impact 2)

**Why:** Needle, Laya, Mirage, MiniLM and EmbeddingGemma are exactly the models with no
catalog skill. Their manifests already declare skills (description, path,
`requiresTools`), and the lifecycle already gates them by visible tools — but the host
never supplies `registerSkill`, so the contribution is silently dropped.

**Changes**

- Implement `registerSkill` in the host's contribution registrar (`index.ts`):
  resolve the installed package record, read the manifest skill by name, load its
  content from the declared path, register it through `ctx.skills` when
  `registerSkills` is on.
- Consider an SDK follow-up: carry `description` and `path` on the `skill`
  contribution so the host does not re-read the manifest (requires an SDK version bump;
  start with the host-side lookup, which needs no wire change).
- Keep the lifecycle's `requiresTools` gating: a skill whose tools are withheld must not
  be advertised.

**TDD**

- `tests/extension-skills.test.ts`: activate a fixture extension with a declared skill →
  `ctx.skills` contains it with description and content; `requiresTools` unmet → not
  registered; `registerSkills:false` → not registered; deactivation removes it.
- Catalog skills keep their existing test.

**Gates:** extension-registrar/lifecycle tests; host-cluster; full host suite;
`verify:manifests`; `verify:docs` (skill catalog docs if generated).

**Acceptance:** every installed extension's manifest skills appear in the session skill
catalog; nothing appears for withheld tools; disabling skills is honored.

### P3 — Deferred loading for heavy schemas (impact 3)

**Why:** all schemas ride every request. The harness supports `deferLoading` and
DeepSeek serializes `defer_loading`; the plugin uses neither.

**Changes**

- Optional config `deferHeavySchemas` (default **off** initially): mark tools whose
  model-facing schema exceeds a size threshold, or an explicit list
  (`multimodal_embed`, `media_find_moments`, `extract_with_repair`, `structured_extract`,
  `tools_plan`, `semantic_*`).
- Pass `deferLoading: true` through `defineTool` in the registrar/bindings/extension
  registration; document the DSH developer-message activation path the model must use.
- Keep the catalog and `tool_mode_list` as the on-demand index so a deferred tool is
  still discoverable.
- Operator-facing semantics, selected ids and the activation caveat:
  [deferred-loading.md](./deferred-loading.md). The flag is read at registration time and is
  default OFF; enable it only once the DSH activation path is wired.

**TDD**

- `tests/defer-loading.test.ts`: chosen schemas carry `deferLoading`; non-chosen do not;
  deferred schemas still carry name/description/parameters; the plugin's MCP surface is
  unchanged (MCP is contract-based, not deferral-based).
- Harness-level: the DeepSeek serializer assertion is **DSH-owned** (the package is not a
  dependency of this repo); this plugin asserts the marker survives to
  `ctx.tools.schemas()`. DSH covers `defer_loading` in its own test suite.
- Measure schema bytes before/after in the test and assert the expected reduction.

**Gates:** `tsc`; new test; control-surface/discovery; full host suite; `verify:mcp`;
`verify:packed`.

**Acceptance:** context bytes for the selected tools drop by the measured delta; a
deferred tool still executes after the documented activation; default-off keeps every
existing probe unchanged.

### P4 — Split discovery into callable and unavailable (impact 4, 5)

**Why:** `tool_mode_list` still mixes catalog rows that are not registered with callable
tools, and readiness is invisible to the model. A listed name can make a whole program
refuse.

**Changes**

- `tool_mode_list` result: `tools` = registered/callable names only (with
  `state:'callable'`), plus a new `unavailable` array
  `{ name, model, extension, state, reason }` sourced from `modelSurface`.
- `tool_mode_describe` of a non-callable name returns the reason and the action that
  would clear it, not a fabricated schema.
- Update the discovery description: "only `tools` may be bound in a program".
- Keep the catalog revision and existing fields; MCP uses the same inventory.

**TDD**

- Extend `tests/model-surface-agreement.test.ts`: every catalog name is either in
  `tools` or in `unavailable` (exactly once); `tools` names are all registered;
  `unavailable` carries the same state/reason as model_tools.
- `tool_mode_run` test: a program binding only `tools` never fails the whole-request
  gate for an unavailable catalog name.
- MCP parity test: the MCP published/withheld split matches the same state.

**Gates:** ext32-discovery, mcp-host-binding, control-surface; full suite; `verify:mcp`.

**Acceptance:** no name in `tools` can be refused as unattainable; every absent catalog
model is explained once.

### P5 — Readiness hint and the Tool Mode prompt section (impact 5, 8)

**Why:** the agent sees neither the readiness vocabulary nor the discovery workflow. A
short prompt section is cheaper than repeating it in every description.

**Changes**

- Register one `systemPrompt` section, order after the tool sections, titled
  **Tool Mode**: callable vs unavailable, "list/describe first in Code Mode",
  prepared-cold loads the engine on first call, receipts exist per call.
- Guard the registration on `ctx.get('systemPrompt')` so a host without the service is
  unaffected; test both presets.
- Point `tool_mode_list`'s description at the section.

**TDD**

- `tests/tool-mode-prompt.test.ts`: assemble the prompt in a mounted host → section
  present exactly once, ≤ 1200 chars, contains the four facts; absent service → no
  section and no throw; an agent preset with a complete section still renders.
- Snapshot the section text.

**Gates:** host suite; `verify:docs`; full suite.

**Acceptance:** section present once, bounded, and the tool_mode_list description
references it.

### P6 — Disambiguate the embedding family (impact 6)

**Why:** seven embedding-ish tools are easy to confuse, and their names do not say when
to choose one over another.

**Changes**

- Rewrite P1-composed descriptions for `text_embed`, `multimodal_embed`,
  `semantic_similarity`, `semantic_rank`, `semantic_classify`,
  `semantic_deduplicate`, `dedupe_and_rank`, `media_find_moments` with explicit
  "choose this when / choose X instead when" lines.
- Add a short comparison table to the user docs; no contract change in this phase.
- Optional follow-up (own decision): collapse the family into one operation-parameter
  tool; explicitly out of scope here.

**TDD**

- Extend the golden description test; a dedicated test asserts each family member names
  its distinguishing input or operation and at least one sibling to prefer instead.
- Token budget: the family's total description bytes must not grow beyond the P1 budget
  without review.

**Gates:** golden review; docs; full suite.

**Acceptance:** a reader can pick the right member from its description alone.

### P7 — MCP parity and usage feedback (impact 9)

**Why:** the same model ↔ tool ↔ readiness truth must hold for external clients, and
zero-call tools are the signal to prune or rewrite.

**Changes**

- Reuse `modelSurface`/the inventory triple in the MCP export decision and in
  `model_tools action:'mcp'`; a withheld tool keeps its named reason.
- Add a read-only review surface (or extend diagnostics) that lists tools with zero calls
  over the range plus their description byte size, so description work is driven by data.
- Document the review cadence in `docs/audit/inventory-audit.md`.

**TDD**

- Parity test: for every catalog model, `model_tools list`, `tool_mode_list` and the MCP
  published/withheld decision agree on state and tool name.
- Usage test: the review surface includes a never-called tool with 0 calls and its
  description size; no payload/args leak.

**Gates:** `verify:mcp`; usage/inventory tests; full suite.

**Acceptance:** one truth across all three surfaces; a zero-call list is available.

### P8 — Header churn and the restart boundary (impact 7)

**Why:** installing/activating mid-session changes the pinned tool list and starts a new
request series; the config already says changes apply after restart, but the guidance is
implicit.

**Changes**

- Documentation and config copy: "model and tool registration changes apply after
  restart"; auto-provisioning already runs at boot.
- Test the copy on the settings page and the README claim (no behavior change).
- If desired later, gate mid-session registration behind an explicit "apply now" action;
  not required for this plan.

**TDD**

- Copy tests: settings page and README contain the restart sentence; no test asserts
  mid-session registration behavior changes.

**Gates:** client bundle check; docs; full suite.

## 3. Cross-cutting verification protocol

For **every phase**, in order:

1. **Tests first**: commit the failing test(s); the TDD records under
   `verification/tdd/` capture the red/green evidence.
2. `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json`
3. Targeted suites for the touched modules (`tsx --test …`).
4. `npm run build:host` and, if the client bundle moved,
   `node packages/dsh-tool-mode/scripts/gen-client-catalog.mjs --check`.
5. `npm run verification` (final report/artifacts current).
6. `npm run verify:static`, `npm run verify:docs`, `npm run verify:manifests`,
   `npm run verify:mcp`.
7. `npm run test:integration:dsh` (full host suite) and the affected SDK/extension
   suites.
8. Text-changing phases: regenerate the golden description doc and review the diff and
   byte budget in the PR/commit message.
9. `anti_slop_lint` on every new module and test.
10. Release gate: `npm run verify:release`; bump the patch version; publish; reinstall
    into the web profile; report whether a restart is required.

**Rollback:** each phase is a separate commit/version; a description-only phase reverts
cleanly, P3 is behind a default-off flag, P4 keeps `tools` compatible by adding
`unavailable`, P5 is guarded on the prompt service.

## 4. Measurable acceptance summary

| Phase | Primary metric |
| --- | --- |
| P1 | 100% of registered tools have when-to-use + limits; ≤ 700 chars; golden reviewed |
| P2 | all manifest skills of installed extensions in the session catalog; withheld tools excluded |
| P3 | selected schemas carry `deferLoading` on every registration path; measured deferrable declaration payload (a provider hint, NOT a local byte reduction); default off; activation caveat documented in [deferred-loading.md](./deferred-loading.md) |
| P4 | `tools` = registered only; every catalog model once in `tools` ∪ `unavailable` |
| P5 | one bounded Tool Mode prompt section; references discovery |
| P6 | family disambiguation assertions per tool |
| P7 | three-surface parity; zero-call report |
| P8 | restart copy asserted; no mid-session registration change |

## 5. Agent-team execution (disjoint scopes)

| Phase | Owner | Write scope |
| --- | --- | --- |
| P1 | model-map | new `src/tool-description.ts`, catalog schema/JSON, registrar/bindings, tests, golden generator |
| P2 | core-runtime | `src/index.ts` registrar wiring, `src/extension-registrar.ts`, tests |
| P3 | litert-provider | registrar/bindings/config + tests (coordinate `src/index.ts` with P2 sequentially) |
| P4 | effect-v4 | `src/index.ts` discovery actions + tests (after P3) |
| P5 | model-map | new prompt module + tests |
| P6 | model-map | catalog prose + golden tests |
| P7 | doc-reviewer | MCP parity + usage review tests, docs |
| P8 | doc-reviewer | copy tests/docs |
| verifier | tardigrade-audit | independent gate run + diff safety review per phase |

Serial dependencies: P1 → P6; P2 and P1 can run in parallel; P3/P4 both touch
`src/index.ts`, so run them sequentially; P5/P7/P8 are independent.

## 6. Risks

- **Description bloat** raises every request's context. Mitigate with the byte budget,
  golden review, and P3 deferral.
- **Deferred tools are invisible until activated**; the model must learn the activation
  path. Keep P3 default-off and document the DSH behavior.
- **Prompt section conflicts** with agent presets that supply a complete section. Test
  both; keep the section non-complete.
- **SDK skill contribution shape**: the host-side lookup avoids a wire change now; an SDK
  enrichment is a separate versioned step.
- **Golden snapshots** can be rubber-stamped; require the generator diff and byte budget
  in review.
- **Test pinning**: text changes will touch descriptions in tests; update intentionally,
  never to make a red test pass.

## 7. Suggested first release

P1 + P2 together (description composer and extension skills) deliver most of the
selection improvement with no runtime risk; P3 follows as an opt-in perf change; P4/P5
make discovery trustworthy. Start with P1 and P2, verify, publish a patch release, then
re-evaluate with the golden snapshot and the zero-call review.