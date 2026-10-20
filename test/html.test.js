import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escHtml, unescHtml } from '../lib/html/escape.js'
import { mapText, walkHtml } from '../lib/html/walk.js'
import {
  addHeadingIds,
  fixSpacedEllipses,
  headingSlug,
  wrapDivineNames,
  wrapRomanNumerals
} from '../lib/html/passes.js'
import { compareTitles, sortableTitle } from '../lib/titles.js'
import { parseFrontmatter } from '../lib/frontmatter.js'

// ─── The tag walker ───
test('walkHtml splits text from tags and marks skipped regions', () => {
  const seen = []
  walkHtml('a<b>b<code>c</code>d<!-- e -->f', new Set(['code']), {
    onText: (t, skipped) => seen.push(['text', t, skipped]),
    onTag: (name, full) => seen.push(['tag', name, full])
  })
  assert.deepEqual(seen, [
    ['text', 'a', false], ['tag', 'b', '<b>'],
    ['text', 'b', false], ['tag', 'code', '<code>'],
    ['text', 'c', true], ['tag', 'code', '</code>'],
    ['text', 'd', false], ['tag', null, '<!-- e -->'],
    ['text', 'f', false]
  ])
})

test('mapText transforms only the text outside skip tags', () => {
  assert.equal(
    mapText('x<code>x</code>x<b>x</b>', new Set(['code']), (t) => t.toUpperCase()),
    'X<code>x</code>X<b>X</b>'
  )
})

test('a self-closing skip tag does not open a region', () => {
  assert.equal(mapText('<code/>x', new Set(['code']), (t) => t.toUpperCase()), '<code/>X')
})

// ─── Escaping ───
test('escHtml and unescHtml', () => {
  assert.equal(escHtml('a & b < c > "d"'), 'a &amp; b &lt; c &gt; &quot;d&quot;')
  assert.equal(unescHtml('a &amp; b &lt; c &gt; &quot;d&quot; &#39;e&#39;'), 'a & b < c > "d" \'e\'')
  // &amp; goes last, so a doubly escaped entity decodes once.
  assert.equal(unescHtml('&amp;lt;'), '&lt;')
})

// ─── Titles ───
test('sortableTitle drops a leading article', () => {
  assert.equal(sortableTitle('The law of Christ'), 'law of Christ')
  assert.equal(sortableTitle('An apple'), 'apple')
  assert.equal(sortableTitle('A way'), 'way')
  assert.equal(sortableTitle('Anchor'), 'Anchor')
  assert.equal(sortableTitle('Theology'), 'Theology')
})

test('compareTitles sorts ignoring articles and case', () => {
  const titles = ['The Zeal', 'apple', 'A Banana', 'Cherry'].map((title) => ({ title }))
  assert.deepEqual(titles.sort(compareTitles).map((t) => t.title), ['apple', 'A Banana', 'Cherry', 'The Zeal'])
})

// ─── Frontmatter ───
test('parseFrontmatter', () => {
  assert.deepEqual(parseFrontmatter('---\ntitle: A\n---\nBody'), { data: { title: 'A' }, content: 'Body' })
  assert.deepEqual(parseFrontmatter('No frontmatter'), { data: {}, content: 'No frontmatter' })
  assert.deepEqual(parseFrontmatter('---\n---\nBody'), { data: {}, content: 'Body' })
  assert.deepEqual(parseFrontmatter('﻿---\r\ntitle: A\r\n---\r\nBody'), { data: { title: 'A' }, content: 'Body' })
})

test('parseFrontmatter rejects an unclosed block and non-mapping YAML', () => {
  assert.throws(() => parseFrontmatter('---\ntitle: A\nBody'), /never closed/)
  assert.throws(() => parseFrontmatter('---\n- a\n- b\n---\nBody'), /key: value/)
})

// ─── Typography passes ───
test('fixSpacedEllipses', () => {
  assert.equal(fixSpacedEllipses('wait . . . what'), 'wait&nbsp;.&nbsp;.&nbsp;. what')
  assert.equal(fixSpacedEllipses('end. . . And'), 'end.&nbsp;.&nbsp;. And')
})

test('wrapRomanNumerals wraps numerals of two or more letters, not a bare I, and skips code', () => {
  assert.equal(wrapRomanNumerals('<p>Part XIV and I</p>'),
    '<p>Part <span class="roman-num">XIV</span> and I</p>')
  assert.equal(wrapRomanNumerals('<p>X.III</p>'), '<p><span class="roman-num">X.III</span></p>')
  assert.equal(wrapRomanNumerals('<code>XIV</code>'), '<code>XIV</code>')
})

test('wrapDivineNames wraps LORD, GOD, YHWH and I AM with a styled initial', () => {
  assert.equal(wrapDivineNames('<p>the LORD</p>'),
    '<p>the <span class="divine-name"><span class="divine-name-initial">L</span>ORD</span></p>')
  assert.match(wrapDivineNames('<p>I AM WHO I AM</p>'), /divine-name-initial">I<\/span> AM WHO/)
  assert.equal(wrapDivineNames('<p>Lord</p>'), '<p>Lord</p>')
})

// ─── Headings ───
test('headingSlug decodes entities and falls back to "section"', () => {
  assert.deepEqual(headingSlug('Faith &amp; Works'), { text: 'Faith & Works', base: 'faith-and-works' })
  assert.equal(headingSlug('<em>***</em>').base, 'section')
})

test('addHeadingIds gives h2 and h3 ids, keeps explicit ones and avoids collisions', () => {
  const out = addHeadingIds('<h2>Grace</h2><h3 id="grace-2">X</h3><h3>Grace</h3><h4>Skip</h4>')
  assert.match(out, /<h2 id="grace">Grace<\/h2>/)
  assert.match(out, /<h3 id="grace-2">X<\/h3>/)
  assert.match(out, /<h4>Skip<\/h4>/)
})

test('addHeadingIds lets a repeat of the heading just above go without an id, but reports others', () => {
  const adjacent = []
  const out = addHeadingIds('<h2>Grace</h2><h3>Grace</h3>', false, adjacent)
  assert.equal(out, '<h2 id="grace">Grace</h2><h3>Grace</h3>')
  assert.deepEqual(adjacent, [])

  const far = []
  addHeadingIds('<h2>Grace</h2><h2>Law</h2><h2>Grace</h2>', false, far)
  assert.equal(far.length, 1)
  assert.match(far[0], /"Grace" \(#grace\)/)
})

test('addHeadingIds ignores headings inside comments and scripts', () => {
  const html = '<!-- <h2>Hidden</h2> --><script>"<h2>x</h2>"</script>'
  assert.equal(addHeadingIds(html), html)
})
