// /index/scripture lists the referenced books; /index/scripture/{book} lists
// each unique reference with the pages and sections it appears in.
import { escHtml } from '../html/escape.js'
import { info } from '../log.js'
import { chapterId, entryId } from '../bible/collect.js'

export async function writeScriptureIndex ({ output, renderLayout }) {
  // ── Scripture Index ────────────────────────────────────────────────────────
  info(
    `Scripture collector: ${output.refs.length} ref(s) from ${output.pageCount()} page(s).`
  )

  // Group refs by book, then by canonical ref key (for deduplication).
  // refsByBook: Map<bookIndex, { bookSlug, bookName, entryMap }>
  // entryMap:   Map<entryKey, { chapterNum, verseStart, rangeVal, endVerse,
  //                             displayShort, occMap }>
  // occMap:     Map<occKey, { pageUrl, pageTitle, sectionId, sectionTitle }>
  const refsByBook = new Map()
  for (const ref of output.refs) {
    let bookData = refsByBook.get(ref.bookIndex)
    if (!bookData) {
      bookData = {
        bookSlug: ref.bookSlug,
        bookName: ref.bookName,
        bookCwms: ref.bookCwms,
        entryMap: new Map()
      }
      refsByBook.set(ref.bookIndex, bookData)
    }
    const entryKey = `${ref.chapterNum}|${ref.verseStart ?? ''}|${ref.rangeVal ?? ''}|${ref.endVerse ?? ''}|${ref.endChapter ?? ''}`
    let entry = bookData.entryMap.get(entryKey)
    if (!entry) {
      entry = {
        chapterNum: ref.chapterNum,
        verseStart: ref.verseStart,
        rangeVal: ref.rangeVal,
        endVerse: ref.endVerse,
        displayShort: ref.displayShort,
        occMap: new Map()
      }
      bookData.entryMap.set(entryKey, entry)
    }
    // Collapse multiple occurrences of the same ref on the same page+section
    const occKey = `${ref.pageUrl}|${ref.sectionId ?? ''}`
    if (!entry.occMap.has(occKey)) {
      entry.occMap.set(occKey, {
        pageUrl: ref.pageUrl,
        pageTitle: ref.pageTitle,
        sectionId: ref.sectionId,
        sectionTitle: ref.sectionTitle
      })
    }
  }

  // Referenced books in canonical (Genesis → Revelation) order
  const referencedBooks = [...refsByBook.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, bookData]) => bookData)

  // Root page: /index/scripture — lists all referenced books
  {
    const listHtml =
      referencedBooks.length === 0
        ? '<p>No Scripture references found.</p>'
        : '<ul>\n' +
          referencedBooks
            .map(
              (b) =>
                `  <li><a href="/index/scripture/${b.bookSlug}">${b.bookName}</a></li>`
            )
            .join('\n') +
          '\n</ul>'
    const rootHtml = renderLayout(listHtml, {
      url: '/index/scripture',
      nsLabel: 'Index page',
      frontmatter: { title: 'Scripture index', permalink: 'scripture' }
    })
    await output.emit('/index/scripture', rootHtml)
    info('Built (index): /index/scripture')
  }

  // Per-book pages: /index/scripture/{book-slug}
  for (const [i, book] of referencedBooks.entries()) {
    // Back and forward between the books that have a page, top and bottom.
    const prev = referencedBooks[i - 1]
    const next = referencedBooks[i + 1]
    const bookNav = [
      prev && `<a href="/index/scripture/${prev.bookSlug}">&laquo; ${prev.bookName}</a>`,
      next && `<a href="/index/scripture/${next.bookSlug}">${next.bookName} &raquo;</a>`
    ].filter(Boolean).join(' &middot; ')
    const entries = [...book.entryMap.values()]
    // Sort canonically: chapter → verse (chapter-only before verse) → range
    entries.sort((a, b) => {
      if (a.chapterNum !== b.chapterNum) return a.chapterNum - b.chapterNum
      const vsA = a.verseStart ?? -1
      const vsB = b.verseStart ?? -1
      if (vsA !== vsB) return vsA - vsB
      const rvA = a.rangeVal !== undefined ? parseInt(a.rangeVal) : -1
      const rvB = b.rangeVal !== undefined ? parseInt(b.rangeVal) : -1
      if (rvA !== rvB) return rvA - rvB
      const evA = a.endVerse !== undefined ? parseInt(a.endVerse) : -1
      const evB = b.endVerse !== undefined ? parseInt(b.endVerse) : -1
      return evA - evB
    })

    let listHtml = '<dl>\n'
    let chapter = 0
    for (const entry of entries) {
      // The first entry starting in a chapter carries the chapter's anchor.
      const chapterAnchor =
        entry.chapterNum === chapter ? '' : `<span id="${chapterId(entry.chapterNum)}"></span>`
      chapter = entry.chapterNum
      const innerItems = [...entry.occMap.values()]
        .map((occ) => {
          const href = occ.sectionId
            ? `${occ.pageUrl}#${occ.sectionId}`
            : occ.pageUrl
          const label =
            occ.sectionId && occ.sectionTitle
              ? `<span class="page-title">${escHtml(occ.pageTitle)}</span><span aria-hidden="true">&nbsp;&rsaquo;</span> <span class="section-title">${escHtml(occ.sectionTitle)}</span>`
              : `<span class="page-title">${escHtml(occ.pageTitle)}</span>`
          return `<li><a href="${href}">${label}</a></li>`
        })
        .join('\n')
      listHtml += `<dt class="scripture-reference" id="${entryId(entry.displayShort)}">${chapterAnchor}${book.bookCwms} ${entry.displayShort}</dt>\n<dd>\n<ul>\n${innerItems}\n</ul>\n</dd>\n`
    }
    listHtml += '</dl>'

    // Jump to a chapter that has an entry, at the top (leaving out the first chapter, which is
    // right there) and at the bottom (leaving out the last). A book of one chapter needs none.
    const chapters = [...new Set(entries.map((entry) => entry.chapterNum))]
    const jump = (list) =>
      chapters.length > 1
        ? `<div class="namespace-menu" role="group" aria-label="Jump to chapter"><ul><li class="label">Jump to chapter:</li>${list.map((n) => `<li><a href="#${chapterId(n)}">${n}</a></li>`).join('')}</ul></div>\n`
        : ''
    const bookNavHtml = bookNav ? `<nav class="book-nav" aria-label="Books"><p>${bookNav}</p></nav>\n` : ''
    listHtml = bookNavHtml + jump(chapters.slice(1)) + listHtml + '\n' + jump(chapters.slice(0, -1)) + bookNavHtml

    const bookHtml = renderLayout(listHtml, {
      url: `/index/scripture/${book.bookSlug}`,
      nsLabel: 'Index page',
      frontmatter: {
        title: `Scripture index: ${book.bookName}`,
        permalink: book.bookSlug
      }
    })
    await output.emit(`/index/scripture/${book.bookSlug}`, bookHtml)
    info(`Built (index): /index/scripture/${book.bookSlug}`)
  }
}
