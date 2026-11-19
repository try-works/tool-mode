# Auto-keep Phase 0 — release hygiene and the installed baseline

Date: 2026-11-20. Package under test: **0.5.96** (source commit `7454a6f`).
Plan: `docs/auto-keep-plan.md`.

## Outcome

The packed plugin was installed into a disposable profile, the host was restarted
between install and probe, and a real `tool_mode_run` produced a callable draft.
A second restart showed the session draft is correctly invisible to the new session.

This is a **Phase 0 release-hygiene result**, not an auto-keep behavior result.

## Build and pack

```text
npm run build:host        exit 0
npm run verify:built      exit 0
```

`npm run plugin:pack` is broken in this checkout:

```text
npm error No workspaces found: --workspace=@try-works/dsh-tool-mode
```

The package itself packs correctly from its directory:

```text
cd packages/dsh-tool-mode
npm pack --json
-> try-works-dsh-tool-mode-0.5.96.tgz (517 entries)
```

The first standalone profile created by `npm install` pulled DSH plugins
`0.2.1-rc.5` while the CLI is `0.2.1-rc.2`; startup disabled the incompatible rows.
The fix was a fresh profile initialized through the DSH plugin manager, which resolves
the DSH bundles from the rc.2 checkout:

```text
dsh --profile autokeep --from-default-profile headless
dsh plugin --profile autokeep add <tarball>
```

Installed package version: **0.5.96**.

## Confinement evidence

The packed build initially refused `tool_mode_run`:

```text
generated-code execution is withheld: no passing confinement evidence for this build
```

Evidence was recorded for 0.5.96 and checked:

```text
node scripts/record-confinement-evidence.mjs --out verification/ptc-confinement-evidence.json
  package 0.5.96 · 5 tests, 5 pass, 0 fail, 0 skipped

node scripts/check-confinement-evidence.mjs --path verification/ptc-confinement-evidence.json
  package 0.5.96 · 5 tests, 5 pass · OK
```

The evidence file at the package root was repacked and reinstalled. The profile contains
`verification/ptc-confinement-evidence.json` for 0.5.96.

## Restart probes

Each headless invocation is a fresh host process. The install was followed by a fresh
process, then a second fresh process for the persistence check.

**Run (fresh process after install):**

```text
tool_mode_run code="return { doubled: input.value * 2 }" tools=[] input={"value":21}
-> runId rcpt_000001
-> result { "doubled": 42 }
```

**Draft created:**

```json
{
  "name": "agent_from_draft_462e422e",
  "status": "draft",
  "scope": "session",
  "scopeKey": "session-bf28150e-1302-48c5-9be1-c0b7e0df43fd",
  "expiresAt": "2026-11-20T21:19:40.753Z"
}
```

**Callable draft (new process, same session turn):**

```text
tool_mode_run -> runId rcpt_000002, result { "tripled": 6 }
tool_mode_tools list -> agent_from_draft_8db2269e
call agent_from_draft_8db2269e with value=4 -> { "tripled": 12 }
```

**Second restart (new session):**

```text
tool_mode_tools action=list
-> 0 authored tools visible in this session
```

That is the intended session boundary: the draft is callable in the session that created
it and is not visible to a new session.

## Findings to carry forward

1. `npm run plugin:pack` must be fixed or replaced with the package-directory
   `npm pack` in the release procedure.
2. A standalone `npm install` of the tarball can pull incompatible `0.2.1-rc.5`
   DSH plugins against the rc.2 CLI. Use the DSH plugin manager (pnpm) to initialize the
   profile.
3. A packed build must include a confinement evidence file for its exact version;
   otherwise `tool_mode_run` refuses by design.
4. The plan's restart check is real: the session draft does not survive into a new
   session, which is the correct behavior for Phase 4's session scope.

## Next

Phase 1: deprecate `autoDraft` in the schema with a one-release compatibility warning,
using red-first tests and the same restart gate for the install that ships it.
