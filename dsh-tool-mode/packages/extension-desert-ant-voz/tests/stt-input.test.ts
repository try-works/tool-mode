/** TOOL-01 — STT input is inspected by container facts, not the extension. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { inspectAdmittedWav } from '../src/index.ts'

function wav(options: {
  readonly sampleRate?: number
  readonly channels?: number
  readonly bits?: number
  readonly seconds?: number
} = {}): Buffer {
  const sampleRate = options.sampleRate ?? 16_000
  const channels = options.channels ?? 1
  const bits = options.bits ?? 16
  const seconds = options.seconds ?? 0.25
  const dataBytes = Math.round(sampleRate * channels * (bits / 8) * seconds)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(bits === 16 ? 1 : 3, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * (bits / 8), 28)
  header.writeUInt16LE(channels * (bits / 8), 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return Buffer.concat([header, Buffer.alloc(dataBytes)])
}

function inTemp(name: string, bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'voz-stt-input-'))
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

test('admits PCM16 16 kHz mono and ignores the file extension', () => {
  const path = inTemp('recording.bin', wav())
  try {
    const inspected = inspectAdmittedWav(path)
    assert.equal(inspected.dataBytes, 8000)
    assert.equal(inspected.durationSeconds, 0.25)
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true })
  }
})

test('refuses 44.1 kHz stereo content even when it is named .wav', () => {
  const path = inTemp('recording.wav', wav({ sampleRate: 44_100, channels: 2 }))
  try {
    assert.throws(() => inspectAdmittedWav(path), /only PCM16 16 kHz mono is admitted/)
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true })
  }
})

test('refuses a non-WAV file rather than trusting the extension', () => {
  const path = inTemp('recording.wav', Buffer.from('this is not a wav file at all'))
  try {
    assert.throws(() => inspectAdmittedWav(path), /not a WAV container/)
  } finally {
    rmSync(join(path, '..'), { recursive: true, force: true })
  }
})
