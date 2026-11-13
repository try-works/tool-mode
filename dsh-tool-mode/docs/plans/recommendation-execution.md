# Recommendation execution — TDD plan

## Objective

Implement the surviving recommendations from the Executor-comparison audit for
`dsh-tool-mode`, in an order that proves the contract abstraction before adding
more machinery:

1. Recorded second-implementation swap proof.
2. Durable invocation receipts (not just in-memory retention).
3. Withheld-tool reasons in MCP call results.
4. ApprovalStore wired into management mutations.
5. `tool_mode_describe` exposes `semantics` and `unsupported`.
6. Manifest drift guard, the first derivable slice of “derive the manifest”.

Non-goals: porting Executor’s code-mode/elicitation runtime; publishing a new npm
release in this wave; rewriting the already-correct headless surface.

## Method

Red/green TDD per slice. Each lane writes its failing test first, captures the
failure, implements the smallest change, then runs its targeted suite. The Lead
reviews the final diff and runs the full gate.

## Slice 1 — swap proof (evidence, no new architecture)

**Why:** the only claim that proves the contract layer is substitutability. Two
packages already implement `text.title` and `image.describe`, but no swap is recorded.

**Red:** a test/qualification script that installs two implementations of the same
contract, selects one, disables it, and expects the second to serve the same tool.
Today the recorded proof does not exist, so the test is red on missing evidence, not
on missing production behavior.

**Green:** add `scripts/qualify-implementation-swap.mjs` and
`docs/tool-mode/qualification/implementation-swap.json` with:
- selected implementation id;
- alternative implementation id(s);
- before/after call receipts;
- the exact images/text used;
- an explicit `outcome: "pass"` only when the alternative served the call.

**Acceptance:** the script runs against real fixture/extension packages and writes
the qualification record; the test asserts the record names distinct implementations
and a real result.

## Slice 2 — durable receipts

**Failure:** `receipt.ts` builds provenance, but `index.ts` keeps a bounded in-memory
ring; a restart loses every receipt.

**Red tests** in `packages/dsh-tool-mode/tests/receipt-durability.test.ts`:

- append a receipt, create a new host/store instance, read receipts: the receipt is
  present;
- retention remains bounded at `MAX_RETAINED_RECEIPTS`;
- malformed store data is quarantined (not silently treated as empty);
- receipt ids remain unique across a restart.

**Green:** add a small file-backed receipt store (JSON, atomic write, bounded ring)
next to the configured state file; wire append/load in `index.ts`; keep the in-memory
ring as the read cache. Do not put receipts into the enable/disable state document.

**Acceptance:** restart-simulation test passes; `model_tools` `receipts` action reads
the persisted record.

## Slice 3 — withheld reasons in call results

**Failure:** MCP `callTool` returns `unknown tool "x"` even when the host knows the
tool exists but withheld it for a named reason.

**Red test** in `packages/dsh-tool-mode/tests/mcp-withheld-reason.test.ts`:

- a host surface with a published-withheld tool and a completely unknown tool;
- calling the withheld name returns the recorded `notExportableReason`;
- calling a genuinely unknown name still returns `unknown tool`;
- no confidential tool leaks its definition.

**Green:** add an optional `withheld: ReadonlyMap<string, string>` (or equivalent)
to `HostSurface`; populate it from the publication decision; use it in `callTool`
before the generic unknown-tool branch.

**Acceptance:** both branches tested; MCP schema/conformance tests stay green.

## Slice 4 — approvals wired into a management mutation

**Failure:** `approval.ts` has zero production importers and management mutations
apply immediately.

**Red tests** in `packages/dsh-tool-mode/tests/approval-integration.test.ts`:

- an extension enable/disable/uninstall (choose the narrowest management mutation)
  creates a pending approval and does not mutate before commit;
- a wrong scope cannot commit;
- approving then committing applies exactly once;
- a denied/expired request refuses with a named error and does not mutate.

**Green:** wire `ApprovalStore` into the chosen service path with explicit
request/approve/commit semantics. No UI is required for the test, but a caller that
does not approve must fail promptly, never hang.

**Acceptance:** targeted approval + extension-service suites pass; existing direct
management calls remain valid where the operator has pre-approved (document the
compatibility path).

## Slice 5 — describe semantics and unsupported cases

**Failure:** `tool_mode_describe` returns limits/skill/model but omits the contract’s
`semantics` and `unsupported`.

**Red test** in `packages/dsh-tool-mode/tests/tool-mode-describe.test.ts`:

- describing `stt_transcribe` includes its semantics and non-empty unsupported list;
- an absent tool still reports the existing refusal;
- the output schema declares both fields (closed, bounded).

**Green:** extend the describe output schema and projection. No new data source — the
contract already carries both fields.

**Acceptance:** test passes; `verify:mcp` schema checks stay green.

## Slice 6 — manifest drift guard

**Why narrow:** current extension entries do not declare tools in a way the SDK can
derive; full manifest generation needs a new authoring API. The immediately derivable
facts are identity, version, tool-name uniqueness and referenced schema existence.

