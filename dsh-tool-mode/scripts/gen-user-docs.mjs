/**
 * Generate the user-facing model and tool reference tables.
 *
 * These pages are derived from the catalog and the installed extension
 * manifests. Hand-maintained copies of the same facts drift silently: a tool
 * gets renamed, a model stops being Windows-runnable, or a package moves. The
 * docs then teach the previous release.
 *
 * Usage:
 *   node scripts/gen-user-docs.mjs
 *   node scripts/gen-user-docs.mjs --check
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs', 'guide', 'reference')
const catalog = JSON.parse(readFileSync(join(root, 'packages', 'dsh-tool-mode', 'catalog', 'desert-ant-models.json'), 'utf8'))
const extensions = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .flatMap((entry) => {
    const manifestPath = join(root, 'packages', entry.name, 'tool-mode.extension.json')
    const packagePath = join(root, 'packages', entry.name, 'package.json')
    if (!existsSync(manifestPath) || !existsSync(packagePath)) return []
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
    return [{
      packageName: pkg.name,
      version: pkg.version,
      id: manifest.id,
      displayName: manifest.displayName ?? manifest.id,
      description: manifest.description ?? '',
      activation: manifest.activation?.policy ?? 'operator',
      tools: manifest.tools ?? [],
      manifestPath,
    }]
  })
  .sort((left, right) => left.id.localeCompare(right.id))

const clean = value => String(value ?? '')
  .replace(/\s*\((?:[A-Z]{2,4}-\d+(?:\s*,\s*[A-Z]{2,4}-\d+)*)\)/g, '')
  .replace(/\s+/g, ' ')
  .trim()
const escape = value => clean(value).replaceAll('|', '\\|')
const truncate = (value, max) => {
  const text = clean(value)
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function windowsStatus(model) {
  if (model.verifiedRunnableOnWindows === true) return 'Yes'
  if (model.appleOnly === true) return 'Apple only'
  if (model.closedBeta === true) return 'Closed beta'
  if (model.windowsSupport === 'browser-only') return 'Browser only'
  return 'No native build'
}

function licenseLabel(model) {
  if (model.license === 'source-available') return 'Source-available'
  return clean(model.license ?? 'See model page')
}

function modelsPage() {
  const rows = catalog.map(model => [
    `[${escape(model.name)}](${model.docsUrl ?? '#'})`,
    escape(model.capability),
    windowsStatus(model),
    model.appleOnly === true ? 'Yes' : 'No',
    model.closedBeta === true ? 'Yes' : 'No',
    model.modelSizeMB === null || model.modelSizeMB === undefined ? '—' : `${model.modelSizeMB} MB`,
    licenseLabel(model),
  ].join(' | '))

  return `---
title: Models
description: The Desert Ant catalog, what each model does, and where it runs.
---

# Models

Tool Mode ships with the **18-model Desert Ant catalog**. Availability is decided
in the running process, not guessed by the agent: a model with no usable route is
reported as unavailable together with the concrete reason.

## Status at a glance

| Model | Task | Windows x64 | Apple only | Closed beta | Size | License |
|---|---|---|---|---|---|---|
${rows.map(row => `| ${row} |`).join('\n')}

**Reading the status column**

- **Yes** — the provider was verified runnable on Windows x64.
- **Browser only** — the vendor ships a browser build, but no Node native build.
- **No native build** — there is no prebuilt binary for this platform.
- **Apple only** — the model runs through Apple frameworks and needs a Mac (or
  the user-hosted bridge).
- **Closed beta** — the vendor has not published a runtime SDK.

The table describes the **catalog models**. Extension packages add their own
models and tools; see [Extensions](../guides/install-extensions.md).

### Extension models

These models are added by first-party extension packages. They are available only
when the package is installed, its assets are ready, and it is enabled.

| Model | Package | Tools |
|---|---|---|
${extensions.map(extension => `| ${escape(extension.displayName)} | \`${extension.packageName}\` | ${extension.tools.map(tool => `\`${tool.name}\``).join(', ') || '—'} |`).join('\n')}

## Catalog details

${catalog.map(model => `### ${model.name}

${clean(model.summary)}

- **Capability:** \`${model.capability}\`
- **Input:** ${clean(model.input)}
- **Output:** ${clean(model.output)}
- **npm package:** ${model.npmPackage ? `\`${model.npmPackage}${model.npmSubpath ?? ''}\`` : '—'}
- **CLI verb:** ${model.cliVerb ? `\`desertant ${model.cliVerb}\`` : '—'}
- **Model size:** ${model.modelSizeMB === null || model.modelSizeMB === undefined ? 'not stated' : `${model.modelSizeMB} MB`}
- **License:** ${licenseLabel(model)}
- **Vendor page:** ${model.docsUrl ?? '—'}
`).join('\n')}

## Why a model can be unavailable

An unavailable model stays visible in the catalog so the reason is discoverable.
The common causes are:

1. **No native build for this platform.** Several LiteRT/TFLite packages publish
   Linux or Apple binaries but no \`win32-x64\` build.
2. **Apple-only frameworks.** Title and Uhm need Core ML/MLX on Apple silicon.
3. **Closed beta.** The weights or SDK are not published yet.
4. **A missing extension.** Extension-backed models need the extension installed,
   prepared, and enabled.
5. **A missing runtime.** Some packages need \`onnxruntime-node\` or another
   platform runtime before they can execute.

Use \`tool_mode_list\` for the live answer in your process. Do not infer
availability from this page: your operating system, CPU, installed packages and
enabled extensions decide it.

## Routes

A model does not need to run on the same machine as the agent. The supported
routes are:

- **In-process npm package** — the default when the platform has a build.
- **Desert Ant CLI** — macOS and Linux; covers every shipping model.
- **User-hosted bridge** — an HTTP bridge on a machine that can run a model. The
  plugin does not host the model for you.
- **Extension** — a Tool Mode extension package that declares its tools and
  assets.

See [How Tool Mode works](../concepts/how-tool-mode-works.md) and
[Configuration](../reference/configuration.md#routes).
`
}

function toolsPage() {
  const extensionTools = extensions.flatMap(extension => extension.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    owner: extension.displayName,
    ownerKind: 'Extension',
    availability: `Requires ${extension.packageName} to be installed and enabled`,
  })))

  /**
   * Standard contract tools whose implementation is selected by the host rather
   * than declared as a manifest tool. MiniLM serves text_embed/text_rerank as an
   * implementation of the standard contract, so it is absent from the manifest
   * tool list but present in the live surface.
   */
  const standardTools = [
    {
      name: 'text_embed',
      description: 'Embed text into the legacy 384-dimensional MiniLM space.',
      owner: 'MiniLM text_embed',
      ownerKind: 'Standard contract',
      availability: 'Requires the MiniLM text_embed extension and its prepared text backbone',
    },
    {
      name: 'decision_choose_jev',
      description: 'Choose one of 2–16 options through the remote Jev (TypeSafe System One) typed-question API.',
      owner: 'Remote Jev',
      ownerKind: 'Opt-in remote route',
      availability: 'Only when jev.enabled is true and a Jev API key is configured',
    },
    {
      name: 'decision_judgments_jev',
      description: 'Batch independent yes/no judgments through the remote Jev API.',
      owner: 'Remote Jev',
      ownerKind: 'Opt-in remote route',
      availability: 'Only when jev.enabled is true and a Jev API key is configured',
    },
    {
      name: 'decision_combine',
      description: 'Combine code-computed facts and model judgment probabilities through explicit first-match rules.',
      owner: 'Host',
      ownerKind: 'Host tool',
      availability: 'Built into the host',
    },
    {
      name: 'decision_evaluate',
      description: 'Evaluate labeled decision probabilities with accuracy, confusion rates, Brier score and calibration bins.',
      owner: 'Host',
      ownerKind: 'Host tool',
      availability: 'Built into the host',
    },
    {
      name: 'decision_route',
      description: 'Route a judgment probability into accept, reject or the escalate band.',
      owner: 'Host',
      ownerKind: 'Host tool',
      availability: 'Built into the host',
    },
    {
      name: 'text_rerank',
      description: 'Score query/document pairs with the MiniLM cross-encoder and rank them.',
      owner: 'MiniLM text_rerank',
      ownerKind: 'Standard contract',
      availability: 'Requires the MiniLM text_rerank extension and its prepared text backbone',
    },
  ]

  const all = [...extensionTools, ...standardTools].sort((left, right) => left.name.localeCompare(right.name))
  const rows = all.map(tool => `| \`${tool.name}\` | ${escape(truncate(tool.description, 150))} | ${escape(tool.owner)} (${tool.ownerKind}) | ${escape(tool.availability)} |`)

  const extensionRows = extensions.map(extension => `| [${escape(extension.displayName)}](../guides/install-extensions.md) | \`${extension.packageName}\` | ${extension.version} | ${extension.tools.length} | ${escape(extension.activation)} |`)

  return `---
title: Tools
description: The tools an agent can call, and the model or extension behind each one.
---

# Tools

The tools below are declared by installed extension manifests. The **live
schema** is always available from \`tool_mode_describe\`; this page is the
human-readable index, not a second source of truth for argument shapes.

Catalog models are documented separately in [Models](models.md). A catalog model's
tool name is a route label; it is not a promise that the tool is registered in
your deployment.

## Tool index

| Tool | What it does | Backed by | Availability |
|---|---|---|---|
${rows.join('\n')}

## Host and discovery tools

These are provided by Tool Mode itself rather than by a model extension.

| Tool | What it does | Available over MCP? |
|---|---|---|
| \`tool_mode_list\` | Lists the tools the caller may use, their readiness and the catalog revision. | Depends on the caller's export grant; check \`tools/list\`. |
| \`tool_mode_describe\` | Returns a tool's schemas, model facts, semantics, limits and unsupported cases. | Depends on the caller's export grant. |
| \`model_tools\` | Read-only management view: installed models, enable/disable state and why a model cannot run. | No. Management stays host-local. |
| \`tool_mode_run\` | Runs a bounded program that chains tools (Code Mode). | Only when the operator grants hosted code and confinement evidence is valid. |

## Decision and utility tools

The decision family and the harness utilities are registered by the host and
extension packages. Their descriptions and schemas are available through
\`tool_mode_describe\`. They are not model catalog entries.

## Extensions

| Extension | Package | Version | Tools | Activation |
|---|---|---|---|---|
${extensionRows.join('\n')}

## Reading a tool result

Most tools return a JSON object with the task result. A tool error is a normal
tool result with \`isError: true\` and a text explanation; it is not a crash. If a
tool is unavailable, \`tool_mode_list\` reports the reason instead of registering a
tool that would fail at call time.

For exact fields, call:

\`\`\`text
tool_mode_describe { "tools": ["lang_detect"] }
\`\`\`

To discover the live set:

\`\`\`text
tool_mode_list
\`\`\`
`
}

const pages = {
  'models.md': modelsPage(),
  'tools.md': toolsPage(),
}

const check = process.argv.includes('--check')
let stale = false
mkdirSync(outDir, { recursive: true })
for (const [name, content] of Object.entries(pages)) {
  const target = join(outDir, name)
  const current = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  if (check) {
    if (current !== content) {
      stale = true
      console.error(`stale: docs/guide/reference/${name}`)
    }
  } else {
    writeFileSync(target, content)
    console.log(`wrote docs/guide/reference/${name}`)
  }
}
if (check) {
  if (stale) {
    console.error('run: node scripts/gen-user-docs.mjs')
    process.exit(1)
  }
  console.log('user reference docs are up to date')
}
