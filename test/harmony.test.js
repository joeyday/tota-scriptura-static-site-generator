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

test('a row has no verse twice, and no member is another member', () => {
  const seen = new Set()
  for (const { members } of harmonyRows()) {
    const row = members.map((ids) => ids.join())
    assert.equal(new Set(row).size, members.length, `${members.map((ids) => ids[0])} has a member twice`)
    for (const ids of members) assert.equal(new Set(ids).size, ids.length, `${ids[0]} has a verse twice`)
    const key = row.join('=')
    assert.ok(!seen.has(key), `${key} is in the table twice`)
    seen.add(key)
  }
})

test('the main member is the first canonically, and Psalms is main against the books that reproduce it', () => {
  for (const { members, main } of harmonyRows()) {
    const books = members.map((ids) => bookOf(ids[0]))
    if (books.some((book) => book !== bookInfoByCwms.get('Ps').bookIndex) && books.includes(bookInfoByCwms.get('Ps').bookIndex)) {
      assert.equal(books[main], bookInfoByCwms.get('Ps').bookIndex)
    } else {
      assert.equal(members[main][0], Math.min(...members.map((ids) => ids[0])))
    }
  }
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
  for (const row of harmonyRows()) row.members.forEach((ids, member) => ids.forEach((id) => (member === row.main ? mains : parallels).add(id)))
  assert.deepEqual([...parallels].filter((id) => mains.has(id)), [])
})
