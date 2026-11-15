/**
 * The PTC sandbox temp root (task-58): Code Mode's Windows ACL failure.
 *
 * Evidence: `tool_mode_run` failed with "windows-acl-run: AclSandbox init failed" because
 * DSH's sandbox-local materializes its private temp with `os.tmpdir()`, which reads
 * TEMP/TMP. Setting DACLs on a fresh directory under E:\tmp fails with Win32 5, while a
 * directory in the user profile succeeds. The plugin therefore points TEMP/TMP at
 * ~/.dsh/tool-mode-sandbox/tmp (or `sandboxTempRoot`) for the life of the host.
 *
 * @module tests/sandbox-temp
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'

import * as plugin from '../src/index.ts'
import {
  installSandboxTempRoot,
  resolveSandboxTempRoot,
} from '../src/sandbox-temp.ts'
import { cleanup } from './helpers.ts'

const dirs: string[] = []
after(async () => {
  await cleanup()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixtureDir(): string {
  const created = mkdtempSync(join(tmpdir(), 'sandbox-temp-'))
  dirs.push(created)
  return created
}

/** The win32 home default the plugin names in its documentation. */
function windowsDefault(home = homedir()): string {
  return join(home, '.dsh', 'tool-mode-sandbox', 'tmp')
}

describe('resolveSandboxTempRoot — the resolution table', () => {
  it('uses the DSH-home default on win32 when unset', () => {
    const resolved = resolveSandboxTempRoot({ platform: 'win32', home: 'C:\\Users\\probe' })
    assert.equal(resolved.root, join('C:\\Users\\probe', '.dsh', 'tool-mode-sandbox', 'tmp'))
    assert.equal(resolved.source, 'windows-default')
  })

  it('leaves the platform temp alone on non-win32 when unset', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const resolved = resolveSandboxTempRoot({ platform, home: '/home/probe' })
      assert.equal(resolved.root, '')
      assert.equal(resolved.source, 'disabled')
    }
  })

  it('uses an explicit non-empty path, resolved to an absolute path', () => {
    const resolved = resolveSandboxTempRoot({ configured: 'relative/tool-mode-tmp', platform: 'win32', home: 'C:\\Users\\probe' })
    assert.equal(resolved.root, resolve('relative/tool-mode-tmp'))
    assert.equal(resolved.source, 'configured')
  })

  it('treats an explicit empty (or whitespace) value as DISABLED, not the default', () => {
    for (const configured of ['', '   ']) {
      const resolved = resolveSandboxTempRoot({ configured, platform: 'win32', home: 'C:\\Users\\probe' })
      assert.equal(resolved.root, '', 'explicit disable must win over the win32 default')
      assert.equal(resolved.source, 'disabled')
    }
  })
})

describe('installSandboxTempRoot — set TEMP/TMP and restore them exactly', () => {
  it('creates the directory, points TEMP/TMP at it and restores the previous values', () => {
    const dir = fixtureDir()
    const env: NodeJS.ProcessEnv = { TEMP: 'E:\\tmp', TMP: 'E:\\tmp' }
    const install = installSandboxTempRoot(dir, { env })
    assert.equal(install.changed, true)
    assert.equal(existsSync(dir), true)
    assert.equal(env['TEMP'], dir)
    assert.equal(env['TMP'], dir)
    install.restore()
    assert.equal(env['TEMP'], 'E:\\tmp')
    assert.equal(env['TMP'], 'E:\\tmp')
    // Idempotent: a second restore is a no-op, not a second swap.
    install.restore()
    assert.equal(env['TEMP'], 'E:\\tmp')
  })

  it('deletes TEMP/TMP again when they were previously absent', () => {
    const dir = fixtureDir()
    const env: NodeJS.ProcessEnv = {}
    const install = installSandboxTempRoot(dir, { env })
    assert.equal(env['TEMP'], dir)
    install.restore()
    assert.equal('TEMP' in env, false)
    assert.equal('TMP' in env, false)
  })

  it('does nothing when TEMP/TMP already point at the root', () => {
    const dir = fixtureDir()
    const env: NodeJS.ProcessEnv = { TEMP: dir, TMP: dir }
    const install = installSandboxTempRoot(dir, { env })
    assert.equal(install.changed, false)
    install.restore()
    assert.equal(env['TEMP'], dir)
  })
})

describe('the mounted plugin owns TEMP/TMP for its lifetime', () => {
  it('points TEMP/TMP at the configured root while mounted and RESTORES them on disposal', async () => {
    const dir = fixtureDir()
    const previousTemp = process.env['TEMP']
    const previousTmp = process.env['TMP']
    const stateDir = fixtureDir()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    try {
      await ctx.plugin(plugin, {
        stateFile: join(stateDir, 'state.json'),
        credentialsFile: join(stateDir, 'credentials.json'),
        sandboxTempRoot: dir,
        allowAgentAuthoring: false,
      })
      assert.equal(process.env['TEMP'], resolve(dir))
      assert.equal(process.env['TMP'], resolve(dir))
      assert.equal(existsSync(resolve(dir)), true)
    } finally {
      await ctx.fiber.dispose()
    }
    assert.equal(process.env['TEMP'], previousTemp)
    assert.equal(process.env['TMP'], previousTmp)
  })

  it('applies the win32 DSH-home default when the config leaves the root unset', async () => {
    if (process.platform !== 'win32') return
    const previousTemp = process.env['TEMP']
    const previousTmp = process.env['TMP']
    const stateDir = fixtureDir()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    try {
      await ctx.plugin(plugin, {
        stateFile: join(stateDir, 'state.json'),
        credentialsFile: join(stateDir, 'credentials.json'),
        allowAgentAuthoring: false,
      })
      assert.equal(process.env['TEMP'], windowsDefault())
      assert.equal(process.env['TMP'], windowsDefault())
    } finally {
      await ctx.fiber.dispose()
    }
    assert.equal(process.env['TEMP'], previousTemp)
    assert.equal(process.env['TMP'], previousTmp)
  })
})
