// Capture screenshots + DOM evidence from the shared Chrome page that shows the
// disposable :3180 instance, over the DevTools protocol (no extra dependency).
// Usage: node capture-3180.mjs <label>
import { mkdirSync, writeFileSync } from 'node:fs'

const label = process.argv[2] ?? 'capture'
const outDir = process.env.EVD
mkdirSync(outDir + '/screens', { recursive: true })
mkdirSync(outDir + '/dom', { recursive: true })

const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? '9222'}/json/list`)).json()
const target = targets.find(entry => String(entry.url).startsWith('http://127.0.0.1:3180'))
if (target === undefined) throw new Error('no :3180 page target found on the shared browser')
console.log('target:', target.url, target.id)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let nextId = 1
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
  }
})
function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return result.result?.value
}

await send('Page.enable')
await send('Runtime.enable')

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
writeFileSync(`${outDir}/screens/${label}.png`, Buffer.from(shot.data, 'base64'))
console.log('screenshot bytes:', Buffer.from(shot.data, 'base64').length)

const facts = await evaluate(`(() => {
  const text = document.body.innerText || '';
  return {
    url: location.href,
    panelButtons: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(Boolean),
    hasToolInsightsText: text.includes('Tool Insights'),
    hasModelAsToolText: text.includes('Model as Tool'),
    bootModelToolsEntry: (window.__DSH_BOOT__?.entries ?? []).find(e => (e.id || '').includes('dsh-tool-mode')) ?? null,
    sidebarText: (document.querySelector('nav[aria-label]')?.innerText ?? '').slice(0, 500)
  };
})()`)
writeFileSync(`${outDir}/dom/${label}-facts.json`, JSON.stringify(facts, null, 2) + '\n')
const bodyText = await evaluate('document.body.innerText')
writeFileSync(`${outDir}/dom/${label}-body.txt`, String(bodyText ?? ''))
console.log(JSON.stringify({ url: facts.url, hasToolInsightsText: facts.hasToolInsightsText, hasModelAsToolText: facts.hasModelAsToolText, panelButtons: facts.panelButtons.slice(0, 12), bootEntryUrl: facts.bootModelToolsEntry?.url }, null, 2))
socket.close()
