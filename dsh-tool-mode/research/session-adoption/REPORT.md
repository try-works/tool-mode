# Session-start adoption through the DSH prompt hook

**Date:** 2026-11-20. **Build:** 0.5.101 source (0.5.100 + fail-open guard). **Question:** can
the harness present the caller's stored tools/workflows at the start of a request so
auto-keep does not depend on an agent deciding to look?

## The hook that already exists

DSH's `dsh-agent` augments the public `AssembleContext` with the live `Agent`:

```text
D:\deepseek-harness\packages\core\agent\src\runtime-types.ts
  interface AssembleContext { agent?: Agent }

D:\deepseek-harness\packages\core\agent\src\dispatch.ts
  assembleContextFor(agent, signal) => { agent, scope: agent, signal }
```

`system-prompt/assemble` is a waterfall over the assembled sections, contexts, tools and
variables. A registered section's `text(context)` is evaluated at each assembly, and the
README states sections repeat per request. That is the start-of-request seam.

The plugin already registered a section, but its callback ignored `context` and its comment
claimed assembly had no caller identity. It therefore resolved only workspace/global rows.
That is why E14's session auto-draft was not in the prompt, and why "listed" never happened.

## What changed

- The section callback now reads `context.agent` and calls `scopeFor({ agent }, 'session')`.
- The resulting scope chain supplies session, workspace and global rows (winners only).
- Session rows carry the caller's root session id, so `buildDirectiveDigest` shows them to
  their owner and filters them out for every other session.
- The directive now renders the compact call shape, for example
  `Use agent_from_draft_x({texts: string[]}) ...`, and adds
  `Pass the whole list in one call.` when the schema takes an array. This targets the E15
  cost observation as well as E14's discovery gap.

## TDD evidence

```text
npx tsx --test packages/dsh-tool-mode/tests/adoption-session-prompt.test.ts
red:   2 tests, 0 pass, 2 fail   (section text was empty)
green: 3 tests, 3 pass, 0 fail   (the third pins tools + workflows together)
```

Adjacent adoption/digest suites: **23 tests, 23 pass**. Typecheck: exit 0.

## Alternatives considered

| Hook | Fits prompt text? | Notes |
|---|---|---|
| `systemPrompt.section({ text(context) })` | yes | per-assembly, receives Agent; existing section already owns the bounded digest |
| `system-prompt/assemble` waterfall | yes | more general; useful if we needed to add/replace tool schemas, not just text |
| `systemPrompt.context` | yes | becomes a durable user-role snapshot; avoids changing the cached system prefix, at the cost of another history message |
| `agent/pre-step` | yes | can replace step messages; later than assembly and more invasive |
| `agent/request` | no | runs after assembly and cannot mutate messages |
| `agent/created` | no | initialization signal, not prompt content |

The section is the smallest change because the digest already lived there. If prefix-cache
invalidation becomes measurable, moving the same rows to `systemPrompt.context` is a
contained follow-up.

## Startup hardening (0.5.101 / 0.5.102)

The prompt section is now fail-open: any scope/store/digest failure is caught, logged as
`tool-mode library digest skipped: ...`, and returns an empty section. A missing aid must
not block prompt assembly or DSH startup.

A separate environment fault was found while installing this build: `dsh plugin add`
failed with `'pnpm' is not recognized as an internal or external command`. The DSH plugin
manager needs pnpm on PATH; it was missing while only temporary pnpm tool directories
remained. `pnpm@11.28.5` is now installed globally, and the 0.5.101 install succeeded with
the normal command. That missing tool, not the tool-mode prompt section, is the concrete
failure observed; it is not claimed as the only cause of the earlier startup trouble.

### Boot path: async, cached integrity (0.5.102)

The restore chain used the SDK's synchronous `verifyUnchanged()` before activation. That
hashes each installed tree on the event loop; with ~16 extensions and multi-GB dependency
trees it delayed the loader and the auth URL. It now uses `verifyUnchangedAsync()`, which
uses the worker-pool digest and reuses a fingerprint-matching verification, so the restore
chain yields to boot. Regression: `tests/extension-restore-nonblocking.test.ts` proves the
synchronous digest is never called and activation still completes. Plugin suite after the
change: **2169 tests, 2165 pass, 4 skipped, 0 fail**.

## Limits

- 0.5.102 is packed and installed into the web profile; the running host still holds the
  old module graph until a full DSH stop/start, so the boot-time and live prompt probes are
  pending.
- The inventory is directive plus at most three supporting names, bounded to four lines and
  600 characters. It is not an exhaustive catalog; `tool_mode_tools list` remains the full
  bounded surface.
- Discovery is still a prompt effect. The E14/E15 contrast remains the evidence that naming
  beats existence; this change makes naming automatic, not guaranteed.
