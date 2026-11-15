# Verification: 0.5.69 and 0.5.70

Status: independently verified 2026-11-15 against commits `e3d6430` (0.5.69) and `ab94236`
(0.5.70), which is HEAD. Only this report was written; no source file was edited. The full host
suite was not run (the Lead runs it separately).

**Working-tree note.** The tree was clean when verification started, but a concurrent UNRELATED
task-54 edit landed while the gates ran (`decision-combine.ts` at 17:40,
`decision-evaluate.ts` and `tests/harness-llm.test.ts`; `index.ts` at 17:49, 119 added lines).
Those changes add host-authored `meta` envelopes to the `decision_*` tools and are not part
of 0.5.69/0.5.70; the reviewed index.ts paths were unchanged from `ab94236` during the gates.
All file:line references below are for commit `ab94236`; in the current working tree, lines
after `index.ts:5035` are shifted by the unrelated insertion.

Scope:

- **0.5.69** — agent-authored workflows/tools (`src/agent-authoring.ts`, host registration and
  receipts in `src/index.ts`), the Code Mode bundled-evidence fallback
  (`src/ptc-confinement.ts`, `src/ptc-runtime.ts`, `scripts/check-confinement-evidence.mjs`),
  the bundled artifact, and the actionable refusal text.
- **0.5.70** — contract/contractVersion/schemaAvailable in `tool_mode_list`, the callable-only
  invariant, and receipts with required `at`/`runId` plus `parentReceiptId`/`outcome`
  (`src/receipt.ts`, `src/receipt-store.ts`, `src/discovery-contracts.ts`, `src/index.ts`).

## Verdict

- **Authored-code security boundary: PASS, no privilege escalation found.** Authored code never
  executes outside the host's `ProgramRunner`; the gate is checked before `prepare`/`run`; the
  stored `tools[]` is a binding subset that the runner refuses if any name is unattainable; a
  saved artifact can be stored while the gate is closed but cannot be run; the authored tool
  namespace is reserved and collisions are refused; input is enforced against the full authored
  schema, not only the projected DSH parameters.
- **Evidence fallback order and stale refusal: PASS.** Candidate order is env → home → bundled,
  with the same strict validator for every candidate; a bundled artifact for another package
  version/platform is refused; the release check is wired and green for 0.5.70 (5/5).
- **Callable invariant: PASS on the tested surface, with one structural hardening gap.** Every
  `tools` row is registered and (on the mounted test surface) state `callable`, and every
  unregistered model lives only in `unavailable`. The catalog branch gates the split on
  registration, not on `surface.state`, so the invariant is empirical rather than enforced.
- **Receipt honesty: PASS for what is recorded, with two completeness concerns.** Direct and
  nested receipts set `at`, `runId` and `outcome` honestly, a nested call inherits the
  composition `runId`, `outcome: 'ok'` is emitted only after the call resolved, and an unknown
  outcome is exposed as null. But a pre-0.5.70 receipt store is quarantined wholesale on upgrade
  (verified), and composition failures record no receipt at all.

## Security review of authored code

**Only the confined runner executes it.** `runAuthoredProgram` (agent-authoring.ts:552-567)
checks `externalRefusal(runner)` first, then `runner.prepare()`, then `runner.run({program,
requested: options.tools, input})`. `tool_mode_workflows`/`tool_mode_tools` call it for `run`
and for an authored tool's `execute` (index.ts:4824-4834), and `tool_mode_run` uses the same
runner (index.ts:4651-4665). There is no second execution path in this diff.

**The binding subset is not a grant.** The stored `tools[]` is passed as `requested`; the runner
intersects it with the host grant and the visible registry and refuses the WHOLE program on any
unattainable name (tool-mode-run.ts:196-205, 549-567; ptc-authority.ts:235-250). The authoring
test proves the refusal with a runner double (agent-authoring.test.ts:274-285); the real
intersection is the same code `tool_mode_run` already tests.

