import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processBibleRefs } from '../lib/bible/process.js'
import { TOTAL_VERSES } from '../lib/bible/versification.js'
import { computeStatistics, countWords, measureHtml } from '../lib/stats.js'

// ─── Helpers ───
// The collected references of some text on a page, exactly as the build makes them.
const refsOf = (url, text) => processBibleRefs(`<p>${text}</p>`, { url, title: url }).refs

const record = (url, extra = {}) => ({
  title: url,
  url,
  ns: 'topic',
  isNote: false,
  listed: true,
  words: 400,
  bytes: 1000,
  headings: 0,
  terms: 0,
  tables: 0,
  blockquotes: 0,
  figures: 0,
  footnotes: 0,
  callouts: 0,
  ...extra
})

// computeStatistics with everything empty except what a test supplies.
const stats = (overrides = {}) => computeStatistics({
  pages: [],
  bodies: [],
  filesToProcess: [],
  refs: [],
  otherRefs: [],
  backlinksMap: {},
  membersMap: {},
  alphabeticalByNs: {},
  notesByPage: {},
  imageMap: {},
  version: '0.0.0',
  commit: 'abc1234',
  ...overrides
})

const scripture = (...texts) => stats({
  pages: texts.map((_, i) => record(`/topic/p${i}`)),
  refs: texts.flatMap((t, i) => refsOf(`/topic/p${i}`, t))
}).scripture

// ─── Counted while a page renders ───
test('measureHtml counts headings, terms, tables, quotes, figures, footnotes and callouts', () => {
  const html = '<h2>a</h2><h3 id="x">b</h3><h4>no</h4><dt>t</dt><dt>u</dt><table><tr></tr></table>' +
    '<blockquote>q</blockquote><figure></figure><li class="footnote-item"></li><div class="callout"></div>'
  assert.deepEqual(measureHtml(html), {
    headings: 2, terms: 2, tables: 1, blockquotes: 1, figures: 1, footnotes: 1, callouts: 1
  })
})

test('countWords counts single-spaced words', () => {
  assert.equal(countWords(''), 0)
  assert.equal(countWords('one'), 1)
  assert.equal(countWords('one two  three'), 4) // text is single-spaced by contract; a double space is counted
  assert.equal(countWords('a b c d e'), 5)
})

// ─── Scripture coverage ───
test('coverage numbers on a small hand-made set of references', () => {
  const s = scripture('John 3:16, 18; Romans 3; Romans 5:1–3', 'John 3:16; Genesis 1:1–2:3')

  assert.equal(s.total, 6)
  assert.equal(s.unique, 5) // John 3:16 is on both pages
  assert.deepEqual(s.translations, [['ESV', 6]])

  const book = (name) => s.books.find((b) => b.name === name)
  assert.deepEqual(
    ['refs', 'chaptersCited', 'versesCited'].map((k) => book('John')[k]), [3, 1, 2])
  assert.deepEqual(
    ['refs', 'chaptersCited', 'versesCited'].map((k) => book('Romans')[k]), [2, 2, 3])
  // 34 verses is more than a passage can be and still cite its verses: the chapters count, the verses don't.
  assert.deepEqual(
    ['refs', 'chaptersCited', 'versesCited'].map((k) => book('Genesis')[k]), [1, 2, 0])

  assert.equal(s.all.booksCited, 3)
  assert.equal(s.all.versesCited, 5)
  assert.equal(s.all.chaptersCited, 5)
  assert.equal(s.ot.booksCited, 1)
  assert.equal(s.nt.booksCited, 2)
  assert.equal(s.neverCitedBooks.length, 63)
  assert.equal(s.all.verses, TOTAL_VERSES)

  assert.equal(s.versesCitedMoreThanOnce, 1)
  assert.deepEqual(s.topVerses[0], {
    label: 'John 3:16', count: 2, href: '/index/scripture/john#3.16'
  })
  assert.equal(s.longestVerseRange.label, 'Genesis 1:1–2:3')
  assert.equal(s.longestVerseRange.span, 34)
  assert.equal(s.longestChapterRange.label, 'Romans 3')
})

