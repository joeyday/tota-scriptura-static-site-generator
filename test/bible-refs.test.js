import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processBibleRefs } from '../lib/bible/process.js'

// ─── Helpers ───
const page = { url: '/topic/test', title: 'Test' }

// The hrefs of the links in html, with the ref.ly prefix dropped.
const hrefs = (html) => [...html.matchAll(/href="https:\/\/ref\.ly\/([^"]+)"/g)].map((m) => m[1])
// The visible text of the links (non-breaking spaces as plain spaces).
const labels = (html) => [...html.matchAll(/class="external bible-ref"[^>]*>([^<]*)<\/a>/g)]
  .map((m) => m[1].replaceAll(' ', ' '))
const run = (text) => processBibleRefs(`<p>${text}</p>`, page)

// ─── Books of one chapter ───
test('Phm 1:3 reads as Phm 3, and links to chapter 1 verse 3', () => {
  const { html, problems } = run('See Phm 1:3.')
  assert.deepEqual(problems, [])
  assert.deepEqual(hrefs(html), ['Phm1.3;ESV'])
  assert.deepEqual(labels(html), ['Phm 3'])
})

test('Phm 1 is the whole letter, shown as just Phm', () => {
  const { html, problems } = run('See Phm 1.')
  assert.deepEqual(problems, [])
  assert.deepEqual(hrefs(html), ['Phm1;ESV'])
  assert.deepEqual(labels(html), ['Phm'])
})

test('a lone Phm 3 is chapter 3 and fails the build, saying how to write a verse', () => {
  const { problems } = run('See Phm 3.')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /Philemon has one chapter/)
  assert.match(problems[0], /Philemon 1:3/)
})

test('Phm 1:3–5 reads as Phm 3–5', () => {
  const { html } = run('See Phm 1:3–5.')
  assert.deepEqual(hrefs(html), ['Phm1.3-5;ESV'])
  assert.deepEqual(labels(html), ['Phm 3–5'])
})

test('a continuation in a book of one chapter drops the chapter too', () => {
  const { html, problems } = run('Phm 1:3, 1:5')
  assert.deepEqual(problems, [])
  assert.deepEqual(hrefs(html), ['Phm1.3;ESV', 'Phm1.5;ESV'])
  assert.deepEqual(labels(html), ['Phm 3', '5'])
})

// ─── Continuations ───
test('John 3:16, 18 links 18 as a verse of the same chapter', () => {
  const { html, refs } = run('John 3:16, 18')
  assert.deepEqual(hrefs(html), ['Jn3.16;ESV', 'Jn3.18;ESV'])
  assert.deepEqual(refs.map((r) => r.displayShort), ['3:16', '3:18'])
})

test('a chapter:verse continuation changes the chapter', () => {
  const { html } = run('Jn 3:16; 5:24')
  assert.deepEqual(hrefs(html), ['Jn3.16;ESV', 'Jn5.24;ESV'])
})

test('chapter-level continuations read as chapters, not verses', () => {
  assert.deepEqual(hrefs(run('Romans 3, 5').html), ['Ro3;ESV', 'Ro5;ESV'])
  assert.deepEqual(hrefs(run('Romans 3–5, 7').html), ['Ro3-5;ESV', 'Ro7;ESV'])
})

test('continuations do not carry across a block boundary', () => {
  const { html } = processBibleRefs('<p>John 3:16</p><p>, 18</p>', page)
  assert.deepEqual(hrefs(html), ['Jn3.16;ESV'])
})

test('distant numbers are not continuations: only whitespace may sit between refs', () => {
  assert.deepEqual(hrefs(run('Jn 3:16 (see the note, 20 April 2013)').html), ['Jn3.16;ESV'])
  assert.deepEqual(hrefs(run('Jn 3:16 on 20 April 2013, 5').html), ['Jn3.16;ESV'])
})

// ─── Spacing and opt-outs ───
test('1Jn 2:2 links, but 1 Jn 2:2 does not', () => {
  assert.deepEqual(hrefs(run('1Jn 2:2').html), ['1Jn2.2;ESV'])
  assert.deepEqual(hrefs(run('1 Jn 2:2').html), [])
})

