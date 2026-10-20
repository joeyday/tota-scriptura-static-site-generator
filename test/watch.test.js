import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWatcher } from '../lib/watch.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('a burst of notifications is one call, once things have been quiet', async () => {
  const calls = []
  const watcher = createWatcher({ onChange: (files) => calls.push(files), quietMs: 40 })
  watcher.notify(['a.md'])
  await sleep(20)
  watcher.notify(['b.md', 'a.md']) // restarts the wait; a duplicate counts once
  await sleep(20)
  assert.deepEqual(calls, [])
  await sleep(60)
  assert.deepEqual(calls, [['a.md', 'b.md']])
  watcher.notify(['c.md'])
  await sleep(80)
  assert.deepEqual(calls, [['a.md', 'b.md'], ['c.md']])
  watcher.stop()
})

test('stop() cancels a pending call', async () => {
  const calls = []
  const watcher = createWatcher({ onChange: (files) => calls.push(files), quietMs: 30 })
  watcher.notify(['a.md'])
  watcher.stop()
  await sleep(80)
  assert.deepEqual(calls, [])
})

test('watch() reports changed files that count, with slash-separated paths, and ignores the rest', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tsgen-watch-'))
  const calls = []
  const watcher = createWatcher({ onChange: (files) => calls.push(files), quietMs: 150 })
  try {
    await fs.mkdir(path.join(dir, 'topic'))
    watcher.watch(dir, (rel) => rel.endsWith('.md'))
    await sleep(100)
    await fs.writeFile(path.join(dir, 'topic', 'a.md'), 'x')
    await fs.writeFile(path.join(dir, 'ignored.txt'), 'x')
    for (let waited = 0; calls.length === 0 && waited < 3000; waited += 50) await sleep(50)
    assert.ok(calls.length >= 1, 'expected a call')
    const files = new Set(calls.flat())
    assert.ok(files.has('topic/a.md'), [...files].join())
    assert.ok(![...files].some((f) => f.endsWith('.txt')), [...files].join())
  } finally {
    watcher.stop()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('watch() with recursive: false reports the directory\'s own files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tsgen-watch-'))
  const calls = []
  const watcher = createWatcher({ onChange: (files) => calls.push(files), quietMs: 100 })
  try {
    watcher.watch(dir, () => true, { recursive: false })
    await sleep(100)
    await fs.writeFile(path.join(dir, 'top.md'), 'x')
    // What the platform names the file varies (macOS may report a parent), so look for any call.
    for (let waited = 0; calls.length === 0 && waited < 3000; waited += 50) await sleep(50)
    assert.ok(calls.length >= 1, 'expected a call')
  } finally {
    watcher.stop()
    await fs.rm(dir, { recursive: true, force: true })
  }
})