**Red test** in `packages/dsh-tool-mode/tests/manifest-consistency.test.ts`:

- every `tool-mode.extension.json` id/version matches its package.json;
- tool and implementation ids are unique within a manifest;
- every `inputSchema`/`outputSchema` path exists;
- every implementation references a declared tool.

**Green:** add `scripts/check-extension-manifests.mjs`, wire `verify:manifests` into
`npm run verify` (or `verify:architecture`), and fix any real drift the check finds.
Do not claim this is full derivation; record the remaining design gap.

**Acceptance:** check passes on all 9 extension packages; a deliberately renamed
schema path fails the check.

## Verification

- Targeted suites per slice.
- `npm run build:sdk`, `npm run build:host`, `npm run typecheck`.
- Full `npm run verify` → EXIT 0.
- Regenerate verification artifacts if package counts change.
- For the swap proof, retain the real qualification JSON and cite the receipts.

## Team split

| Lane | Write scope | Depends on |
|---|---|---|
| host-truth | `src/receipt.ts`, new `src/receipt-store.ts`, `src/index.ts`, `src/mcp/host-binding.ts`, related tests | — |
| swap-proof | `scripts/qualify-implementation-swap.mjs`, `docs/tool-mode/qualification/implementation-swap.json`, test | — |
| manifest-guard | `scripts/check-extension-manifests.mjs`, `package.json`, test | — |
| approvals | `src/approval.ts`, `src/extensions-service.ts`, `src/index.ts`, test | host-truth (shared index) |
| verifier | `.agent-scratch/audit/recommendation-verification.md` | all |

The Lead owns integration, full verify, and any final index merge.

## Result (2026-11-13)

| Slice | Result |
|---|---|
| 1. Swap proof | **PASS** — `implementation-swap.json`: harness-text (`text-title-harness`) served `text_title`, disabled, declarative-recipes (`text-title`) served it; receipts `rcpt_000001`/`rcpt_000002`. Packaging defect exposed by the proof fixed in the SDK: a declarative manifest now publishes its implementation without also publishing the duplicate declared tool. |
| 2. Durable receipts | **PASS** — `receipt-store.ts`, `${stateFile}.receipts.json`, atomic write, 200 bound, malformed-file quarantine, receipt-id continuation. |
| 3. Withheld reasons | **PASS** — known-but-withheld MCP names return `tool "x" is withheld: <reason>`; unknown names still return `unknown tool`; confidentiality refuses before lookup. |
| 4. Approvals | **PASS with explicit limit** — `ApprovalStore` is wired to extension activation with pending/decide/commit and named denials. The gate is opt-in (`requireActivationApproval`, default false) because no UI/control-tool path to approve is shipped yet; enabling it without that path dead-ends. |
| 5. Describe semantics | **PASS** — semantics/unsupported are projected and declared in both the registered tool schema and the MCP-advertised contract. |
| 6. Manifest guard | **PASS with explicit limit** — checks all 11 manifests for identity/version, uniqueness, schema paths and contract binding; wired into `npm run verify`. It is a drift check, not full derivation: extension entries still lack the authoring metadata needed to generate tools/permissions/models. |

Verification:

- Targeted suites: 23/23.
- `verify:manifests`: 11 packages, 17 standard contracts.
- `npm run typecheck`: exit 0.
- Full `npm run verify`: **EXIT 0**, 2,736 tests / 2,721 pass / 0 fail / 15 skipped,
  317 requirements / 309 PASS, traceability current.

Residual risks: approval store is in-memory and its production gate is off until an
approval UI/control path exists; receipt writes are atomic but not `fsync`ed; the
manifest guard cannot derive a manifest; the swap proof uses a scripted harness
provider (selection/substitution proof, not model-quality evidence).

### Temporary-instance test (E:)

A fresh DSH home at `E:\dsh-temp\recommendation-wave` (minimal base/web-app/model-tools
profile, own store/state, MCP `:3817`) exercised the built tarball end to end:

- MCP `serverInfo.version` = `0.5.43`; `model-tools` settings namespace present.
- `tool_mode_describe` returned real `semantics` (`readOnly`, `sideEffects:false`) and
  `unsupported` for a registered tool.
- Two receipts persisted to `state.json.receipts.json`; after a host restart the file
  still held both and a later call appended a third.
- With `mcpV3.exportTools: [tool_mode_list]`, calling the known-but-withheld
  `tool_mode_describe` returned
  `tool "tool_mode_describe" is withheld: the MCP export allowlist does not name this tool`.
  A genuinely unknown name still returned the protocol not-found error.

This test caught a gap the unit suite missed: the JSON-RPC dispatcher explained withheld
names, but the HTTP path uses the MCP SDK handler, which registers only published tools
and answered its own “Tool … not found”. The SDK handler now has a request-scoped
withheld override, and the existing MCP host test was updated to the intended named-reason
behavior. Full `npm run verify` after the fix: **EXIT 0**, 2,737 tests / 2,722 pass /
0 fail / 15 skipped.


