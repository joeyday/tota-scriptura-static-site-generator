import { BuildError } from '../errors.js'
import { escHtml } from '../html/escape.js'
import { groupRefsByBook } from '../pages/scripture.js'
import { scriptureStats } from '../stats.js'
import { compareTitles } from '../titles.js'
import { markRefs } from './scripture.js'

// ─── The book, as one HTML document ───
// A topic's page is already built (every text pass has run on it), so the book takes each
// page's <article> and turns the web into print: links go (a Bible reference or any web address
// becomes its text; a link to a topic that is in the book becomes a cross-reference with a page
// number, which book.css fills in), footnotes become the topic's endnotes, and what
// only works on screen (the header, the categories line, icons) is dropped. The page numbers are
// the typesetter's job (Paged.js), not ours.

const TITLE = 'Tota Scriptura'
const SUBTITLE = ['A Systematic-Theological', 'Concordance of the Holy Bible'] // as the 2020 title page breaks it
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const AUTHOR = 'Joey Day'
const DEDICATION = 'For my children'

// "000" stands in for a page number until the book is laid out; lib/book/folios.js fills in the real one.
const PAGE = '000'

// "/topic/trinity" → "topic-trinity": the id a topic's <section> has, and what a cross-reference points at.
export const topicId = (url) => url.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '')

