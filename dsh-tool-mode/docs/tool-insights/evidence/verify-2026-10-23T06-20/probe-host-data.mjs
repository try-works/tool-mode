// Collect the Tool Insights host data through the same cookie-authenticated data path the
// page uses (the disposable host's /api/modelTools/* gateway).
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

const results = {}
results.describe = await call('describe')
results.toolInventory = await call('toolInventory')
results.mcpStatus = await call('mcpStatus')
results.mcpCalls = await call('mcpCalls')
results.toolUsageReport = await call('toolUsageReport')

const inventoryValue = results.toolInventory.value ?? {}
const inventoryRows = Array.isArray(inventoryValue.tools) ? inventoryValue.tools : Array.isArray(inventoryValue.rows) ? inventoryValue.rows : []
const mcpStatus = results.mcpStatus.value ?? {}
const calls = results.mcpCalls.value ?? {}
const report = results.toolUsageReport.value ?? {}
const summary = {
  inventory: {
    ok: results.toolInventory.ok,
    count: inventoryRows.length,
    names: inventoryRows.map(row => row.name).filter(Boolean),
    modelToolsRow: inventoryRows.find(row => row.name === 'model_tools') ?? null,
    origins: [...new Set(inventoryRows.map(row => row.owner ?? row.origin).filter(Boolean))],
  },
  mcpStatus: {
    ok: results.mcpStatus.ok,
    value: mcpStatus,
  },
  mcpCalls: {
    ok: results.mcpCalls.ok,
    total: calls.total ?? calls.calls?.length ?? null,
    clients: calls.clients ?? null,
    firstCall: Array.isArray(calls.calls) ? calls.calls[0] ?? null : null,
    rawKeys: calls !== null && typeof calls === 'object' ? Object.keys(calls) : [],
  },
  usageReport: {
    ok: results.toolUsageReport.ok,
    totals: report.totals ?? null,
    tools: Array.isArray(report.tools) ? report.tools.slice(0, 10) : null,
    recent: Array.isArray(report.recent) ? report.recent.slice(0, 5) : null,
    keys: report !== null && typeof report === 'object' ? Object.keys(report) : [],
  },
}
writeFileSync(outDir + '/host-data.json', JSON.stringify({ capturedAt: new Date().toISOString(), results, summary }, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2).slice(0, 7000))
