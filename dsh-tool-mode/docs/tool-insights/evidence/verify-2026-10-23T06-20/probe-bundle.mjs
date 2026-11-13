// Save the served client bundle and report whether the Tool Insights registration is in it.
import { writeFileSync } from 'node:fs'

const launch = new URL(process.env.LAUNCH)
const outDir = process.env.EVD
const mint = await fetch(launch.href, { redirect: 'manual' })
const cookie = (mint.headers.getSetCookie?.() ?? []).map(r => r.split(';')[0]).filter(p => p.startsWith('dsh-auth')).join('; ')
const shell = await fetch(launch.origin + '/', { headers: { cookie } })
const html = await shell.text()
const bootMatch = /globalThis\["__DSH_BOOT__"\]\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/.exec(html)
const boot = JSON.parse(bootMatch[1])
const entry = boot.entries.find(e => (e.id ?? '').includes('dsh-tool-mode'))
console.log('boot entry:', JSON.stringify(entry))
const bundle = await fetch(new URL(entry.url, launch.origin), { headers: { cookie } })
const text = await bundle.text()
writeFileSync(outDir + '/served-client-bundle.js', text)
const patterns = ['sidebar.panellist', 'order: 15', "id: 'tool-insights'", 'Tool Insights', 'Model as Tool', '__ModuleLoader__']
for (const pattern of patterns) console.log(pattern, '->', text.includes(pattern))
const i = text.indexOf('sidebar.panellist')
if (i !== -1) console.log('registration context:', text.slice(i - 500, i + 400))
