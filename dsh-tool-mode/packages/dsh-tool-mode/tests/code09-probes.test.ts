/** CODE-09 probe — environment/network/import/process confinement on Windows. */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mountPtcRuntimeIfAbsent, PTC_SERVICE } from '../src/ptc-runtime.ts'

async function loadDsh(): Promise<Record<string, any> | { unavailable: string }> {
  try {
    const [{ Context }, nodeMod, sessionProjection, fsLocal, subprocessLocal, sandboxLocal, sandboxPolicy] =
      await Promise.all([
        import('@deepseek-ai/cordis'),
        import('@deepseek-ai/dsh-ptc-runtime-node'),
        import('@deepseek-ai/dsh-session-projection'),
        import('@deepseek-ai/dsh-fs-local'),
        import('@deepseek-ai/dsh-subprocess-local'),
        import('@deepseek-ai/dsh-sandbox-local'),
        import('@deepseek-ai/dsh-sandbox-policy'),
      ])
    return {
      Context,
      backend: (nodeMod as any).NodePtcRuntime ?? (nodeMod as any).default,
      plugins: [
        (sessionProjection as any).default ?? sessionProjection,
        (fsLocal as any).default ?? fsLocal,
        (subprocessLocal as any).default ?? subprocessLocal,
        (sandboxLocal as any).default ?? sandboxLocal,
      ],
      sandboxPolicy: (sandboxPolicy as any).default ?? sandboxPolicy,
    }
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : String(error) }
  }
}

const loaded = await loadDsh()
const dirs: string[] = []
process.on('exit', () => {
  for (const dir of dirs) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } }
})
const skip = 'unavailable' in loaded
  ? String(loaded.unavailable)
  : process.env.TMP === undefined || !process.env.TMP.toLowerCase().startsWith('d:')
    ? 'requires TMP/TEMP on a D: workspace so Windows ACL confinement can start (run with TMP/TEMP=D:\\DEV\\dsh-temp)'
    : undefined

describe('CODE-09 — process/import/network/environment confinement', { skip }, () => {
  it('denies a hosted program process execution, network, unlisted imports and host secrets', async () => {
    const dsh = loaded as Record<string, any>
    const dir = mkdtempSync(join(tmpdir(), 'tmx-confinement-'))
    dirs.push(dir)
    const ctx = new dsh.Context()
    for (const plugin of dsh.plugins) await ctx.plugin(plugin)
    await ctx.plugin(dsh.sandboxPolicy, { mode: 'workspace-write', workspaceRoot: dir })
    await mountPtcRuntimeIfAbsent(ctx, dsh.backend, { timeoutMs: 30_000, maxTimeoutMs: 60_000 })
    const runtime = ctx.get(PTC_SERVICE)
    assert.ok(runtime !== undefined)

    process.env.DSH_SECRET_PROBE = 'must-not-leak'
    try {
      const result = await runtime.run(runtime.resolve({
        program: String.raw`
          const out = {};
          try {
            const cp = await import('node:child_process');
            const r = cp.spawnSync(process.execPath, ['-e', 'console.log(1)']);
            out.process = { ok: r.status === 0, code: r.error?.code ?? null };
          } catch (error) { out.process = { ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }; }
          try {
            const r = await fetch('http://127.0.0.1:1');
            out.network = { ok: true, status: r.status };
          } catch (error) { out.network = { ok: false, code: error?.cause?.code ?? error?.code ?? null }; }
          try {
            await import('not-a-real-unlisted-package');
            out.import = { ok: true, code: null };
          } catch (error) { out.import = { ok: false, code: error?.code ?? null }; }
          out.env = { exposed: typeof process !== 'undefined' && process.env?.DSH_SECRET_PROBE !== undefined,
            value: typeof process !== 'undefined' ? process.env?.DSH_SECRET_PROBE ?? null : null };
          out.globals = { fetch: typeof fetch, process: typeof process };
          return out;
        `,
        bindings: [],
        cwd: dir,
        timeoutMs: 30_000,
      }))
      assert.equal(result.error, undefined, `the confinement probe did not run: ${JSON.stringify(result.error)}`)
      const value = (result.value ?? {}) as Record<string, any>
      assert.equal(value.process?.ok, false, `process execution leaked: ${JSON.stringify(value)}`)
      assert.equal(value.network?.ok, false, `network leaked: ${JSON.stringify(value)}`)
      assert.equal(value.import?.ok, false, `unlisted import leaked: ${JSON.stringify(value)}`)
      assert.equal(value.env?.exposed, false, `host environment leaked: ${JSON.stringify(value)}`)
    } finally {
      delete process.env.DSH_SECRET_PROBE
    }
  })
})