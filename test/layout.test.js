import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UNDERLINE_DEFAULTS, createLayout } from '../lib/layout.js'
import { describe, fallbackHero, findHero } from '../lib/html/describe.js'
import { BuildError } from '../lib/errors.js'

// ─── Link classes ───
const layout = (sets = {}) => createLayout({
  template: '<body class="<%= bodyClasses.join(\' \') %>"><%- content %></body>',
  draftUrls: new Set(),
  categoryUrls: new Set(),
  notesUrls: new Set(),
  featuredUrls: new Set(),
  plannedUrls: new Set(),
  allKnownUrls: new Set(['/topic/a', '/topic/b']),
  fallbackHero: { url: '/asset/x.png', wide: true },
  cacheBust: 'abc1234',
  ...sets
})

const classOf = (html, sets) => {
  const out = layout(sets)(html)
  return /<a class="([^"]*)"/.exec(out)?.[1].split(' ')
}

test('a known internal link is just internal', () => {
  assert.deepEqual(classOf('<a href="/topic/a">A</a>'), ['internal'])
})

test('an unknown internal link is broken, except under /index/', () => {
  assert.deepEqual(classOf('<a href="/topic/nope">N</a>'), ['internal', 'broken'])
  assert.deepEqual(classOf('<a href="/index/anything">N</a>'), ['internal'])
})

test('the query and fragment are ignored when classifying', () => {
  assert.deepEqual(classOf('<a href="/topic/a#section">A</a>'), ['internal'])
  assert.deepEqual(classOf('<a href="/topic/a?q=x">A</a>'), ['internal'])
})

test('draft, category, notes, featured and planned pages get their classes', () => {
  const sets = {
    draftUrls: new Set(['/topic/a']),
    categoryUrls: new Set(['/topic/a']),
    notesUrls: new Set(['/topic/a']),
    featuredUrls: new Set(['/topic/a']),
    plannedUrls: new Set(['/topic/a'])
  }
  assert.deepEqual(classOf('<a href="/topic/a">A</a>', sets),
    ['internal', 'draft', 'category', 'notes', 'featured', 'planned'])
})

test('an external link is external, and one whose text is its own address is a bare-url', () => {
  assert.deepEqual(classOf('<a href="https://example.com/x">Example</a>'), ['external'])
  assert.deepEqual(classOf('<a href="https://www.example.com/x/">http://example.com/x</a>'), ['external', 'bare-url'])
  assert.deepEqual(classOf('<a href="https://example.com/?a=1&amp;b=2">example.com/?a=1&amp;b=2</a>'), ['external', 'bare-url'])
  assert.deepEqual(classOf('<a href="https://example.com"><em>https://example.com</em></a>'), ['external'])
})

test('an existing class attribute is added to, not replaced', () => {
  const out = layout()('<a href="https://x.org" class="bible-ref" target="_blank">x</a>')
  assert.match(out, /<a href="https:\/\/x\.org" class="bible-ref external" target="_blank">/)
})

test('a relative or fragment-only link is internal and never broken', () => {
  assert.deepEqual(classOf('<a href="#top">Top</a>'), ['internal'])
  assert.deepEqual(classOf('<a href="mailto:a@b.c">Mail</a>'), ['internal'])
})

test('body classes are the URL\'s path segments, and the home page is "home"', () => {
  assert.match(layout()('x', { url: '/index/scripture/romans' }), /class="index scripture romans"/)
  assert.match(layout()('x', { url: '/' }), /class="home"/)
})

test('the underline defaults are on or off', () => {
  for (const value of Object.values(UNDERLINE_DEFAULTS)) assert.ok(['on', 'off'].includes(value))
})

// ─── Descriptions and heroes ───
test('describe takes the first paragraph with text, as plain text', () => {
  assert.equal(describe('<p><img src="x"></p><p>Hello <em>there</em> &amp; <a href="/x">you</a>.</p>'), 'Hello there & you.')
  assert.equal(describe('<h2>x</h2>'), '')
})

test('describe drops footnote markers and collapses whitespace', () => {
  assert.equal(describe('<p>A\n  b<sup class="footnote-ref"><a href="#fn1">[1]</a></sup> c</p>'), 'A b c')
})

test('describe trims a long paragraph to a whole word, with an ellipsis', () => {
  const long = `<p>${'word '.repeat(60)}</p>`
  const out = describe(long)
  assert.ok(out.length <= 161, out.length)
  assert.match(out, /word…$/)
  assert.doesNotMatch(out, /wor…$/)
})

test('describe does not cut inside a word, and keeps a paragraph of exactly 160', () => {
  const exact = 'x'.repeat(160)
  assert.equal(describe(`<p>${exact}</p>`), exact)
  assert.equal(describe(`<p>${'a'.repeat(100)} ${'b'.repeat(100)}</p>`), `${'a'.repeat(100)}…`)
})

test('findHero finds an opening image embed, and whether it is wide', () => {
  const imageMap = { 'town.png': '/asset/town.png', 'image/town.png': '/asset/town.png', 'me.png': '/asset/me.png' }
  assert.deepEqual(findHero('![[Town.png|300x137]]\n\ntext', imageMap), { url: '/asset/town.png', wide: true })
  assert.deepEqual(findHero('![[me.png|100x100]]', imageMap), { url: '/asset/me.png', wide: false })
  assert.deepEqual(findHero('![[image/Town.png]]', imageMap), { url: '/asset/town.png', wide: true })
  assert.equal(findHero('Text first\n\n![[town.png]]', imageMap), null)
  assert.equal(findHero('![[missing.png]]', imageMap), null)
})

test('the fallback hero must exist', () => {
  assert.deepEqual(fallbackHero({ 'trees-and-buildings.png': '/asset/t.png' }), { url: '/asset/t.png', wide: true })
  assert.throws(() => fallbackHero({}), BuildError)
})