test('a passage of 15 verses cites them; one of 16 cites only its chapter', () => {
  const fifteen = scripture('Romans 1:1–15').books.find((b) => b.name === 'Romans')
  assert.equal(fifteen.versesCited, 15)
  const sixteen = scripture('Romans 1:1–16').books.find((b) => b.name === 'Romans')
  assert.equal(sixteen.versesCited, 0)
  assert.equal(sixteen.chaptersCited, 1)
})

test('"Romans 5" cites the chapter, not its verses; "Romans 5:1" cites both', () => {
  const chapter = scripture('Romans 5').books.find((b) => b.name === 'Romans')
  assert.deepEqual([chapter.chaptersCited, chapter.versesCited], [1, 0])
  const verse = scripture('Romans 5:1').books.find((b) => b.name === 'Romans')
  assert.deepEqual([verse.chaptersCited, verse.versesCited], [1, 1])
})

test('a run of chapters touches each chapter', () => {
  const romans = scripture('Romans 3–5').books.find((b) => b.name === 'Romans')
  assert.equal(romans.chaptersCited, 3)
  assert.deepEqual(romans.chapterCounts.slice(0, 6), [0, 0, 1, 1, 1, 0])
})

test('the longest stretch of verses nobody cites', () => {
  const s = scripture('Genesis 1:1, 3')
  assert.equal(s.longestGap.verses, TOTAL_VERSES - 3)
  assert.equal(s.longestGap.from, 'Genesis 1:4')
  assert.equal(s.longestGap.to, 'Revelation 22:21')
})

test('a chapter links to the nearest chapter at or before it that a citation starts in', () => {
  const romans = scripture('Romans 1–4').books.find((b) => b.name === 'Romans')
  assert.equal(romans.chapterHrefs[0], '/index/scripture/romans#ch-1')
  assert.equal(romans.chapterHrefs[3], '/index/scripture/romans#ch-1') // chapter 4 has no entry of its own
  assert.equal(romans.chapterHrefs[4], '/index/scripture/romans#ch-1') // and nothing starts after
})

test('references on meta and category pages are in the total but not the cited figures', () => {
  const refs = [
    ...refsOf('/topic/a', 'John 3:16'),
    ...refsOf('/meta', 'Romans 1:1'),
    ...refsOf('/category/c', 'Genesis 1:1')
  ]
  const s = stats({
    pages: [record('/topic/a'), record('/meta', { ns: 'meta' }), record('/category/c', { ns: 'category' })],
    refs
  }).scripture
  assert.equal(s.total, 1)
  assert.equal(s.all.booksCited, 1)
  assert.equal(s.everything, 3)
  assert.deepEqual(s.byNamespace, {
    topic: { refs: 1, inNotes: 0 },
    meta: { refs: 1, inNotes: 0 },
    category: { refs: 1, inNotes: 0 }
  })
})

test('references on notes pages count apart, with their page\'s namespace', () => {
  const s = stats({
    pages: [record('/topic/a'), record('/topic/a/notes', { isNote: true })],
    refs: refsOf('/topic/a', 'John 3:16'),
    otherRefs: [...refsOf('/topic/a/notes', 'John 3:17, 18')]
  }).scripture
  assert.deepEqual(s.byNamespace, { topic: { refs: 1, inNotes: 2 } })
  assert.equal(s.everything, 3)
  assert.equal(s.total, 1)
})

test('translations are counted per reference', () => {
  const s = scripture('Jn 3:16; 5:24 KJV', 'Jn 1:1')
  assert.deepEqual(s.translations, [['KJV', 2], ['ESV', 1]])
})

test('the densest pages need 300 words; the broadest cite the most books', () => {
  const s = stats({
    pages: [record('/topic/short', { words: 100 }), record('/topic/long', { words: 1000 })],
    refs: [...refsOf('/topic/short', 'John 3:16, 18, 20'), ...refsOf('/topic/long', 'John 3:16; Romans 3')]
  }).scripture
  assert.deepEqual(s.densest.map((p) => p.url), ['/topic/long'])
  assert.equal(s.densest[0].per1000, 2)
  assert.equal(s.broadestPages[0].url, '/topic/long')
  assert.equal(s.topPages[0].url, '/topic/short')
})

