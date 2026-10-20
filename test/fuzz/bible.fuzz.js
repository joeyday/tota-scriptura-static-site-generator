// A fuzz harness for the Bible-reference code. It is not part of `npm test`; run it with
// `npm run fuzz` when lib/bible/ changes. FUZZ_ITERATIONS (default 3000) sets the size and
// FUZZ_SEED reruns a failure: the seed is printed, and so is the text that broke.
//
// It writes references it knows the answer to, from the verse table, in all the forms the
// scanner reads, and checks what the linker, the collector and the checker make of them.
import assert from 'node:assert/strict'
import { processBibleRefs } from '../../lib/bible/process.js'
import { BIBLE_BOOKS } from '../../lib/bible/refs.js'
import { VERSES_PER_CHAPTER } from '../../lib/bible/versification.js'

const iterations = Number(process.env.FUZZ_ITERATIONS ?? 3000)
const seed = Number(process.env.FUZZ_SEED ?? Date.now() % 2 ** 32)
console.log(`bible fuzz: ${iterations} iterations, seed ${seed}`)

// mulberry32: a small seeded generator, so a failure can be rerun.
let state = seed
function random () {
  state = (state + 0x6D2B79F5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1)) // inclusive
const pick = (list) => list[int(0, list.length - 1)]

const page = { url: '/topic/fuzz', title: 'Fuzz' }
const hrefs = (html) => [...html.matchAll(/href="https:\/\/ref\.ly\/([^"]+)"/g)].map((m) => m[1])
const FILLER = ['see', 'and', 'also', 'compare', 'as in', 'the', 'but', 'which is', 'cf.']
const DASHES = ['-', '\u2013', '\u2014']

// How a book is written: its full name, or an abbreviation (a numbered one has no space).
const nameOf = (names) => pick(names)
const MULTI = BIBLE_BOOKS.map((names, book) => ({ names, book })).filter(({ book }) => VERSES_PER_CHAPTER[book].length > 1)

// A reference the scanner reads, with the href and Scripture-index key it must produce.
function makeNamed () {
  const { names, book } = pick(MULTI)
  const chapters = VERSES_PER_CHAPTER[book]
  const cwms = names.at(-1)
  const c = int(1, chapters.length)
  const dash = pick(DASHES)
  const kind = pick(['chapter', 'chapters', 'verse', 'verses', 'across'])
  const name = nameOf(names)
  if (kind === 'chapters' && c < chapters.length) {
    const c2 = int(c + 1, chapters.length)
    return { text: `${name} ${c}${dash}${c2}`, href: `${cwms}${c}-${c2}`, chapter: c, chapterLevel: true, cwms, short: `${c}\u2013${c2}` }
  }
  if (kind === 'chapter' || kind === 'chapters') {
    return { text: `${name} ${c}`, href: `${cwms}${c}`, chapter: c, chapterLevel: true, cwms, short: `${c}` }
  }
  const v = int(1, chapters[c - 1])
  if (kind === 'verses' && v < chapters[c - 1]) {
    const v2 = int(v + 1, chapters[c - 1])
    return { text: `${name} ${c}:${v}${dash}${v2}`, href: `${cwms}${c}.${v}-${v2}`, chapter: c, cwms, short: `${c}:${v}\u2013${v2}` }
  }
  if (kind === 'across' && c < chapters.length) {
    const c2 = int(c + 1, chapters.length)
    const v2 = int(1, chapters[c2 - 1])
    return { text: `${name} ${c}:${v}${dash}${c2}:${v2}`, href: `${cwms}${c}.${v}-${c2}.${v2}`, chapter: c, cwms, short: `${c}:${v}\u2013${c2}:${v2}`, across: true }
  }
  return { text: `${name} ${c}:${v}`, href: `${cwms}${c}.${v}`, chapter: c, cwms, short: `${c}:${v}`, verse: v }
}

// ─── Property 1: valid references link and collect exactly what was written ───
function validParagraph () {
  const parts = []
  const skeleton = [] // the same text with a NUL where each reference is written
  const expected = []
  const count = int(1, 3)
  for (let i = 0; i < count; i++) {
    const ref = makeNamed()
    const filler = pick(FILLER)
    parts.push(`${filler} ${ref.text}`)
    skeleton.push(`${filler} \u0000`)
    expected.push(ref)
    // A chain of continuations: "; c:v" after anything, ", v" (a verse of the chapter in force)
    // after a verse reference, and ", c" (a chapter) after a chapter reference.
    const chapters = VERSES_PER_CHAPTER[BIBLE_BOOKS.findIndex((names) => names.at(-1) === ref.cwms)]
    let chapter = ref.chapter // a run across chapters leaves the chapter it started in
    let chapterLevel = !!ref.chapterLevel
    for (let j = int(0, 3); j > 0; j--) {
      // Not a bare verse after a run across chapters: which chapter it belongs to is undecided
      // (it is read in the run's first; see docs/plan.md).
      const form = pick(ref.across && !chapterLevel && chapter === ref.chapter ? ['full'] : ['full', 'bare', 'bare'])
      let write
      let made
      if (form === 'bare' && chapterLevel) {
        const c = int(1, chapters.length)
        write = `, ${c}`
        made = { href: `${ref.cwms}${c}`, short: `${c}` }
      } else if (form === 'bare') {
        const v = int(1, chapters[chapter - 1])
        write = `, ${v}`
        made = { href: `${ref.cwms}${chapter}.${v}`, short: `${chapter}:${v}` }
      } else {
        const c = int(1, chapters.length)
        const v = int(1, chapters[c - 1])
        write = `; ${c}:${v}`
        made = { href: `${ref.cwms}${c}.${v}`, short: `${c}:${v}` }
        chapter = c
        chapterLevel = false
      }
      parts[parts.length - 1] += write
      skeleton[skeleton.length - 1] += write.slice(0, 2) + '\u0000' // the separator stays outside the link
      expected.push({ ...made, cwms: ref.cwms })
    }
  }
  return {
    html: `<p>${parts.join(', and ')}.</p>`,
    skeleton: `<p>${skeleton.join(', and ')}.</p>`,
    expected
  }
}

