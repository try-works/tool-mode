# Extension state read: benchmark and independent verification

Status: measured 2026-11-14 on the shared development host. Scope: the Settings > Model as Tool
extension-state read, the three changes that target it (fast page read, async digest, client
coalescing), and the diff that implements them.

## Why this exists

Settings > Model as Tool blocked for minutes on "Reading the extension state from the host...".
The host-side cause is `ExtensionsService.describe()`: every row it returns is backed by a full
content digest of an installed extension tree, and the store under test is 4.26 GiB across
19,683 files and 11 installed rows. The page path called that method from several places, so one
render could pay the digest repeatedly, and a skipped digest used to mark rows blocked.

## Store under test

| Fact | Value |
| --- | --- |
| Store root | `C:\Users\erikb\.dsh\profiles\web\extensions` |
| Files (recursive, regular files) | 19,683 |
| Bytes | 4,577,813,513 (4.26 GiB; the user-visible "4.58 GB" is the same size in decimal GB) |
| `extensions.lock.json` records | 15 |
| Rows returned by describe | 11 (11 installed, 0 active) |
| Newest file mtime | 2026-11-14T12:47:44.538Z |

The user's observed count was 19,697 files; the census saw 19,683. The difference is between
observations (likely staging churn), not a change made by this benchmark: every run below reports
the same census before and after.

## Method

`scripts/bench-extension-state.mjs` (new, this task) imports the repository sources through
`tsx` and times the three calls the page and activation paths use:

1. `ExtensionsService.describeFast()` - identity, state, tools; no installed-bytes digest.
2. `ExtensionStore.verifyUnchanged(firstRecord)` - the full content digest of one install.
3. `ExtensionsService.describe()` - every row with its integrity verified.

The script is READ-ONLY by construction and by measurement: it never calls install, enable,
disable, prepare or any store writer, and it censuses the store (file count, byte count, newest
mtime) before and after the timed calls. Every run below reports `storeUnchanged: true`.

Run it with:

```sh
npx tsx scripts/bench-extension-state.mjs --runs 5 --describe-runs 1 --label after
npx tsx scripts/bench-extension-state.mjs --skip-describe --runs 5 --label after-fast
```

Measurement limits, stated rather than hidden:

- These are service-level timings inside one Node process, not browser page timings. The page
  adds the Remote round trip and client normalization on top.
- The development host was busy during part of this work. Timings are reported as ranges and
  medians, and one run taken while the host was at 100% CPU is quoted separately rather than
  folded into the headline.
- `describe()` was timed twice before the Lead's instruction to avoid reconstructing slow
  pre-change timings arrived; both are reported as the still-slow full path, not as a speedup.
- The pre-change tree is no longer reproducible in the working tree now that all three changes
  have landed. The baseline run below was captured before the implementers' first write, and
  the Lead-recorded figures are quoted alongside it.

## Baselines

Lead-recorded, before the remote rewiring (authoritative for page-level expectations):

| Fact | Baseline |
| --- | --- |
| User-observed full page read | minutes |
| Page-path `describeFast` | 438 ms, 11 rows / 11 installed |
| Sync vs async digest, `@try-works/extension-minilm-embed@1.0.0` (2,914 files / 747.7 MiB) | 6,805 ms sync vs 2,682 ms async |

Preserved service-level baseline run (this task, 2026-11-14T13:12:24Z, before the first
implementer write; `label=baseline`, `--runs 3 --describe-runs 1`):

| Call | Baseline |
| --- | --- |
| `ExtensionStore.readLock()` | 2.3 ms (15 records) |
| `describeFast()` | 292.6 ms first call; 57.4 ms, 58.0 ms warm; rows=11, installed=11, blocked=11, integrity {unknown: 11} |
| `verifyUnchanged(first record)` | first record `@try-works/extension-declarative-recipes@0.1.0` (6 files, 19.2 KiB): 31.0 ms, 7.6 ms, 6.4 ms; unchanged=true |
| `describe()` | 56,241.6 ms; rows=11, blocked=2, integrity {unchanged: 11} |
| Store census before/after | 19,683 files / 4,577,813,513 bytes / same newest mtime; `storeUnchanged: true` |

The two regimes are both real and should not be conflated: the page path before the rewiring
was the full `describe()` (56.2 s in this run, "minutes" as the user saw it with repeated
reads), while `describeFast()` already existed and cost 57-58 ms warm. The change that removes
the stall is wiring the page to `describeFast()` and making a skipped digest non-blocking.

