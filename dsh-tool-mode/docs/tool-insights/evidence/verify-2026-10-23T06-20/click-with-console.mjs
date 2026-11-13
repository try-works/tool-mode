// Click the Tool Insights sidebar row over CDP and report console errors/exceptions.
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
const events = []
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
    return
  }
  if (message.method === 'Runtime.consoleAPICalled' || message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') {
    events.push(message)
  }
})
function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
await send('Runtime.enable')
await send('Log.enable')
const click = await send('Runtime.evaluate', {
  expression: `(() => { const b = [...document.querySelectorAll('button[aria-label="Tool Insights"]')][0]; if (!b) return 'missing'; b.click(); return 'clicked'; })()`,
  returnByValue: true,
})
await new Promise(resolve => setTimeout(resolve, 1200))
const state = await send('Runtime.evaluate', {
  expression: `(() => { const b = [...document.querySelectorAll('button[aria-label="Tool Insights"]')][0]; const text = document.body.innerText || ''; return { click: 'done', current: b?.getAttribute('aria-current') ?? null, hasTabs: ['Tool Inventory','MCP'].every(t => text.includes(t)), snippet: text.slice(0, 500) }; })()`,
  returnByValue: true,
})
const summarized = events.map(event => {
  if (event.method === 'Runtime.exceptionThrown') return { kind: 'exception', text: event.params.exceptionDetails?.exception?.description ?? event.params.exceptionDetails?.text }
  if (event.method === 'Runtime.consoleAPICalled') return { kind: 'console-' + event.params.type, text: (event.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400) }
  return { kind: 'log-' + event.params.entry?.level, text: (event.params.entry?.text ?? '').slice(0, 400) }
})
console.log(JSON.stringify({ click: click.result?.value, state: state.result?.value, events: summarized }, null, 2))
socket.close()
