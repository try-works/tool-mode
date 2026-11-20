# Headless live verification — 0.5.104

**Status:** measured in a fresh DSH process. **Web host:** still old; not claimed.

A disposable DSH home/profile was updated from 0.5.98 to **0.5.104** and given
`hostedCode: true` through its own `cordis.patch.yml`. The headless profile uses the same
tool-mode plugin build as the web profile, and every session below is a separate full DSH
process start.

## Evidence

| Session | Task | Result |
|---|---|---|
| `6a63724c-8a89-4f82-9ca8-e4b6ba7ab098` | define workspace tool `agent_live_probe` with a verification note | `DONE`; the digest rendered: `Use agent_live_probe({texts?: string[]}) — Count items. Pass the whole list in one call. Verify: Fails on short lists; verify counts.` |
| `3af36b8b-5ff8-4f0f-a2ea-5f116fa55861` | first task: `Reply READY. Do not call any tools.` | transcript's first-step user messages include the same digest **before any tool call**: `Use agent_live_probe(...) ... Verify: Fails on short lists; verify counts.` |
| `1588c428-7c8a-4332-9824-a239cba82b3c` | `tool_mode_run({ probe: true, tools: ['agent_live_probe'] })` | `resolved: true` (workspace artifact bindable) |
| `27380a15-ecc9-4980-bdc9-6b0f78b8d139` | run a program, then probe the resulting draft | draft `agent_from_draft_47091bf0` created at session scope; `resolved: true` |

The transcript decode is the same concatenated-zstd reader used by
`scripts/probe-adoption-0.5.103.mjs`: a plain decompress returns only the header.

## What this establishes

- The 0.5.104 build starts as a fresh DSH process and registers tool mode.
- An existing workspace artifact reaches the **first task step** as a user message and
  carries the author's verification note.
- A workspace artifact resolves in the program binding preflight when its workspace key
  matches the caller.
- A successful `tool_mode_run` creates a session draft that resolves from its own session.

## Not established

- The **web** host on `:3080` is still PID 30464, booted before 0.5.104 was installed. Its
  auth URL/boot-time behavior is not re-measured here.
- The delegated-subagent U42 case was not exercised in this headless profile.
- The probe script's markers are draft-specific; this artifact is `agent_live_probe`, so
  the script's `userMessageHits: 0` is a marker miss, not a delivery failure. The manual
  transcript above is the evidence.