// ─── The rest of the page's numbers ───
test('words: totals, median, buckets, and stop words stay out of the ranking', () => {
  const pages = [
    record('/topic/a', { words: 50 }),
    record('/topic/b', { words: 400 }),
    record('/topic/c', { words: 2500 }),
    record('/topic/c/notes', { words: 700, isNote: true }),
    record('/topic/hidden', { words: 9999, listed: false })
  ]
  const s = stats({
    pages,
    bodies: [{ url: '/topic/a', body: 'Grace grace the mercy John 3 ESV Joey? Yes! λόγος' }]
  }).words
  assert.equal(s.total, 50 + 400 + 2500 + 700) // unlisted pages are left out of every figure
  assert.equal(s.median, 550)
  assert.equal(s.notesTotal, 700)
  assert.deepEqual(s.buckets.map((b) => [b.label, b.content, b.notes]), [
    ['Under 100', 1, 0], ['100–499', 1, 0], ['500–999', 0, 1], ['1,000–1,999', 0, 0], ['2,000 or more', 1, 0]
  ])
  assert.deepEqual(s.topWords[0], ['grace', 2])
  const ranked = s.topWords.map(([w]) => w)
  for (const stop of ['the', 'john', 'esv', 'joey']) assert.ok(!ranked.includes(stop), stop)
  assert.ok(ranked.includes('mercy'))
  assert.deepEqual(
    [s.fun.questions, s.fun.exclamations, s.fun.greek, s.fun.hebrew], [1, 1, 1, 0])
})

test('words: the divine names are counted', () => {
  const s = stats({ bodies: [{ url: '/x', body: 'the LORD God and GOD, YHWH, I AM; LORD' }] }).words
  assert.deepEqual(s.divine, { LORD: 2, GOD: 1, YHWH: 1, 'I AM': 1 })
})

test('links: pairs, orphans, and links to hidden pages', () => {
  const files = [
    { finalUrlPath: '/topic/a', title: 'A', hidden: false },
    { finalUrlPath: '/topic/b', title: 'B', hidden: false },
    { finalUrlPath: '/topic/c', title: 'C', hidden: false },
    { finalUrlPath: '/topic/draft', title: 'Draft', hidden: true }
  ].map((f) => ({ nsDir: 'topic', categories: [], ...f }))
  const s = stats({
    pages: [record('/topic/a'), record('/topic/b'), record('/topic/c')],
    filesToProcess: files,
    backlinksMap: {
      '/topic/b': [{ url: '/topic/a' }, { url: '/topic/c' }],
      '/topic/a': [{ url: '/topic/b' }],
      '/topic/draft': [{ url: '/topic/a' }]
    }
  }).links
  assert.equal(s.pairs, 3)
  assert.equal(s.broken, 1)
  assert.deepEqual(s.brokenTargets, [{ url: '/topic/draft', title: 'Draft', count: 1 }])
  assert.deepEqual(s.orphans.map((p) => p.url), ['/topic/c'])
  assert.equal(s.mostLinkedTo[0].url, '/topic/b')
  assert.equal(s.mostLinkedTo[0].count, 2)
  assert.equal(s.linkNowhere, 0)
  assert.equal(s.averageInbound, 1)
})

test('site: hidden and unlisted pages are not counted', () => {
  const f = (url, extra = {}) => ({ finalUrlPath: url, nsDir: 'topic', hidden: false, unlisted: false, isNote: false, categories: [], ...extra })
  const s = stats({
    filesToProcess: [
      f('/topic/a'), f('/topic/b', { draft: true }), f('/topic/c', { hidden: true }),
      f('/topic/d', { unlisted: true }), f('/topic/a/notes', { isNote: true })
    ]
  }).site
  assert.equal(s.published, 2)
  assert.equal(s.notes, 1)
  assert.equal(s.drafts, 1)
  assert.equal(s.namespaces.topic.pages, 2)
})

test('an empty site computes without dividing by zero', () => {
  const s = stats()
  assert.equal(s.words.median, 0)
  assert.equal(s.links.averageInbound, 0)
  assert.equal(s.titles.averageLength, 0)
  assert.equal(s.weight.averageBytes, 0)
  assert.equal(s.scripture.total, 0)
  assert.deepEqual(s.scripture.longestGap.verses, TOTAL_VERSES)
})
