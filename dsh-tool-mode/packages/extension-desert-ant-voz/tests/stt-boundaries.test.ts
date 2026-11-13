/** AT-21 — silence, WAV chunk boundaries and the audio caps. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { closeSync, ftruncateSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectAdmittedWav } from '../src/index.ts'

const dirs: string[] = []
after(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voz-boundary-'))
  dirs.push(dir)
  return dir
}

function header(dataBytes: number): Buffer {
  const bytes = Buffer.alloc(44)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(36 + dataBytes, 4)
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16_000, 24)
  bytes.writeUInt32LE(32_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(dataBytes, 40)
  return bytes
}

describe('AT-21 — silence and WAV chunk boundaries', () => {
  it('admits a silent PCM16 16 kHz mono WAV', () => {
    const dir = tempDir()
    const path = join(dir, 'silence.wav')
    writeFileSync(path, Buffer.concat([header(16_000), Buffer.alloc(16_000)]))
    const inspected = inspectAdmittedWav(path)
    assert.equal(inspected.durationSeconds, 0.5)
  })

  it('finds the data chunk after an unknown LIST chunk at a non-44-byte boundary', () => {
    const dir = tempDir()
    const path = join(dir, 'list.wav')
    const listPayload = Buffer.from('INFOISFT', 'ascii')
    const list = Buffer.alloc(8 + listPayload.length)
    list.write('LIST', 0, 'ascii')
    list.writeUInt32LE(listPayload.length, 4)
    listPayload.copy(list, 8)
    const data = Buffer.alloc(8_000)
    const base = header(0)
    base.writeUInt32LE(4 + (8 + 8 + list.length) + (8 + data.length) - 4, 4)
    writeFileSync(path, Buffer.concat([base.subarray(0, 36), list, Buffer.from('data'), Buffer.from([0x40, 0x1f, 0, 0]), data]))
    const inspected = inspectAdmittedWav(path)
    assert.equal(inspected.dataBytes, 8_000)
  })
})

describe('AT-21 — audio caps', () => {
  it('refuses a data chunk larger than the file', () => {
    const dir = tempDir()
    const path = join(dir, 'lying.wav')
    writeFileSync(path, header(512 * 1024 * 1024 + 2))
    assert.throws(() => inspectAdmittedWav(path), /data chunk|exceeds/)
  })

  it('refuses a sparse WAV longer than the 3600-second cap', () => {
    const dir = tempDir()
    const path = join(dir, 'long.wav')
    const dataBytes = 16_000 * 2 * 3_601
    const fd = openSync(path, 'w')
    try {
      writeFileSync(fd, header(dataBytes))
      ftruncateSync(fd, 44 + dataBytes)
    } finally {
      closeSync(fd)
    }
    assert.throws(() => inspectAdmittedWav(path), /3600-second contract limit/)
  })
})