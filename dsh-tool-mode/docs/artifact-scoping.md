# Artifact scoping

Authored workflows (`workflow_<name>`) and tools (`agent_<name>`) can live at one of three
scopes. Scoping is off by default; with `artifactScopes.enabled: false` every artifact is
global and the pre-scoping behaviour is preserved.

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
tools.

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

1. Ship with `enabled: false`; verify existing global behaviour.
2. Enable with `defaultScope: session` on one host.
3. Consider changing the default only after the adoption measurements.

Existing v1 store rows migrate to `global`/`host` on load with no data move. Writes use
document version 2; reads still accept v1.