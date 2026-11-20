# Artifact-specific verification field

**Status:** source-verified, TDD red -> green. **Target release:** 0.5.104.

## Why

The 0.5.101 live check showed the counters are not a correctness signal: a draft with 61
uses and 0 failures was wrong (E22). The first fix was a generic `Verify its output on edge
cases` clause. This change adds the missing source of truth: an optional, author-supplied
verification/known-failure note that the digest can render verbatim.

## What changed

- `AgentToolDefinition` / `AgentToolSummary` carry `verification?: string`.
- `saveTool`, `saveDraft`, `define`, `clone`, `from-run` and promotion preserve or accept it.
- `tool_mode_tools define` and `from-run` expose a `verification` argument.
- The digest renders `Verify: <note>` for an artifact that has one, suppresses the generic
  unverified warning for that row, and does not render the `Evidence:` counter line.
- An artifact without a note keeps the generic fail-safe warning; a kept artifact without a
  note may still show counts.

## TDD evidence

```text
npx tsx --test packages/dsh-tool-mode/tests/adoption-verification.test.ts
red:   2 tests, 0 pass, 2 fail
green: 3 tests, 3 pass, 0 fail   (third: define -> prompt digest integration)
```

The first red failure was `verification: undefined` after `saveTool`; the second was the
generic warning where the specific note was expected.

Adjacent verification/authoring/adoption suites: **32 tests, 32 pass**. Typecheck: exit 0.
`anti_slop_lint` is clean on the changed authoring, surface, digest and ranking files; the
only findings on `index.ts` are pre-existing naming rules outside this change.

## Remaining limits

- The note is author-supplied; the host does not infer it from a wrong answer. A future
  verification hook could record an explicit failed check rather than only a thrown error.
- Workflows do not yet carry the field; tools are the measured artifact class.
- This is metadata: it does not change the content digest, so adding a note does not fork
  the artifact identity.
