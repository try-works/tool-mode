# Artifact scoping

Authored workflows (`workflow_<name>`) and tools (`agent_<name>`) can live at one of three
scopes. Scoping is **on by default**; new artifacts are session-scoped, existing global rows
remain resolvable, and Code Mode nested calls inherit the caller's session. A caller with no
session identity is downgraded to global, and every authoring write response echoes
`requestedScope` plus `scopeReason: "no-session-id"` whenever the effective scope differs
from the request; an explicit `scope: session` without a session is refused. Set
`artifactScopes.enabled: false` for the pre-scoping global-only behaviour.

```yaml
artifactScopes:
  enabled: true
  defaultScope: session
  workspaceRoot: auto       # git root via .git, else cwd; or an absolute path
  globalPromotion: human    # human | off
  promoteMinUses: 2
  expireSessionArtifacts: true
```

## Scopes and keys

| Scope | Key | Lifetime |
| --- | --- | --- |
| session | root session id; subagents walk `parentSession` to the root | until the root session is disposed |
| workspace | git root if inside a repo, else cwd; normalized realpath (lowercased on Windows) | durable |
| global | `host` | durable |

Resolution is `session > workspace > global`; the first row with the name wins. A list row
reports the winning `scope` and the nearest hidden lower row as `shadowing`, so the same
name at two scopes is never silent. `tool_mode_describe` carries both fields for authored
tools and accepts either the artifact name or `workflow_<name>`.

## API

Optional `scope` on `tool_mode_tools {define, clone, from-run}` and
`tool_mode_workflows {save, clone}`. `promote` copies to `to` under the same name and resets
`version` to 1; `keepSource` defaults true and `false` removes the source after the copy.
`demote` removes the row at `from` (default: the caller scope); the next lower row resolves.
`list` accepts `scope: session | workspace | global | all`.

Promotion requires `uses >= promoteMinUses` and `failures == 0`. `force: true` bypasses the
evidence floor only for a workspace promotion. A global promotion additionally requires the
operator to export `DSH_ARTIFACT_GLOBAL_APPROVAL=1` in the host environment; a tool argument
cannot stand in for that human decision.

At root-session disposal, session rows are removed and an `expire` authoring receipt records
their use counts. `tool_mode_list.authoring.pending` exposes those counts before expiry. The
host never auto-promotes. A crash can lose session artifacts without an expire receipt.

## Evidence

Promotion evidence is computed from invocation receipts with the same `artifactName` and
`artifactDigest`; `sessions` counts distinct `rootSessionId` values. Receipts carry
`artifactScope` for authored-artifact calls. Editing a program changes its digest, so old
evidence does not accrue to the new content.

## Rollout

0.5.90 enables scoping by default with `defaultScope: session`. Existing v1 rows remain
global and resolve underneath new session rows, so a stored `workflow_x` keeps working.
Operators can still set `enabled: false` to return to the global-only path.

Existing v1 store rows migrate to `global`/`host` on load with no data move. Writes use
document version 2; reads still accept v1.