**Save is allowed, run is gated.** `saveWorkflow`/`saveTool` are plain store writes with no gate
(agent-authoring.ts:354-528); `runAuthoredProgram` refuses with the actionable hosted-code
message while the gate is closed (agent-authoring.test.ts:261-272). Defining an authored tool
while gated is allowed and the definition persists; executing it is refused
(agent-authoring.test.ts:351-431). `allowAgentAuthoring:false` removes both authoring tools and
every stored authored tool at boot (agent-authoring.test.ts:434-444).

**No escalation found.** `agent_` is a reserved namespace (agent-authoring.ts:51) and a name
already in the registry is refused before persistence/registration (index.ts:4787-4794). The
authored tool's full input schema is compiled once and enforced with `assertAgainstSchema` on
every call (index.ts:4795-4800, 4823), so a constraint the DSH projection drops is not silently
unenforced. Authored tool names are added to the HOST grant so a program may bind them
(index.ts:4740-4746 comment, :4559); they are tools the host already published, so this adds no
new authority. External callers keep their own grant
(`externalGrantContext.current()`), and `tool_mode_run` is advertised over MCP only when
`externalExposurePermitted()` is true (index.ts:2465-2466). Recursive composition remains bounded
by `MAX_PROGRAM_DEPTH` and the identical-call detector (tool-mode-run.ts:208-214).

**One boundary gap (low).** CODE-07's exclusion list is
`['tool_mode_run','model_tools','model_tools_manage','tool_mode_list','tool_mode_describe']`
(ptc-authority.ts:189); the new control tools `tool_mode_workflows` and `tool_mode_tools` are
not in it. They are currently unbindable only because the host grant omits them
(index.ts:2245, :4559) — not because the program boundary refuses them. A widened grant would
let a program call them mid-run, contradicting the advertised "Tool Mode control tools are
callable directly but excluded from programs (CODE-07)" (index.ts:4280, 4953). Add both names
to `EXCLUDED_BINDINGS`.

## Code Mode evidence fallback

**Order and stale refusal are correct.** `checkConfinementEvidence` builds candidates env →
home → bundled, skips home when an explicit env path was supplied, and accepts the FIRST VALID
candidate (ptc-confinement.ts:278-316). Every candidate goes through the same validator: kind,
schema version, `passed === true`, exact package version, platform, parseable timestamp, a
non-empty test list, and full-pass counts with zero skips (ptc-confinement.ts:125-229). Tests
cover env-wins, home-wins, absent-env→bundled, broken-explicit→bundled, stale package version,
wrong kind/schema, and a closed gate with no valid artifact (ptc-confinement-bundled.test.ts
:73-177); the refusal names the fix and leaks neither the home path nor internal versions
(:180-201).

**The release path is real, not asserted.** `packages/dsh-tool-mode/verification/
ptc-confinement-evidence.json` records `packageVersion 0.5.70`, win32, 5/5 pass (generated
2026-11-15T09:16:33.926Z). `files[]` ships it (dsh-tool-mode/package.json:57), the package script
`check:confinement` verifies it (package.json:94), and it is wired into `verify:static` and
`verify:release` (root package.json:36, :48). `npm run check:confinement` from the package
exits 0: "confinement evidence OK — package 0.5.70 · 5 tests, 5 pass, 0 fail, 0 skipped".

**Limitations, stated rather than hidden.** The artifact is self-asserted: neither the runtime
validator nor the release script pins `tests` to the confinement suite or signs the file, so a
hand-edited or packaged artifact with matching version/platform/counts opens the gate. That was
already true of the operator artifact; shipping one makes every same-version/same-platform
install trust the package's copy. This is the intended release-evidence model, but it is a trust
boundary, not a per-host proof.

**Unguarded test seam (medium-low).** `resetConfinementEvidenceCacheForTest`
(ptc-runtime.ts:244-251) is exported in the built artifact and accepts an arbitrary
`bundledPath`, without the `DSH_PTC_CONFINEMENT_SEAM` marker that guards
`setConfinementDemonstratedForTest` (:291-299). The module documents that the gate "always
costs an operator decision and never happens by config, by import or by accident"
(:272-277), but an in-process import can point the bundled candidate at a crafted valid
artifact and drop the cache, after which `confinementDemonstrated()` (:254-255) returns true.
The operator grant is still required for exposure (:318-320), and in-process code is already
privileged, but the seam should be guarded like its sibling or moved to a test build.

