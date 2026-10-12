// /statistics: counts, records and a map of how much of the Bible the site cites.
// The numbers come from computeStatistics (lib/stats.js); this file only lays
// them out.
import { escHtml } from '../html/escape.js'
import { info } from '../log.js'
import { NAMESPACES } from '../model.js'
import { TOTAL_CHAPTERS, TOTAL_VERSES } from '../bible/versification.js'

// Numbers are formatted by hand: toLocaleString is slow, and this page formats thousands.
const grouped = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const num = (n) => grouped(String(Math.round(n)))
const dec = (n, places = 1) => {
  const [whole, fraction] = n.toFixed(places).split('.')
  return fraction === undefined ? grouped(whole) : `${grouped(whole)}.${fraction}`
}
// A whole-number percentage, for a label; a share that rounds to nothing says so.
const pctLabel = (part, whole) => {
  const share = whole ? (part / whole) * 100 : 0
  return share > 0 && share < 0.5 ? '&lt;1%' : `${Math.round(share)}%`
}
const pct = (part, whole) => (whole ? `${dec((part / whole) * 100)}%` : '0%')
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`
const kb = (bytes) => `${dec(bytes / 1024)} KB`

const link = (item) => `<a href="${escHtml(item.url)}">${escHtml(item.title)}</a>`

// The theme colors in hue order, with pink (hue 5, the wrap-around) last. Books and letters take them in turn.
const HUES = ['red', 'orange', 'yellow', 'puke', 'green', 'teal', 'slate', 'blue', 'indigo', 'violet', 'magenta', 'pink']

// The tiles take the theme colors in turn across the whole page, each row picking up where
// the last left off. Reset when the page starts so the output is the same every build.
let tileCount = 0

// A tile's icon classes. "name" is a Sharp Solid icon; "kit:name" is one of the kit's own
// custom icons, which carry fa-kit instead of the style classes. Extra classes can follow
// ("tags fa-rotate-90").
const iconClasses = (spec) => {
  const [first, ...extra] = spec.split(' ')
  const custom = first.startsWith('kit:')
  const name = custom ? first.slice('kit:'.length) : first
  return [custom ? 'fa-kit' : 'fa-sharp fa-solid', `fa-${name}`, ...extra].join(' ')
}

// A row of big-number tiles. [label, value, icon] triples (see iconClasses); a tile whose
// icon isn't chosen yet has none.
const facts = (pairs) =>
  `<dl class="facts">\n${pairs
    .map(([label, value, icon]) => {
      const hue = HUES[tileCount++ % HUES.length]
      const mark = icon ? `<span class="${iconClasses(icon)}" aria-hidden="true"></span>` : ''
      return `  <div style="--tile: var(--color-${hue})"><dt>${label}</dt><dd>${value}</dd>${mark}</div>`
    })
    .join('\n')}\n</dl>`

// "x / y" for a tile: the whole is set small, beside the big number.
const outOf = (part, whole) => `${part}<span class="of"> / ${whole}</span>`

// The mark on a figure that is one of the references "in content".
const asterisk = '<span class="asterisk">*</span>'

// An explainer paragraph, set as fine print: one with no figures of its own.
const note = (html) => `<p class="note">${html}</p>`

// An ordered ranking: [html, count] pairs. Rows with the same count share a place ("1, 2, 2, 4"):
// an <li> gets a `value` wherever its place isn't the number the browser would count to by itself.
const ranking = (rows, unit = '') => {
  let place = 0
  let counted = 1 // what the browser shows next
  return `<ol class="ranking">\n${rows
    .map(([html, count], i) => {
      if (i === 0 || count !== rows[i - 1][1]) place = i + 1
      const value = place === counted ? '' : ` value="${place}"`
      counted = place + 1
      return `  <li${value}>${html} <span class="count">${count}${unit}</span></li>`
    })
    .join('\n')}\n</ol>`
}

// A letter's hue follows its place in the alphabet; anything else (a digit, "#") keeps the primary.
const letterHue = (letter) => (/^[A-Z]$/.test(letter) ? HUES[(letter.charCodeAt(0) - 65) % HUES.length] : '')

const bar = (fraction, hue = '') =>
  `<span class="bar${hue && ` hue-${hue}`}" style="--p:${dec(Math.min(Math.max(fraction, 0), 1) * 100)}%" aria-hidden="true"></span>`

// A pie whose slice is `fraction` of the circle, in a hue.
const pie = (fraction, hue) =>
  `<span class="pie" style="--p:${dec(Math.min(Math.max(fraction, 0), 1) * 100)}%; --heat: var(--color-${hue})" aria-hidden="true"></span>`

// A table under an h3 of its own (the page's tables mark off sections, so they get headings
// rather than captions); the table is labelled by it.
const table = (title, head, rows) => {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  // A column of numbers (a dash stands for none, an asterisk may mark one) is right-aligned, header and all.
  const isNumber = (cell) => /^\*?\s*(?:[\d,.]+%?|–)\s*\*?$/.test(cell.replace(/<[^>]*>/g, '').trim())
  const numeric = head.map((_, i) => rows.every((cells) => isNumber(String(cells[i]))))
  const attrs = (i) => (numeric[i] ? ' class="num"' : '')
  // A table that ends in a column of text (not figures) gives that column the room: the others
  // shrink to fit their content.
  const textLast = !numeric.at(-1)
  return `<h3 id="${id}">${title}</h3>
