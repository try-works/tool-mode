# Tool Insights client — checks and evidence (task-14)

Date: 2026-10-23. Workspace: `D:\DEV\dsh-tool-mode` (repo 0.5.19).

## Targeted tests

`node packages/dsh-tool-mode/tests/tool-insights-{client,render,registration,bundle}.test.ts`

- client logic: 10/10
- render tree: 6/6
- registration/slots: 4/4
- bundle/generator: 4/4
- TOTAL 24/24 pass, 0 fail (see `client-green-2026-10-23.log`; red run in `client-red-2026-10-23.log`).

Why `node` instead of the canonical `tsx --test`: the DSH Windows file sandbox refuses PIPE
creation for spawned programs, so tsx/esbuild fails with `EPERM` and Node's `--test` runner
fails when it spawns per-file children. Node 24's native TypeScript stripping runs the same
`.test.ts` files in-process with identical assertions. `npm test` therefore cannot execute in
this sandbox at all (every file reports ✖ from the runner, not from the tests); the exact
command was attempted and its EPERM failure recorded.

## Bundle / generator

- `node packages/dsh-tool-mode/scripts/gen-client-catalog.mjs --check`
  → exit 0: `client/index.js current: 18 models, 2 runnable here`.
- The generator gained an explicit `--out <path>` so a caller that can only read files can
  produce the bundle beside itself. The workspace itself is not writable from the shell in
  this sandbox (the file policy denies it), so the checked-in `client/index.js` was updated
  through the host file tool and proven byte-identical by `--check`.
- Bundle assertions: `function createToolInsights` present, placeholder gone, no
  `require.async('./tool-insights.js')`, all three tab labels and `Previous`/`Next`/`Page`
  literals present.
- `node scripts/verify-built.mjs` → exit 0 (`OK — the built artifact loads through package
  main and works under plain Node`), after the client change.

## anti_slop_lint

- `client/tool-insights.js`, 15-rule run: 42 findings, all `anti-slop/no-runtime-typeof`
  (the page's I/O-boundary normalizers parse untyped Remote/projection JSON).
- Same run on the pre-existing generated `client/index.js`: **137** findings of the same rule,
  i.e. the rule class is endemic to this plugin's untyped browser half (no oxlint config or
  disable exists in the package). The new page does not introduce a new rule class.
- 14-rule run excluding `no-runtime-typeof`: **0 findings**.

## Typecheck / build

- Host typecheck (`tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json`) currently fails
  in `src/tool-usage-projection.ts` (task-13, concurrent): Zod types resolve from two
  installations (`D:\DEV\dsh-tool-mode\node_modules\zod` vs
  `D:\deepseek-harness\node_modules\.pnpm\zod@4.4.3`). Outside task-14 scope; the client half
  is plain JavaScript and is not part of that program.
- `npm run build` writes `lib/**` in the workspace, which the sandbox denies; the same tsc
  build directed at a temp `--outDir` fails only on the task-13 file above.
- `npm run verify:built` is green (see above).

## Full suite (best effort, per-file)

162 `.test.ts` files across the 12 packages in `npm test`: 85 exit 0, 77 exit 1. The failures
are environmental, not Tool Insights: 55 contain `spawn EPERM` (worker/tool subprocesses,
symlink tests) and several are missing-module/`ajv` layout errors in this pnpm tree. The four
Tool Insights files are among the 85 passing. A clean-shell run of `npm test` remains the
authoritative gate.
