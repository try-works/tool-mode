# Refactoring `index.ts`

`packages/dsh-tool-mode/src/index.ts` is the plugin composition root, but it grew into an
8.6k-line file containing the catalog, discovery, authoring, extension lifecycle, MCP server
and reconciliation logic. It is hard to review, hard to test in isolation, and every change
risks an unrelated surface.

This is the extraction plan. It is dependency-first, not line-count-first: a module is moved
only when its boundary is the plugin context, the tool registry, the receipt ledger, or one
already-extracted module. A split that needs a new circular import is not a refactor.

## Current state

| Module | Responsibility | Lines |
| --- | --- | ---: |
| `src/index.ts` | composition root and all remaining surfaces | ~8.6k |
| `src/model-cards.ts` | capability-card projection (catalog/verdict to card) | ~210 |
| `src/receipt-surface.ts` | receipt store, id minting, bounded in-memory ring | ~70 |
| `src/receipt-view.ts` | stable read shape for `model_tools` receipts | ~50 |
| `src/discovery-binding.ts` | shared binding resolution for list/describe/preflight | ~105 |
| `src/discovery-control.ts` | read-only `tool_mode_list` / `tool_mode_describe` | ~520 |
| `src/authoring-surface.ts` | workflow + authored-tool handlers | ~650 |
| `src/runtime-surface.ts` | `tool_mode_run`, probe and composition receipts | ~190 |
| `src/model-tools-schema.ts` | `model_tools` advertised schema and renderer | ~670 |
| `src/tool-mode-run.ts` | authorized Code Mode runner and report | ~690 |
| `src/agent-authoring.ts` | scoped artifact store and resolution | ~1.4k |
| `src/extensions-service.ts` | extension install/prepare/lifecycle coordination | ~3.3k |

Extracted so far:

- `model-cards.ts` (commit `acfcf9f`) is pure catalog/verdict formatting, with the
  public `ModelDescriptor`, `ModelOperationCard`, `ModelRuntimeCard`,
  `describeModelCard` and `describeModels` names re-exported from `index.ts` so
  existing imports and tests do not change.
- `receipt-surface.ts` owns the receipt store, counter floor and bounded in-memory
  ring; `receipt-view.ts` owns the stable per-row projection. External accounting
  still moves with `discovery-surface`.
- `discovery-binding.ts` owns the one grant/registry/caller-scope resolver and the
  `bindable` predicate.
- `discovery-control.ts` owns the read-only `tool_mode_list` / `tool_mode_describe`
  pair, their contract facts and `discoveryBucket`.
- `model-tools-schema.ts` owns the `model_tools` advertised schema and renderer.
  The execution closure still lives in `index.ts` because its management actions
  share extension lifecycle, credentials and asset state.
- `authoring-surface.ts` owns `tool_mode_workflows` and `tool_mode_tools`. The
  store, ledger, registration/disposal hooks, scope resolver, receipts and
  sandbox runner are injected; the registration helpers stay in `index.ts`
  because boot restore calls them before the tools are registered.

## Target shape

`index.ts` should become a composition root: read config, construct shared services,
register feature modules, own teardown. Feature code lives behind explicit dependency
interfaces, not closures over a 400-line `apply`.

    index.ts                     config -> services -> register modules -> teardown
      model-cards.ts             pure card formatting                 [done]
      discovery-control.ts       list / describe                   [done]
      model-tools-schema.ts      model_tools contract              [done]
      discovery-surface.ts       model_tools execution
      discovery-binding.ts       list/describe/preflight resolution  [done]
      authoring-surface.ts       workflow + agent tool handlers  [done]
      extension-lifecycle.ts     restore, inspect, prepare, activate
      mcp-surface.ts             HTTP/stdio, auth, credentials, subscriptions
      runtime-surface.ts         tool_mode_run + receipts        [partial]
      receipt-surface.ts         receipt stores, accounting, usage   [done]

## Extraction order

1. **model-cards** - done. No plugin context; re-exported public types.
2. **receipt-surface** - done for the store/counter/ring. Invocation accounting and the
   usage projections still move with discovery because their read model is the
   `model_tools` receipts action.
3. **discovery-surface** - partially done. `tool_mode_list` and `tool_mode_describe`
   are out in `discovery-control.ts`; the binding resolver is in `discovery-binding.ts`.
   `model_tools` remains because its management actions share extension lifecycle,
   credentials and asset state; extract it with the lifecycle split rather than inventing
   a second dependency graph for it.
4. **authoring-surface** - done for the handlers. `AuthoringDeps` carries the store,
   ledger, workflow/authored-name registries, scope resolver, receipts, promotion
   settings and sandbox runner. Boot registration/restore still lives in `index.ts`;
   extracting it is the next authoring step, not part of this move.
5. **extension-lifecycle** - restore/inspect/prepare/activate. This is the riskiest split
   because ordering is a contract (integrity, asset restore, readiness, activation) and
   several maps are shared with dispatch. Extract it only after 2-4 have settled, with
   the restore chain tests run before and after.
6. **mcp-surface** - HTTP/stdio setup, auth, credentials, subscriptions. It is already
   mostly in `src/mcp/`; move the remaining server lifecycle and route wiring.
7. **runtime-surface** - partially done: `tool_mode_run` (probe, binding preflight,
   composition/nested receipts, run capture) is out in `runtime-surface.ts`. The
   adapters, provider bridge and model runtime lane are already separate modules; the
   remaining wiring stays in the composition root until the lifecycle split lands.

## Dependency rules

- A feature module receives an explicit deps object; it does not import `index.ts`.
- Shared state is passed as callbacks or a service interface, never re-created.
- Public names stay re-exported from `index.ts` until every in-repo and published consumer
  has moved; removal is a versioned change, not part of the split.
- No module may call a tool through a second path. Discovery, preflight and program bindings
  must share `bindingPreflight` (or its new module) so callable/bindable/resolved cannot
  drift.
- Scoping rules stay in `agent-authoring.ts` / `artifact-scope-context.ts`; a surface passes
  the caller context, it does not recompute root-session or workspace keys.

## Verification per extraction

Every step is a mechanical move plus import/re-export changes. Required before commit:

- `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json`
- targeted tests for the moved surface
- `npm run build:host` (the published artifact must import the new module)
- `npm run test:integration:dsh` (full host suite)
- static/docs/manifests/MCP checks if a generated artifact changed

No behavior change is bundled into a move. If a move exposes a bug, fix it in a separate
commit so the refactor can be reviewed and reverted independently.

## Non-goals

- Not splitting `extensions-service.ts` (3.3k lines) in the same pass; it has its own
  dependency graph and should follow the same method separately.
- Not changing the scoping model, `from-run` schema policy, promotion evidence or the
  code-mode gate as part of this work.
- Not removing public re-exports from `index.ts` before consumers migrate.

## Next step

Extract `receipt-surface` and `discovery-surface` in that order. Both have explicit inputs
and existing tests; together they remove the most-read ~1.2k lines from the composition
root without touching extension restore ordering.
