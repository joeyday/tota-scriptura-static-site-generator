import { BIBLE_BOOKS, TRANSLATIONS, bookInfoByCwms } from './bible/refs.js'
import { OT_BOOK_COUNT, VERSES_PER_CHAPTER } from './bible/versification.js'
import { sortableTitle } from './titles.js'
import { bookIndexUrl, chapterId, entryId } from './bible/collect.js'

// ─── Statistics ───
// Everything the /statistics page shows, computed from structures the build has
// already made: the page records, the link and category maps, the collected
// Scripture references, and a few counts taken while each page was rendered.
// Nothing here reads a file or walks the corpus again. Output must be the same
// for the same content, so no clocks and no timings.

// ─── Counted while a page renders ───

// One pass over a page's rendered body for the structures worth counting.
const STRUCTURE_RE = /<(h2|h3|table|blockquote|figure)[\s>]|class="(footnote-item|callout)"/g

export function measureHtml (html) {
  const counts = { headings: 0, tables: 0, blockquotes: 0, figures: 0, footnotes: 0, callouts: 0 }
  STRUCTURE_RE.lastIndex = 0
  let hit
  while ((hit = STRUCTURE_RE.exec(html)) !== null) {
    switch (hit[1] ?? hit[2]) {
      case 'h2':
      case 'h3':
        counts.headings++
        break
      case 'table':
        counts.tables++
        break
      case 'blockquote':
        counts.blockquotes++
        break
      case 'figure':
        counts.figures++
        break
      case 'footnote-item':
        counts.footnotes++
        break
      case 'callout':
        counts.callouts++
        break
    }
  }
  return counts
}

// Words in text whose whitespace is already single spaces (the search body).
export function countWords (text) {
  if (!text) return 0
  let words = 1
  for (let i = text.indexOf(' '); i !== -1; i = text.indexOf(' ', i + 1)) words++
  return words
}

// ─── Small helpers ───

const sum = (list, pick = (x) => x) => list.reduce((n, x) => n + pick(x), 0)
// The n largest by `pick`, largest first; ties keep their order in the list (with keepTies,
// everything tied with the nth stays too).
// One pass that keeps a short sorted list, not a sort of the whole thing.
function topBy (list, pick, n, keepTies = false) {
  const best = [] // { item, value }, descending
  for (const item of list) {
    const value = pick(item)
    if (best.length >= n && (keepTies ? value < best[n - 1].value : value <= best[n - 1].value)) continue
    let i = best.length
    while (i > 0 && best[i - 1].value < value) i--
    best.splice(i, 0, { item, value })
    // Past n, drop what is left of the list (or, keeping ties, whatever ranks below the nth).
    if (best.length > n) {
      const nth = best[n - 1].value
      best.length = keepTies ? best.findLastIndex((b) => b.value >= nth) + 1 : n
    }
  }
  return best.map((b) => b.item)
}
const bottomBy = (list, pick, n) =>
  [...list].sort((a, b) => pick(a) - pick(b)).slice(0, n)
