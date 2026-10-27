import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { hyphenate } from '../lib/book/hyphenate.js'
import { printArticle } from '../lib/book/compose.js'

// The soft hyphens shown as a middle dot, so a failure is readable
const dots = (html, options) => hyphenate(html, options).replaceAll('­', '·')

describe('hyphenate', () => {
  test('puts soft hyphens in a lowercase word of six letters or more', () => {
    assert.equal(dots('<p>traditional and grammatically</p>'), '<p>tra·di·tional and gram·mat·i·cally</p>')
  })

  test('leaves at least three letters on each side of a break', () => {
    for (const word of ['members', 'primarily', 'synthesizing', 'ontological', 'deliberately']) {
      for (const piece of dots(word).split('·')) assert.ok(piece.length >= 1)
      const breaks = [...hyphenate(word)].reduce((at, ch, i, all) => ch === '­' ? [...at, all.slice(0, i).filter((c) => c !== '­').length] : at, [])
      for (const at of breaks) assert.ok(at >= 3 && word.length - at >= 3, `${word} breaks at ${at}`)
    }
  })

  test('leaves a short word, a name, an acronym, a contraction and a compound alone', () => {
    const text = '<p>should Corinthians ESV don’t well-known self-evident Jesus</p>'
    assert.equal(hyphenate(text), text)
  })

  test('leaves Greek, Hebrew and transliteration alone, and a word touching them', () => {
    const text = '<p>ἀγάπη שלום ḵerubim kerubḇim</p>'
    assert.equal(hyphenate(text), text)
  })

  test('leaves code, an abbreviation, a footnote number and a heading alone', () => {
    const html = '<code>something</code><pre>something</pre><abbr title="x">something</abbr><sup>something</sup><h2>something</h2><h3>something</h3>'
    assert.equal(hyphenate(html), html)
  })

  test('leaves a term in small capitals alone, unless it is a commentary’s run-in term', () => {
    const html = '<dt>terminology</dt><dd>terminology</dd>'
    assert.equal(dots(html), '<dt>terminology</dt><dd>ter·mi·nol·ogy</dd>')
    assert.equal(dots(html, { commentary: true }), '<dt>ter·mi·nol·ogy</dt><dd>ter·mi·nol·ogy</dd>')
  })

  test('touches nothing but text: a tag, an attribute and an id keep their words', () => {
    const html = '<p id="traditional" title="grammatically" class="significance">significance</p>'
    assert.equal(dots(html), '<p id="traditional" title="grammatically" class="significance">sig·nif·i·cance</p>')
  })

  test('removing the soft hyphens gives back the text exactly', () => {
    const html = '<p>The traditional account is <em>grammatically</em> sound, says the <a href="#x">commentary</a>.</p>'
    assert.equal(hyphenate(html).replaceAll('­', ''), html)
  })
})

describe('printArticle hyphenates', () => {
  const page = (body) => `<main><article>\n${body}\n</article></main>`

  test('the text of a topic, but not its headings', () => {
    const out = printArticle(page('<h2 id="significance">significance</h2><p>significance</p>'), { slug: 's', inBook: {} })
    assert.equal(out.replaceAll('­', '·'), '<h2 id="s--significance">significance</h2><p>sig·nif·i·cance</p>')
  })

  test('a commentary’s run-in terms too', () => {
    const out = printArticle(page('<dl><dt>significance</dt><dd><p>x</p></dd></dl>'), { slug: 's', inBook: {}, commentary: true })
    assert.match(out.replaceAll('­', '·'), /<dt>sig·nif·i·cance<\/dt>/)
  })
})
