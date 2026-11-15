# P1 / P2 independent verification (task-37)

Status: verified 2026-11-15 against the uncommitted working tree. Verifier: independent of the
P1 and P2 implementers. No source file was edited by this verification; the only file written is
this report.

- P1 (description composer): `src/tool-description.ts` (new, 244 lines), `src/catalog.ts`,
  `src/types.ts`, `src/registrar.ts`, `src/bindings.ts`, plus the golden generator and tests.
- P2 (extension-manifest skills): `src/index.ts` (`registerSkill`, 92 added lines) and
  `tests/extension-skills.test.ts`.

## Verdict

- **P2 passes.** The manifest skill reaches `ctx.skills`, is gated by `registerSkills` and by the
  lifecycle's `requiresTools`, is withdrawn on deactivation, refuses an oversized body while
  keeping the extension active, and refuses an install whose declared body is absent. Path
  containment is present and the supported install routes reject symlinks/hardlinks, so no
  escape path was found.
- **P1 is implemented and green for the current data, with two substantive gaps and one
  acceptance shortfall** (details below, no source edits made):
  1. **Budget guard is not absolute.** `composeToolDescription` can emit more than 700
     characters for a long purpose plus optional sections (measured 817, 912 and 1,072 chars),
     contradicting the module's "total is bounded" invariant and the plan's "every description
     <= 700 characters" acceptance. Current catalog/contract data never triggers it (longest
     golden row is 652 chars).
  2. **The composer is not the only source of contract/catalog text on every model-facing
     surface.** The DSH registry path is composed, but the MCP surface still publishes raw
     `contract.description` (`mcp/host-binding.ts:249`, `index.ts:5437`), and the
     extension-manifest tool registration path (`index.ts:5203`, `:5354`) still uses the raw
     manifest description, which the P1 plan listed as a path to compose.
  3. **"100% coverage of when to use and limits" is not met literally**: the golden list has
     When to use on 16/33 rows and Limits on 17/33. This is data-driven (16 per-model catalog
     skills already carry `whenToUse`; 17 contracts carry `limits`), and no prose was
     invented to pad it.

## P1 evidence

**Single composer for the DSH tool registry (pass).** Both DSH registration entry points call the
composer: `registrar.ts:155` (`catalogToolDescription(entry)`) and `bindings.ts:201`,
`:332` (`contractToolDescription(contract)`). No other `entry.tool.description` /
`contract.description` reaches `defineTool` on these paths. The registration test asserts the
actual `ctx.tools` definition equals the composer output and that parameter schemas are
unchanged (`tool-description-registration.test.ts:109-188`).

**Section order (pass).** `tool-description.ts:126-135` renders purpose, When to use, When not to
use, Inputs and outputs, Limits, one Example, Skill; empty sections are omitted (`:128-133`).
Pinned by `tool-description.test.ts:22-40` and the fallback/bullet/one-example tests
(`:46-67`).

**700-character budget (current data passes; guard is broken).**
`TOOL_DESCRIPTION_MAX_CHARS = 700` (`tool-description.ts:18`); the golden test asserts every row
fits (`tool-description-golden.test.ts:29-35`) and the longest row is 652. However, `bounded`
(`tool-description.ts:86-110`) keeps the full purpose and reserves only
`min(head.length, 280)` (`:96`), then joins the head with the truncated sections (`:109`).
When the head is longer than the reserve, the total exceeds the budget. Reproduced from the
repository root:

```sh
npx tsx -e "import { composeToolDescription } from './packages/dsh-tool-mode/src/tool-description.ts'; \
console.log(composeToolDescription({ purpose: 'P'.repeat(500), whenToUse: 'W'.repeat(300) }).length)"
# 817  (also 912 with a 600-char purpose, 1072 with 650 + two 200-char bullets)
```

The unit test does not cover this because its purpose is 37 characters
(`tool-description.test.ts:69-83`). Suggested fix: truncate the head to leave room for the
reserved sections (or slice the final joined string to `TOOL_DESCRIPTION_MAX_CHARS`), and add a
long-purpose regression.