for (let i = 0; i < iterations; i++) {
  const { html, skeleton, expected } = validParagraph()
  const where = `seed ${seed}, iteration ${i}: ${html}`
  const out = processBibleRefs(html, page)
  assert.deepEqual(out.problems, [], where)
  assert.deepEqual(hrefs(out.html).map((h) => h.replace(/;ESV$/, '')), expected.map((e) => e.href), where)
  // The linker and the collector agree on every reference.
  assert.equal(out.refs.length, expected.length, where)
  assert.deepEqual(out.refs.map((r) => r.displayShort), expected.map((e) => e.short), where)
  assert.deepEqual(out.refs.map((r) => r.bookCwms), expected.map((e) => e.cwms), where)
  // Linking is idempotent: the links are skipped on a second pass, and nothing is collected twice.
  const again = processBibleRefs(out.html, page)
  assert.equal(again.html, out.html, where)
  assert.equal(again.refs.length, 0, where)
  // The text outside the references is untouched.
  assert.equal(out.html.replace(/<a [^>]*>[^<]*<\/a>/g, '\u0000'), skeleton, where)
}

// ─── Property 2: a reference past the end of its book is one problem and is not collected ───
for (let i = 0; i < iterations; i++) {
  const { names, book } = pick(MULTI)
  const chapters = VERSES_PER_CHAPTER[book]
  const name = nameOf(names)
  const c = int(1, chapters.length)
  const bad = pick([
    `${name} ${chapters.length + int(1, 20)}`, // a chapter the book doesn't have
    `${name} ${c}:${chapters[c - 1] + int(1, 20)}`, // a verse the chapter doesn't have
    `${name} ${c}:0`, // verses start at 1
    `${name} ${c}:${chapters[c - 1]}-${chapters[c - 1] + int(1, 9)}` // a range that runs past the end
  ])
  const html = `<p>${bad}</p>`
  const out = processBibleRefs(html, page)
  const where = `seed ${seed}, iteration ${i}: ${html}`
  assert.equal(out.problems.length, 1, where)
  assert.equal(out.refs.length, 0, where)
}

// ─── Property 3: paragraphs are independent ───
for (let i = 0; i < iterations / 3; i++) {
  const a = validParagraph().html
  const b = validParagraph().html
  const together = processBibleRefs(a + b, page)
  const apart = [processBibleRefs(a, page), processBibleRefs(b, page)]
  const where = `seed ${seed}, iteration ${i}: ${a}${b}`
  assert.equal(together.html, apart[0].html + apart[1].html, where)
  assert.deepEqual(together.refs, [...apart[0].refs, ...apart[1].refs], where)
}

// ─── Property 4: nothing throws, whatever the text ───
const ALPHABET = ['John', 'Jn', 'Romans', '1Jn', '1 Jn', 'Phm', '!', ' ', ' ', ':', ';', ',', '-', '\u2013', '0', '3', '16', '999', '<b>', '</b>', '<p>', '</p>', '<a href="x">', '</a>', '<code>', '</code>', 'KJV', 'ESV', '&amp;', '<!-- x -->', '\n', '2013', 'Am', 'Song of Solomon']
for (let i = 0; i < iterations; i++) {
  const text = Array.from({ length: int(1, 24) }, () => pick(ALPHABET)).join('')
  const where = `seed ${seed}, iteration ${i}: ${JSON.stringify(text)}`
  let out
  try {
    out = processBibleRefs(text, i % 2 ? page : null, i % 3 === 0)
  } catch (err) {
    assert.fail(`${where}\n${err.stack}`)
  }
  assert.equal(typeof out.html, 'string', where)
  // The links the first pass wrote are not touched by a second pass. (The second
  // pass may link more: a "1" that was text before a "Jn 2013" is link text after it, so
  // "1 Jn" stops looking like a numbered book. The build runs the pass once.)
  const links = out.html.match(/<a [^>]*class="external bible-ref"[^>]*>[^<]*<\/a>/g) ?? []
  const again = processBibleRefs(out.html, null, i % 3 === 0).html
  for (const link of links) assert.ok(again.includes(link), `a link changed: ${link}\n${where}`)
}

console.log('bible fuzz: ok')
