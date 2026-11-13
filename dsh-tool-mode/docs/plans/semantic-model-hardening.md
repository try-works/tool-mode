# Semantic-model hardening — TDD plan

## Objective

Close the three highest-leverage gaps found in the semantic model of the
`dsh-tool-mode` plugin:

1. **Auxiliary speech registration must not abort plugin apply.**
2. **Extension activation failures must be durable and visible**, not only logged.
3. **Settings must tell the truth** when a saved value is captured at apply time.

Non-goals: redesigning the whole extension lifecycle, changing the DSH speech
registry contract, or making every config field genuinely live.

## Method

Red/green TDD per slice. Each slice starts with a failing test that encodes the
failure mode from the semantic analysis, then the smallest implementation that
passes. No production change lands without its test. The Lead reviews the final
diff and runs the full gate.

## Slice 1 — speech registration is non-fatal and idempotent

**Failure today:** `voz-local` may already be registered (standalone STT plugin,
or a check-then-register race). `register()` throws, the throw escapes `apply()`,
and the entire plugin surface (settings, MCP, tools) disappears.

**Red tests** in `packages/dsh-tool-mode/tests/speech-bridge.test.ts`:

- registry reports no providers via `listProviders()`, but `register()` throws
  `Speech provider already registered: voz-local`
  → `installVozSpeechProvider` **does not throw**, returns a resolvable disposer,
  and reports the skip through `onSkipped` exactly once.
- existing happy path still registers exactly once.
- non-duplicate `register()` errors still propagate (do not swallow real faults).

**Green implementation:** catch only duplicate-provider registration, return a
no-op disposer, and let the caller record a warning. Keep the existing
`listProviders()` fast path.

**Files:** `src/speech-bridge.ts`, `tests/speech-bridge.test.ts`.

## Slice 2 — activation errors are durable and visible

**Failure today:** lifecycle writes `observedActivation: failed` with no reason.
`extensions-service` falls back to a generic “activation failed earlier” string;
the actual cause is only in host logs.

**Red tests:**

- `packages/tool-mode-extension-sdk/tests/lifecycle.test.ts`
  - a failing contribution publish records `activationError` containing the
    thrown message, alongside `observedActivation: failed`.
  - a subsequent successful activation clears `activationError`.
  - a retry after failed readiness records the readiness reason.
- `packages/dsh-tool-mode/tests/extensions-service.test.ts`
  - when no higher-priority unmet requirement exists, the row `reason` is the
    recorded `activationError`, not the generic fallback.
  - a state written before this field existed still parses (optional field).

**Green implementation:**

- add optional `activationError?: string` to `ExtensionState`
  (`packages/tool-mode-extension-sdk/src/state.ts`);
- allow it in `#stateFor` overrides and write it in the readiness-failure,
  publish-failure, activating, and active transitions
  (`packages/tool-mode-extension-sdk/src/install/lifecycle.ts`);
- prefer it in `reasonOf` for failed rows
  (`packages/dsh-tool-mode/src/extensions-service.ts`).

**Files:** `state.ts`, `install/lifecycle.ts`, `extensions-service.ts` plus the
two test files above.

## Slice 3 — settings truth for captured values

**Failure today:** the Settings page says values are live. `apply()` captures
`exposeUnavailable`, `registerSkills`, `registerControlTool`, model selection and
worker settings once; `loader/volatile-update` only rewrites `config`. A save
changes storage and the displayed value, but not the registered tools.

**Red test** in `packages/dsh-tool-mode/tests/tool-insights-client.test.ts`:

- the Model as Tool settings pane renders an explicit restart notice for captured
  settings, e.g. “Model and tool registration changes apply after restart.”
- the notice is absent/present deterministically across renders.

**Green implementation:** add the notice to the settings pane copy
(`client/index.template.js`), keeping behavior unchanged. This is a truth fix, not
a pretend-live fix.

**Files:** `client/index.template.js`, `tests/tool-insights-client.test.ts`.

## Acceptance

- Targeted tests for all three slices pass.
- `npm run build:host` succeeds.
- Client build/catalog regeneration is current.
- Full `npm run verify` exits 0 (the 2686-test gate).
- The fixed plugin is staged into the live profile and a probe host confirms the
  `model-tools` settings namespace and MCP listener without restarting the GUI.

## Team split

| Lane | Write scope | Depends on |
|---|---|---|
| speech-hardening | `src/speech-bridge.ts`, `tests/speech-bridge.test.ts` | — |
| activation-visibility | `src/state.ts`, `src/install/lifecycle.ts`, `src/extensions-service.ts`, `tests/lifecycle.test.ts`, `tests/extensions-service.test.ts` | — |
| settings-truth | `client/index.template.js`, `tests/tool-insights-client.test.ts` | — |
| lead-integration | build, full verify, evidence, live staging | all three |

Each lane writes its failing test first, then the minimal implementation. The Lead
does not edit files owned by a lane until that lane is complete.

## Result (2026-11-13)

All three slices landed and passed:

- speech lane: 6/6 `speech-bridge` tests; duplicate registration skips with
  `onSkipped`, unrelated throws still propagate.
- activation lane: 3 lifecycle tests + 2 service tests; `activationError` is
  persisted on failure and cleared on success. The prepare probe calls
  `activate(..., { recordFailure: false })` so its artificial registrar refusal
  cannot contaminate the durable reason.
- settings lane: 14/14 `tool-insights-client` tests; the pane now states the
  restart boundary for captured settings.
- Combined targeted run: 121/121.
- Full `npm run verify`: **EXIT 0**, 2697 tests, 0 failures; verification
  artifacts current (317 requirements, 309 PASS) and traceability current
  (227 requirements, 90 acceptance tests).
- The fixed package is staged in the live `web` profile. A disposable probe
  profile (own store/state, MCP 3799) confirmed the `model-tools` settings
  namespace is exposed and the MCP listener serves `decision_combine`,
  `decision_route`, `decision_evaluate`; the GUI itself was not restarted.
- Published **@try-works/dsh-tool-mode@0.5.43** to npm (`latest`), verified
  the registry SHA-512 against the downloaded tarball, and installed that exact
  artifact into the live profile (`package.json` dependency `0.5.43`). The
  running GUI still needs one restart to load it. The profile's pnpm lockfile
  remains at 0.5.31 because a full install is blocked by the unrelated
  unpublished `@try-works/dsh-versatile-design@^0.2.5` dependency.