**Golden list (honest, generated, current).** `goldenDescriptionRows` builds 33 rows from the 16
contract-less catalog entries plus the 17 standard contracts (`tool-description.ts:196-221`);
`docs/audit/tool-description-golden.md` records "Total tools: 33" with 33 `##` rows and
`goldenDescriptionRows`/render is checked by `tool-description-golden.test.ts:20-27`. 
`node packages/dsh-tool-mode/scripts/gen-tool-descriptions.mjs --check` reports
"tool descriptions current: 33 tools" (exit 0). Descriptions are composed only from existing
catalog `tool.description`/`skill.whenToUse` and contract `description`/`unsupported`/
`limits`/`examples`; no catalog or contract data file changed in this diff, so no prose was
invented for the golden.

Coverage by section (golden): When to use 16/33, When not to use 17/33, Inputs and outputs 33/33,
Limits 17/33, Example 17/33, Skill 16/33.

**Raw descriptions that bypass the composer (gap).**
- MCP contract tools publish `published.contract.description` unchanged
  (`mcp/host-binding.ts:249`); extension contract implementations build their MCP contract from
  the raw `contract.description` (`index.ts:5437`, consumed at `:2318`).
- Extension-manifest module tools register with `declared.description` (`index.ts:5203`) and
  expose the same raw text to MCP (`:5354`); declarative recipe lanes likewise use
  `lane.tool.description` / `recipe.description` (`:5619`, `:5795`).
The plan named the extension tool registration path as a composer target, so this is a partial
P1 implementation as well as a second model-facing rendering path. The composer is the only
source for DSH-registry catalog/contract tools, which is exactly what the registration tests
cover.

## P2 evidence

**Registration is wired.** `registerSkill` (`index.ts:5458`) returns immediately when
`registerSkills` is off (`:5459`; config default true at `:752`), resolves the installed record
(`:5460`), re-reads the installed manifest (`:5467-5476`), matches the declared skill by name
(`:5477-5481`), loads the body (`:5491-5510`) and registers it with `name`, `description`,
`content`, `path` and `source: 'extension'` (`:5512-5520`). Every failure logs and returns a
no-op disposer rather than failing activation (`:5504-5527`).

**Path containment.** Manifest validation at install already refuses a missing or escaping
declared path (`packages/tool-mode-extension-sdk/src/manifest.ts:347-378`). The host re-checks
lexically: resolve against the installed root, then require `path === root || path.startsWith(root +
sep)` (`index.ts:5494-5498`). The supported installers reject archive symlinks/hardlinks
(`packages/tool-mode-extension-sdk/src/install/archive.ts:145`) and source-directory reparse
points (`source-directory.ts:38-55,115`), so the lexical check is not bypassable through a
symlink in an installed package. The containment branch has no direct test because validated
installs cannot reach it (defense in depth).

**512 KiB cap.** `MAX_SKILL_BYTES = 512 * 1024` (`index.ts:173`), checked with a stat before the
read (`:5499-5502`), so an oversized body is refused and the activation stays active. Covered by
`extension-skills.test.ts:174-185` (513 KiB body -> skill absent, extension `active`).

**requiresTools gate.** The SDK lifecycle filters the `skill` contribution before the host sees
it; an unmet requirement leaves the extension active but unregisters the skill. Covered by
`extension-skills.test.ts:148-156`. The host re-reads the manifest only for contributions the
lifecycle published, so it cannot widen the gate.

**registerSkills off.** `index.ts:5459`; covered by `extension-skills.test.ts:158-162`.

**Deactivation withdrawal.** The registrar stores the disposer returned by `registerSkill`
(`extension-registrar.ts:181-185`, `:209-210`) and `withdraw()` calls it on the contribution
handle (`:216-233`). Covered by `extension-skills.test.ts:164-172` (skill absent after
`disable`).

**Missing body.** The install route refuses a manifest whose declared skill file is absent
(`extension-skills.test.ts:187-201` asserts `/does not ship/` and that nothing is recorded as
installed).

## Diff safety / unrelated changes

