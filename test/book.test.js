import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildIndex, citationTally, composeBook, printArticle, scriptureIndexHtml, splitBook, topicId } from '../lib/book/compose.js'
import { processBibleRefs } from '../lib/bible/process.js'
import { markRefs } from '../lib/book/scripture.js'
import { composeCover, coverSize } from '../lib/book/cover.js'
import { FONT_AWESOME_KIT } from '../lib/layout.js'
import { findChrome, load, renderCoverPdf, renderPdf, setPageSize } from '../lib/book/pdf.js'
import { buildVault } from './helpers/scratch-vault.js'

// ─── printArticle: one built page, turned into print ───

const built = (body) => `<main>\n<article>\n<header><h1>T</h1><span class="featured-badge fa-sharp fa-solid fa-star" role="img"></span></header>\n${body}\n<p class="categories"><a class="index-link internal" href="/index/categorical">Categories</a>: <a class="internal category" href="/category/x">X</a></p>\n</article>\n</main>`
const inBook = { '/topic/mercy': 'topic-mercy' }
const print = (body, extra = {}) => printArticle(built(body), { slug: 'topic-grace', inBook, ...extra })

describe('printArticle', () => {
  test('drops what only the screen uses: the header, the categories line and icons', () => {
    const out = print('<p>Grace <span class="fa-sharp fa-solid fa-tags" aria-hidden="true"></span></p>')
    assert.doesNotMatch(out, /header|categories|featured-badge|fa-/)
    assert.match(out, /<p>Grace /)
  })

  test('a Bible reference and a web address become their text', () => {
    const out = print('<p><a href="https://ref.ly/Jn3.16;ESV" class="external bible-ref" target="_blank">Jn 3:16</a> and <a class="external" href="https://example.org/">a site</a></p>')
    assert.equal(out, '<p>Jn 3:16 and a site</p>')
  })

  test('a link to a topic in the book is a cross-reference; any other internal link is its text', () => {
    const out = print('<p><a class="internal" href="/topic/mercy">Mercy</a> and <a class="internal" href="/topic/wrath">Wrath</a> and <a class="internal" href="/topic/mercy#depth">deep</a></p>')
    assert.equal(out, '<p><a class="xref" href="#topic-mercy" data-p="000">Mercy</a> and Wrath and <a class="xref" href="#topic-mercy" data-p="000">deep</a></p>')
  })

  test('footnotes become the topic’s endnotes, numbered from 1 in the order cited, with no heading', () => {
    const out = print(
      '<p>One<sup class="footnote-ref"><a class="internal" role="doc-noteref" href="#fn2" id="fnref2">[2]</a></sup> two<sup class="footnote-ref"><a class="internal" role="doc-noteref" href="#fn1" id="fnref1">[1]</a></sup> again<sup class="footnote-ref"><a class="internal" role="doc-noteref" href="#fn2" id="fnref2:1">[2]</a></sup></p>\n' +
      '<hr class="footnotes-sep">\n<section role="doc-endnotes" class="footnotes">\n<ol class="footnotes-list">\n' +
      '<li id="fn1" class="footnote-item"><p>First note. <a role="doc-backlink" href="#fnref1" class="footnote-backref internal">↩︎</a></p>\n</li>\n' +
      '<li id="fn2" class="footnote-item"><p>Second note, with <a class="internal" href="/topic/mercy">Mercy</a>. <a role="doc-backlink" href="#fnref2" class="footnote-backref internal">↩︎</a> <a role="doc-backlink" href="#fnref2:1" class="footnote-backref internal">↩︎</a></p>\n</li>\n</ol>\n</section>'
    )
    assert.match(out, /One<sup class="fnref">1<\/sup> two<sup class="fnref">2<\/sup> again<sup class="fnref">1<\/sup>/)
    assert.match(out, /<section class="notes">\s*<ol class="notes-list">/)
    assert.match(out, /<li><span class="nn">1<\/span>Second note, with <a class="xref" href="#topic-mercy" data-p="000">Mercy<\/a>\.<\/li>\s*<li><span class="nn">2<\/span>First note\.<\/li>/)
    assert.doesNotMatch(out, /footnote-|doc-backlink|↩|<h2>Notes/)
  })

  test('an inline "see also" that points only outside the book is dropped', () => {
    const tail = (links) => print(`<dl>\n<dt>T</dt>\n<dd><a href="https://ref.ly/Jn3.16;ESV" class="external bible-ref">Jn 3:16</a> <em><small>— see also ${links}</small></em></dd>\n</dl>`)
    const gone = tail('<a class="internal" href="/topic/elsewhere">Elsewhere</a>')
    assert.doesNotMatch(gone, /see also|Elsewhere/)
    assert.match(gone, /<dd>Jn 3:16<\/dd>/)
    assert.match(tail('<a class="internal" href="/topic/mercy">Mercy</a>'), /see also <a class="xref" href="#topic-mercy"/)
    assert.match(tail('<a class="external bible-ref" href="https://ref.ly/Ro8.29;ESV">Ro 8:29</a>'), /see also Ro 8:29/)
  })

  test('links left pointing out of the book are collected, and the ones in it are not', () => {
    const outside = []
    print('<p><a class="internal" href="/topic/mercy">Mercy</a> <a class="internal" href="/topic/elsewhere#x">Else <em>where</em></a> <a class="external" href="https://example.org/">web</a></p>', { outside })
    assert.deepEqual(outside, ['"Else where" (/topic/elsewhere#x) in topic-grace'])
  })

  test('a commentary loses its screen furniture and keeps its terms as plain paragraphs', () => {
    const body = '<script>var x = 1</script>\n<p>Intro.</p>\n<nav class="toc" aria-label="Table of contents">\n<p class="toc-title">Outline</p>\n<ul><li>Greeting</li></ul>\n</nav>\n<h2 id="g">Greeting</h2>\n<dl>\n<dt><em>Paul</em></dt>\n<dd>A servant.</dd>\n</dl>\n' +
      '<dl class="scripture-entries">\n<dt class="scripture-reference" id="1.1">Tit 1:1</dt>\n<dd><ul><li><a class="internal" href="/topic/elsewhere">Elsewhere</a></li></ul></dd>\n</dl>\n<p class="scripture-toggle"><label>Interleave</label></p>\n<script>var y = 2</script>'
    const outside = []
    const out = print(body, { commentary: true, outside })
    assert.doesNotMatch(out, /script|Outline|scripture-entries|Interleave|Elsewhere/)
    assert.deepEqual(outside, [])
    assert.match(out, /<h2 id="topic-grace--g">Greeting<\/h2>\n<dl>\n<div class="para"><dt><em>Paul<\/em><\/dt><dd>A servant\.<\/dd><\/div>\n<\/dl>/)
    assert.doesNotMatch(out, /class="claim"/)
  })

  test('a closing "See X." that points only outside the book is dropped', () => {
    const para = (see) => print(`<dl>\n<dt>T</dt>\n<dd>Some text here. ${see}</dd>\n</dl>`)
    const gone = para('See <a class="internal" href="/topic/elsewhere">Elsewhere</a>.')
    assert.match(gone, /<dd>Some text here\.<\/dd>/)
    assert.match(para('See <a class="internal" href="/topic/mercy">Mercy</a>.'), /See <a class="xref" href="#topic-mercy" data-p="000">Mercy<\/a>\./)
    const outside = []
    print('<dl>\n<dt>T</dt>\n<dd>See <a class="internal" href="/topic/elsewhere">Elsewhere</a> for more.</dd>\n</dl>', { outside })
    assert.equal(outside.length, 1)
  })

  test('an "External links" section is left out, and what is in it is not collected', () => {
    const out = print('<p>Body.</p>\n<h2 id="external-links">External links</h2>\n<ul>\n<li><a class="external" href="https://example.org/x">A page</a></li>\n</ul>\n<h2 id="see-also">See also</h2>\n<ul><li><a class="internal" href="/topic/mercy">Mercy</a></li></ul>')
    assert.doesNotMatch(out, /External links|example\.org|A page/)
    assert.match(out, /<h2 id="topic-grace--see-also">See also<\/h2>/)
  })

  test('a page without footnotes has no notes section', () => {
    assert.doesNotMatch(print('<p>Plain.</p>'), /notes/)
  })

  test('a term and all its descriptions are one block, so a page never breaks between them', () => {
    const out = print('<dl>\n<dt id="a">One</dt>\n<dd>first</dd>\n<dd>second</dd>\n<dt>Two</dt>\n<dd>third</dd>\n</dl>')
    // each claim is numbered, so that a badly broken one can be held whole
    assert.match(out, /<div class="claim" data-c="topic-grace-1"><dt id="topic-grace--a">One<\/dt><dd>first<\/dd><dd>second<\/dd><\/div>\n<div class="claim" data-c="topic-grace-2"><dt>Two<\/dt><dd>third<\/dd><\/div>/)
  })

  test('the "Main topic" definition is marked, so the passages follow it closely as on the site', () => {
    const out = print('<dl>\n<dt>Claim</dt>\n<dd>\n<div class="main-topic">\n<p>Main topic: <a class="internal" href="/topic/mercy">Mercy</a></p>\n</div>\n</dd>\n<dd>Jn 3:16</dd>\n</dl>')
    assert.match(out, /<dd class="main-topic-dd">\n<div class="main-topic">/)
    assert.equal(out.match(/main-topic-dd/g).length, 1)
  })

  test('a "Main topic" line keeps only the topics in the book, and goes when none is', () => {
    const line = (names) => `<dl>\n<dt>Claim</dt>\n<dd>\n<div class="main-topic">\n<p>${names}</p>\n</div>\n</dd>\n<dd>Jn 3:16</dd>\n</dl>`
    const out = print(line('Main topics: <a class="internal" href="/topic/mercy">Mercy</a>, Providence, <a class="internal" href="/topic/elsewhere">Elsewhere</a>'))
    assert.match(out, /<p>Main topic: <a class="xref" href="#topic-mercy" data-p="000">Mercy<\/a><\/p>/)
    assert.doesNotMatch(out, /Providence|Elsewhere/)
    const none = print(line('Main topic: Providence'))
    assert.doesNotMatch(none, /main-topic|Providence/)
    assert.match(none, /<dd>Jn 3:16<\/dd>/)
  })

  test('See also keeps the topics that are in the book, and goes when none are', () => {
    const list = (...items) => `<h2 id="see-also">See also</h2>\n<ul>\n${items.map((i) => `<li><a class="internal" href="${i}">x</a></li>`).join('\n')}\n</ul>`
    const some = print(list('/topic/mercy', '/topic/wrath'))
    assert.match(some, /See also/)
    assert.match(some, /<li><a class="xref" href="#topic-mercy" data-p="000">x<\/a><\/li>/)
    assert.doesNotMatch(some, /wrath/)
    assert.doesNotMatch(print(list('/topic/wrath')), /See also/)
  })

  test('ids belong to their topic, and images come from the asset folder', () => {
    const out = print('<h2 id="oneness">Oneness</h2><figure><img src="/asset/Town.png" alt="Town" width="300" height="137"></figure>')
    assert.match(out, /<h2 id="topic-grace--oneness">/)
    assert.match(out, /<img src="\.\.\/asset\/Town\.png"/)
  })
})

