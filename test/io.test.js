import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWriter, mapLimit } from '../lib/io.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('mapLimit keeps input order and passes the index', async () => {
  const out = await mapLimit([30, 1, 10], async (ms, i) => { await sleep(ms); return `${i}:${ms}` })
  assert.deepEqual(out, ['0:30', '1:1', '2:10'])
})

test('mapLimit runs at most `limit` at once', async () => {
  let running = 0
  let peak = 0
  await mapLimit(Array.from({ length: 12 }, (_, i) => i), async () => {
    peak = Math.max(peak, ++running)
    await sleep(5)
    running--
  }, 3)
  assert.equal(peak, 3)
})

test('mapLimit of nothing is an empty list, and an error rejects', async () => {
  assert.deepEqual(await mapLimit([], async () => 1), [])
  await assert.rejects(mapLimit([1], async () => { throw new Error('boom') }), /boom/)
})

async function withDir (fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tsgen-io-'))
  try { await fn(dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}

test('the writer makes directories and writes after flush', () => withDir(async (dir) => {
  const writer = createWriter()
  await writer.write(path.join(dir, 'a/b/c.txt'), 'hello')
  await writer.write(path.join(dir, 'a/b/d.txt'), 'there')
  await writer.flush()
  assert.equal(await fs.readFile(path.join(dir, 'a/b/c.txt'), 'utf-8'), 'hello')
  assert.equal(await fs.readFile(path.join(dir, 'a/b/d.txt'), 'utf-8'), 'there')
}))

test('writes to one path land in the order queued: the last wins', () => withDir(async (dir) => {
  const writer = createWriter()
  const file = path.join(dir, 'x.txt')
  for (let i = 0; i < 20; i++) await writer.write(file, `v${i}`)
  await writer.flush()
  assert.equal(await fs.readFile(file, 'utf-8'), 'v19')
}))

test('with a small limit, write() waits for a free slot and every file still lands', () => withDir(async (dir) => {
  const writer = createWriter(2)
  for (let i = 0; i < 25; i++) await writer.write(path.join(dir, `f${i}.txt`), String(i))
  await writer.flush()
  assert.equal((await fs.readdir(dir)).length, 25)
}))

test('a failed write is thrown by flush', () => withDir(async (dir) => {
  const writer = createWriter()
  await fs.writeFile(path.join(dir, 'file'), '')
  await writer.write(path.join(dir, 'file/inside.txt'), 'x') // "file" is not a directory
  await writer.write(path.join(dir, 'other/inside.txt'), 'y')
  await assert.rejects(writer.flush(), { code: /^(EEXIST|ENOTDIR)$/ })
}))