const median = (nums) => {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Words too common to be worth ranking.
const STOP_WORDS = new Set(
  (
    'a about after all also an and any are as at be because been but by can could did do does for from had has have he ' +
    'her him his how i if in into is it its me more most my no not of on one only or other our out she so some such ' +
    'than that the their them then there these they this those through to up us was we were what when which who ' +
    'cf vs ch ff pp etc eg ie viz also see however thus yet very much many may must shall should still ' +
    'will with would you your s t d re ve ll m'
  ).split(' ')
)

// ─── Scripture ───

// The longest passage, in verses, that counts as citing its verses (Joey, 2026-10-08).
const MAX_CITED_RANGE = 15

const bookInfo = []
for (const info of bookInfoByCwms.values()) bookInfo[info.bookIndex] = info
// Bible vocabulary isn't what the site writes about, it is how the site cites, so it stays
// out of the word ranking: the books' names and abbreviations, and the translations. A
// numbered book ("1 Co", "1 John") is counted as the word it leaves, so its number goes
// too; a name of several words ("Song of Solomon") is left alone, its words are words.
for (const names of BIBLE_BOOKS) {
  for (const name of names) {
    const word = name.toLowerCase().replace(/^\d+\s*/, '')
    if (/^[a-z]+$/.test(word)) STOP_WORDS.add(word)
  }
}
for (const translation of TRANSLATIONS) STOP_WORDS.add(translation.toLowerCase())
// What the linker doesn't know but the site cites by: the Septuagint and the testaments.
for (const abbreviation of ['lxx', 'ot', 'nt']) STOP_WORDS.add(abbreviation)
// The author's name and "UTC", from the signatures on talk and notes pages (Joey, 2026-10-09).
STOP_WORDS.add('joey')
STOP_WORDS.add('utc')

const verseLabel = (book, chapter, verse) =>
  `${bookInfo[book].bookName} ${chapter}:${verse}`

// References per namespace of the page they are on (a notes page counts with its page's
// namespace): { ns: { refs, inNotes } }. `refs` are the index's; `otherRefs` are those on
// the pages the index leaves out, which are in notes (a notes page) or on the reference
// and category pages themselves.
function referencesByNamespace (refs, otherRefs, pagesByUrl) {
  const rows = {}
  const add = (ns, key) => ((rows[ns] ??= { refs: 0, inNotes: 0 })[key]++)
  for (const ref of refs) add(pagesByUrl.get(ref.pageUrl)?.ns ?? 'meta', 'refs')
  for (const ref of otherRefs) {
    const page = pagesByUrl.get(ref.pageUrl)
    add(page?.ns ?? 'meta', page?.isNote ? 'inNotes' : 'refs')
  }
  return rows
}

function scriptureStats (refs, pagesByUrl) {
  // A verse is cited when a citation names it, alone or in a range of at most
  // MAX_CITED_RANGE verses. A chapter is cited when any citation touches it:
  // "Romans 5" and "Romans 5:1" both cite the chapter, but only the second cites
  // a verse.
  const explicit = VERSES_PER_CHAPTER.map((chapters) => chapters.map((n) => new Uint32Array(n)))
  const touched = VERSES_PER_CHAPTER.map((chapters) => new Uint32Array(chapters.length))
  // Where the Scripture index has something to link to: the chapters a citation starts in, and
  // the verses cited on their own.
  const starts = VERSES_PER_CHAPTER.map((chapters) => new Uint8Array(chapters.length))
  const singleVerses = new Set() // "book|chapter|verse"
  const refsByBook = new Array(BIBLE_BOOKS.length).fill(0)
  const uniqueRefs = new Set()
  const translations = new Map()
  let longestVerseRange = null
  let longestChapterRange = null

  const perPage = new Map() // url → { refs, books:Set }
  for (const ref of refs) {
    const book = ref.bookIndex
    refsByBook[book]++
    uniqueRefs.add(`${book}|${ref.displayShort}`)
    translations.set(ref.translation, (translations.get(ref.translation) ?? 0) + 1)
    let page = perPage.get(ref.pageUrl)
    if (!page) perPage.set(ref.pageUrl, (page = { refs: 0, books: new Set() }))
    page.refs++
    page.books.add(book)

    const chapters = VERSES_PER_CHAPTER[book]
    const chapter = ref.chapterNum
    const { verseStart, rangeVal, endChapter } = ref
    // Impossible references fail the build, so only a page shown by serve
    // --show-hidden can reach here with one; it is left out of the figures.
    if (chapter < 1 || chapter > chapters.length) {
      continue
    }
    starts[book][chapter - 1] = 1
    if (verseStart !== undefined && rangeVal === undefined) singleVerses.add(`${book}|${chapter}|${verseStart}`)

    if (verseStart === undefined) {
      // A whole chapter, or a run of them.
      const last = endChapter ? parseInt(endChapter) : chapter
      if (last < chapter || last > chapters.length) {
        continue
      }
      for (let c = chapter; c <= last; c++) touched[book][c - 1]++
      const span = last - chapter + 1
      if (!longestChapterRange || span > longestChapterRange.span) {
        longestChapterRange = { span, label: `${bookInfo[book].bookName} ${ref.displayShort}`, href: bookIndexUrl(bookInfo[book].bookSlug, entryId(ref.displayShort)) }
      }
      continue
    }

    // Verses: a single verse, a run in one chapter, or a run across chapters.
    const startVerse = verseStart
    const crossChapter = ref.endVerse !== undefined
    const lastChapter = crossChapter ? parseInt(rangeVal) : chapter
    const lastVerse = crossChapter ? parseInt(ref.endVerse) : rangeVal ? parseInt(rangeVal) : startVerse
    if (
      startVerse < 1 ||
      startVerse > chapters[chapter - 1] ||
      lastChapter < chapter ||
      lastChapter > chapters.length ||
      lastVerse < 1 ||
      lastVerse > chapters[lastChapter - 1] ||
      (lastChapter === chapter && lastVerse < startVerse)
    ) {
      continue
    }
    let span = 0
    for (let c = chapter; c <= lastChapter; c++) {
      span += (c === lastChapter ? lastVerse : chapters[c - 1]) - (c === chapter ? startVerse : 1) + 1
    }
    // A passage longer than MAX_CITED_RANGE cites its chapters but not its verses:
    // an outline that cites whole sections would otherwise cite most of a book.
    const citesVerses = span <= MAX_CITED_RANGE
    for (let c = chapter; c <= lastChapter; c++) {
      if (citesVerses) {
        const from = c === chapter ? startVerse : 1
        const to = c === lastChapter ? lastVerse : chapters[c - 1]
        for (let v = from; v <= to; v++) explicit[book][c - 1][v - 1]++
      }
      touched[book][c - 1]++
    }
    if (!longestVerseRange || span > longestVerseRange.span) {
      longestVerseRange = { span, label: `${bookInfo[book].bookName} ${ref.displayShort}`, href: bookIndexUrl(bookInfo[book].bookSlug, entryId(ref.displayShort)) }
    }
  }

  // Coverage per book, and the verse-by-verse walk through the canon.
  const books = []
  const topVerses = [] // the ten most cited verses so far, and any tied with the tenth: { b, c, v, count }
  let versesCitedMoreThanOnce = 0
  let run = 0 // current stretch of verses nobody cites
  let runStart = null
  let longestGap = { verses: 0, from: null, to: null }
  let lastUncited = null
  for (let b = 0; b < VERSES_PER_CHAPTER.length; b++) {
    const chapters = VERSES_PER_CHAPTER[b]
    let chaptersCited = 0
    let versesCited = 0
    const chapterVersesCited = [] // verses cited in each chapter, for the heatmap
    for (let c = 0; c < chapters.length; c++) {
      if (touched[b][c] > 0) chaptersCited++
      let inChapter = 0
      for (let v = 0; v < chapters[c]; v++) {
        const cited = explicit[b][c][v]
        if (cited > 0) {
          versesCited++
          inChapter++
          if (cited > 1) versesCitedMoreThanOnce++
          if (topVerses.length < 10 || cited >= topVerses[9].count) {
            let i = topVerses.length
            while (i > 0 && topVerses[i - 1].count < cited) i--
            topVerses.splice(i, 0, { b, c, v, count: cited })
            // Every verse tied for 10th place stays.
            while (topVerses.length > 10 && topVerses[topVerses.length - 1].count < topVerses[9].count) topVerses.pop()
          }
          if (run > longestGap.verses) {
            longestGap = { verses: run, from: runStart, to: lastUncited }
          }
          run = 0
        } else {
          if (run === 0) runStart = [b, c + 1, v + 1]
          lastUncited = [b, c + 1, v + 1]
          run++
        }
      }
      chapterVersesCited.push(inChapter)
    }
    // A chapter's link: the nearest chapter at or before it that a citation starts in (a
    // chapter cited only inside "Romans 1–4" has no entry of its own).
    let anchor = 0
    const chapterHrefs = chapters.map((_, c) => {
      if (starts[b][c]) anchor = c + 1
      return anchor ? bookIndexUrl(bookInfo[b].bookSlug, chapterId(anchor)) : null
    })
    books.push({
      name: bookInfo[b].bookName,
      slug: bookInfo[b].bookSlug,
      testament: b < OT_BOOK_COUNT ? 'Old' : 'New',
      refs: refsByBook[b],
      chapters: chapters.length,
      chaptersCited,
      verses: sum(chapters),
      versesCited,
      chapterCounts: Array.from(touched[b]),
      chapterHrefs,
      chapterVersesCited,
      chapterVerses: chapters
    })
  }
  if (run > longestGap.verses) longestGap = { verses: run, from: runStart, to: lastUncited }
  const labelOf = ([b, c, v]) => verseLabel(b, c, v)

  const part = (list) => ({
    books: list.length,
    booksCited: list.filter((x) => x.refs > 0).length,
    refs: sum(list, (x) => x.refs),
    chapters: sum(list, (x) => x.chapters),
    chaptersCited: sum(list, (x) => x.chaptersCited),
    verses: sum(list, (x) => x.verses),
    versesCited: sum(list, (x) => x.versesCited)
  })
  const ot = part(books.slice(0, OT_BOOK_COUNT))
  const nt = part(books.slice(OT_BOOK_COUNT))
  const all = part(books)

  const chapterRows = []
  for (const book of books) {
    book.chapterCounts.forEach((count, i) => {
      if (count > 0) chapterRows.push({ label: `${book.name} ${i + 1}`, count, href: book.chapterHrefs[i] })
    })
  }

  const pagesCiting = [...perPage.entries()].map(([url, p]) => ({
    url,
    title: pagesByUrl.get(url)?.title ?? url,
    refs: p.refs,
    books: p.books.size,
    words: pagesByUrl.get(url)?.words ?? 0
  }))
  const dense = pagesCiting
    .filter((p) => p.words >= 300)
    .map((p) => ({ ...p, per1000: (p.refs / p.words) * 1000 }))

  return {
    total: refs.length,
    unique: uniqueRefs.size,
    translations: [...translations.entries()].sort((a, b) => b[1] - a[1]),
    all,
    ot,
    nt,
    books,
    neverCitedBooks: books.filter((b) => b.refs === 0).map((b) => b.name),
    topBooks: topBy(books.filter((b) => b.refs > 0), (b) => b.refs, 10),
    topChapters: topBy(chapterRows, (r) => r.count, 10, true),
    topVerses: topVerses.map((r) => ({
      label: verseLabel(r.b, r.c + 1, r.v + 1),
      count: r.count,
      // The verse's own entry, or its chapter's when it is cited only inside ranges.
      href: singleVerses.has(`${r.b}|${r.c + 1}|${r.v + 1}`)
        ? bookIndexUrl(bookInfo[r.b].bookSlug, entryId(`${r.c + 1}:${r.v + 1}`))
        : books[r.b].chapterHrefs[r.c]
    })),
    versesCitedMoreThanOnce,
    longestVerseRange,
    longestChapterRange,
    longestGap: longestGap.verses
      ? { verses: longestGap.verses, from: labelOf(longestGap.from), to: labelOf(longestGap.to) }
      : longestGap,
    topPages: topBy(pagesCiting, (p) => p.refs, 10),
    broadestPages: topBy(pagesCiting, (p) => p.books, 5),
    densest: topBy(dense, (p) => p.per1000, 5)
  }
}

// ─── Everything ───

// pages:   one entry per rendered page, from the build loop (hidden pages are never
//          rendered; unlisted ones are marked and left out of every figure):
//          { title, url, ns, isNote, listed, words, bytes, ...measureHtml }
// bodies:  the search documents ({ url, body }) of the listed pages
// refs:    the collected Scripture references (content pages; the Scripture index's)
// otherRefs: the references on notes, reference and category pages, which only the site's total and
//          the table by namespace count
export function computeStatistics ({
  pages,
  bodies,
  filesToProcess,
  refs,
  otherRefs,
  backlinksMap,
  membersMap,
  alphabeticalByNs,
  notesByPage,
  imageMap,
  version,
  commit
}) {
  const pagesByUrl = new Map(pages.map((p) => [p.url, p]))
  const listed = pages.filter((p) => p.listed)
  const listedUrls = new Set(listed.map((p) => p.url))
  const content = listed.filter((p) => !p.isNote)
  const notes = listed.filter((p) => p.isNote)
  const nsOf = (record) => record.nsDir || 'meta'

  // ── The site ──
  // The site as visitors find it: hidden pages and unlisted pages are not counted
  // anywhere on the statistics page.
  const live = filesToProcess.filter((f) => !f.hidden && !f.unlisted)
  const namespaces = {}
  for (const f of live) {
    const row = (namespaces[nsOf(f)] ??= { pages: 0, notes: 0, words: 0, notesWords: 0 })
    if (f.isNote) row.notes++
    else row.pages++
  }
  for (const p of listed) {
    const row = namespaces[p.ns]
    if (!row) continue
    if (p.isNote) row.notesWords += p.words
    else row.words += p.words
  }
  const withNotes = (ns) =>
    live.filter((f) => !f.isNote && nsOf(f) === ns && listedUrls.has(notesByPage[f.finalUrlPath])).length
  for (const [ns, row] of Object.entries(namespaces)) row.withNotes = withNotes(ns)

  const site = {
    published: live.filter((f) => !f.isNote).length,
    notes: live.filter((f) => f.isNote).length,
    drafts: live.filter((f) => f.draft).length,
    featured: live.filter((f) => f.featured).length,
    featuredWith: live.filter((f) => f.featuredWith).length,
    imagesInVault: Object.keys(imageMap).filter((k) => k.startsWith('image/')).length,
    namespaces
  }

  // ── Words ──
  const wordsOf = (list) => list.map((p) => p.words)
  const totalWords = sum(listed, (p) => p.words)
  const buckets = [
    ['Under 100', 0, 100],
    ['100–499', 100, 500],
    ['500–999', 500, 1000],
    ['1,000–1,999', 1000, 2000],
    ['2,000 or more', 2000, Infinity]
  ].map(([label, lo, hi]) => ({
    label,
    content: content.filter((p) => p.words >= lo && p.words < hi).length,
    notes: notes.filter((p) => p.words >= lo && p.words < hi).length
  }))
  const frequency = new Map()
  const divine = { LORD: 0, GOD: 0, YHWH: 0, 'I AM': 0 }
  const fun = { questions: 0, exclamations: 0, greek: 0, hebrew: 0 }
  for (const { body } of bodies) {
    fun.questions += body.match(/\?/g)?.length ?? 0
    fun.exclamations += body.match(/!/g)?.length ?? 0
    fun.greek += body.match(/[\u0370-\u03FF\u1F00-\u1FFF]+/g)?.length ?? 0
    fun.hebrew += body.match(/[\u0590-\u05FF]+/g)?.length ?? 0
    for (const token of body.toLowerCase().match(/[a-z]+/g) ?? []) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1)
    }
    for (const name of body.match(/\b(?:LORD|GOD|YHWH|I AM)\b/g) ?? []) divine[name]++
  }
  const rankedWords = [...frequency.entries()]
    .filter(([word]) => !STOP_WORDS.has(word) && word.length > 1)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const words = {
    total: totalWords,
    mean: listed.length ? Math.round(totalWords / listed.length) : 0,
    median: Math.round(median(wordsOf(listed))),
    contentTotal: sum(content, (p) => p.words),
    notesTotal: sum(notes, (p) => p.words),
    readingHours: totalWords / 250 / 60,
    longest: topBy(listed, (p) => p.words, 5),
    longestContent: topBy(content, (p) => p.words, 5),
    shortest: bottomBy(content.filter((p) => p.words > 0), (p) => p.words, 5),
    buckets,
    vocabulary: frequency.size,
    topWords: rankedWords.slice(0, 32),
    divine,
    fun
  }

  // ── Titles ──
  const titled = content
  const letters = {}
  for (const item of alphabeticalByNs.topic ?? []) {
    if (item.redirect) continue
    const letter = sortableTitle(item.title).trim()[0]?.toUpperCase() ?? '#'
    letters[letter] = (letters[letter] ?? 0) + 1
  }
  const titles = {
    longest: topBy(titled, (p) => p.title.length, 3),
    shortest: bottomBy(titled, (p) => p.title.length, 3),
    averageLength: titled.length ? sum(titled, (p) => p.title.length) / titled.length : 0,
    letters
  }

  // ── Links ──
  const inbound = new Map() // url → distinct pages linking to it
  const outbound = new Map() // url → distinct pages it links to
  let linkPairs = 0
  let fromNotes = 0
  for (const [target, sources] of Object.entries(backlinksMap)) {
    if (!listedUrls.has(target)) continue
    const from = sources.filter((s) => listedUrls.has(s.url))
    inbound.set(target, from.length)
    for (const s of from) {
      linkPairs++
      outbound.set(s.url, (outbound.get(s.url) ?? 0) + 1)
      if (pagesByUrl.get(s.url)?.isNote) fromNotes++
    }
  }
  const linkable = content.filter((p) => p.ns !== 'category')
  const withInbound = (p) => inbound.get(p.url) ?? 0
  const withOutbound = (p) => outbound.get(p.url) ?? 0
  const links = {
    pairs: linkPairs,
    fromNotes,
    mostLinkedTo: topBy(linkable, withInbound, 10).map((p) => ({ ...p, count: withInbound(p) })),
    mostLinking: topBy(listed, withOutbound, 10).map((p) => ({ ...p, count: withOutbound(p) })),
    orphans: linkable.filter((p) => withInbound(p) === 0),
    linkNowhere: linkable.filter((p) => withOutbound(p) === 0).length,
    linkable: linkable.length,
    averageInbound: linkable.length ? sum(linkable, withInbound) / linkable.length : 0
  }

  // ── Categories ──
  const categoryRecords = live.filter((f) => f.isCategory)
  const categoryUrls = new Set(categoryRecords.map((f) => f.finalUrlPath))
  const depthMemo = new Map()
  const depthOf = (url, trail = new Set()) => {
    if (depthMemo.has(url)) return depthMemo.get(url)
    if (trail.has(url)) return 1
    trail.add(url)
    let deepest = 0
    for (const m of membersMap[url] ?? []) {
      if (categoryUrls.has(m.url)) deepest = Math.max(deepest, depthOf(m.url, trail))
    }
    trail.delete(url)
    depthMemo.set(url, deepest + 1)
    return deepest + 1
  }
  const sized = categoryRecords.map((f) => ({ title: f.title, url: f.finalUrlPath, members: (membersMap[f.finalUrlPath] ?? []).length }))
  const categorizable = content.filter((p) => p.ns !== 'category' && p.ns !== 'meta')
  const byUrl = new Map(live.map((f) => [f.finalUrlPath, f]))
  const categoryCount = (p) => byUrl.get(p.url)?.categories.length ?? 0
  const categories = {
    listed: sized.length,
    largest: topBy(sized, (c) => c.members, 5),
    smallest: bottomBy(sized.filter((c) => c.members > 0), (c) => c.members, 3),
    averageMembers: sized.length ? sum(sized, (c) => c.members) / sized.length : 0,
    deepest: sized.length ? Math.max(...sized.map((c) => depthOf(c.url))) : 0,
    uncategorized: categorizable.filter((p) => categoryCount(p) === 0),
    inSeveral: categorizable.filter((p) => categoryCount(p) > 1).length,
    mostCategories: topBy(categorizable, categoryCount, 3).map((p) => ({ ...p, count: categoryCount(p) }))
  }

  // ── Structure and weight ──
  const structure = {}
  for (const key of ['headings', 'tables', 'blockquotes', 'figures', 'footnotes', 'callouts']) {
    structure[key] = {
      total: sum(listed, (p) => p[key]),
      most: topBy(listed, (p) => p[key], 1).filter((p) => p[key] > 0)[0] ?? null
    }
  }
  const weight = {
    pages: listed.length,
    totalBytes: sum(listed, (p) => p.bytes),
    averageBytes: listed.length ? sum(listed, (p) => p.bytes) / listed.length : 0,
    heaviest: topBy(listed, (p) => p.bytes, 3)
  }

  const byNamespace = referencesByNamespace(refs, otherRefs, pagesByUrl)

  return {
    version,
    commit,
    site,
    words,
    titles,
    links,
    categories,
    structure,
    weight,
    scripture: {
      // The cited figures count the references in the topic and commentary pages:
      // the Meta and category pages are in the Scripture index but not in these.
      ...scriptureStats(
        refs.filter((ref) => {
          const ns = pagesByUrl.get(ref.pageUrl)?.ns
          return ns !== 'meta' && ns !== 'category'
        }),
        pagesByUrl
      ),
      byNamespace,
      everything: refs.length + otherRefs.length // the figure at the top of the page
    }
  }
}
