import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BuildError } from '../lib/errors.js'
import { md, protectFencedAttrs } from '../lib/markdown.js'

const render = (text) => md.render(protectFencedAttrs(text))

test('~text~ is small, and a lone tilde stays a tilde', () => {
  assert.equal(render('a ~b~ c'), '<p>a <small>b</small> c</p>\n')
  assert.equal(render('about ~100 things'), '<p>about ~100 things</p>\n')
})

test('~small~ never crosses a block or overlaps other markup', () => {
  assert.equal(render('~a\n\nb~'), '<p>~a</p>\n<p>b~</p>\n')
  assert.doesNotMatch(render('~a *b~ c*'), /<small>[^<]*<em>[^<]*<\/small>/)
})

test('~~text~~ is still strikethrough', () => {
  assert.equal(render('~~gone~~'), '<p><s>gone</s></p>\n')
})

test('==text== is marked', () => {
  assert.equal(render('==hi=='), '<p><mark>hi</mark></p>\n')
})

test('a bare ::: fence is a callout', () => {
  assert.equal(render('::: \nHello\n:::'), '<div class="callout">\n<p>Hello</p>\n</div>\n')
})

test('a ::: {…} fence carries classes, an id and attributes', () => {
  const html = render('::: {.wide .note #here data-x="a&b"}\nHi\n:::')
  assert.match(html, /<div id="here" class="wide note" data-x="a&amp;b">/)
})

test('a bad attribute name in a fenced div fails the build', () => {
  assert.throws(() => render('::: {1a=b}\nHi\n:::'), BuildError)
  assert.throws(() => render('::: {a<b=c}\nHi\n:::'), BuildError)
})

test('a quote cannot break out of a fenced div\'s attribute: the tokenizer splits on it first', () => {
  assert.equal(render('::: {a"b=c}\nHi\n:::'), '<div b="c">\n<p>Hi</p>\n</div>\n')
})

test('definition lists, footnotes and tables', () => {
  assert.match(render('Term\n: Definition'), /<dl>\s*<dt>Term<\/dt>\s*<dd>Definition<\/dd>/)
  const footnote = render('Text[^1]\n\n[^1]: Note.')
  assert.match(footnote, /<a role="doc-noteref" /)
  assert.match(footnote, /<section role="doc-endnotes" aria-label="Footnotes" /)
  assert.match(footnote, /<a role="doc-backlink" aria-label="Back to footnote 1" /)
  assert.match(render('| a |\n|---|\n| b |'), /^<div class="table-scroll">\n<table>[\s\S]*<\/table>\n<\/div>\n$/)
})

test('bracketed spans and attributes', () => {
  assert.equal(render('[text]{.x}'), '<p><span class="x">text</span></p>\n')
  assert.equal(render('text {.y}'), '<p class="y">text</p>\n')
})

test('typographer curls quotes and dashes; raw HTML and bare URLs pass through', () => {
  assert.equal(render('"quoted" -- here'), '<p>“quoted” – here</p>\n')
  assert.match(render('<span class="x">hi</span>'), /<span class="x">hi<\/span>/)
  assert.match(render('see https://example.com now'), /<a href="https:\/\/example\.com">/)
})
