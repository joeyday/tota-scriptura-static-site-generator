// A commentary page named for a Bible book carries that book's Scripture index entries
// between its paragraphs, in canonical order, behind a switch at the foot of the page that
// shows or hides them.
// The commentary is cut into slices at its h2 headings and at each term (or paragraph) that
// opens with a verse reference ("Tit 1:2"); the terms and paragraphs after it, with none of
// their own, belong to the same slice. An entry comes after the slice for its verse and before
// the first slice for a later one. The commentary's own references are left out of the
// entries, since they are right there in the text; other pages' references to the book stay.
//
// The entries need every page's references, so a commentary page is first processed with
// its text alone (that collects its references and writes nothing), and written again once
// all pages have been collected, with the entries in it. The entries are not collected.
import { BuildError } from '../errors.js'
import { chapterId } from '../bible/collect.js'
import { BIBLE_BOOKS, bookInfoByCwms } from '../bible/refs.js'
import { walkHtml } from '../html/walk.js'
import { info } from '../log.js'
import { entryHtml, groupRefsByBook } from './scripture.js'

// The book a commentary page is named for: { names, bookIndex, bookSlug, bookName, ... }. A
// commentary page named for anything else fails the build.
export function commentaryBook (fileInfo) {
  const names = BIBLE_BOOKS.find((book) => book[0] === fileInfo.title)
  if (!names) {
    throw new BuildError(
      `Commentary page "${fileInfo.filePath}" is not named for a Bible book (its title is "${fileInfo.title}"), so it can't carry Scripture index entries.`
    )
  }
  return { names, ...bookInfoByCwms.get(names[names.length - 1]) }
}

const VOID_TAGS = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr'])

// The top-level elements of rendered Markdown, as strings (the text between them, which is
// only line breaks, is dropped).
function splitBlocks (html) {
  const blocks = []
  let depth = 0
  let pos = 0
  let start = 0
  walkHtml(html, new Set(), {
    onText (text) {
      pos += text.length
    },
    onTag (name, full) {
      const before = pos
      pos += full.length
      if (!name || VOID_TAGS.has(name) || full.endsWith('/>')) {
        if (depth === 0) blocks.push(full)
      } else if (full.startsWith('</')) {
        if (--depth === 0) blocks.push(html.slice(start, pos))
      } else if (depth++ === 0) {
        start = before
      }
    }
  })
  return blocks
}

const textOf = (html) => html.replace(/<[^>]*>/g, '')
const compareKeys = (a, b) => a[0] - b[0] || a[1] - b[1]

// The pattern for a reference to this book at the start of a text ("Tit 1:2", "Titus 1:15"),
// capturing its chapter and verse.
function startRefPattern (names) {
  const alternatives = [...names]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replaceAll(' ', '\\s*'))
  return new RegExp(`(?:${alternatives.join('|')})\\s+(\\d+):(\\d+)`)
}

// A <dl> of terms and definitions as groups of one term (or more) and its definitions, each
// a <dl> of its own.
function termGroups (dl) {
  const groups = []
  let group = null
  for (const element of splitBlocks(dl.replace(/^<dl[^>]*>|<\/dl>\s*$/g, ''))) {
    if (element.startsWith('<dt')) {
      if (!group || group.defined) groups.push(group = { term: element, html: '', defined: false })
    } else {
      group.defined = true
    }
    group.html += element + '\n'
  }
  return groups.map(({ term, html }) => ({ term, html: `<dl>\n${html}</dl>` }))
}

// The commentary as slices of [chapter, verse] key and blocks. The key of a heading is the
// reference in its parentheses, "Greeting (Tit 1:1–4)"; of a term or a paragraph, its opening
// reference. A heading with none keeps the key before it. Before the first slice is the
// introduction, at [0, 0].
function sliceCommentary (html, names) {
  const ref = startRefPattern(names)
  const inParens = new RegExp(`\\(${ref.source}`)
  const opening = new RegExp(`^${ref.source}`)
  const slices = [{ key: [0, 0], blocks: [] }]
  const keyOf = (match, fallback) => (match ? [Number(match[1]), Number(match[2])] : fallback)
  for (const block of splitBlocks(html)) {
    const last = slices[slices.length - 1]
    if (/^<h2[\s>]/.test(block)) {
      slices.push({ key: keyOf(inParens.exec(textOf(block)), last.key), blocks: [block] })
      continue
    }
    if (block.startsWith('<dl>')) {
      for (const { term, html } of termGroups(block)) {
        const marker = opening.exec(textOf(term).trim())
        if (marker) slices.push({ key: keyOf(marker), blocks: [html] })
        else slices[slices.length - 1].blocks.push(html)
      }
      continue
    }
    last.blocks.push(block)
  }
  return slices
}