## Discovery: callable invariant and pinned contracts

`tool_mode_list` derives `registered` from `ctx.tools.schemas()`; a catalog row whose tool is
registered is appended to `tools`, everything else to `unavailable`
(index.ts:4308-4342). Owned host tools come from the same registry and are hardcoded
`state: 'callable'` (index.ts:4369-4386). Each `tools` row now carries `contract` (id or null),
`contractVersion` (or null) and `schemaAvailable`; these three are declared in the
MCP-advertised item schema (discovery-contracts.ts:29-54). The agreement test asserts, over a
mounted host, that every `tools` row is `state: 'callable'` and registered, that every
`unavailable` row is unregistered and not `callable`, and that `tool_mode_list` pins
`host.tool_mode_list`/1.0.0 while a tool with no published contract reports null
(model-surface-agreement.test.ts:309-368).

**Structural gap (low).** The catalog branch splits on `registered.has(toolName)` but copies
`state: surface.state` into the row (index.ts:4317-4342). If a registered catalog tool's
verdict is ever not runnable, it would appear in `tools` with state `unavailable`/
`not-installed`, contradicting the promised invariant; the test exercises only the small
mounted surface where registration implies callability. Split on
`surface.state === 'callable'` (moving others to `unavailable`), or add a synthetic
registered/unrunnable test.

**Authored tools report no contract (low).** `agentToolContract` defines
`agent.<name>` version `1.0.0` (agent-authoring.ts:186-190), but `toolContracts` is populated
only for extension/implementation tools (index.ts:6040-6145), so `agent_*` rows report
`contract: null`/`contractVersion: null`. That is conservative rather than invented, but an
artifact cannot pin an authored tool's contract even though the host knows it. Populate the map
in `registerAuthored` or document the null semantics.

## Receipts

**Direct calls (PASS).** A direct contract call records `at` (ISO), `runId === receiptId`,
`parentReceiptId: null` and `outcome: 'ok'`; `buildReceipt` is called only after output
validation/success (bindings.ts:270-284, :375-387; receipt.ts:206-230). The receipt's
`outcome` is exposed as null when a lane genuinely cannot know (index.ts:3669-3672), and the
receipt output schema declares the field (ab94236 index diff). Tests: receipt-enrichment.test.ts
:144-158.

**Composed runs (PASS for traced calls).** `tool_mode_run` and authored runs record one nested
receipt per traced sub-call with `parentReceiptId = runId = composition receipt id`, then the
composition receipt with `runId = its own id`, parent null and `outcome: 'ok'` only after
`serveProgram`/`runAuthoredProgram` resolved (index.ts:4681-4708, :4744-4777). A failed
sub-call inside a program is recorded as `outcome: 'failed'`, not ok
(receipt-enrichment.test.ts:161-210). A bare-string authored tool still records an enriched
receipt (:213-238). `receipt-store.ts:69-85` now requires `runId` and `at`, so a malformed
hand-edited row is refused rather than served.

**Concern 1 — upgrade quarantines every pre-0.5.70 receipt (medium).** `RECEIPT_STORE_VERSION`
stays 1 (`receipt-store.ts:41`) while `isReceipt` now requires `runId` and `at`
(:69-85), and `parseDocument` rejects the whole document if ANY receipt fails
(:87-109). A 0.5.69 store (version 1, no `runId`/`at`) is therefore "malformed": verified with a
probe that wrote one 0.5.69-shaped receipt and loaded it — `records: 0`, quarantine path
present, reason "the store contains a malformed receipt". An upgrade silently loses the whole
receipt history (the file is moved aside, not deleted). Migrate by defaulting
`runId = receiptId` and `at` from the file/epoch (or drop invalid rows individually), or bump
the store version and document the quarantine.

**Concern 2 — composition failures leave no receipt (low).** `serveProgram` and
`runAuthoredProgram` throw on a failed run before the host records anything
(index.ts:4658-4708, agent-authoring.ts:552-567), so `outcome: 'failed' | 'cancelled' |
'timed-out'` is never recorded for a COMPOSITION — only for a sub-call inside a composition
that completed. If "recoverable from receipts" is meant to include failed runs, record the
composition in a `catch`/`finally` with the real outcome.

