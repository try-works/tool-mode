# Proposal: name-keyed recipe bindings (RCP-02/RCP-03)

**Requirement under review:** RCP-02 (published recipe vocabulary), RCP-03 (binding pointers).
**Status:** accepted for this implementation; the pinned spec prose remains the historical text of record.

## Current text

The specification's recipe example uses JSON Pointer bindings (`/image_path`, `/focus`) and RCP-03 describes pointer traversal.

## Proposed text

A recipe declares a closed, name-keyed `inputs` map. `inputBindings` entries name a
top-level simple identifier through a validated RFC 6901 pointer (e.g. `/focus`); a
nested or escaped pointer is refused because the host argument map is flat.

## Rationale

A pointer is a small traversal language, and RCP-03 has to reject traversal past a
reserved member, `~0`/`~1` escapes and array indices. A closed identifier map removes
that entire class of abuse by construction. The published JSON Schema
(`packages/tool-mode-recipes/schema/harness-model-recipe.schema.json`) documents this
implementation truth and a parity test proves code and schema reject the same damaged
documents. Refusing nested pointers explicitly is safer than silently accepting a
pointer the host cannot resolve.

## Compatibility and disclosure

- Existing shipped recipes are unchanged (they already use the name-keyed form).
- RCP-03 still validates RFC 6901 grammar for the pointer string before the flat-map
  restriction, so an invalid escape is a grammar error, not an unbound input.
- The schema `$comment` and recipe module header disclose the deviation; describe output
  states the closed-map vocabulary.
- Spec text is not rewritten; this proposal is the review record. A future spec revision
  may adopt the name-keyed form explicitly.

## Evidence

- `packages/tool-mode-recipes/tests/schema-parity.test.ts` — code/schema parity.
- `packages/tool-mode-recipes/tests/canonical-vocabulary.test.ts` — RFC 6901 escape and
  nested-pointer refusals.
