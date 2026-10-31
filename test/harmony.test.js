import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookOf, harmonize, harmonyRows, hasHarmony, verseId } from '../lib/bible/harmony.js'
import { bookInfoByCwms } from '../lib/bible/refs.js'

const id = (cwms, chapter, verse) => verseId(bookInfoByCwms.get(cwms).bookIndex, chapter, verse)

test('the table is read, and every verse of it exists', () => {
  assert.ok(harmonyRows().length > 500)
  assert.ok(hasHarmony(id('2Sa', 7, 22)))
  assert.ok(!hasHarmony(id('Jn', 3, 16)))
})

test('a row has no verse twice, and is not in the table twice', () => {
  const seen = new Set()
  for (const { main, parallel } of harmonyRows()) {
    for (const ids of [main, parallel]) assert.equal(new Set(ids).size, ids.length, `${ids[0]} has a verse twice`)
    assert.ok(!main.some((verse) => parallel.includes(verse)), `${main[0]} is its own parallel`)
    const key = `${main}=${parallel}`
    assert.ok(!seen.has(key), `${key} is in the table twice`)
    seen.add(key)
  }
})

test('the main passage is the first book canonically, and Psalms is main against the books that reproduce it', () => {
  const psalms = bookInfoByCwms.get('Ps').bookIndex
  for (const { main, parallel } of harmonyRows()) {
    const books = [bookOf(main[0]), bookOf(parallel[0])]
    if (books.includes(psalms) && books[0] !== books[1]) assert.equal(books[0], psalms)
    else assert.ok(books[0] <= books[1], `${main[0]} is not before ${parallel[0]}`)
  }
})

test('a row that matches each verse is the same length on both sides', () => {
  for (const { main, parallel, each } of harmonyRows()) if (each) assert.equal(main.length, parallel.length, `${main[0]}`)
})

test('a parallel is matched with the verse beside it when the members are the same length', () => {
  const [main, parallels] = [...harmonize(new Map([[id('1Ch', 17, 20), false]]))][0]
  assert.equal(main, id('2Sa', 7, 22))
  assert.deepEqual([...parallels.parallels], [id('1Ch', 17, 20)])
})

test('a parallel is matched with the whole passage when the members are different lengths', () => {
  const [, { parallels }] = [...harmonize(new Map([[id('Mt', 3, 3), false]]))][0]
  assert.deepEqual([...parallels], [id('Mk', 1, 2), id('Mk', 1, 3), id('Lk', 3, 4), id('Lk', 3, 5), id('Lk', 3, 6), id('Jn', 1, 23)])
})

test('a verse in no row stays as it is, and a main verse is not its own parallel', () => {
  assert.deepEqual([...harmonize(new Map([[id('Jn', 3, 16), false]]))], [[id('Jn', 3, 16), { parallels: new Set(), whole: false }]])
  const mains = harmonize(new Map([[id('2Sa', 7, 22), false], [id('1Ch', 17, 20), false]]))
  assert.equal(mains.size, 1)
})

test('a main verse is whole only if every verse that led to it was', () => {
  assert.equal(harmonize(new Map([[id('2Sa', 7, 22), true]])).get(id('2Sa', 7, 22)).whole, true)
  assert.equal(harmonize(new Map([[id('2Sa', 7, 22), true], [id('1Ch', 17, 20), false]])).get(id('2Sa', 7, 22)).whole, false)
})

test('no verse is a parallel in one row and a main verse in another', () => {
  const mains = new Set()
  const parallels = new Set()
  for (const row of harmonyRows()) {
    row.main.forEach((id) => mains.add(id))
    row.parallel.forEach((id) => parallels.add(id))
  }
  assert.deepEqual([...parallels].filter((id) => mains.has(id)), [])
})

test('a range that crosses a chapter runs on into the next', () => {
  assert.deepEqual([...harmonize(new Map([[id('1Ch', 16, 1), false]]))].map(([main]) => main), [id('2Sa', 6, 17)])
  assert.ok(harmonize(new Map([[id('2Ki', 24, 18), false]])).get(id('2Ki', 24, 18)).parallels.has(id('Jer', 52, 1)))
  assert.deepEqual([...harmonize(new Map([[id('2Ch', 24, 1), false]]))].map(([main]) => main), [id('2Ki', 11, 21), id('2Ki', 12, 1)])
})