**Concern 3 — nested receipts are bounded by the trace (low).** The trace keeps at most
`MAX_TRACE_CALLS = 50` calls (tool-mode-run.ts:178), and the nested-receipt loops iterate the
reported `meta.calls` (index.ts:4681-4689, :4744-4761). A program making more than 50 sub-calls
cannot be fully reconstructed from receipts; `meta.toolCalls` carries the full count. Document
the 50-call provenance bound, or record a summary row when the count exceeds the trace.

**Concern 4 — nested authored compositions are roots (low).** An authored tool called from a
program records its OWN composition receipt with `parentReceiptId: null` and its own
`runId` (index.ts:4762-4776); the outer run's nested receipt names it
(`contract: 'nested:agent_x'`, implementationId `agent_x`, :4748-4758) but no data field links
the inner composition to the outer run. Recovery across nested compositions relies on
names/timestamps. Thread the ambient composition id through, or document the shape.

**Concern 5 — synthetic nested contract identity (low).** Nested rows carry
`contract: 'nested:<tool>'` and a hardcoded `contractVersion: '1.0.0'` (index.ts:4748-4750).
The version is not a published contract version; a consumer pinning versions could read it as
one. Consider `contractVersion: null` for the nested pseudo-contract.

## Other observations

- **Authoring file hygiene (low).** The authoring document is written with default permissions
  (`writeFileSync` without mode, agent-authoring.ts:410) while the receipt store uses
  `0o600` (receipt-store.ts:134). Authored programs can embed prompts/URLs; use `{ mode: 0o600 }`.
  A corrupt authoring file is read as empty with a logged issue and overwritten by the next save
  (agent-authoring.ts:354-367 + persist) rather than quarantined, so authored content can be
  silently lost where receipts are preserved.
- **Anti-slop on changed files.** New files are clean: `agent-authoring.ts`,
  `check-confinement-evidence.mjs`, and the three new tests report zero findings. Changed-line
  findings in `index.ts`: :3673-3674 `no-conditional-empty-object-spread` (receipt exposure),
  :4388 and :4708 `require-safety-comment-for-type-assertion` (added `as never` returns),
  :5606/:5608 `no-unsafe-dictionary-type` (Record-typed result stamping),
  :6040-6041 `no-runtime-typeof` (planning provider input). `ptc-confinement.ts:72` is
  `no-runtime-typeof` in the JSON-boundary helper (the module, unlike receipt-store, has no
  documented disable header). No functional or security impact; these are the repository's
  pre-existing boundary/cast conventions.

## Gates (verifier)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json` | exit 0 |
| `npx tsx --test tests/agent-authoring.test.ts tests/tool-mode-run.test.ts tests/receipt.test.ts tests/receipt-durability.test.ts tests/receipt-enrichment.test.ts tests/discovery-provenance.test.ts tests/model-surface-agreement.test.ts tests/ptc-confinement.test.ts tests/ptc-confinement-bundled.test.ts` | 134 tests, 134 pass, 0 fail, 0 skipped |
| 18 non-live `tests/mcp-*.test.ts` suites (cache-policy, client-grant, conformance, export-policy, extension-surface, host-binding, host-endpoint, http, oauth, protocol, rate-limit, server, status, stdio, subscriptions, usage, v2-interop, withheld-reason) | 258 tests, 258 pass, 0 fail, 0 skipped |
| `npm run check:confinement` (package script) | exit 0 — package 0.5.70 · 5 tests, 5 pass, 0 fail, 0 skipped · win32 |
| `anti_slop_lint` on the new files/tests | clean (see Other observations for changed-line findings) |

The tsc and core/MCP gate runs above took place at roughly 17:44-17:48. The unrelated
`decision-*.ts` edit (17:40) was present during those runs and they still passed; `index.ts`
changed at 17:49, after the gates, so the reviewed index.ts code was the committed `ab94236`
version. The Lead's full-suite run is the cross-check on the combined tree.

Not run here, left to the Lead: the full host suite, `verify:mcp:live` and the live MCP suites,
`verify:static`/`verify:release` end to end (the confinement script they call was run
directly), and any publish/install step.
