# autoDraft removal — Phase 2 completion

Date: 2026-11-20. Package **0.5.98**.
Plan: `docs/auto-keep-plan.md`.

## Outcome

`adoption.autoDraft` is no longer a functional setting. The schema keeps a tombstone
key so an old configuration fails with a migration message instead of silently falling
back to `autoKeep:'session'`. `autoKeep` is the policy field.

## Installed-build probes

Installed **0.5.98** into the disposable `autokeep` profile via the DSH plugin manager,
then started a fresh host process.

### Removed key is diagnosed

Using the 0.5.96 patch that still contains `autoDraft: true`:

```text
model-tools (@try-works/dsh-tool-mode): Error: adoption.autoDraft was removed.
Use adoption.autoKeep to choose 'off' | 'session' | 'workspace';
use captureRunPrograms:false to disable capture, drafts and from-run entirely.
```

Exit code: 1. The error is the migration path, not a silent ignore.

### autoKeep still works

With `autoKeep: session`:

```text
tool_mode_run code="return { doubled: input.value * 2 }" tools=[] input={"value":3}
-> runId rcpt_000001
-> agent_from_draft_462e422e, status draft, scope session
```

Restart (new session):

```text
tool_mode_tools action=list -> total 0
```

The session draft does not leak into the next session.

## Verification

- Full host suite: **2154 pass, 0 fail, 7 environmental skips**
- `npm run typecheck`: exit 0
- `npm run build:host`: exit 0
- `npm run verify:built`: exit 0
- Installed profile: **0.5.98**

## Note on the tombstone

The zod schema still declares `autoDraft` as an optional boolean solely to catch the old
key at runtime. It is absent from the hand-written `Config` type and has no effect on
behavior; any present value throws the migration error above. Removing the tombstone
entirely would let an old config silently switch to the default session policy, which is
worse.
