import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskCode, restoreCode } from '../lib/code.js'
import { expandPartials } from '../lib/partials.js'
import { prepareSource } from '../lib/source.js'

// ─── Code masking ───
const roundTrip = (text) => {
  const stash = []
  const masked = maskCode(text, stash)
  return { masked, stash, restored: restoreCode(masked, stash) }
}

test('maskCode hides fenced blocks and inline code, and restoreCode puts them back', () => {
  for (const text of [
    'a `[[Link]]` b',
    'a ``x ` y`` b',
    '```js\n[[Link]] {{partial}}\n```\nafter',
    '~~~\ncode\n~~~',
    '```\nunclosed fence runs to the end'
  ]) {
    const { masked, restored } = roundTrip(text)
    assert.notEqual(masked, text, text)
    assert.doesNotMatch(masked, /\[\[Link\]\]|\{\{partial\}\}|code\b.*\n~~~/, text)
    assert.equal(restored, text)
  }
})

test('maskCode leaves text without code alone, and an unmatched backtick is not code', () => {
  assert.equal(roundTrip('plain [[Link]] text').masked, 'plain [[Link]] text')
  assert.equal(roundTrip('one ` tick only').masked, 'one ` tick only')
})

test('an inline code span does not cross a blank line', () => {
  const { masked } = roundTrip('a `b\n\nc` d')
  assert.equal(masked, 'a `b\n\nc` d')
})

test('a fence closes on the same character, however long (the code says 3 or more)', () => {
  const { stash } = roundTrip('```\ncode\n`````\nout')
  assert.equal(stash.length, 1)
  assert.doesNotMatch(stash[0], /out/)
  assert.equal(roundTrip('```\ncode\n~~~\nmore\n```').stash.length, 1) // a tilde fence does not close a backtick one
})

// CommonMark closes a fence only on a fence at least as long as the opening one, so
// a four-backtick fence can hold a three-backtick line. maskCode closes it at the
// first three (its comment says "any length of 3+"), which leaves "still code" unmasked
// and starts a second, unclosed fence that swallows the rest of the text.
test('a longer fence is not closed by a shorter one (CommonMark)', { todo: 'maskCode closes on any fence of 3+' }, () => {
  const { stash } = roundTrip('````\n```\nstill code\n````\nout')
  assert.equal(stash.length, 1)
  assert.match(stash[0], /still code/)
})

// ─── Partials ───
const expand = (text, partials, warn) => expandPartials(text, partials, undefined, undefined, warn)

test('a partial is expanded by basename, case-insensitively, with positional arguments', () => {
  const partials = { note: 'Note: {{1}} and {{2}}.' }
  assert.equal(expand('{{Note|a|b}}', partials), 'Note: a and b.')
  assert.equal(expand('{{[[Note]]|a}}', partials), 'Note: a and .')
})

test('{{$args}} and {{$n}} describe the arguments', () => {
  const partials = { list: '{{$n}}: {{$args}}' }
  assert.equal(expand('{{list|x|y|z}}', partials), '3: x, y, z')
  assert.equal(expand('{{list}}', partials), '0: ')
})

test('a wikilink argument keeps its pipe', () => {
  const partials = { see: 'See {{1}} ({{2}})' }
  assert.equal(expand('{{see|[[topic/Trinity|Trinity]]|simple}}', partials), 'See [[topic/Trinity|Trinity]] (simple)')
})

test('a "$" in an argument is literal', () => {
  assert.equal(expand('{{p|$&}}', { p: '[{{1}}]' }), '[$&]')
})

test('partials nest, and a circular one is reported, not looped on', () => {
  const warnings = []
  const partials = { a: 'A({{b}})', b: 'B', loop: '{{loop}}' }
  assert.equal(expand('{{a}}', partials), 'A(B)')
  assert.equal(expand('{{loop}}', partials, (w) => warnings.push(w)), '<!-- circular partial: loop -->')
  assert.deepEqual(warnings, ['circular partial "loop"'])
})

test('a missing partial is reported and leaves a comment', () => {
  const warnings = []
  assert.equal(expand('x {{nope}} y', {}, (w) => warnings.push(w)), 'x <!-- partial not found: nope --> y')
  assert.deepEqual(warnings, ['partial "nope" not found'])
})

test('a numeric name is an unfilled placeholder and expands to nothing', () => {
  assert.equal(expand('a{{1}}b', {}), 'ab')
})

test('after a definition marker, an expansion\'s other lines are indented into the definition', () => {
  const partials = { def: 'one\ntwo\n\n' }
  assert.equal(expand(': {{def}}', partials), ': one\n  two')
  assert.equal(expand('plain {{def}}', partials), 'plain one\ntwo\n\n')
})

// ─── Preparing a page's source ───
test('prepareSource strips %% comments and expands partials, but not inside code', () => {
  const { text, restore } = prepareSource('a %% hidden [[Link]] %% b `{{p}}` {{p}}', { p: 'P' })
  assert.doesNotMatch(text, /hidden/)
  assert.match(text, / P$/)
  assert.equal(restore(text), 'a  b `{{p}}` P')
})

test('prepareSource: code in a partial stays literal too', () => {
  const { text, restore } = prepareSource('{{p}}', { p: 'use `%% not a comment %%` here' })
  assert.equal(restore(text), 'use `%% not a comment %%` here')
})
