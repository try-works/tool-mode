/** Fetch the pinned uhm assets into .assets/uhm (gitignored). */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.assets', 'uhm')
const REVISION = 'a81452eeaa82ba83bdd3682906fe01120b12351a'
const FILES = [
  { name: 'uhm.onnx', bytes: 94042570, sha256: 'fbd19765def76893841e0c70e498bf632d6c68175ceae5a2da8fe3bf7d9d0314' },
  { name: 'labels.json', bytes: 237 },
]
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
mkdirSync(OUT, { recursive: true })
let failed = false
for (const file of FILES) {
  const target = join(OUT, file.name)
  let bytes = existsSync(target) ? readFileSync(target) : undefined
  if (bytes === undefined || bytes.length !== file.bytes || (file.sha256 !== undefined && sha256(bytes) !== file.sha256)) {
    const response = await fetch('https://huggingface.co/desert-ant-labs/uhm/resolve/' + REVISION + '/' + file.name)
    if (!response.ok) { console.error('HTTP ' + response.status + ' for ' + file.name); failed = true; continue }
    bytes = Buffer.from(await response.arrayBuffer())
    writeFileSync(target, bytes)
  }
  const digest = sha256(bytes)
  const ok = bytes.length === file.bytes && (file.sha256 === undefined || digest === file.sha256)
  if (!ok) failed = true
  console.log([file.name, String(bytes.length), 'sha256=' + digest, ok ? 'verified' : 'MISMATCH'].join('  '))
}
if (failed) process.exit(1)
console.log('uhm assets ready at ' + OUT)