<div class="table-scroll"><table aria-labelledby="${id}"${textLast ? ' class="text-last"' : ''}>
<thead><tr>${head.map((h, i) => `<th scope="col"${attrs(i)}>${h}</th>`).join('')}</tr></thead>
<tbody>
${rows.map((cells) => `<tr>${cells.map((c, i) => `<td${attrs(i)}>${c}</td>`).join('')}</tr>`).join('\n')}
</tbody>
</table></div>`
}

const section = (id, title, body) =>
  `<section id="${id}">\n<h2>${title}</h2>\n${body}\n</section>`

// Page titles listed in full, trimmed to `limit` with a count of the rest.
const titleList = (items, limit) => {
  // An item with a count shows it after the title, as the word cloud does.
  const shown = items.slice(0, limit).map((item) => link(item) + (item.count === undefined ? '' : `&nbsp;<span class="count">${num(item.count)}</span>`)).join('&nbsp;· ')
  const rest = items.length - limit
  return rest > 0 ? `${shown}&nbsp;· and ${num(rest)} more` : shown
}

// An h3 and its titles, or nothing at all when there are none.
const titleSection = (heading, items) =>
  items.length ? `<h3>${heading}</h3>\n<p class="titles">${titleList(items, 40)}</p>` : ''

// A namespace's name, linked to its alphabetical index.
const namespaceLink = (ns) => `<a href="/index/alphabetical/${ns}">${NAMESPACES[ns]}</a>`

// A word or phrase, linked to a search for it.
const searchLink = (text) => `<a href="/search?q=${encodeURIComponent(text)}">${escHtml(text)}</a>`

// A table's rows by namespace: one per namespace that has pages, its name and the cells `cells` gives it.
const namespaceRows = (site, cells) =>
  Object.keys(NAMESPACES)
    .filter((ns) => site.namespaces[ns])
    .map((ns) => [namespaceLink(ns), ...cells(site.namespaces[ns], ns)])

// ─── Sections ───

function overviewSection (stats) {
  const { site, words, scripture, categories } = stats
  return section(
    'overview',
    'Overview',
    [
      facts([
        ['Total Scripture references', num(scripture.everything), 'book-bible'],
        ['Total words', num(words.total), 'keyboard'],
        ['Pages', num(site.published + site.notes), 'book'],
        ['Links', num(stats.links.pairs), 'link'],
        ['Categories', num(categories.listed), 'tags fa-rotate-90']
      ]),
      '<p>I’ve been working on <strong>Tota Scriptura</strong> in its current form since 2009. The aim is completeness, citing not merely enough Scriptures to be convincing, but making a conscious effort toward exhaustiveness, citing every Scripture that bears on a given topic.</p>',
      `<p><em>Tota Scriptura</em> means “all Scripture” or “the totality of Scripture”, so I’m also intentional about citing a greater percentage of God’s Word. As of now I’m citing <strong>${pctLabel(scripture.all.versesCited, TOTAL_VERSES)}</strong> of all verses in the Bible. This is the single most important statistic on this page and the one I’m most passionate about improving.</p>`
    ].join('\n')
  )
}

function scriptureSection (stats) {
  const { scripture } = stats
  const wholeBible = scripture.all
  // One testament: its books and references in words, its chapters and verses cited as pies.
  const testament = (label, part, hues) => {
    const pieFigure = (what, cited, total, hue) => `<figure>