test('1 John 2:2 (full name) links', () => {
  assert.deepEqual(hrefs(run('1 John 2:2').html), ['1Jn2.2;ESV'])
})

test('a ! opts a reference out and is removed from the text', () => {
  const { html, refs } = run('!John 3:16 and Jn 3:17')
  assert.deepEqual(hrefs(html), ['Jn3.17;ESV'])
  assert.match(html, /John 3:16 and/)
  assert.equal(refs.length, 1)
})

test('an opted-out reference does not start a continuation chain', () => {
  assert.deepEqual(hrefs(run('!John 3:16, 18').html), [])
})

test('words that look like book names are not references', () => {
  assert.deepEqual(hrefs(run('I am 30 years old').html), [])
})

test('text inside <a>, <code> and headings is left alone', () => {
  const html = '<h2>John 3:16</h2><p><code>John 3:16</code> <a href="/x">John 3:16</a></p>'
  const out = processBibleRefs(html, page)
  assert.equal(out.html, html)
  assert.deepEqual(out.refs, [])
})

// ─── Translations ───
test('a trailing translation applies to the whole chain and moves inside the link', () => {
  const { html, refs } = run('Jn 3:16; 5:24 KJV')
  assert.deepEqual(hrefs(html), ['Jn3.16;KJV', 'Jn5.24;KJV'])
  assert.match(html, /5:24 KJV<\/a>/)
  assert.deepEqual(refs.map((r) => r.translation), ['KJV', 'KJV'])
})

test('a translation after other words is not about the reference', () => {
  assert.deepEqual(hrefs(run('Jn 3:16 is in the KJV').html), ['Jn3.16;ESV'])
})

test('the translation resets at the next block', () => {
  const { html } = processBibleRefs('<p>Jn 3:16 NIV</p><p>Jn 3:17</p>', page)
  assert.deepEqual(hrefs(html), ['Jn3.16;NIV', 'Jn3.17;ESV'])
})

// ─── Ranges and checking ───
test('same-chapter and cross-chapter ranges', () => {
  assert.deepEqual(hrefs(run('Rom 1:1–4').html), [])
  assert.deepEqual(hrefs(run('Ro 1:1–4').html), ['Ro1.1-4;ESV'])
  assert.deepEqual(hrefs(run('Ro 12:1–15:13').html), ['Ro12.1-15.13;ESV'])
})

test('references that cannot exist are problems and are not collected', () => {
  for (const bad of ['Romans 17', 'Romans 12:71', 'Romans 3:0', 'Romans 12:9–2', 'Romans 5–3']) {
    const { problems, refs } = run(bad)
    assert.equal(problems.length, 1, bad)
    assert.equal(refs.length, 0, bad)
  }
})

test('a bad continuation says what it was read as', () => {
  // A bare verse after a cross-chapter range is read in the range's first chapter
  // (12), not its last (15). Pinned as the code behaves today.
  const { problems } = run('Romans 12:1\u201315:13, 71')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /"71" \(read as Romans 12:71\)/)
})

test('a generated page (no page record) links but collects nothing', () => {
  const { html, refs, problems } = processBibleRefs('<p>John 3:16</p>', null)
  assert.deepEqual(hrefs(html), ['Jn3.16;ESV'])
  assert.deepEqual(refs, [])
  assert.deepEqual(problems, [])
})

// ─── Linker and collector agree ───
test('the linker and the collector agree on every reference', () => {
  const text = [
    'John 3:16, 18; 5:24 KJV', 'Romans 3, 5', 'Romans 3–5, 7', 'Phm 1:3', 'Phm 1',
    '1Jn 2:2', 'Ro 12:1–15:13', 'Gen 1:1', 'Ge 1:1–2', 'Jude 1:3', '!Mt 5:3', 'Mt 5:3'
  ].map((t) => `<p>${t}</p>`).join('')
  const { html, refs } = processBibleRefs(text, page)
  assert.equal(hrefs(html).length, refs.length)
})

test('collected refs carry their section', () => {
  const { refs } = processBibleRefs('<h2 id="intro">Intro</h2><p>Jn 3:16</p>', page)
  assert.equal(refs.length, 1)
  assert.equal(refs[0].sectionId, 'intro')
  assert.equal(refs[0].pageUrl, '/topic/test')
})
