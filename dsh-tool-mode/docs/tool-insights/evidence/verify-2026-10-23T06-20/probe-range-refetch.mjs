// Click the 24h range over CDP and report every network request/frame caused by it.
const port = process.env.CDP_PORT ?? '9222'
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find(entry => String(entry.url).startsWith('http://127.0.0.1:3180'))
if (target === undefined) throw new Error('no :3180 target')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let nextId = 1
const pending = new Map()
const requests = []
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
    return
  }
  if (message.method === 'Network.requestWillBeSent') {
    requests.push({ url: String(message.params.request.url), method: message.params.request.method })
  }
})
function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
await send('Network.enable')
await send('Runtime.evaluate', { expression: `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '24h'); if (!b) return 'missing'; b.click(); return 'clicked'; })()`, returnByValue: true })
await new Promise(resolve => setTimeout(resolve, 3000))
const interesting = requests.filter(r => /modelTools|api|mcp|toolUsage/i.test(r.url))
const kpi = await send('Runtime.evaluate', { expression: `(() => { const t = document.body.innerText || ''; const i = t.indexOf('CALLS\\n'); return i < 0 ? null : t.slice(i + 7, i + 30).split('\\n').slice(0, 2).join(' | '); })()`, returnByValue: true })
console.log(JSON.stringify({ totalRequests: requests.length, interesting, kpi: kpi.result?.value }, null, 2))
socket.close()
