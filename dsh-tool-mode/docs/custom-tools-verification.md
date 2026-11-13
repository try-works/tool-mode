# Custom Tools v1 — verification

**Date:** 2026-10-25
**Plan:** [custom-tools-implementation-plan.md](custom-tools-implementation-plan.md)
**Package:** `@try-works/dsh-tool-mode`

## What was implemented

- Profile-scoped, versioned custom-tool store with immutable versions and an
  atomic active index.
- Validated authoring records for HTTP, prompt and composite tools.
- Runtime compilation to `defineTool`, startup restore and disposal with the
  plugin.
- HTTP executor with:
  - exact HTTPS origin allowlist;
  - DNS-based private/loopback/link-local/metadata refusal;
  - redirect refusal, timeout and 1 MiB response cap;
  - `ctx.credentials` secret references resolved per call.
- Prompt executor through the composed host model.
- Composite executor with a 10-step bound, self-call refusal, previous-result
  interpolation and a destructive-step approval seam.
- Additive Remote methods:
  `customToolsDescribe`, `customToolsGet`, `customToolsDraft`,
  `customToolsValidate`, `customToolsTest`, `customToolsSave`,
  `customToolsSetEnabled`, `customToolsDelete`.
- Create-tool client tab:
  manual editor, validate/test/save, saved list, edit, enable/disable, delete,
  and agent draft.
- MCP exposure is per-tool opt-in. Custom tools default to agent exposure and
  MCP off; the status surface receives a named withheld reason.
- Tool Inventory attributes custom tools to `kind: custom` and the owning record.

## Commands and results

```text
npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json
  exit 0

npx tsx --test packages/dsh-tool-mode/tests/custom-tools-*.test.ts
  tests 38, pass 38, fail 0

npx tsx --test packages/dsh-tool-mode/tests/remote-typert.test.ts
  tests 16, pass 16, fail 0

npx tsx --test packages/dsh-tool-mode/tests/tool-inventory.test.ts
  tests 16, pass 16, fail 0

npx tsx --test packages/dsh-tool-mode/tests/*.test.ts   # repo root
  tests 1403, pass 1400, fail 0, skipped 3
```

The clean-profile E2E test (`custom-tools-e2e.test.ts`) uses a fresh state file
and custom-tool root, then:

1. persists a composite tool;
2. mounts the real plugin and registry;
3. confirms the tool is registered;
4. executes it through `ctx.tools.execute`, calling a second real registry tool;
5. confirms Tool Inventory reports `kind: custom` and the owning record id;
6. disables it through the Remote surface and confirms removal from the registry;
7. deletes it and confirms the list is empty.

## Coverage gaps

These are not claimed as verified:

- **Live public-network HTTP execution.** The SSRF and credential paths are
  covered with injected DNS/fetch/credential seams. No external API call is made
  in the suite.
- **Live MCP transport.** MCP exposure is asserted through the publication
  surface; a full external MCP client handshake is outside this run.
- **A real model provider for prompt tools and agent drafting.** The service
  tests inject a model double; the host adapter is typechecked but not exercised
  against a live provider in this run.
- **Browser screenshot of the Create tab.** The client bundle and render tests
  pass; visual verification in the running Web GUI is still pending.
