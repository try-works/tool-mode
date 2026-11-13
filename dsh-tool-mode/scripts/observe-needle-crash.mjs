/** AT-37 — native worker crash: kill needle.exe mid-call, truthful terminal state, clean retry. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { activateExtension } from '@try-works/tool-mode-extension-sdk'
import extension from '../packages/extension-needle/src/index.ts'

const ENGINE = process.env.NEEDLE_EXTENSION_ENGINE ?? 'E:/dsh-asset-cache/groups/@try-works__extension-needle/needle3/native-engine/needle.exe'
const WEIGHTS = process.env.NEEDLE_EXTENSION_WEIGHTS ?? 'E:/dsh-asset-cache/groups/@try-works__extension-needle/needle3/native-engine/needle3.cact'
if (!existsSync(ENGINE) || !existsSync(WEIGHTS)) throw new Error('the pinned Needle artifacts are missing')
const assets = {
  assetIds: ['needle-engine-win-x64', 'needle3-weights'],
  get: id => id === 'needle-engine-win-x64'
    ? { path: ENGINE, digest: 'sha256:47cd411a022d22e393d87ce091848fd446e6d25df2ce31b12a7328337557c85b' }
    : id === 'needle3-weights'
      ? { path: WEIGHTS, digest: 'sha256:c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38' }
      : undefined,
}
const context = {
  extensionId: '@try-works/extension-needle', extensionVersion: '0.1.3', activationGeneration: 1,
  storage: { directory: '', async read() { return undefined }, async write() {} },
  logger: { log() {} }, signal: new AbortController().signal, configuration: {},
}
const invocation = id => ({
  invocationId: id, signal: new AbortController().signal,
  limits: { maxInputBytes: 4 * 1024 * 1024, maxAudioSeconds: 60, maxResultBytes: 1024 * 1024 },
  resolvePath: candidate => candidate,
})
const tools = [{ name: 'lookup_weather', description: 'Look up the weather.', parameters: { type: 'object', properties: { city: { type: 'string' } } } }]
const longRequest = `Use lookup_weather for the city. ${'Context. '.repeat(600)}`
const needlePids = () => {
  const stdout = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '@(Get-Process -Name needle -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true }).stdout.trim()
  if (stdout === '' || stdout === 'null') return []
  const parsed = JSON.parse(stdout)
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(value => Number.isInteger(value) && value > 0)
}

const instance = await activateExtension(extension, context)
try {
  const provider = await instance.createProvider({ modelId: 'needle3', configuration: {} })
  await provider.load({ assets, signal: new AbortController().signal })
  const running = provider.invoke({
    implementationId: 'needle3-native-tools-plan',
    input: { request: longRequest, tools, max_new_tokens: 1024 },
    context: invocation('crash-call'),
  })
  // Give the child time to start, then kill the native engine mid-inference.
  await new Promise(resolve => setTimeout(resolve, 700))
  const before = needlePids()
  if (before.length === 0) throw new Error('the native worker did not start; crash probe inconclusive')
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-Process -Name needle -ErrorAction SilentlyContinue | Stop-Process -Force'], { encoding: 'utf8', windowsHide: true })
  let terminal
  try {
    await running
    terminal = 'resolved'
  } catch (error) {
    terminal = `rejected:${error instanceof Error ? error.message : String(error)}`
  }
  if (!terminal.startsWith('rejected:')) throw new Error(`a killed native worker resolved successfully: ${terminal}`)
  await new Promise(resolve => setTimeout(resolve, 300))
  const afterKill = needlePids()
  if (afterKill.length > 0) throw new Error(`orphan needle.exe processes remain: ${afterKill.join(',')}`)
  // Clean retry on the same provider proves no stale lock/state survived the crash.
  const retry = await provider.invoke({
    implementationId: 'needle3-native-tools-plan',
    input: { request: 'Use lookup_weather for Paris.', tools, max_new_tokens: 128 },
    context: invocation('retry-call'),
  })
  if (!Array.isArray(retry.proposals) || retry.proposals.length === 0) throw new Error(`clean retry produced no proposal: ${JSON.stringify(retry)}`)
  console.log(JSON.stringify({
    acceptance: 'AT-37', killedPids: before, terminalState: terminal, orphanPidsAfterKill: afterKill,
    retryProposal: retry.proposals[0], observed: 'a killed native worker rejects, leaves no orphan, and a fresh call succeeds',
  }, null, 2))
} finally {
  await instance.dispose('shutdown')
}