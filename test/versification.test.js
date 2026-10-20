import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BIBLE_BOOKS, bookInfoByCwms, cwmsByName, oneChapterCwms } from '../lib/bible/refs.js'
import {
  OT_BOOK_COUNT,
  TOTAL_CHAPTERS,
  TOTAL_VERSES,
  VERSES_PER_CHAPTER
} from '../lib/bible/versification.js'

const sum = (a) => a.reduce((x, y) => x + y, 0)

test('the verse table totals 31,102 verses in 1,189 chapters and 66 books', () => {
  assert.equal(VERSES_PER_CHAPTER.length, 66)
  assert.equal(TOTAL_CHAPTERS, 1189)
  assert.equal(TOTAL_VERSES, 31102)
})

test('the Old Testament is 39 books with 23,145 verses; the New is 7,957', () => {
  assert.equal(OT_BOOK_COUNT, 39)
  assert.equal(sum(VERSES_PER_CHAPTER.slice(0, OT_BOOK_COUNT).map(sum)), 23145)
  assert.equal(sum(VERSES_PER_CHAPTER.slice(OT_BOOK_COUNT).map(sum)), 7957)
})

// The ESV's verse counts for a few books, counted independently of the table.
test('known chapter and verse counts', () => {
  const book = (name) => VERSES_PER_CHAPTER[bookInfoByCwms.get(cwmsByName.get(name)).bookIndex]
  assert.equal(book('genesis').length, 50)
  assert.equal(sum(book('genesis')), 1533)
  assert.equal(book('psalms').length, 150)
  assert.equal(book('psalms')[118], 176) // Psalm 119
  assert.equal(sum(book('psalms')), 2461)
  assert.equal(sum(book('matthew')), 1071)
  assert.equal(sum(book('john')), 879)
  assert.equal(sum(book('romans')), 433)
  assert.equal(sum(book('titus')), 46)
  assert.equal(sum(book('revelation')), 404)
})

test('every book has a CWMS code and every name resolves to its book', () => {
  assert.equal(BIBLE_BOOKS.length, 66)
  BIBLE_BOOKS.forEach((names, i) => {
    const cwms = names.at(-1) // the last entry is the CWMS abbreviation
    for (const name of names) {
      const key = name.toLowerCase()
      assert.equal(bookInfoByCwms.get(cwmsByName.get(key)).bookIndex, i, name)
    }
    assert.equal(bookInfoByCwms.get(cwms).bookIndex, i)
  })
})

test('the books of one chapter are Obadiah, Philemon, 2 and 3 John, and Jude', () => {
  const names = [...oneChapterCwms].map((c) => bookInfoByCwms.get(c).bookName).sort()
  assert.deepEqual(names, ['2 John', '3 John', 'Jude', 'Obadiah', 'Philemon'])
})
