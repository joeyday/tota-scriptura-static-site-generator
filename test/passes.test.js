import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addTableOfContents,
  applyAltText,
  makeAbbreviationWrapper,
  makeUnknownAbbreviationFinder,
  smallAsides,
  stripOptOuts,
  wrapInitials
} from '../lib/html/passes.js'

// ─── Abbreviations ───
test('abbreviations are wrapped with their expansion, outside code and web addresses', () => {
  const wrap = makeAbbreviationWrapper({ NT: 'New Testament', 'e.g.': 'for example' })
  assert.equal(wrap('<p>The NT, e.g. Acts</p>'),
    '<p>The <abbr title="New Testament">NT</abbr>, <abbr title="for example">e.g.</abbr> Acts</p>')
  assert.equal(wrap('<p><code>NT</code> https://x.org/NT/y NTS</p>'),
    '<p><code>NT</code> https://x.org/NT/y NTS</p>')
})

test('the longest abbreviation wins, and the match is case-sensitive and whole-word', () => {
  const wrap = makeAbbreviationWrapper({ JS: 'Joseph Smith', 'JS–H': 'Joseph Smith—History' })
  assert.equal(wrap('<p>JS–H</p>'), '<p><abbr title="Joseph Smith—History">JS–H</abbr></p>')
  assert.equal(wrap('<p>js JSX</p>'), '<p>js JSX</p>')
})

test('abbreviation titles are escaped', () => {
  const wrap = makeAbbreviationWrapper({ Q: 'a "quote" & more' })
  assert.equal(wrap('<p>Q</p>'), '<p><abbr title="a &quot;quote&quot; &amp; more">Q</abbr></p>')
})

test('an abbreviation is not wrapped twice', () => {
  const wrap = makeAbbreviationWrapper({ NT: 'New Testament' })
  const once = wrap('<p>NT</p>')
  assert.equal(wrap(once), once)
})

// ─── Unknown abbreviations ───
test('the finder lists all-caps words nothing explains', () => {
  const find = makeUnknownAbbreviationFinder({ NT: 'New Testament' })
  assert.deepEqual(find('<p>NT NASA UBS5 the LORD XIV I AM A.5 OK</p>'), ['NASA', 'UBS5', 'OK'])
})

test('the finder skips code, addresses and ! opt-outs, and a key like JS–H covers JS', () => {
  const find = makeUnknownAbbreviationFinder({ 'JS–H': 'Joseph Smith—History' })
  assert.deepEqual(find('<p><code>NASA</code> https://x.org/NASA !NASA JS–H</p>'), [])
})

test('the finder works with no abbreviations at all', () => {
  assert.deepEqual(makeUnknownAbbreviationFinder({})('<p>NASA</p>'), ['NASA'])
})

test('stripOptOuts drops the ! and nothing else', () => {
  assert.equal(stripOptOuts('<p>!NASA Wow!NASA and !</p>'), '<p>NASA Wow!NASA and !</p>')
})

// ─── Initials ───
const initials = { 'R.C. Sproul': 'Robert Charles Sproul', 'D.A. Carson': 'Donald Arthur Carson' }

test('initials are wrapped whether the surname follows or precedes', () => {
  const problems = []
  assert.equal(wrapInitials('<p>R.C. Sproul</p>', initials, problems),
    '<p><abbr title="Robert Charles Sproul">R.C.</abbr> Sproul</p>')
  assert.equal(wrapInitials('<p>Carson, D.A. wrote</p>', initials, problems),
    '<p>Carson, <abbr title="Donald Arthur Carson">D.A.</abbr> wrote</p>')
  assert.deepEqual(problems, [])
})

test('initials with no entry, or no surname, are problems and stay plain', () => {
  const problems = []
  assert.equal(wrapInitials('<p>J.R. Smith</p>', initials, problems), '<p>J.R. Smith</p>')
  assert.equal(wrapInitials('<p>and U.S.A.</p>', initials, problems), '<p>and U.S.A.</p>')
  assert.equal(problems.length, 2)
  assert.match(problems[0], /"J\.R\. Smith"/)
  assert.match(problems[1], /no surname beside them/)
})

test('single-letter abbreviations such as Dr. are not initials', () => {
  const problems = []
  assert.equal(wrapInitials('<p>Dr. Smith</p>', initials, problems), '<p>Dr. Smith</p>')
  assert.deepEqual(problems, [])
})