## After-change measurement

This task's script against the working tree with all three changes in it
(2026-11-14T13:17Z, `label=after`, `--runs 3 --describe-runs 2`):

| Call | After |
| --- | --- |
| `readLock()` | 2.2 ms (15 records) |
| `describeFast()` | 329.2 ms first call; 72.6 ms, 72.4 ms warm; rows=11, installed=11, **blocked=2**, integrity {unknown: 11} |
| `verifyUnchanged(first record)` | 40.4 ms, 8.6 ms, 7.4 ms; unchanged=true, digestMatches=true |
| `describe()` (still the full sync path) | 35,947.5 ms, 32,331.1 ms; rows=11, blocked=2, integrity {unchanged: 11} |
| Store census before/after | unchanged (same three fields); `storeUnchanged: true` |

A second clean run at 13:23Z (host at 100% CPU from concurrent test processes,
`--skip-describe --runs 5`) measured `describeFast`: 202.3 ms first call, then 62.8, 74.4, 78.8,
89.9 ms (median 78.8 ms); `verifyUnchanged`: 46.6 ms first, then 10.0, 9.8, 11.9, 10.0 ms. A
third run during the same saturation produced 0.5-1.9 s per `describeFast`; it is reported here
to show the variance, not as a result.

### What the page path gets

- Before: the Remote `describe` was `ExtensionsService.describe()` - a full digest, 56.2 s in
  the preserved run (the user saw minutes with repeated reads).
- After: the Remote `describe` is `describeFast()` - 72.6 ms warm / 329.2 ms cold in the
  like-for-like run. That is ~775x faster warm and ~171x faster cold for the host call the page
  now makes (56,241.6 / 72.6 and 56,241.6 / 329.2).
- Client coalescing (task-29) means the page's four readers share one in-flight host call and a
  5 s snapshot, so the mount/Recheck/post-action burst is one call, not four. Explicit
  invalidation after install/enable/disable/prepare and Recheck bypasses the snapshot.
- Skipped integrity is no longer blocking: the same store went from 11 blocked rows on the fast
  read to 2, which matches what the full read reports. Integrity still reads `unknown` on the
  fast path - it is never upgraded to `unchanged` without a digest.

## Residual bottlenecks

1. **The full digest path is still slow and still used where integrity is required.**
   `ExtensionsService.describe()` remains ~32-36 s warm / ~56 s cold on this 4.26 GiB store
   (single-threaded, synchronous `digestInstalledContent`, `store.ts:177`). That is acceptable
   off the page path, but any caller that needs verified integrity still pays it.
2. **The async/cached digest exists but has no caller.** `verifyUnchangedAsync`
   (`store.ts:748`) and `digestInstalledContentAsync` (`store.ts:324`) are exported, tested and
   benchmarked, and the Lead-recorded latency on a 747.7 MiB install is 6,805 ms sync vs
   2,682 ms async (2.5x). But a repository-wide grep finds no production caller: activation
   (`lifecycle.ts:398`, `:774`), the CLI (`cli.ts:444`) and the host's own integrity checks
   still call the synchronous `verifyUnchanged` (`extensions-service.ts:1408`, `:3226`,
   `index.ts:6038`). Until it is wired in, task-28 improves no measured path, including the
   `describe()` timing above (that path is unchanged; its 56.2 s -> ~34 s difference is most
   plausibly OS page-cache and host-load variance between runs, not the async digest).
3. **`describeFast()` still costs 63-90 ms warm.** `readLock()` is only ~2 ms of it; the rest is
   profile-state reads, `readExtensionFacts` per installed copy and the requirement/dependency
   computation for 11 rows. The first call in a process costs 200-330 ms (module/JIT warm-up).
   The script does not decompose this further.
4. **Client cache semantics.** A snapshot can be up to 5 s stale for a change made by another
   client (`REMOTE_SNAPSHOT_TTL_MS`, `client/index.template.js:601`); own actions and Recheck
   invalidate it. An in-flight read that is invalidated is not cancelled: its cache write is
   suppressed by the generation check, but a caller already awaiting it can still resolve with
   the older snapshot (`client/index.template.js:629-670`). Not covered by a test; low risk in
   the current call order.