${pie(cited / total, hue)}
<figcaption><span class="number" style="color: var(--color-${hue})">${num(cited)}<span class="of"> / ${num(total)}</span></span><br>${what} cited<br>${pct(cited, total)}</figcaption>
</figure>`
    return `<div class="testament" role="group" aria-label="${label}">
<p class="name"><strong>${label}</strong><br><small>${part.booksCited} of ${part.books} books cited &middot; ${num(part.refs)} references</small></p>
${pieFigure('Chapters', part.chaptersCited, part.chapters, hues[0])}
${pieFigure('Verses', part.versesCited, part.verses, hues[1])}
</div>`
  }
  const testaments = `<h3 id="testament-by-testament">Testament by testament</h3>
<div class="testaments">
${testament('Old Testament', scripture.ot, HUES.slice(0, 2))}
${testament('New Testament', scripture.nt, HUES.slice(2, 4))}
</div>`

  const bookHue = new Map(scripture.books.map((b, i) => [b.name, HUES[i % HUES.length]]))

  // A dot's shade is the share of its chapter's verses that are cited, so a short chapter
  // can reach the top shade: none, up to 25%, up to 50%, up to 75%, over 75%. A chapter that is
  // only mentioned as a whole ("John 3") cites no verses but is lifted to the first shade, and
  // no number of such mentions can lift it further.
  const shadeLevel = (cited, total, mentions) => {
    const share = cited / total
    return cited === 0 ? (mentions > 0 ? 1 : 0) : share <= 0.25 ? 1 : share <= 0.5 ? 2 : share <= 0.75 ? 3 : 4
  }
  // One row per book, in canonical order (the Old Testament's, then the New's).
  const heatmap = scripture.books
    .map((b) => {
      const cited = b.refs > 0
      const name = cited ? `<a href="/index/scripture/${b.slug}">${escHtml(b.name)}</a>` : escHtml(b.name)
      // A cited dot links to its chapter in the Scripture index. Its 900 or so links are kept out of
      // the tab order (the book's name leads to the same page).
      const dots = b.chapterVersesCited
        .map((cited, i) => {
          const shade = `c${shadeLevel(cited, b.chapterVerses[i], b.chapterCounts[i])}`
          const title = `${escHtml(b.name)} ${i + 1}: ${cited} / ${b.chapterVerses[i]} ${b.chapterVerses[i] === 1 ? 'verse' : 'verses'} cited (${Math.round((100 * cited) / b.chapterVerses[i])}%)`
          return b.chapterCounts[i] > 0
            ? `<a class="${shade}" href="${b.chapterHrefs[i]}" title="${title}" tabindex="-1"></a>`
            : `<i class="${shade}" title="${title}"></i>`
        })
        .join('')
      // The chapters, then the verses, as percentages; the fractions are in a tooltip (a title,
      // like the abbreviations').
      const figures = cited
        ? `<span title="${b.chaptersCited} / ${b.chapters} ${b.chapters === 1 ? 'chapter' : 'chapters'}">chapters ${pctLabel(b.chaptersCited, b.chapters)}</span> &middot; <span title="${num(b.versesCited)} / ${num(b.verses)} ${b.verses === 1 ? 'verse' : 'verses'}">verses ${pctLabel(b.versesCited, b.verses)}</span>`
        : 'Not cited'
      // The numbers go with the name, on the left; the dots have the right side to themselves.
      return `<div class="book hue-${bookHue.get(b.name)}"><span class="info"><span class="name${cited ? '' : ' uncited'}">${name}${
        cited ? ` <span class="count">${num(b.refs)} ${b.refs === 1 ? 'citation' : 'citations'}</span>` : ''
      }</span><span class="figures">${figures}</span></span><span class="chapters">${dots}</span></div>`
    })
    .join('\n')

  const rankedBooks = ranking(
    scripture.topBooks.map((b) => [`<a href="/index/scripture/${b.slug}">${escHtml(b.name)}</a>`, `${num(b.refs)} references`])
  )

  const records = []
  if (scripture.longestVerseRange) {
    records.push(
      // A count after a reference ("Romans 3, 71 verses") would be read as a verse,
      // so each record puts the number first.
      `The longest passage cited, at ${plural(scripture.longestVerseRange.span, 'verse')}, is <a href="${scripture.longestVerseRange.href}">${escHtml(scripture.longestVerseRange.label)}</a>.`
    )
  }
  if (scripture.longestChapterRange && scripture.longestChapterRange.span > 1) {
    records.push(
      `The citation that spans the most chapters, ${plural(scripture.longestChapterRange.span, 'chapter')}, is <a href="${scripture.longestChapterRange.href}">${escHtml(scripture.longestChapterRange.label)}</a>.`
    )
  }
  if (scripture.longestGap.verses > 0) {
    records.push(
      `The longest stretch with no citations is ${plural(scripture.longestGap.verses, 'verse')}, from !${escHtml(scripture.longestGap.from)} to !${escHtml(scripture.longestGap.to)}.`
    )
  }
  records.push(
    scripture.neverCitedBooks.length
      ? `${plural(scripture.neverCitedBooks.length, 'book is', 'books are')} never cited: ${scripture.neverCitedBooks.map(escHtml).join(', ')}.`
      : 'Every book of the Bible is cited at least once.'
  )
  records.push(
    `${plural(scripture.versesCitedMoreThanOnce, 'verse is', 'verses are')} cited more than once.`
  )

  return section(
    'scripture',
    'Scripture',
    [
      facts([
        [`Verses cited in main content &middot; ${pctLabel(wholeBible.versesCited, TOTAL_VERSES)}`, outOf(num(wholeBible.versesCited), num(TOTAL_VERSES)), 'kit:book-paragraph-chart-pie-simple'],
        [`Chapters cited &middot; ${pctLabel(wholeBible.chaptersCited, TOTAL_CHAPTERS)}`, outOf(num(wholeBible.chaptersCited), num(TOTAL_CHAPTERS)), 'kit:book-section-chart-pie-simple'],
        [`Books cited &middot; ${pctLabel(wholeBible.booksCited, wholeBible.books)}`, outOf(wholeBible.booksCited, wholeBible.books), 'kit:books-chart-pie-simple'],
        ['References', num(scripture.total), 'book-bible'],
        ['Unique references', num(scripture.unique), 'fingerprint']
      ]),
      note('Verses in long ranges don’t count in these statistics. If they did it would be trivial to cheese these stats with a single reference to !Ge 1:1–!Rev 22:21.'),
      table(
        'Scripture references by namespace',
        ['Namespace', 'Content pages', 'Notes pages'],
        Object.keys(NAMESPACES).map((ns) => {
          const row = scripture.byNamespace[ns] ?? { refs: 0, inNotes: 0 }
          // The pages the figures after the table count: topic and commentary
          // pages. Meta and category pages are in the Scripture index but not in those
          // figures, and reference pages aren't in the index.
          const inContent = ns !== 'reference' && ns !== 'category' && ns !== 'meta'
          return [namespaceLink(ns), `${num(row.refs)}${inContent ? asterisk : ''}`, num(row.inNotes)]
        })
      ),
      note(`${asterisk} Topic and commentary pages count as “main content”.`),
      '<h3 id="book-by-book">Book by book</h3>',
      '<p>Each dot is a chapter. The more saturated the dot, the greater the percentage of that chapter’s verses are cited in main content. Hover over chapter and verse percentages to see the math.</p>',
      '<p class="legend" aria-hidden="true">Percentage of a chapter’s verses cited in main content:<br /><i class="c0"></i> none <i class="c1"></i> 0–25% <i class="c2"></i> 25–50% <i class="c3"></i> 50–75% <i class="c4"></i> 75–100%</p>',
      `<div class="heatmap" role="group" aria-label="Chapters of the Bible shaded by the share of its verses cited, with each book's share of verses and chapters cited and its references.">\n${heatmap}\n</div>`,
      testaments,
      '<h3>Records</h3>',
      `<ul class="records">\n${records.map((r) => `  <li>${r}</li>`).join('\n')}\n</ul>`,
      '<h3>Most cited books</h3>',
      rankedBooks,
      '<h3>Most cited chapters</h3>',
      ranking(scripture.topChapters.map((r) => [`<a href="${r.href}">${escHtml(r.label)}</a>`, `${num(r.count)} citations`])),
      '<h3>Most cited verses</h3>',
      ranking(scripture.topVerses.map((r) => [`<a href="${r.href}">${escHtml(r.label)}</a>`, `${num(r.count)} citations`])),
      '<h3>Pages that cite the most</h3>',
      ranking(scripture.topPages.map((p) => [link(p), `${num(p.refs)} references`])),
      '<h3>Across the most books</h3>',
      ranking(scripture.broadestPages.map((p) => [link(p), `${p.books} books`])),
      '<h3>Most references for their length</h3>',
      ranking(scripture.densest.map((p) => [link(p), `${dec(p.per1000)} per 1,000 words`])),
      '<h3>Translations</h3>',
      `<p class="cloud">${scripture.translations
        .map(([t, n]) => `${escHtml(t)}&nbsp;<span class="count">${num(n)}</span>`)
        .join('&nbsp;· ')}</p>`
    ].join('\n')
  )
}

function wordsSection (stats) {
  const { site, words, titles } = stats
  return section(
    'words',
    'Words',
    [
      facts([
        ['Total words', num(words.total), 'keyboard'],
        [`Words in notes &middot; ${pctLabel(words.notesTotal, words.total)}`, num(words.notesTotal), 'chart-pie-simple'],
        ['Median page word count', num(words.median), 'percent'],
        ['Hours to read at 250 words per minute', dec(words.readingHours), 'kit:book-open-lines-clock'],
        ['Unique words', num(words.vocabulary), 'fingerprint']
      ]),
      table(
        'Words by namespace',
        ['Namespace', 'Content pages', 'Notes pages'],
        namespaceRows(site, (ns) => [num(ns.words), num(ns.notesWords)])
      ),
      `<p>Printed at 500 words per page, the site would be about ${num(words.total / 500)} pages long.</p>`,
      '<h3>Longest pages</h3>',
      ranking(words.longest.map((p) => [link(p), `${num(p.words)} words`])),
      '<h3>Shortest pages</h3>',
      ranking(words.shortest.map((p) => [link(p), `${num(p.words)} words`])),
      table(
        'Page length distribution',
        ['Words', 'Pages', 'Notes pages'],
        words.buckets.map((b) => [b.label, num(b.content), num(b.notes)])
      ),
      '<h3>Most used words</h3>',
      `<p class="cloud">${words.topWords
        .map(([word, n]) => `${searchLink(word)}&nbsp;<span class="count">${num(n)}</span>`)
        .join('&nbsp;· ')}</p>`,
      note('Common short words, Bible book names, abbreviations, and translation names excluded.'),
      `<p>Of the divine names, LORD appears ${num(words.divine.LORD)} times, GOD ${num(words.divine.GOD)}, YHWH ${num(words.divine.YHWH)} and I AM ${num(words.divine['I AM'])}. The site asks ${num(words.fun.questions)} questions and has ${num(words.fun.exclamations)} exclamation marks, and it quotes ${num(words.fun.greek)} Greek words and ${num(words.fun.hebrew)} Hebrew ones.</p>`,
      '<h3>Title lengths</h3>',
      `<p>The average title is ${dec(titles.averageLength)} characters. The longest: ${titles.longest
        .map((p) => `${link(p)}&nbsp;<span class="count">${p.title.length}</span>`)
        .join('; ')}. The shortest: ${titles.shortest
        .map((p) => `${link(p)}&nbsp;<span class="count">${p.title.length}</span>`)
        .join('; ')}.</p>`
    ].join('\n')
  )
}

function pagesSection (stats) {
  const { site, structure, weight, titles } = stats
  const letters = Object.entries(titles.letters).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const tallest = Math.max(1, ...letters.map(([, n]) => n))
  const structureRows = [
    ['Headings', 'headings'],
    ['Images', 'figures'],
    ['Tables', 'tables'],
    ['Footnotes', 'footnotes'],
    ['Blockquotes', 'blockquotes'],
    ['Callouts', 'callouts']
  ].map(([label, key]) => [
    label,
    num(structure[key].total),
    structure[key].most ? `${link(structure[key].most)}&nbsp;<span class="count">${num(structure[key].most[key])}</span>` : '–'
  ])
  return section(
    'pages',
    'Pages',
    [
      facts([
        ['Content pages', num(site.published), 'book'],
        ['Notes pages', num(site.notes), 'notebook'],
        ['Working drafts', num(site.drafts), 'pencil'],
        ['Featured pages', num(site.featured + site.featuredWith), 'star'],
        ['Images', num(site.imagesInVault), 'images']
      ]),
      table(
        'Pages by namespace',
        ['Namespace', 'Content pages', 'Notes pages'],
        namespaceRows(site, (ns) => [num(ns.pages), num(ns.withNotes)])
      ),
      `<h3>Page titles by first letter</h3>
      <ol class="letters" style="--rows:${Math.ceil(letters.length / 2)}" aria-label="Topic titles by first letter">
      ${letters
        .map(
          ([letter, n]) =>
            `  <li><span class="letter">${escHtml(letter)}</span>${bar(n / tallest, letterHue(letter))}<span class="count">${n}</span></li>`
        )
        .join('\n')}
      </ol>`,
      table('Structures across all pages', ['', 'Total', 'Most on one page'], structureRows),
      '<h3>Page weight</h3>',
      `<p>The ${num(weight.pages)} pages weigh ${dec(weight.totalBytes / 1048576)} MB of HTML together, ${kb(weight.averageBytes)} each on average. The heaviest: ${weight.heaviest
        .map((p) => `${link(p)}&nbsp;<span class="count">${kb(p.bytes)}</span>`)
        .join('; ')}.</p>`
    ].join('\n')
  )
}

function linksSection (stats) {
  const { site, links } = stats
  return section(
    'links',
    'Links',
    [
      facts([
        ['Links between pages', num(links.pairs), 'link'],
        ['Broken links', num(links.broken), 'link-broken'],
        ['Average links to each page', dec(links.averageInbound), 'percent'],
        ['Pages with no incoming links', num(links.orphans.length), 'kit:link-slash-circle-arrow-left'],
        ['Pages with no outgoing links', num(links.linkNowhere), 'kit:link-slash-circle-arrow-right']
      ]),
      note('Links count once per pair of pages, regardless of how many times one page links to another.'),
      table(
        'Links by namespace',
        ['Namespace', 'Content out', 'Notes out', 'Content in', 'Notes in'],
        namespaceRows(site, (_row, ns) => {
          const { out, in: into } = links.byNamespace[ns] ?? { out: {}, in: {} }
          return [out.content, out.notes, into.content, into.notes].map((n) => num(n ?? 0))
        })
      ),
      '<h3>Most linked to</h3>',
      ranking(links.mostLinkedTo.map((p) => [link(p), `${p.count} in`])),
      '<h3>Linking out the most</h3>',
      ranking(links.mostLinking.map((p) => [link(p), `${p.count} out`])),
      titleSection('Pages nothing links to', links.orphans),
      titleSection('Broken links', links.brokenTargets)
    ].join('\n')
  )
}

function categoriesSection (stats) {
  const { categories } = stats
  return section(
    'categories',
    'Categories',
    [
      facts([
        ['Category pages', num(categories.listed), 'kit:tags'],
        ['Levels deep', num(categories.deepest), 'sitemap'],
        ['Average pages per category', dec(categories.averageMembers), 'percent'],
        ['Pages in multiple categories', num(categories.inSeveral), 'kit:tags-circle-plus'],
        ['Uncategorized pages', num(categories.uncategorized.length), 'kit:tags-slash']
      ]),
      '<h3>Largest categories</h3>',
      ranking(categories.largest.map((c) => [link(c), `${c.members} pages`])),
      '<h3>Most categories on one page</h3>',
      ranking(categories.mostCategories.map((p) => [link(p), `${p.count} categories`])),
      titleSection('Uncategorized pages', categories.uncategorized)
    ].join('\n')
  )
}

// ─── The page ───

// The footnote at the foot of the page, marked up the way markdown-it-footnote renders one
// (lib/markdown.js), so it takes the site's footnote styles: the content commit and the
// generator version the figures came from, each linked to GitHub. A local build has no commit
// to link.
const footnoteMark = '<sup class="footnote-ref"><a role="doc-noteref" href="#fn1" id="fnref1">[1]</a></sup>'

function footnote (stats) {
  const commit = /^[0-9a-f]{7,}$/.test(stats.commit)
    ? `<a href="https://github.com/joeyday/totascriptura.org/commit/${stats.commit}"><code>${stats.commit}</code></a>`
    : escHtml(stats.commit)
  const version = `<a href="https://github.com/joeyday/tota-scriptura-static-site-generator/releases/tag/v${escHtml(stats.version)}">${escHtml(stats.version)}</a>`
  return `<hr class="footnotes-sep">
