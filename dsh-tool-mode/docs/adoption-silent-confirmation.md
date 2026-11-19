# Silent-run confirmation and purpose-strip verification (task-81)

**HEAD audited:** `98beb37` (clean). **Base for the fix:** `3ac8df3`.
**Verifier:** task-81. **Writes:** this report only; no source/test changes, no commit.
Probes were run outside the repo under `D:\DEV\tmp\adoption-reverify`.

## Verdict

**PASS.**

The purpose-strip fix is confirmed by execution on every non-digest surface tested
(`tool_mode_tools` list/get/promote/demote and `tool_mode_list`'s authoring block), while
both digest modes still render the purpose. The silent Phase 8 run has been re-recorded
with raw logs, the exact seed and prompts; the updated D 1/10 vs G/O 10/10 result is
internally consistent, the report states the one D artifact call and the unrounded
answer honestly, and the purpose is absent from every D log. The remaining observations
are evidence/reproducibility notes, not correctness blockers.

## Gates (re-run on `98beb37`)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 (19 tsc projects) |
| `npm run test:integration:dsh` | `ℹ tests 2137 · pass 2130 · fail 0 · skipped 7 · cancelled 0`, exit 0 |
| `agent-authoring.test.ts` (purpose contract) | 32 tests, 31 pass, 0 fail, 1 skip (POSIX permissions on win32) |
| `npm run build:host` | exit 0; client catalog 18 models / 9 runnable |
| `npm run verify:built` | exit 0; built artifact loads through package main |
| `npm run verify:docs` | exit 0; 22 pages, README coverage OK |

The 7 full-suite skips are the established environment set (POSIX bits, symlink EPERM,
env-gated needle, Windows ACL workspace-write arms); no purpose/silent test is skipped.

## Purpose strip — confirmed by execution

With the D-like config (`adoption.digest:false`) and an artifact carrying the silent
purpose, on HEAD `98beb37`:

| Surface | Purpose present? |
|---|---|
| `tool_mode_tools list` | **false** |
| `tool_mode_tools get` | **false** |
| `tool_mode_tools promote` | **false** |
| `tool_mode_tools demote` | **false** |
| `tool_mode_list` `authoring.tools` | **false** |
| callable tool schema description | `A helper.` (opaque; purpose absent) |
| neutral digest | **true** |
| directive digest | **true** |

The execution probe defined `agent_a7f3` with the exact silent purpose and asserted the
whole serialized result does not contain it. The source uses `visibleToolRow`
(`authoring-surface.ts:276-282`) for list/get/demote/promote and strips purpose from the
`tool_mode_list` authoring tools map (`index.ts:3971-3980`); the store and the digest keep
it (`index.ts:4048-4062`). The new agent-authoring contract test passes. The raw D logs
contain **0** occurrences of the purpose; G and O logs contain it (from their digests),
which is the intended asymmetry.

A residual, non-blocking gap: workflow rows can carry a `purpose` in the store type, but
there is no public `tool_mode_workflows save` purpose parameter, and the tool-only strip
is what this run needs. If workflow purposes are ever exposed through a setter, the same
strip must be applied to `tool_mode_workflows` list/get and the authoring work flows map.

## Silent Phase 8 run — re-audit of the committed evidence

The updated evidence now includes the exact seed, prompts, 30 raw task logs, D's
ledger/usage, G/O ledgers/usage and task results. Cross-checks:

| Check | Result |
|---|---|
| raw logs present | 10 per arm, 30 total |
| task exits | 30 × `EXIT=0` |
| task results | 30 entries; D 10/10 within 1 cent (9/10 exact cents), G/O 10/10 exact |
| G/O artifact calls | ledger 10 sessions each, exactly one `agent_a7f3` call per session |
| G/O usage | 10 uses, 10 sessions, 0 failures, digest `66e4b164…` |
| G/O ledger ↔ usage session ids | identical sets |
| D artifact use | 1 session, 1 `agent_a7f3` call, 1 use in usage |
| D extra call | one `pwsh` call in a different session (ledger) |
| purpose in D logs | **0** |
| purpose in G/O logs | G 3, O 2 (digest text) |
| D task 5 | answer `52.325` (within a cent, not rounded); report states this |
| D task 7 | one artifact call with `b=1.2` (wrong semantics, output 682.55); D ignored it and answered 372.30 correctly |

The report's updated numbers match the files: D session reuse **1/10**, G/O **10/10**;
the kill-rule G vs D and O vs D are **+90 percentage points**. The one D artifact call
means the baseline is "10% by guessing", not "0%"; the report labels it as the only
non-silent event and does not hide it. The seed (`seed-agent_a7f3.json`) has the opaque
name/description/`a`/`b`, purpose and program; the prompts match `prompts.txt`.

**Silent condition:** with purpose stripped from every non-digest surface and the seed
purpose present only in G/O digests, the D arm's initial context is genuinely opaque. The
fact that one D session guessed and called the tool is a real outcome, not a leak; the
other nine answered by hand. This is a valid silent result within the tested design.

### Evidence notes (not blockers)

- `run.ps1` still uses `E:\tmp` paths, does not copy `seed-agent_a7f3.json` into the
  arm directory, and does not copy task logs back into the repo. The seed/logs are now
  committed, so the run is auditable, but reproduction still involves manual steps; a
  self-contained run script would be better.
- The raw logs are the CLI's reasoning/answer output, not full session transcripts or the
  system prompt. Combined with the config and the purpose-surface probe they are enough
  for this audit, but a full transcript set would make the silent claim even stronger.
- `docs/adoption-silent/REPORT.md` claims "all 30 answers correct within one cent"; the
  task-results confirm `withinCent:true` for all 30 and the D exact-cents exception is
  disclosed.
- The older ceiling run remains separately recorded and labeled; this report supersedes
  it as the Phase 8 result, as stated.

## Remaining carried-forward notes

- `autoDraft` remains true by default; the silent run did not exercise it (no
  `tool_mode_run`), and the report correctly claims no adoption lift for it. The
  functional suite passes; the adoption-lift question is separate.
- F4 (raw red transcripts) remains partial; `adoption-red-evidence.md` continues to state
  the missing transcripts. Not part of this confirmation's acceptance.
- The purpose contract test's old title still says "list returns it" while its assertions
  require absence; the assertions are correct, the title is stale.

## What was not run

- No new 30-session experiment; I re-audited the committed logs/ledgers and re-ran the
  gates and purpose probes.
- No publish/install or live MCP suite.
