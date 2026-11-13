// Query the Tool Insights usage report over the full history and explicit windows.
import { writeFileSync } from 'node:fs'

const launch = new URL(process.env.LAUNCH)
const outDir = process.env.EVD
const mint = await fetch(launch.href, { redirect: 'manual' })
const cookie = (mint.headers.getSetCookie?.() ?? []).map(r => r.split(';')[0]).filter(p => p.startsWith('dsh-auth')).join('; ')

async function call(method, args = {}) {
  const response = await fetch(launch.origin + '/api/modelTools/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: method + '-' + Date.now(), method: 'modelTools/' + method, payload: { args } }),
  })
  const text = await response.text()
  let envelope
  try { envelope = JSON.parse(text) } catch { envelope = { raw: text.slice(0, 800) } }
  return { method, status: response.status, ok: envelope?.result?.ok ?? false, value: envelope?.result?.value ?? null, error: envelope?.result?.error ?? null }
}

const probes = {}
for (const [label, query] of [
  ['all', { range: 'all' }],
  ['30d', { range: '30d' }],
  ['explicit-2026-08', { from: Date.parse('2026-08-01T00:00:00Z'), to: Date.parse('2026-09-01T00:00:00Z') }],
]) {
  probes[label] = await call('toolUsageReport', { query })
}
writeFileSync(outDir + '/usage-report-ranges.json', JSON.stringify({ capturedAt: new Date().toISOString(), probes }, null, 2) + '\n')
for (const [label, probe] of Object.entries(probes)) {
  const value = probe.value ?? {}
  console.log(label, JSON.stringify({ ok: probe.ok, error: probe.error, range: value.range, calls: value.calls, sessions: value.sessions, uniqueTools: value.uniqueTools, tools: (value.tools ?? []).map(t => t.name ?? t.tool).slice(0, 8), recent: (value.recentCalls ?? []).length }))
}