<section role="doc-endnotes" aria-label="Footnotes" class="footnotes">
<ol class="footnotes-list">
<li id="fn1" class="footnote-item"><p>These statistics are accurate as of commit ${commit}, built with static site generator version ${version}. <a role="doc-backlink" aria-label="Back to footnote 1" href="#fnref1" class="footnote-backref">\u21a9\ufe0e</a></p>
</li>
</ol>
</section>`
}

export async function writeStatistics ({ output, renderLayout, stats }) {
  tileCount = 0
  // The hero, as a content page's opening image renders; its alt text comes from the vault's alt-text.json.
  const hero = '<figure><img src="/asset/Trees-and-buildings.png" width="300" height="137"></figure>\n'
  const intro = `${hero}<p>Statistics about <strong>Tota Scriptura</strong> are tracked automagically by the static site generator.${footnoteMark}</p>
<div class="namespace-menu" role="group" aria-label="Jump to a section">${[
    [['scripture', 'Scripture'], ['words', 'Words']],
    [['pages', 'Pages'], ['links', 'Links'], ['categories', 'Categories']]
  ]
    .map(
      (row, i) =>
        `\n<ul>${i === 0 ? '<li class="label">Jump to:</li>' : ''}${row
          .map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`)
          .join('')}</ul>`
    )
    .join('')}\n</div>`

  const body = [
    intro,
    overviewSection(stats),
    scriptureSection(stats),
    wordsSection(stats),
    pagesSection(stats),
    linksSection(stats),
    categoriesSection(stats),
    footnote(stats)
  ].join('\n')

  const html = renderLayout(body, {
    url: '/statistics',
    nsLabel: 'Meta page',
    stylesheet: 'statistics.css',
    kit: 'ecf9c95079',
    frontmatter: { title: 'Statistics', permalink: 'statistics' }
  })
  await output.emit('/statistics', html)
  info('Built (statistics): /statistics')
}