// ─── markRefs and the Scripture index ───

// The book reads the links the site made, so its tests start from the site's own linker
const linked = (html) => processBibleRefs(html, { url: '/x', title: 'x' }, true).html
// (the site's link text has non-breaking spaces)
const mark = (html, slug, refs) => markRefs(linked(html), slug, refs).replaceAll('\u00a0', ' ')

describe('markRefs', () => {
  test('wraps each Bible reference in a numbered span and collects it', () => {
    const refs = []
    const out = mark('<p>See Jn 3:16; 5:24 and Ro 8:1–4.</p>', 'topic-grace', refs)
    assert.equal(out, '<p>See <span class="ref" id="r1">Jn 3:16</span>; <span class="ref" id="r2">5:24</span> and <span class="ref" id="r3">Ro 8:1–4</span>.</p>')
    assert.deepEqual(refs.map((r) => [r.id, r.bookName, r.displayShort]), [
      ['topic-grace--r1', 'John', '3:16'], ['topic-grace--r2', 'John', '5:24'], ['topic-grace--r3', 'Romans', '8:1–4']
    ])
  })

  test('reads the reference from the link, so a single-chapter book shown without its chapter is still the right verse', () => {
    const refs = []
    const out = mark('<p>2Jn 1:1, 13; Phm 1:3–5; Jude 1; Rev 1:1–2:3; Ro 1–2</p>', 'topic-a', refs)
    assert.deepEqual(refs.map((r) => [r.bookName, r.displayShort]), [
      ['2 John', '1:1'], ['2 John', '1:13'], ['Philemon', '1:3–5'], ['Jude', '1'], ['Revelation', '1:1–2:3'], ['Romans', '1–2']
    ])
    assert.match(out, /<span class="ref" id="r1">2Jn 1<\/span>, <span class="ref" id="r2">13<\/span>; <span class="ref" id="r3">Phm 3–5<\/span>; <span class="ref" id="r4">Jude<\/span>/)
  })

  test('an opted-out reference is plain text and is not collected', () => {
    const refs = []
    const out = mark('<p>!Jn 3:16 and Jn 1:2</p>', 'x', refs)
    assert.match(out, /<p>Jn 3:16 and <span class="ref" id="r1">Jn 1:2<\/span><\/p>/)
    assert.equal(refs.length, 1)
  })

  test('a link it cannot read fails the book', () => {
    assert.throws(() => markRefs('<a href="https://ref.ly/nonsense" class="external bible-ref">x</a>', 'x', []), /can't read the Bible reference link "nonsense"/)
  })
})

describe('scriptureIndexHtml', () => {
  const refs = []
  mark('<p>Jn 3:16; Ge 1:1; Jn 3:16</p>', 'topic-a', refs)
  mark('<p>Jn 3:16 and Ge 1:1–3</p>', 'topic-b', refs)
  const html = scriptureIndexHtml(refs)

  test('lists the books in canonical order, each reference once, with a page for every place it is cited', () => {
    assert.match(html, /<section class="scripture-index" id="scripture-index"><h1 class="topic-title">Scripture index<\/h1>/)
    assert.ok(html.indexOf('>Genesis<') < html.indexOf('>John<'))
    assert.match(html, /<p class="ix"><span class="ixt">3:16<\/span><span class="pgs"><span class="pg"><a class="pn" href="#topic-a--r1">000<\/a><\/span><span class="pg">, <a class="pn" href="#topic-a--r3">000<\/a><\/span><span class="pg">, <a class="pn" href="#topic-b--r1">000<\/a><\/span><\/span><\/p>/)
  })

  test('orders a book’s references canonically: the longer of two ranges from one verse first', () => {
    assert.ok(html.indexOf('>1:1–3<') < html.indexOf('>1:1<'))
  })
})

// ─── composeBook: the whole document ───

describe('citationTally', () => {
  const refs = []
  mark('<p>Jn 3:16; Ge 1:1; Jn 3:16; Ge 1:1–3; Ps 119:1–40</p>', 'topic-a', refs)
  const topics = [{ pages: [{ relDir: 'topic' }, { relDir: 'topic' }] }]

  test('says how many verses the book cites of the Bible’s, by the site’s count (a passage of over fifteen verses cites none)', () => {
    assert.equal(
      citationTally(topics, refs),
      '<p class="tally">The 2 topics in this edition cite 4 of the Bible’s 31,102 verses, 0% of all Scripture.</p>\n'
    )
  })

  test('mentions commentaries only when a page comes from the commentary folder', () => {
    assert.match(citationTally([{ pages: [{ relDir: 'topic' }, { relDir: 'commentary' }] }], refs), /The 2 topics and commentaries in this edition/)
  })

  test('closes the Scripture index', () => {
    assert.match(scriptureIndexHtml(refs, citationTally(topics, refs)), /<\/div>\n<p class="tally">The 2 topics[^]*<\/p>\n<\/section>\n$/)
  })
})

describe('composeBook', () => {
  const page = (url, title) => ({ finalUrlPath: url, title })
  const parts = [
    { title: 'Prolegomena', pages: [page('/topic/grace', 'Grace')] },
    { title: 'Theology & more', pages: [page('/topic/mercy', 'Mercy <3')] }
  ]
  const articles = { '/topic/grace': built('<p>About grace.</p>'), '/topic/mercy': built('<p>About mercy.</p>') }
  const html = composeBook({ parts, articles, date: new Date('2026-10-21T12:00:00Z'), commit: 'abc1234', version: '0.21.0' })

  test('has the front matter, a contents page, a page per part and a section per topic', () => {
    assert.match(html, /<section class="title-page">/)
    assert.match(html, /<section class="copyright-page">[\s\S]*Copyright © 2026 by Joey Day\.<br>All rights reserved\.<br>Published by Joey Day\.[\s\S]*October 2026 edition<br>commit abc1234 · tsgen 0\.21\.0<\/p>/)
    assert.match(html, /<p class="subtitle">A Systematic-Theological<br>Concordance of the Holy Bible<\/p>/)
    assert.match(html, /<section class="dedication">/)
    assert.match(html, /<nav class="toc">/)
    assert.match(html, /<section class="part" id="part-1">[\s\S]*Part 1[\s\S]*Prolegomena/)
    assert.match(html, /<section class="part" id="part-2">/)
    assert.match(html, /<section class="topic" id="topic-grace"><h1 class="topic-title">Grace<\/h1>\n<p>About grace\.<\/p>/)
  })

  test('the contents are short: the parts and the index, not the topics; titles are escaped', () => {
    const toc = html.slice(html.indexOf('<nav class="toc">'), html.indexOf('</nav>'))
    assert.match(toc, /<h1>Table of contents<\/h1>/)
    assert.match(toc, /<a href="#part-1" data-p="000">Part 1: Prolegomena<\/a>/)
    assert.match(toc, /<a href="#part-2" data-p="000">Part 2: Theology &amp; more<\/a>/)
    assert.match(toc, /<a href="#topic-index" data-p="000">Topic index<\/a>/)
    assert.match(toc, /<a href="#scripture-index" data-p="000">Scripture index<\/a>/)
    assert.doesNotMatch(toc, /topic-grace|Grace/)
    assert.match(html, /<h1 class="topic-title">Mercy &lt;3<\/h1>/)
  })

  test('links the book’s stylesheets from the asset folder', () => {
    assert.match(html, /<link rel="stylesheet" href="\.\.\/asset\/fonts\.css">\s*<link rel="stylesheet" href="\.\.\/asset\/book\.css">/)
  })

  test('has a topic index of the topics and their aliases, and a Scripture index, with placeholder page numbers', () => {
    assert.match(html, /<section class="index" id="topic-index"><h1 class="topic-title">Topic index<\/h1>/)
    assert.match(html, /<p class="ix"><span class="ixt">Grace<\/span><span class="pgs"><a class="pn" href="#topic-grace">000<\/a><\/span><\/p>/)
  })

  test('without a preface the contents have none, and with one the contents lead with it', () => {
    assert.doesNotMatch(html, /id="preface"|<a href="#preface"/)
    const withPreface = composeBook({ parts, articles, preface: built('<h2 id="the-author">The author</h2><p>Hi.</p>'), date: new Date('2026-10-21T12:00:00Z') })
    assert.match(withPreface, /<li><a href="#preface" data-p="000">Preface<\/a><\/li>/)
    assert.match(withPreface, /<section class="topic preface" id="preface"><h1 class="topic-title">Preface<\/h1>\n<h2 id="preface--the-author">The author<\/h2>/)
    assert.match(withPreface, /<a href="#topic-index" data-p="000">Topic index<\/a>/)
  })

  test('a topic’s id is its url', () => {
    assert.equal(topicId('/topic/church-government'), 'topic-church-government')
  })
})

// ─── buildIndex ───

describe('buildIndex', () => {
  const page = (url, title, aliases = []) => ({ finalUrlPath: url, title, aliases })
  const parts = [{
    title: 'P',
    pages: [
      page('/topic/church', 'Church'),
      page('/topic/church-government', 'Church government', ['Polity', 'Church polity']),
      page('/topic/church-discipline', 'Church discipline'),
      page('/topic/preservation-of-the-saints', 'Preservation of the saints', ['Perseverance of the saints']),
      page('/topic/scripture', 'Scripture', ['Preservation of Scripture', 'Canon']),
      page('/topic/the-law', 'The law of Christ', ['Scripture']),
      page('/topic/grace', 'Grace', ['grace', 'Favor'])
    ]
  }]
  const text = (entries) => entries.flatMap((e) => [e.text, ...e.subs.map((s) => `  ${s.text}`)])

  test('lists topics and aliases alphabetically, ignoring a leading article and case', () => {
    assert.deepEqual(text(buildIndex(parts)), [
      'Canon', 'Church', 'Church discipline', 'Church government', 'Church polity', 'Favor', 'Grace',
      'The law of Christ', 'Perseverance of the saints', 'Polity', 'Preservation of Scripture',
      'Preservation of the saints', 'Scripture', 'Scripture'
    ])
  })

  test('an alias that is its own topic’s title is not listed twice, and every entry points at its topic', () => {
    const entries = buildIndex(parts)
    assert.equal(entries.filter((e) => e.text.toLowerCase() === 'grace').length, 1)
    assert.deepEqual(entries.filter((e) => e.text === 'Scripture').map((e) => e.id).sort(), ['topic-scripture', 'topic-the-law'])
    assert.equal(entries.find((e) => e.text === 'Polity').id, 'topic-church-government')
  })

  test('a group gathers the entries that begin with it, under a heading that has its own page if a topic is called that', () => {
    const entries = buildIndex(parts, ['Church', 'Preservation'])
    assert.deepEqual(text(entries), [
      'Canon', 'Church', '  discipline', '  government', '  polity', 'Favor', 'Grace', 'The law of Christ',
      'Perseverance of the saints', 'Polity', 'Preservation', '  of Scripture', '  of the saints', 'Scripture', 'Scripture'
    ])
    assert.equal(entries.find((e) => e.text === 'Church').id, 'topic-church')
    assert.equal(entries.find((e) => e.text === 'Preservation').id, null)
  })

  test('a group nothing matches leaves no heading', () => {
    assert.equal(buildIndex(parts, ['Nothing']).some((e) => e.text === 'Nothing'), false)
  })
})

// ─── The book, on a scratch vault ───

const builds = []
const build = async (files, options) => {
  const b = await buildVault(files, options)
  builds.push(b)
  return b
}
after(() => Promise.all(builds.map((b) => b.cleanup())))

const topic = (body, data = '') => `---\ntitle: T\n${data}---\n${body}\n`
const manifest = (parts) => JSON.stringify({ parts })
const vault = {
  'topic/Grace.md': topic('Grace is God’s favor ([[Mercy]], see John 3:16)[^1] and [a site](https://example.org/).\n\n[^1]: A note.\n\n## Depth\n\nTerm (aside)\n: Jn 3:16\n'),
  'topic/Mercy.md': topic('Mercy.'),
  'topic/Wrath.md': topic('Wrath.')
}

function assertBookFails (result, pattern) {
  assert.notEqual(result.code, 0, `expected the book to fail:\n${result.output}`)
  assert.match(result.output, /Book failed:/)
  assert.match(result.output, pattern)
}

describe('a build with --book-html', { concurrency: true }, () => {
  test('lays the book out from the built pages', async () => {
    const b = await build({ ...vault, 'book.json': manifest([{ title: 'Grace', topics: ['Grace', 'Mercy'] }]) }, { book: true, args: ['build', '--book-html'] })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/book/book.html')
    assert.match(html, /<section class="topic" id="topic-grace">/)
    assert.match(html, /<a class="xref" href="#topic-mercy" data-p="000">Mercy<\/a>/)
    assert.match(html, /<li><span class="nn">1<\/span>A note\.<\/li>/)
    assert.match(html, /Term <small>\(<em>aside<\/em>\)<\/small>/)
    assert.doesNotMatch(html, /ref\.ly|example\.org|<a [^>]*external/)
    assert.ok(await b.exists('/asset/book.css'))
    assert.ok(await b.exists('/asset/fonts.css'))
    assert.match(b.output, /Book: 1 part\(s\), 2 topic\(s\)/)
    assert.match(html, /<h2 class="sbook">John<\/h2>\n<p class="ix"><span class="ixt">3:16<\/span><span class="pgs"><span class="pg"><a class="pn" href="#topic-grace--r1">000<\/a>/)
    assert.match(html, /[A-Z][a-z]+ 20\d\d edition<br>commit abcdef0 · tsgen \d+\.\d+\.\d+<\/p>/)
  })

  test('the About page is the preface, and the index has the topics and their aliases, in groups', async () => {
    const b = await build({
      ...vault,
      'About.md': topic('Hi, I’m Joey. See John 3:16.[^n]\n\n[^n]: An about note.\n\n## The inception\n\nIt began.\n'),
      'topic/Church.md': '---\ntitle: Church\n---\nChurch.\n',
      'topic/Church discipline.md': '---\ntitle: Church discipline\naliases:\n  - Keys of the kingdom\n---\nDiscipline.\n',
      'book.json': JSON.stringify({ parts: [{ title: 'P', topics: ['Church', 'Church discipline', 'Grace', 'Mercy'] }], index: { groups: ['Church'] } })
    }, { book: true, args: ['build', '--book-html'] })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/book/book.html')
    assert.match(html, /<section class="topic preface" id="preface"><h1 class="topic-title">Preface<\/h1>/)
    assert.match(html, /<h2 id="preface--the-inception">The inception<\/h2>/)
    assert.match(html, /<span class="ref" id="preface--r1">John.3:16<\/span>/)
    assert.match(html, /<a class="pn" href="#preface--r1">000<\/a>/)
    assert.match(html, /<li><span class="nn">1<\/span>An about note\.<\/li>/)
    assert.match(html, /<p class="ix"><span class="ixt">Church<\/span><span class="pgs"><a class="pn" href="#topic-church">000<\/a><\/span><\/p>\n<p class="ix ix-sub"><span class="ixt">discipline<\/span><span class="pgs"><a class="pn" href="#topic-church-discipline">000<\/a><\/span><\/p>/)
    assert.match(html, /<p class="ix"><span class="ixt">Keys of the kingdom<\/span><span class="pgs"><a class="pn" href="#topic-church-discipline">000<\/a><\/span><\/p>/)
  })

  test('a topic can be named with its folder', async () => {
    const b = await build({ ...vault, 'book.json': manifest([{ title: 'P', topics: ['topic/Grace', 'Mercy'] }]) }, { book: true, args: ['build', '--book-html'] })
    assert.equal(b.code, 0, b.output)
  })

  test('needs a book.json', async () => {
    assertBookFails(await build(vault, { book: true, args: ['build', '--book-html'] }), /book\.json not found/)
  })

  test('needs valid JSON with parts', async () => {
    assertBookFails(await build({ ...vault, 'book.json': '{' }, { book: true, args: ['build', '--book-html'] }), /book\.json is not valid JSON/)
    assertBookFails(await build({ ...vault, 'book.json': '{}' }, { book: true, args: ['build', '--book-html'] }), /needs a "parts" list/)
    assertBookFails(await build({ ...vault, 'book.json': '[]' }, { book: true, args: ['build', '--book-html'] }), /must be a JSON object/)
  })

  test('the index groups, when given, are a list of headings', async () => {
    assertBookFails(await build({ ...vault, 'book.json': JSON.stringify({ parts: [{ title: 'P', topics: ['Grace'] }], index: { groups: 'Church' } }) }, { book: true, args: ['build', '--book-html'] }), /"index" "groups" must be a list of headings/)
    assertBookFails(await build({ ...vault, 'book.json': JSON.stringify({ parts: [{ title: 'P', topics: ['Grace'] }], index: [] }) }, { book: true, args: ['build', '--book-html'] }), /"index" must be an object/)
  })

  test('every part needs a title and topics', async () => {
    const b = await build({ ...vault, 'book.json': manifest([{ topics: ['Grace'] }, { title: 'Two' }, { title: 'Three', topics: [7] }]) }, { book: true, args: ['build', '--book-html'] })
    assertBookFails(b, /part 1 needs a "title"/)
    assert.match(b.output, /part 2 \("Two"\) needs a "topics" list/)
    assert.match(b.output, /part 3 \("Three"\) has a topic that isn't text/)
  })

  test('a topic that is missing, hidden, a draft, a notes page, a category or repeated fails the book', async () => {
    const b = await build({
      ...vault,
      'topic/Secret.md': topic('s', 'hidden: true\n'),
      'topic/Unfinished.md': topic('u', 'draft: true\n'),
      'topic/notes/Grace.md': topic('notes'),
      'category/Things.md': topic('c'),
      'book.json': manifest([{ title: 'P', topics: ['Nowhere', 'Secret', 'Unfinished', 'topic/notes/Grace', 'Things', 'Grace', 'Grace'] }])
    }, { book: true, args: ['build', '--book-html'] })
    assertBookFails(b, /"Nowhere" \(part 1 \("P"\)\) is not a page/)
    assert.match(b.output, /"Secret" .* is hidden/)
    assert.match(b.output, /"Unfinished" .* is a draft/)
    assert.match(b.output, /"topic\/notes\/Grace" .* is a notes page/)
    assert.match(b.output, /"Things" .* is a category/)
    assert.match(b.output, /"Grace" .* is already in part 1/)
  })

  test('a commentary can be a Part of the book, and is marked so it prints run-in', async () => {
    const b = await build({
      ...vault,
      'commentary/Titus.md': '---\ntitle: Titus\n---\nIntro.\n\n## Start (Tit 1:1)\n\nTit 1:1 *A term*\n: A definition.\n',
      'book.json': manifest([{ title: 'P', topics: ['Mercy'] }, { title: 'Commentaries', topics: ['commentary/Titus'] }])
    }, { book: true, args: ['build', '--book-html'] })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/book/book.html')
    assert.match(html, /<section class="part" id="part-2"><p class="part-number">Part 2<\/p><h1 class="part-title">Commentaries<\/h1>/)
    assert.match(html, /<section class="topic commentary" id="commentary-titus">/)
    assert.doesNotMatch(html, /<div class="claim"><dt[^>]*>.*A term/)
  })

  test('a link that points out of the book fails the book, naming it', async () => {
    const b = await build({
      ...vault,
      'topic/Elsewhere.md': topic('Not in the book.'),
      'topic/Grace.md': topic('Grace, and [[Elsewhere]] too.\n'),
      'book.json': manifest([{ title: 'P', topics: ['Grace'] }])
    }, { book: true, args: ['build', '--book-html'] })
    assertBookFails(b, /The book links to pages that are not in it:\n"Elsewhere" \(\/topic\/elsewhere\) in topic-grace/)
  })

  test('a name that more than one page has fails the book until it has its folder', async () => {
    const b = await build({
      ...vault,
      'reference/Twin.md': topic('r'),
      'category/Twin.md': topic('c'),
      'book.json': manifest([{ title: 'P', topics: ['Twin'] }])
    }, { book: true, args: ['build', '--book-html'] })
    assertBookFails(b, /"Twin" \(part 1 \("P"\)\) names more than one page; write it with its folder, like "topic\/Twin"/)
  })

  test('a page at /book would be overwritten, so it fails the book', async () => {
    const b = await build({ ...vault, 'book.md': topic('a page'), 'book.json': manifest([{ title: 'P', topics: ['Grace'] }]) }, { book: true, args: ['build', '--book-html'] })
    assertBookFails(b, /exists: a page at \/book would be overwritten/)
  })
})

// ─── The cover ───

// The cover's icon comes over the network, from the Font Awesome kit (which answers a plain request with a
// 403 and a browser's with the script, so any answer means it can be reached)
const kitReachable = await fetch(`https://kit.fontawesome.com/${FONT_AWESOME_KIT}.js`, { signal: AbortSignal.timeout(5000) }).then(() => true, () => false)
const noCover = (!findChrome() && 'no Chrome to print with') || (!kitReachable && 'the Font Awesome kit is not reachable')

describe('the cover', () => {
  test('is the back, the spine and the front, with bleed, and the spine is as thick as the pages', () => {
    const { spine, width, height, widthPt, heightPt, page } = coverSize(214)
    assert.ok(Math.abs(spine - 214 * 0.002252) < 1e-9)
    assert.equal(coverSize(213).spine, spine) // a leaf has two pages
    assert.ok(coverSize(300).spine > spine)
    // the sheet is two 4.25 in pages and the spine, and a 6.8598 in page, with an eighth of an inch of bleed
    // all round, rounded up to a whole number of points (the extra falling in the bleed)
    for (const [pt, inches] of [[widthPt, 8.75 + spine], [heightPt, 7.1098]]) {
      assert.ok(Number.isInteger(pt) && pt >= inches * 72 && pt < inches * 72 + 1, `${pt} pt for ${inches} in`)
    }
    assert.equal(width, widthPt / 72)
    assert.equal(height, heightPt / 72)
    // and it is printed on a page of the next hundredth of an inch (which is how finely Chrome sizes one) after half a
    // point more, for Chrome prints a page up to 0.48 pt off either way
    for (const [size, sheet] of [[page.width, width], [page.height, height]]) {
      assert.ok(size >= sheet + 0.5 / 72 - 1e-9 && size < sheet + 0.5 / 72 + 0.01 + 1e-9 && Math.abs(size * 100 - Math.round(size * 100)) < 1e-9, `${size} in for ${sheet} in`)
    }
  })

  test('cuts the page box down even when it must grow (a sheet a whole number of points wide), keeping the file\'s offsets right', () => {
    // a PDF as Chrome writes one: objects, a classic cross-reference table, and the startxref that points at it
    const pdf = (width) => {
      const objects = ['<</Type /Catalog /Pages 2 0 R>>', '<</Type /Pages /Kids [3 0 R] /Count 1>>', `<</Type /Page /Parent 2 0 R\n/MediaBox [0 0 ${width} 513.12]>>`, '<</Length 4>>\nstream\nabcd\nendstream']
      let body = '%PDF-1.4\n'
      const offsets = objects.map((o, i) => { const at = body.length; body += `${i + 1} 0 obj\n${o}\nendobj\n`; return at })
      const xref = body.length
      body += `xref\n0 5\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<</Size 5 /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
      return body
    }
    const offsetsOf = (text) => {
      const table = /startxref\n(\d+)/.exec(text)[1]
      assert.ok(text.startsWith('xref\n0 5\n', +table), 'startxref points at the table')
      return [...text.slice(+table).matchAll(/^(\d{10}) \d{5} n $/gm)].map((m) => +m[1])
    }
    for (const width of ['666', '666.24']) {
      const out = setPageSize(pdf(width), { widthPt: 666, heightPt: 512 })
      assert.match(out, /\/MediaBox \[0 1\.12 666 513\.12\] *\]?/)
      offsetsOf(out).forEach((at, i) => assert.ok(out.startsWith(`${i + 1} 0 obj`, at), `object ${i + 1} (width ${width})`))
    }
    // a box that fits where the old one was is padded, and nothing moves
    const same = pdf('666.24')
    assert.equal(setPageSize(same, { widthPt: 666, heightPt: 512 }).length, same.length)
  })

  test('Chrome prints the page of a cover no smaller than its sheet, for a book of any length', { skip: !findChrome() && 'no Chrome to print with', timeout: 120000 }, async () => {
    // (a page of 9.27 in came out 666.96 pt wide, short of a sheet of 667 pt, and the build failed)
    const sizes = new Map()
    for (let pages = 20; pages <= 1200; pages += 2) sizes.set(`${coverSize(pages).page.width}x${coverSize(pages).page.height}`, coverSize(pages))
    const { puppeteer, chrome } = await load()
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true })
    try {
      const page = await browser.newPage()
      for (const [size, sheet] of sizes) {
        await page.setContent(`<style>@page { size: ${sheet.page.width}in ${sheet.page.height}in; margin: 0 } body { margin: 0 }</style><div style="width: 10px; height: 10px; background: #000"></div>`)
        const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1')
        const [, width, height] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)
        assert.ok(+width >= sheet.widthPt && +height >= sheet.heightPt, `${size} in printed ${width} × ${height} pt, for a ${sheet.widthPt} × ${sheet.heightPt} pt sheet`)
      }
    } finally {
      await browser.close()
    }
  })

  test('sets the title, subtitle and author, the spine, and 2 Timothy on the back, with the sheet as the page', () => {
    const html = composeCover({ pages: 214 })
    const { page } = coverSize(214)
    assert.ok(html.includes(`@page { size: ${page.width}in ${page.height}in; margin: 0; }`))
    assert.match(html, /<h1>Tota Scriptura<\/h1>/)
    assert.match(html, /<p class="subtitle">A Systematic-Theological<br>Concordance of the Holy Bible<\/p>/)
    assert.match(html, /<p class="author">Joey Day<\/p>/)
    assert.match(html, /<p class="spine-title">Tota Scriptura<\/p>\s*<p class="spine-author">Joey Day<\/p>/)
    assert.match(html, /All Scripture is breathed out by God and<br>/)
    assert.match(html, /<p class="citation">— 2 Timothy 3:16–17<\/p>/)
    assert.match(html, new RegExp(`kit\\.fontawesome\\.com/${FONT_AWESOME_KIT}\\.js`))
    assert.match(html, /fa-feather-pointed/)
  })

  test('is the site sidebar\'s gray', async () => {
    const template = path.join(import.meta.dirname, '..', 'template')
    const sidebar = /--color-nav-background: (oklch\([^)]*\));/.exec(await fs.readFile(path.join(template, 'style.css'), 'utf-8'))[1]
    const field = /--color-field: (oklch\([^)]*\));/.exec(await fs.readFile(path.join(template, 'cover.css'), 'utf-8'))[1]
    assert.equal(field, sidebar)
    // and in the dark theme, the dark sidebar's gray over the dark page's
    const style = await fs.readFile(path.join(template, 'style.css'), 'utf-8')
    const css = await fs.readFile(path.join(template, 'cover.css'), 'utf-8')
    assert.match(css, new RegExp(`\\.dark \\{[^}]*--color-field: ${/--color-dark-gray: (oklch\([^)]*\));/.exec(style)[1].replace(/[()]/g, '\\$&')};[^}]*--color-paper: ${/--color-darker-gray: (oklch\([^)]*\));/.exec(style)[1].replace(/[()]/g, '\\$&')};`))
  })

  test('sets the back, with the citation\'s numerals old-style, as the book\'s are', async () => {
    // (the font shorthand resets font-variant-numeric, so it has to come after it)
    const css = await fs.readFile(path.join(import.meta.dirname, '..', 'template', 'cover.css'), 'utf-8')
    assert.match(css, /\.back > \* \{[^}]*font: [^;]*;\s*font-variant-numeric: oldstyle-nums;/)
  })

  test('has a dark version, in the site\'s dark theme', () => {
    assert.doesNotMatch(composeCover({ pages: 214 }), /class="cover dark"/)
    assert.match(composeCover({ pages: 214, dark: true }), /<div class="cover dark">/)
  })

  test('fails the book, rather than print without its icon, when the Font Awesome kit does not load', { skip: !findChrome() && 'no Chrome to print with', timeout: 60000 }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tsgen-cover-'))
    try {
      const htmlFile = path.join(dir, 'cover.html')
      await fs.writeFile(htmlFile, '<!doctype html><title>no icon</title><p>No kit here.</p>')
      await assert.rejects(renderCoverPdf({ htmlFile, pdfFile: path.join(dir, 'cover.pdf'), wait: 500 }), /cover's icon didn't load/)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test('is printed as one PDF page the size of the sheet', { skip: noCover, timeout: 120000 }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tsgen-cover-'))
    try {
      await fs.mkdir(path.join(dir, 'book'))
      await fs.cp(path.join(import.meta.dirname, '..', 'template'), path.join(dir, 'asset'), { recursive: true })
      await fs.cp(path.join(dir, 'asset', 'fonts'), path.join(dir, 'asset'), { recursive: true })
      const htmlFile = path.join(dir, 'book', 'cover.html')
      await fs.writeFile(htmlFile, composeCover({ pages: 214 }))
      const pdfFile = path.join(dir, 'book', 'cover.pdf')
      await renderCoverPdf({ htmlFile, pdfFile, size: coverSize(214) })
      const pdf = (await fs.readFile(pdfFile)).toString('latin1')
      assert.equal(pdf.slice(0, 5), '%PDF-')
      assert.equal(pdf.match(/\/Type\s*\/Page\b/g).length, 1)
      // the page is the sheet in whole points (a fraction of a point more shows as a white hairline in a viewer)
      const { widthPt, heightPt } = coverSize(214)
      const [bottom, width, top] = /\/MediaBox \[0 ([\d.]+) (\d+) ([\d.]+) *\]/.exec(pdf).slice(1)
      assert.equal(+width, widthPt)
      assert.ok(Math.abs(top - bottom - heightPt) < 0.011, `${bottom} to ${top} pt`)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the book in a build', () => {
  test('is made by default, so a vault without a book.json fails the build, and --no-book is the way to skip it', async () => {
    const plain = await build(vault, { book: true })
    assertBookFails(plain, /Book failed: book\.json not found/)
    const without = await build(vault, { book: true, args: ['build', '--no-book'] })
    assert.equal(without.code, 0, without.output)
    assert.equal(await without.exists('/book'), false)
    assert.doesNotMatch(without.output, /Book/)
  })

  test('with --book-html the layout is kept and no PDF is made', async () => {
    const b = await build({ ...vault, 'book.json': manifest([{ title: 'P', topics: ['Grace', 'Mercy'] }]) }, { book: true, args: ['build', '--book-html'] })
    assert.equal(b.code, 0, b.output)
    assert.equal(await b.exists('/book/book.html'), true)
    assert.equal(await b.exists('/book/book.pdf'), false)
  })

  test('says so when the Chrome in CHROME_PATH is not there', async () => {
    const b = await build({ ...vault, 'book.json': manifest([{ title: 'P', topics: ['Grace', 'Mercy'] }]) }, { book: true, env: { CHROME_PATH: '/nowhere/chrome' } })
    assertBookFails(b, /needs Chrome or Chromium: install it, set CHROME_PATH to its executable, or build with --no-book \(it is not at \/nowhere\/chrome\)/)
  })

  test('numbers the preface (not the contents) in Roman numerals, and the book from 1 on the first Part', { skip: !findChrome() && 'no Chrome to typeset with', timeout: 120000 }, async () => {
    const b = await build({ ...vault, 'About.md': topic('Hello.'), 'book.json': manifest([{ title: 'Grace', topics: ['Grace', 'Mercy'] }]) }, { book: true, args: ['build', '--book-html'] })
    assert.equal(b.code, 0, b.output)
    const { pages, first, folios } = await renderPdf({ htmlFile: path.join(b.dist, 'book', 'book.html'), pdfFile: path.join(b.dist, 'book', 'book.pdf') })
    assert.equal(first, 9)
    assert.equal(folios.length, pages)
    // The title, copyright and dedication pages show nothing, nor does the blank page after them; the contents
    // (v) show none either; a blank page; the preface is vii; a blank page; the first Part's page is 1 (no number is shown),
    // then a blank page, and the first topic is 3
    assert.deepEqual(folios.slice(0, 11), ['', '', '', '', '', '', 'vii', '', '', '', '3'])
  })

  test('remembers each section it lays out, and lays out again only the one that changed', { skip: !findChrome() && 'no Chrome to typeset with', timeout: 300000 }, async () => {
    const b = await build({ ...vault, 'About.md': topic('Hello.'), 'book.json': manifest([{ title: 'Grace', topics: ['Grace', 'Mercy', 'Wrath'] }]) }, { book: true, args: ['build', '--book-html'] })
    assert.equal(b.code, 0, b.output)
    const htmlFile = path.join(b.dist, 'book', 'book.html')
    const cacheDir = path.join(b.dist, '..', 'cache')
    const typeset = (pdf) => renderPdf({ htmlFile, pdfFile: path.join(b.dist, pdf), cacheDir })
    const sections = splitBook(await fs.readFile(htmlFile, 'utf8')).sections.length
    const cold = await typeset('cold.pdf')
    assert.equal(cold.laid, sections)
    assert.equal(cold.cached, 0)
    // nothing changed: nothing is laid out, and the book is the same
    const warm = await typeset('warm.pdf')
    assert.equal(warm.laid, 0)
    assert.equal(warm.cached, sections)
    assert.equal(warm.pages, cold.pages)
    assert.deepEqual(warm.folios, cold.folios)
    // a topic gets longer by pages: it is the only section laid out again, and the pages after it are renumbered
    const text = await fs.readFile(htmlFile, 'utf8')
    await fs.writeFile(htmlFile, text.replace('<h1 class="topic-title">T</h1>', `<h1 class="topic-title">T</h1>\n${'<p>More words to fill a few lines of this paragraph, and then some more, and then some more still.</p>\n'.repeat(60)}`))
    const longer = await typeset('longer.pdf')
    assert.equal(longer.laid, 1)
    assert.equal(longer.cached, sections - 1)
    assert.ok(longer.pages > cold.pages + 2, `${longer.pages} pages, from ${cold.pages}`)
    // and the book is what a cold layout of the same HTML makes
    const fresh = await renderPdf({ htmlFile, pdfFile: path.join(b.dist, 'fresh.pdf'), cacheDir: path.join(b.dist, '..', 'other-cache') })
    assert.equal(fresh.laid, sections)
    assert.deepEqual(fresh.folios, longer.folios)
    assert.equal(fresh.pages, longer.pages)
    // an entry that was half written is no entry
    const entries = path.join(cacheDir, 'book')
    const [environment] = await fs.readdir(entries)
    const [entry] = await fs.readdir(path.join(entries, environment))
    await fs.writeFile(path.join(entries, environment, entry), '{"pages":')
    assert.equal((await typeset('mended.pdf')).laid, 1)
  })

  test('lays a claim out again whole when Paged.js breaks it badly, so no term is left alone or a line stranded', { skip: !findChrome() && 'no Chrome to typeset with', timeout: 300000 }, async () => {
    // claims of one or two descriptions and from one to a few lines, each after a different amount of text, so that
    // each reaches the foot of a page in every way it can (every topic starts a page of its own)
    const words = (n, seed) => Array.from({ length: n }, (_, i) => ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma'][(i + seed) % 6]).join(' ')
    const files = {}
    const names = []
    ;[[10], [20], [30], [45], [15, 15], [25, 10], [10, 25], [40, 12]].forEach((descriptions, shape) => {
      for (let filler = 0; filler < 30; filler++) {
        const name = `Claim ${shape} ${filler}`
        names.push(name)
        files[`topic/${name}.md`] = topic(`${'Some text to fill the page.\n\n'.repeat(filler)}Term\n${descriptions.map((n, i) => `: ${words(n, i)}`).join('\n')}\n`)
      }
    })
    const b = await build({ ...files, 'About.md': topic('Hello.'), 'book.json': manifest([{ title: 'Grace', topics: names }]) }, { book: true, args: ['build', '--book-html'] })
    assert.equal(b.code, 0, b.output)
    const { pages, held, tall } = await renderPdf({ htmlFile: path.join(b.dist, 'book', 'book.html'), pdfFile: path.join(b.dist, 'book', 'book.pdf') })
    assert.ok(pages > 240)
    // Paged.js breaks some of these badly (about 5 in 240), so some are held, and none is left (a section is laid
    // out up to five times, and none of these would still break badly then)
    assert.ok(held > 0, `${held} claims held`)
    assert.equal(tall, 0)
  })

  test('a "See also" list breaks only with its heading and the first item, and at least two items on the next page', { skip: !findChrome() && 'no Chrome to typeset with', timeout: 180000 }, async () => {
    // topics with a "See also" of one to four items, each after a different amount of text, so that the list
    // reaches the foot of a page in every way it can (every topic starts a page of its own)
    const files = { 'topic/Mercy.md': topic('Mercy.') }
    const names = []
    for (const items of [1, 2, 3, 4]) {
      for (let filler = 0; filler < 22; filler++) {
        const name = `Fill ${items} ${filler}`
        names.push(name)
        files[`topic/${name}.md`] = topic(`${'Some text to fill the page.\n\n'.repeat(filler)}## See also\n\n${'- [[Mercy]]\n'.repeat(items)}`)
      }
    }
    const b = await build({ ...files, 'About.md': topic('Hello.'), 'book.json': manifest([{ title: 'Grace', topics: ['Mercy', ...names] }]) }, { book: true, args: ['build', '--book-html'] })
    assert.equal(b.code, 0, b.output)
    const { puppeteer, polyfill, chrome } = await load()
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--allow-file-access-from-files'] })
    try {
      const page = await browser.newPage()
      await page.evaluateOnNewDocument(() => { window.PagedConfig = { auto: false } })
      await page.goto(pathToFileURL(path.join(b.dist, 'book', 'book.html')).href, { waitUntil: 'networkidle0' })
      await page.addScriptTag({ path: polyfill })
      const lists = await page.evaluate(async () => {
        await document.fonts.ready
        await window.PagedPolyfill.preview()
        const pages = [...document.querySelectorAll('.pagedjs_page')]
        const at = (el) => pages.findIndex((p) => p.contains(el))
        // Paged.js splits a list across pages by cloning it, so take the items in document order: a See also
        // heading's are the list items up to the next heading
        const lists = []
        for (const el of document.querySelectorAll('h2, .topic-title, li')) {
          if (/--see-also$/.test(el.id)) lists.push({ id: el.id, heading: at(el), items: [] })
          else if (el.tagName === 'LI' && lists.length > 0 && !lists.at(-1).done && el.closest('ul:not([class])')) lists.at(-1).items.push(at(el))
          else if (lists.length > 0) lists.at(-1).done = true
        }
        return lists
      })
      assert.equal(lists.length, names.length)
      for (const { id, heading, items } of lists) {
        const [first] = items
        assert.equal(first, heading, `${id}: the heading is alone on its page`)
        if (items.length > 1) assert.equal(items.at(-1), items.at(-2), `${id}: the last item is alone on its page`)
      }
    } finally {
      await browser.close()
    }
  })

  test('typesets a PDF with Paged.js in headless Chrome, and prints the cover beside it', { skip: noCover, timeout: 120000 }, async () => {
    const b = await build({ ...vault, 'About.md': topic('Hello.'), 'book.json': manifest([{ title: 'Grace', topics: ['Grace', 'Mercy'] }]) }, { book: true })
    assert.equal(b.code, 0, b.output)
    assert.match(b.output, /Book: \d+ pages typeset in .*book\.pdf; page 1 is sheet 9/)
    const pdf = await fs.readFile(path.join(b.dist, 'book', 'book.pdf'))
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    assert.match(b.output, /Book: the covers are in .*cover\.pdf and .*cover-dark\.pdf/)
    for (const name of ['cover', 'cover-dark']) {
      assert.equal((await fs.readFile(path.join(b.dist, 'book', `${name}.pdf`))).subarray(0, 5).toString(), '%PDF-')
      assert.equal(await b.exists(`/book/${name}.html`), false)
    }
    // only the PDFs are published: the layouts they were made from are not
    assert.equal(await b.exists('/book/book.html'), false)
  })
})
