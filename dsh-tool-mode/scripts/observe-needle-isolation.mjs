/** AT-62 — process/network observation for two concurrent real Needle callers. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { activateExtension } from '@try-works/tool-mode-extension-sdk'
import extension from '../packages/extension-needle/src/index.ts'

const ENGINE = process.env.NEEDLE_EXTENSION_ENGINE
  ?? 'E:/dsh-asset-cache/groups/@try-works__extension-needle/needle3/native-engine/needle.exe'
const WEIGHTS = process.env.NEEDLE_EXTENSION_WEIGHTS
  ?? 'E:/dsh-asset-cache/groups/@try-works__extension-needle/needle3/native-engine/needle3.cact'
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
  limits: { maxInputBytes: 1024 * 1024, maxAudioSeconds: 60, maxResultBytes: 1024 * 1024 },
  resolvePath: candidate => candidate,
})
const tools = [{
  name: 'lookup_weather',
  description: 'Look up the current weather for a city.',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
}]

// Watch every needle.exe process for outbound TCP state during both calls.
const monitorScript = `
$end=(Get-Date).AddSeconds(25); $hits=@()
while((Get-Date) -lt $end){
  $pids=@(Get-Process -Name needle -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  foreach($p in $pids){
    $c=Get-NetTCPConnection -OwningProcess $p -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Established' -or $_.State -eq 'SynSent' }
    foreach($x in $c){ $hits += [pscustomobject]@{ pid=$p; state=$x.State; remote="$($x.RemoteAddress):$($x.RemotePort)" } }
  }
  Start-Sleep -Milliseconds 20
}
ConvertTo-Json -Compress -InputObject @($hits)
`
const monitor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', monitorScript], { windowsHide: true })
let monitorOut = ''
monitor.stdout.on('data', chunk => { monitorOut += chunk.toString() })
const monitorDone = new Promise(resolve => monitor.on('close', resolve))

const instance = await activateExtension(extension, context)
try {
  const provider = await instance.createProvider({ modelId: 'needle3', configuration: {} })
  await provider.load({ assets, signal: new AbortController().signal })
  const [first, second] = await Promise.all([
    provider.invoke({
      implementationId: 'needle3-native-tools-plan',
      input: { request: 'Use lookup_weather to get the weather in Paris.', tools, max_new_tokens: 128 },
      context: invocation('caller-a'),
    }),
    provider.invoke({
      implementationId: 'needle3-native-tools-plan',
      input: { request: 'Use lookup_weather to get the weather in Tokyo.', tools, max_new_tokens: 128 },
      context: invocation('caller-b'),
    }),
  ])
  await monitorDone
  const connections = JSON.parse((monitorOut.trim().split(/\r?\n/).at(-1) ?? '[]')) || []
  const proposals = [first, second].map(result => result.proposals ?? [])
  if (connections.length > 0) throw new Error(`needle.exe made network connections: ${JSON.stringify(connections)}`)
  if (proposals.some(list => list.length === 0)) throw new Error(`a caller produced no proposal: ${JSON.stringify(proposals)}`)
  const requests = proposals.map(list => list[0]?.arguments?.city ?? list[0]?.arguments?.query ?? null)
  console.log(JSON.stringify({ acceptance: 'AT-62', concurrentCallers: 2, proposals, requests, networkConnections: connections, observed: 'no needle.exe established/syn-sent TCP connections during both calls' }, null, 2))
} finally {
  await instance.dispose('shutdown')
}