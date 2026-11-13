/** TDD-07 — tests do not read ambient production credentials or inherit grants. */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { callTool, isolatedStateFile, mountPlugin } from './helpers.ts'

test('a production-looking env token and sentinel DSH_HOME are not consulted by a non-MCP mount', async () => {
  const previousHome = process.env.DSH_HOME
  const previousToken = process.env.DSH_TOOL_MODE_MCP_TOKEN
  const home = mkdtempSync(join(tmpdir(), 'tdd07-sentinel-home-'))
  process.env.DSH_HOME = home
  process.env.DSH_TOOL_MODE_MCP_TOKEN = 'production-secret-that-must-not-be-read'
  try {
    const ctx = await mountPlugin({
      stateFile: isolatedStateFile(),
      managementGrant: false,
      models: ['title'],
    })
    const diagnostics = await callTool(ctx, 'model_tools', { action: 'diagnostics' })
    assert.equal(diagnostics.isError, false, JSON.stringify(diagnostics))
    const text = JSON.stringify(diagnostics.value)
    assert.doesNotMatch(text, /production-secret-that-must-not-be-read/)
    // No endpoint/credential was configured from the environment.
    assert.match(text, /"endpoint":null/)
    assert.match(text, /"requiresCredential":null/)
    // The management surface is not granted, so an enable attempt must refuse.
    const enable = await callTool(ctx, 'model_tools', { action: 'enable', model: 'title' })
    assert.equal(enable.isError, true)
    // Nothing was written into the sentinel production home.
    assert.equal(existsSync(home) ? readdirSync(home).length : 0, 0)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousToken === undefined) delete process.env.DSH_TOOL_MODE_MCP_TOKEN
    else process.env.DSH_TOOL_MODE_MCP_TOKEN = previousToken
    rmSync(home, { recursive: true, force: true })
  }
})