The P1/P2 diff touches exactly the scoped source paths: five package sources (one new) plus the
new tests, generator and golden. No existing test was modified (the four test files are new,
untracked). The catalog parser additions are optional fields and reject malformed values
(`catalog.ts:201-213`); when absent, behavior is unchanged. `types.ts` adds optional fields only.
`index.ts` adds the skill constant/registration block; no existing behavior was altered. The
generated `verification/*` changes and `.tmp-int11.log` that appeared in the tree during this
verification are not part of the P1/P2 source diff.

## Gates (run by the verifier on the current tree)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json` | exit 0 |
| `npx tsx --test packages/dsh-tool-mode/tests/tool-description.test.ts ...-golden.test.ts ...-registration.test.ts tests/extension-skills.test.ts tests/extension-registrar.test.ts tests/host-cluster.test.ts tests/discovery-provenance.test.ts` | 52 tests, 52 pass, 0 fail, 0 skipped |
| `node packages/dsh-tool-mode/scripts/gen-tool-descriptions.mjs --check` | exit 0, "tool descriptions current: 33 tools" |
| `anti_slop_lint` on the changed/new files | new files clean; modified-file whole-file findings are pre-existing; new-code findings listed below |

Note on the gate path: the task brief's `node scripts/gen-tool-descriptions.mjs --check` does
not exist at the repository root; the generator and golden live under
`packages/dsh-tool-mode/{scripts,docs/audit}/` and the commands above use those paths.

Anti-slop findings on lines this diff actually adds (whole-file findings in
`catalog.ts`/`registrar.ts`/`bindings.ts`/`index.ts` predate this work and are not attributed
to P1/P2):

- `src/catalog.ts:205` `no-runtime-typeof` (the optional-field validator's `typeof` check; the
  surrounding parser is itself a typeof-based boundary).
- `src/catalog.ts:256-259` `no-conditional-empty-object-spread` (the four
  `...value !== undefined ? { key: value } : {}` insertions).
- `tool-description.ts`, `types.ts` and `scripts/gen-tool-descriptions.mjs` are clean.

## Concerns (file:line, severity, suggested action)

1. **`tool-description.ts:86-110` (especially `:96`, `:109`) - medium.** The budget guard can
   return 817/912/1072 characters for long valid input; current data fits (max 652), so nothing
   shipped is over budget today, but the stated invariant and acceptance are false for the
   composer. Fix: reserve `min(head.length, 280)` only after truncating the head to
   `TOOL_DESCRIPTION_MAX_CHARS - reserved`, or clamp the final join; add a long-purpose test.
2. **`mcp/host-binding.ts:249`, `index.ts:5437`/`:2318` - medium.** MCP clients receive the raw
   one-sentence contract description, not the composed, budgeted text. If P1 is meant to cover
   every model-facing surface, compose here too (and keep the MCP golden/registration assertions
   in sync); if MCP is explicitly out of scope, record that decision.
3. **`index.ts:5203`, `:5354` (and `:5619`, `:5795`) - low.** Extension-manifest and recipe tools
   still register/expose raw descriptions. The P1 plan listed the extension tool registration
   path; only the contract-implementation path (through `bindings.ts`) was composed. Either
   compose these or narrow the plan/acceptance text.
4. **Golden coverage - low.** Acceptance asks for "100% coverage of when to use and limits"; the
   honest numbers are 16/33 and 17/33. Either add guidance to the remaining catalog/contract
   entries (new prose, needs review) or amend the acceptance to "render when data exists; 100%
   of existing guidance is rendered".
5. **`docs/audit/tool-description-golden.md` location - note.** The golden lives at
   `packages/dsh-tool-mode/docs/audit/tool-description-golden.md`, not the repository-level
   `docs/audit/` the task brief names; the generator and golden test hard-code the package path.
   Fine as long as `verify:docs`/packaging are aware of the new package-local docs tree.
6. **`extension-skills.test.ts` - note.** The containment check (`escapes the installed package`)
   has no direct test; it is unreachable through the validated install routes, which is why the
   defense-in-depth branch is only code-inspected here.
