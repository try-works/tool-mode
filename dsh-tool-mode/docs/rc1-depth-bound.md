# RC1 — the 3-level dependency-depth bound and the 0.4.8 plugin build

Task-130 findings (2026-10-19, ~10:31–10:46 +08:00). Repo HEAD `b8d13b9`, profile
`web`, plugin 0.3.6 installed → 0.4.8 built and installed. The `ext-matrix`
profile was not touched and the `:3080` host process was not restarted.

## The verbatim failure

Installing `@try-works/extension-laya` from the live Extensions page fails with:

```
[DEPENDENCY_UNSATISFIED] the dependency graph exceeds the 3-level depth bound at define-data-property
```

The web profile uses the source-directory arm (`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
# lines 98–112
- id: model-tools
  name: "@try-works/dsh-tool-mode"
  config:
    extensionStore: "C:/Users/erikb/.dsh/profiles/web/extensions"
    extensionSourceDir: "D:/DEV/dsh-tool-mode/packages"
    allowPreinstalledDependencies: true
    preinstalledDependenciesRoot: "D:/DEV/dsh-tool-mode"
    allowExecutablePreparation: true
    extensions:
      allowSourceDirectories: true
```

`@try-works/extension-laya` declares `onnxruntime-node`; the real host tree is six
packages deep from that declaration (depth 0 onward):

```
0 onnxruntime-node
1 global-agent
2 globalthis
3 define-properties
4 define-data-property   <- first entry past a 3-level bound (the live name)
5 es-define-property     <- deepest entry
```

## Root cause, code level

The bound is a value the HOST supplies and the SDK enforces. The fixed working
tree supplies it on **both** arms; 0.3.6 (and the published 0.4.7) did not supply
it on the source-directory arm, so the SDK's fallback applied.

1. **SDK default + message** — `packages/tool-mode-extension-sdk/src/install/dependencies.ts`:

   ```ts
   294:  const maxDepth = graph.maxDepth ?? 3
   310:  if (entry.depth > maxDepth) {
   314:      `the dependency graph exceeds the ${maxDepth}-level depth bound at ${entry.name}`,
   ```

   The message text is the SDK's, parameterized by `maxDepth`. This is why the live
   text says `3-level` and names `define-data-property`: the SDK received no bound.

2. **Default bound** — `packages/dsh-tool-mode/src/extensions-service.ts:118`:

   ```ts
   export const DEFAULT_REGISTRY_DEPENDENCY_DEPTH = 12
   ```

   with the comment at :106–117 naming the exact `define-data-property` /
   `es-define-property` chain.

3. **Source-directory arm (the live arm) forwards the bound** —
   `src/extensions-service.ts:1163–1176`:

   ```ts
   1167:  const depth = this.#options.registryDependencyDepth ?? DEFAULT_REGISTRY_DEPENDENCY_DEPTH
   1168:  const base = {
   1170:    allowPreinstalled: this.#options.allowPreinstalledDependencies === true,
   1171:    maxDepth: depth,
   1172:  }
   ```

   and the install call consumes it at `:2237`
   (`dependencies: this.#dependencyGraph(sourceDir)`).

4. **Registry arm forwards the same bound** — `src/extensions-service.ts:2004–2034`:
   registry branch `:2006` (`{ ...createRegistryDependencyGraph(session), maxDepth: depth }`),
   preinstalled branch `:2032` (`maxDepth: depth`); consumed at `:1936` and `:1974`.

5. **The graph builder forwards it into the SDK graph** —
   `src/extension-dependencies.ts:597`
   (`if (options.maxDepth !== undefined) optionalGraphFields.maxDepth = options.maxDepth`).

6. **What 0.3.6 shipped** — the profile's installed
   `node_modules/@try-works/dsh-tool-mode/lib/extensions-service.js` contained
   **no** `maxDepth` reference at all (the only hit in the whole `lib/` tree was
   `lib/extension-dependencies.js:356–357`, which merely passes the option
   through). With no field, the SDK's `graph.maxDepth ?? 3` applied and refused at
   depth 4.

## The published 0.4.7 does NOT contain the fix

This is the important correction to the initial RC1 hypothesis. The npm tarball
(`https://registry.npmjs.org/@try-works/dsh-tool-mode/-/dsh-tool-mode-0.4.7.tgz`)
was extracted and inspected:

| location | published 0.4.7 | fix present? |
|---|---|---|
| `lib/extensions-service.js:737` `#dependencyGraph` | no `maxDepth` field in the constructed graph | **NO** |
| `lib/extensions-service.js:1427` registry graph | `maxDepth: depth` | yes |
| `lib/extensions-service.js:1455` preinstalled branch | `maxDepth: depth` | yes |
| bundled SDK `lib/install/dependencies.js:165` | `graph.maxDepth ?? 3` | (SDK honors the field) |

`git show HEAD:packages/dsh-tool-mode/src/extensions-service.ts` matches: the
committed file has `maxDepth` only in the registry arm (lines 1982/2008); the
directory-arm forwarding (`maxDepth: depth` in `#dependencyGraph`) exists only in
the working tree. The live web profile uses the directory arm, so 0.4.7 could not
have fixed RC1 — a rebuilt artifact was required.

## The built artifact: 0.4.8

Built from the working tree (which carries the directory-arm fix and other lanes'
uncommitted changes) with the package version temporarily set to `0.4.8` for
identifiability, then restored to `0.4.7`:

```
> npm pack --json          # cwd packages/dsh-tool-mode, prepack ran stage-bundle + build
...
"entryCount": 319,
"bundled": [
  "@try-works/tool-mode-extension-sdk",
  "@try-works/tool-mode-recipes",
  "@try-works/tool-mode-contracts"
]
```

| artifact | value |
|---|---|
| path | `C:\Users\erikb\.dsh\profiles\web\plugins\try-works-dsh-tool-mode-0.4.8.tgz` |
| bytes | 679,989 |
| sha256 | `CCFE43BFCB3CCA1F71BF62481348F2B90215A87CD33D62CA5432A5F1D454168D` |

Packaged `package/lib/extensions-service.js` (extracted from the tarball):

```
 752:    #dependencyGraph(sourcePackageDir) {
 758:        const depth = this.#options.registryDependencyDepth ?? DEFAULT_REGISTRY_DEPENDENCY_DEPTH;
 761:            maxDepth: depth,
1448:        const registryGraph = { ...createRegistryDependencyGraph(session), maxDepth: depth };
1476:            maxDepth: depth,
1651:                dependencies: this.#dependencyGraph(sourceDir),
1675:        await this.#materializeOptionalRuntimes(storeDir, installed, this.#dependencyGraph(sourceDir), signal);
```

The bundled SDK is identical in behavior (`package/node_modules/@try-works/tool-mode-extension-sdk/lib/install/dependencies.js:165`
`const maxDepth = graph.maxDepth ?? 3;`, message at `:182`).

## Regression test

New file (no shared test file edited):
`packages/dsh-tool-mode/tests/extension-dependency-depth-live.test.ts`

It builds a synthetic host tree with the REAL npm package order
(`onnxruntime-node → global-agent → globalthis → define-properties →
define-data-property → es-define-property`), installs the shipped fixture
extension through the real `ExtensionsService` directory arm and the real SDK
staged installer, and asserts both sides of the bound:

1. `materializes all six packages (define-data-property at depth 4) with the default bound 12`
   — default configuration (`registryDependencyDepth` unset) records all six
   preinstalled dependencies; `define-data-property` and `es-define-property`
   exist under the extension's own `node_modules`.
2. `reproduces the live refusal verbatim when the bound is lowered to 3`
   — with `registryDependencyDepth: 3` the same tree refuses with
   `[DEPENDENCY_UNSATISFIED] ... exceeds the 3-level depth bound at define-data-property`
   and records nothing. This proves the message is driven by the forwarded bound,
   not hardcoded.

Command and result:

```
D:\DEV\dsh-tool-mode> npx tsx --test packages/dsh-tool-mode/tests/extension-dependency-depth-live.test.ts
▶ RC1: the live onnxruntime-node tree is bounded by the configured depth, not 3
  ✔ materializes all six packages (define-data-property at depth 4) with the default bound 12 (762.8709ms)
  ✔ reproduces the live refusal verbatim when the bound is lowered to 3 (message is bound-driven, not hardcoded) (162.2791ms)
✔ RC1: the live onnxruntime-node tree is bounded by the configured depth, not 3 (930.5406ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

Registry arm corroboration (existing shared test file, run read-only, not edited):

```
D:\DEV\dsh-tool-mode> npx tsx --test --test-name-pattern "depth" packages/dsh-tool-mode/tests/extension-registry-install.test.ts
✔ resolves a >=6-level registry tree with the raised default depth (12)
✔ still refuses a runaway graph, names the depth bound, and installs nothing
✔ resolves a transitive leaf from the PREINSTALLED PACKAGE'S OWN node_modules (npm nesting)
✔ materializes a SCRIPT-DECLARING regular dependency from the operator-preinstalled root
ℹ pass 4  fail 0
```

Typecheck (plugin package):

```
D:\DEV\dsh-tool-mode\packages\dsh-tool-mode> npm run typecheck
> @try-works/dsh-tool-mode@0.4.7 typecheck
> tsc --noEmit -p tsconfig.json
TYPE CHECK EXIT: 0
```

## Profile update (no host restart)

`~/.dsh/profiles/web/package.json` dependency line:

before:

```
"@try-works/dsh-tool-mode": "file:C:/Users/erikb/.dsh/profiles/web/plugins/try-works-dsh-tool-mode-0.3.6.tgz",
```

after:

```
"@try-works/dsh-tool-mode": "file:C:/Users/erikb/.dsh/profiles/web/plugins/try-works-dsh-tool-mode-0.4.8.tgz",
```

Installed tree replaced in place (no `pnpm install`, no host restart):
`~/.dsh/profiles/web/node_modules/@try-works/dsh-tool-mode` now reports
`version: 0.4.8` (319 files, down from 338 in the 0.3.6 tree) and its
`lib/extensions-service.js` contains three `maxDepth: depth` fields, including
`#dependencyGraph`.

Node resolution from the profile and a read-only smoke import (separate process)
confirm the installed build:

```
resolved: C:\Users\erikb\.dsh\profiles\web\node_modules\@try-works\dsh-tool-mode\package.json
version: 0.4.8
createExtensionsService: function | DEFAULT depth: 12
```

Commands used for the profile (PowerShell):

```powershell
# 1. build the tarball from the working tree (version 0.4.8, restored to 0.4.7 after pack)
#    cd packages/dsh-tool-mode; npm pack --json
# 2. place it in the profile's plugin folder
Copy-Item D:\DEV\dsh-tool-mode\packages\dsh-tool-mode\try-works-dsh-tool-mode-0.4.8.tgz `
  "$env:USERPROFILE\.dsh\profiles\web\plugins\try-works-dsh-tool-mode-0.4.8.tgz"
# 3. update the single file: dependency line in the profile manifest (edit)
# 4. update the installed tree in place
$dest = "$env:USERPROFILE\.dsh\profiles\web\node_modules\@try-works\dsh-tool-mode"
Remove-Item -Recurse -Force $dest
Copy-Item -Recurse <extracted tarball>/package $dest
# 5. verify resolution + smoke import (read-only, separate node process)
```

## Verification status

| check | result |
|---|---|
| focused RC1 test (2 cases) | **pass 2 / fail 0** |
| existing registry depth tests (4 cases) | **pass 4 / fail 0** |
| `npm run typecheck` (plugin package) | **exit 0** |
| packed 0.4.8 `lib` contains the directory-arm bound | yes (`:761`) |
| installed profile tree resolves to 0.4.8 | yes (Node resolution + smoke import) |

## Not verified / caveats

- **The running `:3080` host was not restarted**, by instruction. The process that
  is serving the page has the 0.3.6 modules loaded in memory; the corrected tree
  takes effect when the Lead restarts it. The live Extensions-page Laya install was
  therefore NOT re-run.
- **The published npm 0.4.7 does not fix RC1** (see table above). Publishing 0.4.8
  to npm is a separate release step and was not performed.
- The 0.4.8 tarball was built from a working tree that also carries other lanes'
  uncommitted changes (`prepared-assets.ts` free-space preflight,
  `extension-page-state.ts`, optional-runtime materialization). If a release should
  contain only RC1, rebuild from HEAD plus the directory-arm hunk.
- `pnpm-lock.yaml` in the profile was deliberately NOT modified (scope: only the
  single `file:` dependency line). It still records
  `file:plugins/try-works-dsh-tool-mode-0.3.6.tgz` and will be stale until the
  next `pnpm install`; the running host does not consult it.
- `anti_slop_lint` could not run in this environment (`oxlint is not installed`), so
  the new test file was not linted with the vendored rules.
- No full-suite run was performed (scope: focused test + plugin typecheck only).