5. **If the async digest is wired in, bound the worker memory.** The worker hashes whole files
   with `readFileSync` (`store.ts:230-237`); the largest file in this store is 46,208,475 bytes
   (~44 MiB), so the default up-to-8 workers peak at roughly workers x largest file (~350 MiB
   here) and grow with the store's largest artifact. Streamed hashing would remove that bound.

## Diff safety review

Criteria supplied with the task: skipped integrity never reported as unchanged; async digest
algorithm-identical; no unrelated changes.

| # | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Skipped integrity is never reported as `unchanged` | **PASS** | `describeFast()` runs `#describe(signal, false)`; the row keeps `integrity: 'unknown'` with a null reason (`extensions-service.ts:1863`, `:1943`). Only `unknown + null reason` becomes a satisfied, non-blocking requirement (`extensions-service.ts:1537-1554`); `changed`, and `unknown` with a digest-failure reason, still block. Tests assert the fast row is `unknown`/not blocked while the full read is `unchanged` (`extensions-service.test.ts:384-430`). After-benchmark: `{unknown: 11, unchanged: 0}`, blocked 2. |
| 2 | Async digest is algorithm-identical | **PASS** | The async digest uses the same sorted file list, the same `name + \0 + size + \0 + sha256(bytes) + \0` records, forward-slash relative names and the same receipt exclusion as `digestInstalledContent` (`store.ts:177` vs `:324`); only the reading is parallel, and the final hash is assembled in one order on the main thread. A worker failure falls back to inline reads. `digest-async.test.ts:66-113` asserts byte-identical output at concurrency 1/2/3/8/default and on empty/edited/removed/receipt-only cases; 12/12 pass. The cache only short-circuits when the record digest and the metadata fingerprint both match (`store.ts:748-779`), and its documented residual (same size, mtime and ctime) is real. |
| 3 | No unrelated changes | **PASS** | `git status`/diff touches exactly the scoped files: `client/index.js` + `client/index.template.js` (generated pair, both carry the same helper), `src/extensions-service.ts` (12 lines), `src/index.ts` (6 lines), `tool-mode-extension-sdk/src/install/store.ts`, plus their tests and `scripts/bench-extension-digest.mjs`. The three implementation diffs contain no version bump, no publish and no root/lock edits. Two caveats: after these diffs landed, the tree also gained a `packages/dsh-tool-mode/package.json` version bump 0.5.50 -> 0.5.51 and regenerated `verification/*` files (mtimes 2026-11-14T21:23:55-21:24:06Z) from a separate step - those are not part of the three implementation diffs and are not reviewed here; and the async digest has **zero callers**, which is not an unrelated change but is a functional gap (see residual bottleneck 2). The untracked `.tmp-*.log` files (`.tmp-int4.log`, `.tmp-sdk.log`, `.tmp-targeted.log` at the time of writing) are stray scratch outputs, not part of this change. |

No blocker was found in the three changed code paths. The one functional concern is the
zero-caller async digest: it is correct but does not yet speed up activation or the full
describe, so it cannot be credited in the numbers above.

## Gates

Run after all three changes landed, from the repository root:

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json` | exit 0 |
| `npx tsx --test packages/dsh-tool-mode/tests/extensions-service.test.ts packages/dsh-tool-mode/tests/client-extension-state.test.ts` | 33 tests, 33 pass, 0 fail |
| `npx tsx --test packages/tool-mode-extension-sdk/tests/digest-async.test.ts` (extra safety gate) | 12 tests, 12 pass, 0 fail |

No full suite was run and nothing was published, per the task. This task did not bump a version; the working tree does contain a separate 0.5.50 -> 0.5.51 bump made after these gate runs, which does not change what the gates exercised (the three code changes).

## Reproduce

```sh
# After-change page-relevant read (no full digest):
npx tsx scripts/bench-extension-state.mjs --runs 5 --skip-describe --label after-fast

# Include the still-slow full digest once (costly: tens of seconds on this store):
npx tsx scripts/bench-extension-state.mjs --runs 3 --describe-runs 1 --label after

# A different store:
npx tsx scripts/bench-extension-state.mjs --store "D:\some\profile\extensions" --runs 3
```

Environment: Windows x64, Node v24.11.0, 16 logical CPUs, 64 GB RAM. The script prints the
store census, the per-run timings, integrity distributions and a final `RESULT {...}` JSON line
for mechanical comparison.