// The content of one page's <article>, ready to sit inside the book's <section>.
//   slug      prefixes every id, so two topics' "oneness" headings don't collide
//   inBook    url → id, for the topics that are in the book
//   assets    where the book's HTML finds /asset/ ("../asset/")
//   refs      when given, each Bible reference is marked and collected here (see scripture.js)
//   commentary  a commentary page: its terms run into their definitions as paragraphs, which may split
//   outside   when given, each link that is left pointing out of the book is added here, as "Text (/url)"
export function printArticle (page, { slug, inBook, assets = '../asset/', refs = null, outside = null, commentary = false }) {
  const open = /<article\b[^>]*>/.exec(page)
  let a = page.slice(open.index + open[0].length, page.indexOf('</article>'))

  // What only the screen uses
  a = a.replace(/<header>[\s\S]*?<\/header>/, '')
  a = a.replace(/<p class="categories">[\s\S]*?<\/p>/, '')
  a = a.replace(/<span class="[^"]*\bfa-[^"]*"[^>]*><\/span>/g, '')
  // The commentary's screen furniture: the outline, the Scripture index entries between its paragraphs, and their switch
  a = a.replace(/<script>[\s\S]*?<\/script>\s*/g, '')
  a = a.replace(/<nav class="toc"[\s\S]*?<\/nav>\s*/, '')
  a = a.replace(/<dl class="scripture-entries">[\s\S]*?<\/dl>\s*/g, '')
  a = a.replace(/<p class="scripture-toggle">[\s\S]*?<\/p>\s*/, '')

  // Footnotes become endnotes of the topic, numbered from 1 in the order they are first cited.
  // (As in the printed 2020 book: not Paged.js footnotes, which sit at the foot of each page.)
  const notes = {}
  for (const m of a.matchAll(/<li id="(fn\d+)" class="footnote-item">([\s\S]*?)<\/li>/g)) {
    notes[m[1]] = m[2]
      .replace(/<a role="doc-backlink"[^>]*>[\s\S]*?<\/a>/g, '')
      .replace(/<\/p>\s*<p>/g, ' ')
      .replace(/<\/?p>/g, '')
      .trim()
  }
  a = a.replace(/<hr class="footnotes-sep">\s*<section role="doc-endnotes"[\s\S]*?<\/section>/, '')
  const cited = []
  a = a.replace(/<sup class="footnote-ref"><a [^>]*href="#(fn\d+)"[^>]*>\[[\d:]+\]<\/a><\/sup>/g, (_, id) => {
    if (!cited.includes(id)) cited.push(id)
    return `<sup class="fnref">${cited.indexOf(id) + 1}</sup>`
  })
  if (cited.length > 0) {
    a += `\n<section class="notes">\n<ol class="notes-list">\n${cited.map((id, i) => `<li><span class="nn">${i + 1}</span>${notes[id] ?? ''}</li>`).join('\n')}\n</ol></section>`
  }

  // An "External links" section is left out entirely: the book prints no web addresses or pages elsewhere
  a = a.replace(/<h2 id="external-links">[\s\S]*?<\/h2>\s*<ul>[\s\S]*?<\/ul>\s*/, '')

  // "See also" keeps only the topics that are in the book
  a = a.replace(/<h2 id="see-also">[\s\S]*?<\/h2>\s*<ul>([\s\S]*?)<\/ul>/, (all, items) => {
    const kept = [...items.matchAll(/<li>([\s\S]*?)<\/li>/g)].filter((m) => {
      const href = /href="([^"#?]*)/.exec(m[1])
      return href && inBook[href[1].replace(/\/$/, '')]
    })
    return kept.length === 0 ? '' : `<h2 id="see-also">See also</h2>\n<ul>${kept.map((m) => `<li>${m[1]}</li>`).join('\n')}</ul>`
  })

  // A "Main topic" line names only topics that are in the book (a name with no page, or a link to a
  // topic outside the book, is dropped); with none left, the whole line goes
  a = a.replace(/<dd>\s*<div class="main-topic">\s*<p>Main topics?: ([\s\S]*?)<\/p>\s*<\/div>\s*<\/dd>\n?/g, (all, names) => {
    const kept = [...names.matchAll(/<a\b[^>]*href="([^"#?]*)[^>]*>[\s\S]*?<\/a>/g)].filter((m) => inBook[m[1].replace(/\/$/, '')])
    if (kept.length === 0) return ''
    return `<dd>\n<div class="main-topic">\n<p>Main topic${kept.length > 1 ? 's' : ''}: ${kept.map((m) => m[0]).join(', ')}</p>\n</div>\n</dd>\n`
  })

  // An inline "— see also Eternal" that points only at topics outside the book goes too, and the italic
  // run it leaves empty with it (one that has Bible references stays, with its links unwrapped)
  a = a.replace(/\s*— see also ((?:<a\b[^>]*href="\/[^"]*"[^>]*>[^<]*<\/a>(?:[;,] )?)+)(?=<\/small>)/g, (all, links) => {
    const targets = [...links.matchAll(/href="([^"#?]*)/g)].map((m) => m[1].replace(/\/$/, ''))
    return targets.some((url) => inBook[url]) ? all : ''
  })
  a = a.replace(/\s*<em><small><\/small><\/em>/g, '')

  // A closing "See Slavery." whose topics are all outside the book goes the same way
  a = a.replace(/\s*See ((?:<a\b[^>]*href="\/[^"]*"[^>]*>[^<]*<\/a>(?:, | and |, and )?)+)\.(?=\s*<\/dd>)/g, (all, links) => {
    const targets = [...links.matchAll(/href="([^"#?]*)/g)].map((m) => m[1].replace(/\/$/, ''))
    return targets.some((url) => inBook[url]) ? all : ''
  })

  // Bible references are marked for the Scripture index before their links go (ids are prefixed below)
  if (refs) a = markRefs(a, slug, refs)

  // Links
  a = a.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (all, attrs, inner) => {
    const href = /href="([^"]*)"/.exec(attrs)?.[1] ?? ''
    const id = href.startsWith('/') ? inBook[href.replace(/[#?].*$/, '').replace(/\/$/, '')] : null
    if (!id && href.startsWith('/')) outside?.push(`"${inner.replace(/<[^>]+>/g, '')}" (${href}) in ${slug}`)
    return id ? `<a class="xref" href="#${id}" data-p="${PAGE}">${inner}</a>` : inner
  })

  // The "Main topic" line is a definition of its own, and the passages follow it closely, as on the site
  a = a.replace(/<dd>(\s*<div class="main-topic">)/g, '<dd class="main-topic-dd">$1')

  // A term and all its descriptions are one block, so a page never breaks between them (a commentary's
  // are paragraphs, wrapped the same way but free to break)
  // No white space between a term and its descriptions: Paged.js looks for "keep with next" at the first node past
  // the foot of the page, and a text node of white space would be that node
  const tight = (claim) => claim.replace(/(<\/d[td]>)\s+(?=<dd)/g, '$1')
  // Each claim is numbered, so that lib/book/pdf.js can hold the ones the typesetter breaks badly
  let claims = 0
  a = a.replace(/<dl>([\s\S]*?)<\/dl>/g, (all, inner) =>
    `<dl>${inner.split(/(?=<dt[\s>])/).map((chunk) => /^<dt[\s>]/.test(chunk) ? `<div class="${commentary ? 'para' : `claim" data-c="${slug}-${++claims}`}">${tight(chunk.trim())}</div>\n` : chunk).join('')}</dl>`)

  // Ids belong to their topic; images come from the site's asset folder
  a = a.replace(/ id="([^"]+)"/g, (_, id) => ` id="${slug}--${id}"`)
  a = a.replace(/(<img [^>]*?src=")\/asset\//g, `$1${assets}`)
  return a.trim()
}

// ─── The index ───
// Every topic in the book, and every alias of one (the vault's `aliases`: "Communion" for the
// Lord's Supper), with the page its topic starts on. `groups` are headings that gather entries:
// with "Church", "Church discipline" is "discipline" under "Church" (which has a page of its own
// if a topic is called Church). Returns [{ text, id, subs: [{ text, id }] }].
export function buildIndex (parts, groups = []) {
  const entries = []
  const seen = new Set()
  for (const part of parts) {
    for (const page of part.pages) {
      for (const text of [page.title, ...(page.aliases ?? [])]) {
        const key = `${text.toLowerCase()}\n${page.finalUrlPath}`
        if (seen.has(key)) continue
        seen.add(key)
        entries.push({ text, id: topicId(page.finalUrlPath) })
      }
    }
  }

  const heads = new Map() // lowercased heading → its entry
  for (const group of groups) heads.set(group.toLowerCase(), { text: group, id: null, subs: [] })
  const top = []
  for (const entry of entries) {
    const own = heads.get(entry.text.toLowerCase())
    if (own) {
      own.id = entry.id
      continue
    }
    const head = [...heads.values()].find((h) => entry.text.toLowerCase().startsWith(`${h.text.toLowerCase()} `))
    if (head) head.subs.push({ text: entry.text.slice(head.text.length + 1), id: entry.id })
    else top.push({ ...entry, subs: [] })
  }
  const used = [...heads.values()].filter((h) => h.id !== null || h.subs.length > 0)
  const all = [...top, ...used]
  const byText = (x, y) => compareTitles({ title: x.text }, { title: y.text })
  all.sort(byText)
  for (const entry of all) entry.subs.sort(byText)
  return all
}

const topicIndexHtml = (entries) => `<section class="index" id="topic-index"><h1 class="topic-title">Topic index</h1>
${entries.map((entry) => `<p class="ix"><span class="ixt">${escHtml(entry.text)}</span>${entry.id ? `<span class="pgs"><a class="pn" href="#${entry.id}">${PAGE}</a></span>` : ''}</p>${
  entry.subs.map((sub) => `\n<p class="ix ix-sub"><span class="ixt">${escHtml(sub.text)}</span><span class="pgs"><a class="pn" href="#${sub.id}">${PAGE}</a></span></p>`).join('')}`).join('\n')}
</section>
`

// The Scripture index: every reference cited in the topics, in canonical order, each with the pages it is
// on (a page once, however many times it is cited there). The page numbers are placeholders until the book
// is laid out. `refs` is what markRefs collected.
export function scriptureIndexHtml (refs, tally = '') {
  // The pages sit flush right; each after the first carries its own comma, since one repeated on a page is hidden after layout
  const line = (entry) => `<p class="ix"><span class="ixt">${escHtml(entry.displayShort)}</span><span class="pgs">${[...entry.occMap.values()].map((occ, i) => `<span class="pg">${i > 0 ? ', ' : ''}<a class="pn" href="#${occ.pageUrl}">${PAGE}</a></span>`).join('')}</span></p>`
  // A book's heading and its first entry are one block: a column never ends on a heading
  const body = groupRefsByBook(refs).map((book) => {
    const [first, ...rest] = book.entries.map(line)
    return [`<div class="sstart"><h2 class="sbook">${escHtml(book.bookName)}</h2>\n${first}</div>`, ...rest].join('\n')
  }).join('\n')
  return `<section class="scripture-index" id="scripture-index"><h1 class="topic-title">Scripture index</h1>\n<div class="six">\n${body}\n</div>\n${tally}</section>\n`
}

// The closing line of the Scripture index: how much of the Bible the book cites, by the site's own count
// (a verse is cited by a passage of at most fifteen verses, as on the statistics page).
export function citationTally (parts, refs) {
  const pages = parts.flatMap((part) => part.pages)
  const { versesCited, verses } = scriptureStats(refs, new Map()).all
  const what = pages.some((page) => page.relDir === 'commentary') ? 'topics and commentaries' : 'topics'
  const n = (count) => count.toLocaleString('en-US')
  return `<p class="tally">The ${pages.length} ${what} in this edition cite ${n(versesCited)} of the Bible’s ${n(verses)} verses, ${Math.round(100 * versesCited / verses)}% of all Scripture.</p>\n`
}

// parts: [{ title, pages: [fileInfo] }]; articles: the built HTML of each page, by url;
// preface: the built HTML of the page that is the preface (the vault's About page), or null.
export function composeBook ({ parts, articles, preface = null, indexGroups = [], date = new Date(), commit = null, version = null, assets = '../asset/' }) {
  const inBook = {}
  for (const part of parts) for (const page of part.pages) inBook[page.finalUrlPath] = topicId(page.finalUrlPath)

  const stamp = `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
  // Which commit of the vault the book is from, and which tsgen made it: the exact state it came from. The month and
  // year above are what name the edition; the commit comes first so "tsgen 1.0" isn't read as the book's version.
  const built = [commit && `commit ${commit}`, version && `tsgen ${version}`].filter(Boolean).join(' · ')
  // The title and copyright pages are laid out as the printed 2020 book's are: a title and a subtitle
  // in two lines, then a narrow column of small gray type with the title in small caps on top
  const front = `<section class="title-page">
<h1>${TITLE}</h1>
<p class="subtitle">${SUBTITLE.join('<br>')}</p>
<p class="author">${AUTHOR}</p>
</section>
<section class="copyright-page">
<p><span class="cp-title">${TITLE}:<br>${SUBTITLE.join('<br>')}</span><br>Copyright © ${date.getUTCFullYear()} by ${AUTHOR}.<br>All rights reserved.<br>Published by ${AUTHOR}.</p>
<p>${stamp} edition${built ? `<br>${built}` : ''}</p>
<p class="url"><em>totascriptura.org</em></p>
<p>Scripture quotations are from The <abbr>ESV</abbr>® Bible (The Holy Bible, English Standard Version®), copyright © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.</p>
<p>Images throughout this book are from “The Witness” by Thekla, Inc.</p>
<p>This book is set in Source Serif from Adobe and Fira Sans by Erik Spiekermann and Carrois Corporate, with Noto for Greek and Hebrew, all released under the SIL Open Font License.</p>
<p class="personal"><em>For personal use only. Not for sale or distribution.</em></p>
</section>
<section class="dedication"><p>${DEDICATION}</p></section>
`

  // The contents are short, as the 2020 book's were: the preface, each Part and the two indexes, which are
  // how to find any one topic or verse.
  const entry = (id, title) => `<li><a href="#${id}" data-p="${PAGE}">${title}</a></li>`
  const toc = `<nav class="toc"><h1>Table of contents</h1>
<ol>
${preface ? `${entry('preface', 'Preface')}\n` : ''}${parts.map((part, i) => entry(`part-${i + 1}`, `Part ${i + 1}: ${escHtml(part.title)}`)).join('\n')}
${entry('topic-index', 'Topic index')}\n${entry('scripture-index', 'Scripture index')}
</ol></nav>
`

  // A link out of the book is a mistake (the places that point out, like "See also" and "Main topic", are
  // dropped by printArticle before it gets here), so it fails the book
  const outside = []
  const prefaceHtml = preface
    ? `<section class="topic preface" id="preface"><h1 class="topic-title">Preface</h1>\n${printArticle(preface, { slug: 'preface', inBook, assets, outside })}\n</section>\n`
    : ''

  const refs = []
  const body = parts.map((part, i) => `<section class="part" id="part-${i + 1}"><p class="part-number">Part ${i + 1}</p><h1 class="part-title">${escHtml(part.title)}</h1></section>
${part.pages.map((page) => {
    const id = inBook[page.finalUrlPath]
    const isCommentary = page.relDir === 'commentary'
    const article = printArticle(articles[page.finalUrlPath], { slug: id, inBook, assets, refs, outside, commentary: isCommentary })
    return `<section class="topic${isCommentary ? ' commentary' : ''}" id="${id}"><h1 class="topic-title">${escHtml(page.title)}</h1>\n${article}\n</section>`
  }).join('\n')}`).join('\n')

  if (outside.length > 0) {
    throw new BuildError(`The book links to pages that are not in it:\n${outside.join('\n')}`)
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${TITLE}</title>
<link rel="stylesheet" href="${assets}fonts.css">
<link rel="stylesheet" href="${assets}book.css">
</head>
<body>
${front}${toc}${prefaceHtml}${body}
${topicIndexHtml(buildIndex(parts, indexGroups))}${scriptureIndexHtml(refs, citationTally(parts, refs))}</body>
</html>
`
}