// The switch at the foot of the page. It works without script (see .commentary in style.css);
// the scripts remember the choice, for the whole site, in the browser. The first runs at the
// top of the page, so the entries show from the first paint; the second, after the checkbox,
// sets the checkbox and keeps the page's class in step with it.
const SHOWN_SCRIPT = `<script>
try { if (localStorage.getItem('scripture-entries') === 'shown') document.documentElement.classList.add('show-scripture-entries') } catch (e) {}
</script>`
const TOGGLE_HTML = `<p class="scripture-toggle"><label><input type="checkbox" role="switch" id="show-scripture-index"> Interleave Scripture index entries</label></p>
<script>
(function () {
  var box = document.getElementById('show-scripture-index')
  var root = document.documentElement
  box.checked = root.classList.contains('show-scripture-entries')
  box.addEventListener('change', function () {
    root.classList.toggle('show-scripture-entries', box.checked)
    try { localStorage.setItem('scripture-entries', box.checked ? 'shown' : 'hidden') } catch (e) {}
  })
})()
</script>`

// pages: [{ fileInfo, html, book, layoutLocals, source }], the listed commentary pages: their
// rendered bodies, the books they are named for, and what they were first processed with.
export async function writeCommentaryPages ({ output, renderLayout, pages }) {
  const books = new Map(groupRefsByBook(output.refs).map((book) => [book.bookSlug, book]))
  for (const { fileInfo, html, book: { names, bookSlug, bookName }, layoutLocals, source } of pages) {
    const book = books.get(bookSlug)
    // The Scripture index has a page for every book with a commentary page, which links to it.
    if (!book) {
      throw new BuildError(`Nothing references ${bookName}, not even "${fileInfo.filePath}", so the Scripture index has no page for it to link to.`)
    }

    // The index entries that have a reference from some page other than this one.
    const entries = []
    for (const entry of book.entries) {
      const occurrences = [...entry.occMap.values()].filter((occ) => occ.pageUrl !== fileInfo.finalUrlPath)
      if (occurrences.length > 0) {
        entries.push({ entry, occurrences, key: [entry.chapterNum, entry.verseStart ?? 0] })
      }
    }

    const parts = []
    let next = 0
    let chapter = 0
    const flushBefore = (key) => {
      const start = next
      while (next < entries.length && compareKeys(entries[next].key, key) < 0) next++
      if (next > start) {
        const items = entries.slice(start, next).map((e) => {
          // As on the book's page in the Scripture index: the first entry in a chapter carries its anchor.
          const chapterAnchor = e.entry.chapterNum === chapter ? '' : `<span id="${chapterId(e.entry.chapterNum)}"></span>`
          chapter = e.entry.chapterNum
          return entryHtml(book, e.entry, e.occurrences, chapterAnchor)
        })
        parts.push('<dl class="scripture-entries">\n' + items.join('') + '</dl>')
      }
    }
    for (const slice of sliceCommentary(html, names)) {
      flushBefore(slice.key)
      for (const block of slice.blocks) {
        // The terms of a <dl> that nothing came between are one list again.
        const previous = parts[parts.length - 1]
        if (block.startsWith('<dl>') && previous?.startsWith('<dl>')) {
          parts[parts.length - 1] = previous.slice(0, -'</dl>'.length) + block.slice('<dl>\n'.length)
        } else {
          parts.push(block)
        }
      }
    }
    flushBefore([Infinity, 0])

    // A page with nothing to show has no switch.
    if (entries.length > 0) parts.unshift(SHOWN_SCRIPT)
    const locals = entries.length > 0 ? { ...layoutLocals, footerExtra: TOGGLE_HTML } : layoutLocals
    await output.emit(fileInfo.finalUrlPath, renderLayout(parts.join('\n'), locals), source)
    info(`Built (commentary with Scripture index entries): ${fileInfo.finalUrlPath}`)
  }
}
