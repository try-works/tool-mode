# Tool expansion plan (2026-10-20)

Scope: add tools that are backed by models **verified runnable on this platform**, and
document cross-model chains as **flows** rather than composite tools.

## Constraint that shapes everything

An extension tool loads only **its own** model. A single tool cannot call EmbeddingGemma
and Laya together. So:

- **within one extension** → a real tool (built, tested, shipped);
- **across models** → a *flow* the agent (or one Code Mode program) composes. No
  host-level composites: model-specific glue in the host is what the architecture forbids.

## Deliverables

| Deliverable | Kind | Backer | Decision |
|---|---|---|---|
| `validate_record` | needle tool | pure host logic (no engine) | build |
| `extract_with_repair` | needle tool | needle engine | build |
| `extract_multi` | needle tool | needle engine | optional |
| `dedupe_and_rank` | embeddinggemma tool | EmbeddingGemma | optional |
| `tag_by_embedding` | — | already `semantic_classify` | do not build (alias) |
| `audio_window_transcribe` | flow | embeddinggemma + voz | flow |
| `semantic_gate` | flow | embedding similarity + Laya | flow |

## Phase 0 — decisions

1. Contract ids stay extension-scoped (`@try-works/extension-needle/validate_record`).
2. Names avoid `tools_plan`, which the HOST owns (see `planning.ts`).
3. Schemas are written before code; they are the contract tests' source.
4. No plugin release is needed: manifest-declared tools register automatically.
5. Repair policy: **at most one** repair pass; unresolved issues are returned, not looped.

## Phase 1 — needle `validate_record`

Validate a caller object against a schema; return `valid`, `issues[]`, normalised record.
No engine, no assets — must work while needle is unprepared.

Tests: valid; missing required; wrong type; unsupported keyword refused by name;
`additionalProperties` respected; **no engine process started**.

Acceptance: validating a record produced by `structured_extract` yields the same `issues`
that call reported.

## Phase 2 — needle `extract_with_repair`

Run extraction; if invalid, re-run **once** with issues as repair feedback; return both
attempts and the final record.

Tests: clean document → one call (`repaired: false`); ambiguous document → two calls and a
reported outcome; token/size guards; abort; engine failure surfaces as an error, never an
empty record (MOD-02).

Acceptance: never `valid: true` with unresolved issues; never more than two engine calls;
each attempt receipted.

## Phase 3 — optional within-extension tools

- `extract_multi`: 2–3 named synthetic functions against one document; report which fired.
- `dedupe_and_rank`: dedupe then rank in one embedding pass; deterministic order.

## Phase 4 — flows (scripts + docs, not tools)

1. **audio locate → transcribe**: `media_find_moments` → `stt_transcribe` on the window →
   `semantic_similarity` of transcript vs query.
2. **semantic gate**: `semantic_similarity` → `decision_test`, threshold applied by the
   caller (threshold is policy, not model output).

## Testing ladder

| Layer | What | Tooling |
|---|---|---|
| 1 unit | pure logic/validation | `node --test` |
| 2 contract | schemas/manifest/discovery | package tests |
| 3 integration | real engine on prepared cache, receipts | `.agent-scratch/verify-one.mjs` |
| 4 negative | missing assets, bad args, oversize, abort | same |
| 5 lifecycle | install → prepare → enable → call → restart → call | disposable profile |
| 6 regression | full suite + typecheck + anti-slop lint | `npm test`, `tsc`, `anti_slop_lint` |

## Risks

| Risk | Mitigation |
|---|---|
| repair doubles latency | one pass; report attempts |
| new tools confuse selection | precise descriptions; no aliases |
| cross-model expectations | flows documented as flows |
| validator drifts from extraction | share the validator; assert equivalence |
| live host drift | disposable profile first, then `web`; one restart at end |

## Work split

- **needle-dev**: Phases 1–3 needle tools (`packages/extension-needle/`).
- **embed-dev**: `dedupe_and_rank` (`packages/extension-embeddinggemma/`).
- **flow-verifier**: Phase 4 flows and matrix wiring (`scripts/`, `docs/flows/`).
- **Lead**: contract naming, review, live verification, release.