7. **Minor determinism:** `goldenDescriptionRows` sorts with `localeCompare`
   (`tool-description.ts:219`); tool names are ASCII today, but a code-unit comparator would make
   the golden byte-stable across host locales.
8. **Tree hygiene:** any regenerated `verification/*` files or `.tmp-*.log` are not part of this
   change; strip them before commit if they are not intended.

## P1b re-check (task-40)

Re-verified 2026-11-15 against the task-40 working tree. Only this report was edited; no source
file was changed. Scope: `src/tool-description.ts`, `src/index.ts`,
`src/mcp/host-binding.ts`, `src/catalog.ts`, the description tests and the golden doc.

### Verdict

The three findings from the first review are closed for the current tree:

1. **Absolute budget: verified.** `bounded` now caps the purpose at 40% and `limitText`
   (`tool-description.ts:117-121`) unconditionally clamps the final join (`:130-147`). Direct
   long-input calls returned 597 / 592 / 700 / 280 / 700 / 700 characters for six adversarial
   inputs (500+300, 600+300, 650+two-200, 2000, 2000+2000+two-1000, and all-sections-2000), all
   <= 700 (the first review's same cases returned 817 / 912 / 1,072). A 300-case randomized
   sweep (purposes up to 2,000 chars, sections up to 2,000) produced max 700 and 0 over-budget.
   The Lead's quoted 597/700/700/280/700 are input-specific; the invariant, not the exact
   numbers, is what is verified here.
2. **Registry == MCP: verified for module and recipe tools, and for contract advertisement.**
   The host composes once and shares the string: module tools at `index.ts:5113-5125`, used by
   the registry (`:5237`) and MCP (`:5388`); contract implementations at `:5471`; lanes at
   `:5640-5653` / `:5658`; recipes at `:5740-5753` / `:5839`. The MCP binding composes
   contract tools (`mcp/host-binding.ts:258`). The real-fixture tests assert
   `registry.description === mcpHost.listTools()[].description` for the module fixture
   (`tool-description-surfaces.test.ts:115-127`) and the recipe fixture (`:130-141`), and the
   MCP contract advertisement is composed and differs from the raw contract text (`:144-154`).
3. **Golden header note: present and current.** The header now states the list is the static
   catalog + standard-contract set and that extension/recipe tools are composed at runtime
   (`packages/dsh-tool-mode/docs/audit/tool-description-golden.md:7-8`); 33 rows;
   `node packages/dsh-tool-mode/scripts/gen-tool-descriptions.mjs --check` exits 0 with
   "tool descriptions current: 33 tools".
4. **Catalog anti-slop additions: fixed.** The four conditional spreads are replaced by a
   mutable declaration plus explicit assignment (`catalog.ts:263-286`) and the `typeof` check by
   a String-tag boundary check (`:230-246`). The two previously reported new-code findings are
   gone. Anti-slop is clean on `tool-description.ts` and the new test files; the remaining
   whole-file findings in `catalog.ts` (`:218`, `:267`), `index.ts` (`:2334`, `:5651`,
   `:5751`) are pre-existing lines in changed hunks, not task-40 additions.

### Gates (run by the verifier on the current tree)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json` | exit 0 |
| `npx tsx --test tests/tool-description.test.ts tests/tool-description-golden.test.ts tests/tool-description-registration.test.ts tests/tool-description-surfaces.test.ts tests/extension-skills.test.ts tests/mcp-host-binding.test.ts tests/discovery-provenance.test.ts tests/host-cluster.test.ts` | 69 tests, 69 pass, 0 fail, 0 skipped |
| `node packages/dsh-tool-mode/scripts/gen-tool-descriptions.mjs --check` | exit 0, "tool descriptions current: 33 tools" |
| `anti_slop_lint` on task-40 files | new files clean; changed-line analysis: no new-code findings; catalog's prior new-code findings cleared |

### Remaining concerns (file:line)

1. **Skill-guidance lookup compares requiresTools IDs to caller-facing tool NAMES - medium.**
   `extensionSkillGuidance` selects a skill with
   `!Array.isArray(requiresTools) || requiresTools.includes(toolName)`
   (`index.ts:5089-5091`), but `requiresTools` holds manifest tool IDs: the SDK resolves each ID
   through `manifest.tools` to its caller-facing name before gating
   (`packages/tool-mode-extension-sdk/src/install/lifecycle.ts:1186-1189`). For the fixtures,
   tool id `fixture-tool` differs from name `fixture_ext_tool`, so a correctly declared skill
   would silently provide no guidance. The current tests do not catch this because both fixture
   manifests declare `skills: []`; the surfaces tests compute their expected text without
   skill guidance. Fix: resolve IDs through `manifest.tools` (same projection as the lifecycle)
   before comparing, and add a fixture with a skill whose requiresTools names the tool ID.
2. **Skill selection vs lifecycle visibility - low.** The same helper can cite a skill the
   lifecycle withheld: a skill requiring several tools is selected for a visible tool even when
   another required tool is withheld, and a skill with `requiresTools: []` is published by the
   lifecycle (`.some` over an empty array is false) but skipped by the helper
   (`index.ts:5089-5091`). Deriving guidance from the lifecycle's visible contributions, or
   matching its id resolution and empty-array semantics, would remove the disagreement.
3. **Truncation is by design.** `limitText` can cut a section mid-sentence and append an
   ellipsis; the budget is guaranteed, but the final section may end abruptly. Acceptable unless
   reviewers want section-aware truncation.
4. **Golden ordering still uses `localeCompare`** (`tool-description.ts:256`); ASCII tool names
   are stable today, a code-unit comparator would be locale-independent.
5. **Tree hygiene:** `.tmp-int11.log` / `.tmp-int12.log` and the regenerated `verification/*`
   files are not part of task-40; strip them before commit if unintended.

## P1c closure (task-41)

Confirmed. The remaining medium concern from the P1b re-check is closed by the current tree:

- `extensionSkillGuidance` now resolves each `requiresTools` entry through `manifest.tools`
  and compares the resolved caller-facing name, with the raw id as the fallback
  (`index.ts:5093-5106`). That is the same projection the SDK lifecycle applies
  (`packages/tool-mode-extension-sdk/src/install/lifecycle.ts:1186-1189`), and an absent or
  empty list is explicitly treated as no restriction (`index.ts:5095-5096`), matching the
  lifecycle's `.some`-over-empty behaviour.
- The ID-form fixture test installs a copy of the module fixture whose tool id is
  `fixture-tool` and whose caller-facing name is `fixture_ext_tool`, then asserts the composed
  registry description contains the skill's "When to use" and "Skill: see ..." lines, equals
  the MCP description, and stays within 700 characters
  (`tool-description-surfaces.test.ts:208-231`); absent (:226) and empty (:233) requirements are
  covered too. The multi-tool case is pinned at `:238-247`.
- Gates on the current tree: `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json` exit 0;
  `tool-description-surfaces` + `extension-skills` + `host-cluster` = 25 tests, 25 pass;
  `node packages/dsh-tool-mode/scripts/gen-tool-descriptions.mjs --check` exit 0 ("tool
  descriptions current: 33 tools"); anti-slop clean on the changed helper lines and the new
  surfaces test.
- Verification prerequisite, not a P1c defect: `packages/dsh-tool-mode/lib/` was absent when
  the gates first ran, so the generator reported "lib/ is not built" and two `host-cluster`
  subprocess tests failed. `npx tsc -p packages/dsh-tool-mode/tsconfig.build.json` restored the
  artifacts and all gates above passed unchanged.
- One low-severity nuance remains and is now intentional/tested: a multi-tool requirement applies
  the skill guidance to each listed tool even when another required tool is withheld, while the
  lifecycle withholds the skill contribution itself in that case, so the description can point
  at a skill the session did not register. If that is unwanted, derive the pointer from the
  lifecycle's visible contributions rather than the raw manifest.

## What this verification did not run

The full host suite (the Lead runs it separately), `verify:static`, `verify:docs`,
`verify:manifests` and the bundle gates were not run here, per the task instruction. No source
file was edited.
