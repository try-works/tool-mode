// Reload the :3180 page over CDP and capture the tool-insights WebSocket calls.
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
const frames = []
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
    return
  }
  if (message.method === 'Network.webSocketFrameSent' || message.method === 'Network.webSocketFrameReceived') {
    const data = String(message.params.response?.payloadData ?? '')
    if (/toolUsageReport|toolInventory|mcpStatus|mcpCalls/.test(data)) {
      frames.push({ direction: message.method.endsWith('Sent') ? 'sent' : 'received', opcode: message.params.response?.opcode, data: data.slice(0, 1500) })
    }
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
await send('Page.reload', { ignoreCache: true })
await new Promise(resolve => setTimeout(resolve, 8000))
console.log(JSON.stringify({ frames }, null, 2))
socket.close()
