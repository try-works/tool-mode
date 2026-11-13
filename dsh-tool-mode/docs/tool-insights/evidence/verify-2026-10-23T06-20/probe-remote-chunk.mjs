// Reload the :3180 page over CDP and report the remote-chunk request + console warnings.
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
const consoleEvents = []
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
    return
  }
  if (message.method === 'Network.responseReceived') {
    const url = String(message.params.response.url)
    if (url.includes('model-tools') || url.includes('client.model')) {
      requests.push({ url, status: message.params.response.status, mime: message.params.response.mimeType })
    }
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' ')
    if (text.toLowerCase().includes('remote') || text.toLowerCase().includes('model-tools')) consoleEvents.push({ type: message.params.type, text: text.slice(0, 500) })
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: (message.params.exceptionDetails?.exception?.description ?? '').slice(0, 500) })
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
await send('Runtime.enable')
await send('Page.reload', { ignoreCache: true })
await new Promise(resolve => setTimeout(resolve, 6000))
console.log(JSON.stringify({ requests, consoleEvents }, null, 2))
socket.close()