// ─── Alt text ───
test('alt text is added, replaced and escaped, by filename only', () => {
  const problems = []
  const alt = { 'a.png': 'A "map"', 'b.png': 'B' }
  assert.equal(applyAltText('<img src="/asset/a.png">', alt, problems),
    '<img src="/asset/a.png" alt="A &quot;map&quot;">')
  assert.equal(applyAltText('<img src="/asset/b.png?v=2" alt="old" />', alt, problems),
    '<img src="/asset/b.png?v=2" alt="B" />')
  assert.deepEqual(problems, [])
})

test('an image with no entry, or no src, is a problem', () => {
  const problems = []
  const html = '<img src="/asset/missing.png"><img alt="x">'
  assert.equal(applyAltText(html, {}, problems), html)
  assert.equal(problems.length, 2)
  assert.match(problems[0], /missing\.png has no entry in alt-text\.json/)
  assert.match(problems[1], /no src/)
})

test('alt text does not match inherited object keys', () => {
  const problems = []
  applyAltText('<img src="constructor">', {}, problems)
  assert.equal(problems.length, 1)
})

// ─── Table of contents ───
const article = (h2s) => `<article>${h2s.map((h, i) => `<h2 id="s${i}">${h}</h2><p>x</p>`).join('')}</article>`

test('a page with three or more h2s gets a table of contents before the first', () => {
  const out = addTableOfContents(`<article><p>Intro</p>${article(['A', 'B', 'C']).slice(9)}`, 'Contents')
  assert.match(out, /<p>Intro<\/p><nav class="toc"/)
  assert.match(out, /<p class="toc-title">Contents<\/p>/)
  assert.match(out, /<li><a class="internal" href="#s1">B<\/a><\/li>/)
  assert.ok(out.indexOf('<nav') < out.indexOf('<h2 id="s0"'))
})

test('fewer than three h2s, or none with ids, get none', () => {
  assert.equal(addTableOfContents(article(['A', 'B']), 'Contents'), article(['A', 'B']))
  const noIds = '<article><h2>A</h2><h2>B</h2><h2>C</h2></article>'
  assert.equal(addTableOfContents(noIds, 'Contents'), noIds)
  assert.equal(addTableOfContents('<p>no article</p>', 'Contents'), '<p>no article</p>')
})

test('h3s and headings outside the article are left out', () => {
  const html = '<h2 id="x">Out</h2><article><h2 id="a">A</h2><h3 id="h">H</h3><h2 id="b">B</h2><h2 id="c">C</h2></article>'
  const out = addTableOfContents(html, 'Outline')
  assert.equal([...out.matchAll(/<li>/g)].length, 3)
  assert.doesNotMatch(out, /href="#h"/)
  assert.doesNotMatch(out, /href="#x"/)
})

// ─── Small asides ───
test('smallAsides leaves a page with no terms or definitions alone', () => {
  assert.equal(smallAsides('<p>(an aside)</p>'), '<p>(an aside)</p>')
})

test('a parenthetical in a term or definition becomes small', () => {
  assert.equal(smallAsides('<dl><dt>Son (of God)</dt><dd>Jesus (see John 1)</dd></dl>'),
    '<dl><dt>Son <small>(of God)</small></dt><dd>Jesus <small>(see John 1)</small></dd></dl>')
})

test('parentheses that are part of a word, or the whole term, are left alone', () => {
  assert.equal(smallAsides('<dt>Son(s)</dt>'), '<dt>Son(s)</dt>')
  assert.equal(smallAsides('<dd>(only an aside)</dd>'), '<dd>(only an aside)</dd>')
})

test('in a definition an em dash starts italic, small text to the end', () => {
  assert.equal(smallAsides('<dd>Word — and more</dd>'),
    '<dd>Word <em><small>— and more</small></em></dd>')
  // Only a definition, never a term; and a dash with nothing after it is skipped.
  assert.equal(smallAsides('<dt>Word — and more</dt>'), '<dt>Word — and more</dt>')
  assert.equal(smallAsides('<dd>Word —</dd>'), '<dd>Word —</dd>')
})

test('only the outermost pair of nested parentheses is wrapped', () => {
  assert.equal(smallAsides('<dd>A (b (c) d) e</dd>'), '<dd>A <small>(b (c) d)</small> e</dd>')
})

test('asides inside code and web addresses are ignored', () => {
  const html = '<dd><code>(x)</code> https://x.org/(y)</dd>'
  assert.equal(smallAsides(html), html)
})

test('smallAsides is idempotent', () => {
  const once = smallAsides('<dd>Jesus (see John 1) — and more</dd>')
  assert.equal(smallAsides(once), once)
})
