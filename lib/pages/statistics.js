// /statistics: counts, records and a map of how much of the Bible the site cites.
// The numbers come from computeStatistics (lib/stats.js); this file only lays
// them out.
import { escHtml } from "../html/escape.js";
import { info } from "../log.js";
import { NAMESPACES } from "../model.js";
import { TOTAL_CHAPTERS, TOTAL_VERSES } from "../bible/versification.js";

// Numbers are formatted by hand: toLocaleString is slow, and this page formats thousands.
const grouped = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const num = (n) => grouped(String(Math.round(n)));
const dec = (n, places = 1) => {
  const [whole, fraction] = n.toFixed(places).split(".");
  return fraction === undefined ? grouped(whole) : `${grouped(whole)}.${fraction}`;
};
const pct = (part, whole) => (whole ? `${dec((part / whole) * 100)}%` : "0%");
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const kb = (bytes) => `${dec(bytes / 1024)} KB`;

const link = (item) => `<a href="${escHtml(item.url)}">${escHtml(item.title)}</a>`;

// A row of big-number tiles. [label, value] pairs.
const facts = (pairs) =>
  `<dl class="facts">\n${pairs
    .map(([label, value]) => `  <div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("\n")}\n</dl>`;

// An ordered ranking: [html, count] pairs.
const ranking = (rows, unit = "") =>
  `<ol class="ranking">\n${rows
    .map(([html, count]) => `  <li>${html} <span class="count">${count}${unit}</span></li>`)
    .join("\n")}\n</ol>`;

const bar = (fraction) =>
  `<span class="bar" style="--p:${dec(Math.min(Math.max(fraction, 0), 1) * 100)}%" aria-hidden="true"></span>`;

const table = (caption, head, rows) =>
  `<div class="table-scroll"><table>\n<caption>${caption}</caption>\n<thead><tr>${head
    .map((h) => `<th scope="col">${h}</th>`)
    .join("")}</tr></thead>\n<tbody>\n${rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("\n")}\n</tbody>\n</table></div>`;

const section = (id, title, body) =>
  `<section id="${id}">\n<h2>${title}</h2>\n${body}\n</section>`;

// Page titles listed in full, trimmed to `limit` with a count of the rest.
const titleList = (items, limit) => {
  const shown = items.slice(0, limit).map(link).join(" · ");
  const rest = items.length - limit;
  return rest > 0 ? `${shown} · and ${num(rest)} more` : shown;
};

// ─── Sections ───

function siteSection(stats) {
  const { site, words, scripture } = stats;
  const rows = Object.keys(NAMESPACES)
    .filter((ns) => site.namespaces[ns])
    .map((ns) => {
      const r = site.namespaces[ns];
      return [
        NAMESPACES[ns],
        num(r.pages),
        r.pages ? pct(r.withNotes, r.pages) : "–",
        num(r.words),
        num(r.notesWords),
      ];
    });
  return section(
    "site",
    "The site",
    [
      facts([
        ["Pages", num(site.published)],
        ["Notes pages", num(site.notes)],
        ["Words", num(words.total)],
        ["Scripture references", num(scripture.total)],
        ["Links between pages", num(stats.links.pairs)],
        ["Aliases", num(site.aliases)],
        ["Working drafts", num(site.drafts)],
        ["Featured", num(site.featured + site.featuredWith)],
        ["Images", num(site.imagesInVault)],
      ]),
      table(
        "Pages by namespace",
        ["Namespace", "Pages", "With notes", "Words", "In notes"],
        rows,
      ),
      `<h3>Behind the scenes</h3>
<p>${plural(site.notesWithoutPage, "notes page has", "notes pages have")} no topic page yet. ${num(site.ownHero)} pages carry their own image in share cards; ${num(site.fallbackHero)} use the default.${
        site.mostAliases.length
          ? ` The page with the most aliases is ${link(site.mostAliases[0])}, with ${site.mostAliases[0].count}.`
          : ""
      }</p>`,
    ].join("\n"),
  );
}

function wordsSection(stats) {
  const { words, titles } = stats;
  const letters = Object.entries(titles.letters).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const tallest = Math.max(1, ...letters.map(([, n]) => n));
  return section(
    "words",
    "Words",
    [
      facts([
        ["Words", num(words.total)],
        ["Words on the median page", num(words.median)],
        ["Different words used", num(words.vocabulary)],
        ["Hours to read it all", dec(words.readingHours)],
        ["In notes", pct(words.notesTotal, words.total)],
        ["Pages and notes counted", num(words.listedPages)],
      ]),
      `<p>The reading time assumes 230 words a minute; printed at 500 words a page it would run to about ${num(words.total / 500)} pages. Words are counted from the text of the pages and notes that are listed on the site.</p>`,
      `<h3>Longest pages</h3>`,
      ranking(words.longest.map((p) => [link(p), `${num(p.words)} words`])),
      `<h3>Shortest pages</h3>`,
      ranking(words.shortest.map((p) => [link(p), `${num(p.words)} words`])),
      table(
        "How long the pages are",
        ["Words", "Pages", "Notes pages"],
        words.buckets.map((b) => [b.label, num(b.content), num(b.notes)]),
      ),
      `<h3>Most used words</h3>`,
      `<p class="cloud">${words.topWords
        .map(([word, n]) => `${escHtml(word)}&nbsp;<span class="count">${num(n)}</span>`)
        .join(" · ")}</p>`,
      `<p>Common little words are left out. In the divine names, LORD appears ${num(words.divine.LORD)} times, GOD ${num(words.divine.GOD)}, YHWH ${num(words.divine.YHWH)} and I AM ${num(words.divine["I AM"])}. The site asks ${num(words.fun.questions)} questions and has ${num(words.fun.exclamations)} exclamation marks, and it quotes ${num(words.fun.greek)} Greek words and ${num(words.fun.hebrew)} Hebrew ones.</p>`,
      `<h3>Titles</h3>`,
      `<p>The average title is ${dec(titles.averageLength)} characters. The longest: ${titles.longest
        .map((p) => `${link(p)} (${p.title.length})`)
        .join("; ")}. The shortest: ${titles.shortest
        .map((p) => `${link(p)} (${p.title.length})`)
        .join("; ")}.</p>`,
      `<h4 class="visually-hidden">Topic titles by first letter</h4>
<ol class="letters" aria-label="Topic titles by first letter">
${letters
  .map(
    ([letter, n]) =>
      `  <li><span class="letter">${escHtml(letter)}</span>${bar(n / tallest)}<span class="count">${n}</span></li>`,
  )
  .join("\n")}
</ol>`,
    ].join("\n"),
  );
}

function linksSection(stats) {
  const { links } = stats;
  return section(
    "links",
    "Links",
    [
      facts([
        ["Links between pages", num(links.pairs)],
        ["From notes", pct(links.fromNotes, links.pairs)],
        ["Links to each page", dec(links.averageInbound)],
        ["Pages nothing links to", num(links.orphans.length)],
        ["Pages that link nowhere", num(links.linkNowhere)],
      ]),
      `<p>A link is counted once per pair of pages, however many times the one page links to the other.</p>`,
      `<h3>Most linked to</h3>`,
      ranking(links.mostLinkedTo.map((p) => [link(p), `${p.count} in`])),
      `<h3>Linking out the most</h3>`,
      ranking(links.mostLinking.map((p) => [link(p), `${p.count} out`])),
      `<h3>Pages nothing links to</h3>`,
      links.orphans.length
        ? `<p class="titles">${titleList(links.orphans, 40)}</p>`
        : `<p>None. Every page is linked from somewhere.</p>`,
    ].join("\n"),
  );
}

function categoriesSection(stats) {
  const { categories } = stats;
  return section(
    "categories",
    "Categories",
    [
      facts([
        ["Categories", num(categories.listed)],
        ["Pages per category", dec(categories.averageMembers)],
        ["Levels deep", num(categories.deepest)],
        ["In more than one", num(categories.inSeveral)],
        ["In none", num(categories.uncategorized.length)],
      ]),
      `<h3>Largest</h3>`,
      ranking(categories.largest.map((c) => [link(c), `${c.members} pages`])),
      `<h3>Most categories on one page</h3>`,
      ranking(categories.mostCategories.map((p) => [link(p), `${p.count} categories`])),
      `<h3>Pages in no category</h3>`,
      categories.uncategorized.length
        ? `<p class="titles">${titleList(categories.uncategorized, 40)}</p>`
        : `<p>None. Every page is in at least one category.</p>`,
    ].join("\n"),
  );
}

function structureSection(stats) {
  const { structure, weight } = stats;
  const rows = [
    ["Headings", "headings"],
    ["Images", "figures"],
    ["Tables", "tables"],
    ["Footnotes", "footnotes"],
    ["Block quotations", "blockquotes"],
    ["Callouts", "callouts"],
  ].map(([label, key]) => [
    label,
    num(structure[key].total),
    structure[key].most ? `${link(structure[key].most)} (${num(structure[key].most[key])})` : "–",
  ]);
  return section(
    "structure",
    "What's on the pages",
    [
      table("Structures across all pages", ["", "Total", "Most on one page"], rows),
      `<h3>Page weight</h3>`,
      `<p>The ${num(weight.pages)} pages weigh ${dec(weight.totalBytes / 1048576)} MB of HTML together, ${kb(weight.averageBytes)} each on average. The heaviest: ${weight.heaviest
        .map((p) => `${link(p)} (${kb(p.bytes)})`)
        .join("; ")}.</p>`,
    ].join("\n"),
  );
}

function scriptureSection(stats) {
  const sc = stats.scripture;
  const wholeBible = sc.all;
  const part = (label, p) => [
    `${label}<br><small>${p.booksCited} of ${p.books} books cited</small>`,
    `${num(p.chaptersCited)} of ${num(p.chapters)}<br><small>${pct(p.chaptersCited, p.chapters)}</small>`,
    `${num(p.versesCited)} of ${num(p.verses)}<br><small>${pct(p.versesCited, p.verses)}</small> ${bar(p.versesCited / p.verses)}`,
  ];
  const coverage = table(
    "How much of the Bible the site cites",
    ["", "Chapters cited", "Verses cited"],
    [part("Old Testament", sc.ot), part("New Testament", sc.nt), part("Whole Bible", wholeBible)],
  );

  const bookRows = sc.books.map((b) => [
    b.refs > 0 ? `<a href="/index/scripture/${b.slug}">${escHtml(b.name)}</a>` : escHtml(b.name),
    num(b.refs),
    `${b.chaptersCited} of ${b.chapters}`,
    `${pct(b.versesCited, b.verses)} ${bar(b.versesCited / b.verses)}`,
  ]);

  const heat = (count) => (count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 7 ? 3 : 4);
  const heatmap = ["Old", "New"]
    .map((testament) => {
      const books = sc.books.filter((b) => b.testament === testament);
      return `<h4>${testament} Testament</h4>
${books
  .map(
    (b) =>
      `<div class="book"><span class="name">${escHtml(b.name)}</span><span class="chapters">${b.chapterCounts
        .map(
          (count, i) =>
            `<i class="c${heat(count)}" title="${escHtml(b.name)} ${i + 1}: ${count === 0 ? "not cited" : plural(count, "citation")}"></i>`,
        )
        .join("")}</span></div>`,
  )
  .join("\n")}`;
    })
    .join("\n");

  const rankedBooks = ranking(
    sc.topBooks.map((b) => [`<a href="/index/scripture/${b.slug}">${escHtml(b.name)}</a>`, `${num(b.refs)} references`]),
  );

  const records = [];
  if (sc.longestVerseRange) {
    records.push(
      `The longest passage cited is <strong>${escHtml(sc.longestVerseRange.label)}</strong>, ${plural(sc.longestVerseRange.span, "verse")}, on ${link(sc.longestVerseRange)}.`,
    );
  }
  if (sc.longestChapterRange && sc.longestChapterRange.span > 1) {
    records.push(
      `The most chapters in one citation is <strong>${escHtml(sc.longestChapterRange.label)}</strong>, ${plural(sc.longestChapterRange.span, "chapter")}, on ${link(sc.longestChapterRange)}.`,
    );
  }
  if (sc.longestGap.verses > 0) {
    records.push(
      `The longest stretch nobody has cited is ${plural(sc.longestGap.verses, "verse")}, from ${escHtml(sc.longestGap.from)} to ${escHtml(sc.longestGap.to)}.`,
    );
  }
  records.push(
    sc.neverCitedBooks.length
      ? `${plural(sc.neverCitedBooks.length, "book is", "books are")} never cited: ${sc.neverCitedBooks.map(escHtml).join(", ")}.`
      : "Every book of the Bible is cited at least once.",
  );
  records.push(
    `${plural(sc.versesCitedMoreThanOnce, "verse is", "verses are")} cited more than once.`,
  );

  return section(
    "scripture",
    "Scripture",
    [
      facts([
        ["References", num(sc.total)],
        ["Different references", num(sc.unique)],
        ["Pages citing", `${num(sc.pagesCiting)} of ${num(sc.pagesEligible)}`],
        ["Books cited", `${wholeBible.booksCited} of ${wholeBible.books}`],
        ["Chapters cited", `${num(wholeBible.chaptersCited)} of ${num(TOTAL_CHAPTERS)}`],
        ["Verses cited", `${num(wholeBible.versesCited)} of ${num(TOTAL_VERSES)}`],
      ]),
      `<p>These are the references the Scripture index lists, so notes pages, reference pages and categories are left out: the notes cite a great deal, and the reference tables would swamp everything else.</p>`,
      `<p>A chapter is cited when any citation touches it. A verse is cited only when a citation names it, on its own or in a range, so a citation of a whole chapter (“!Romans 3”) cites the chapter but none of its verses, while “Romans 3:1” cites both. The Bible has ${num(TOTAL_VERSES)} verses in ${num(TOTAL_CHAPTERS)} chapters (the Protestant numbering the ESV follows).</p>`,
      coverage,
      `<h3>Records</h3>`,
      `<ul class="records">\n${records.map((r) => `  <li>${r}</li>`).join("\n")}\n</ul>`,
      `<h3>Most cited books</h3>`,
      rankedBooks,
      `<h3>Most cited chapters</h3>`,
      ranking(sc.topChapters.map((r) => [escHtml(r.label), `${num(r.count)} citations`])),
      `<h3>Most cited verses</h3>`,
      ranking(sc.topVerses.map((r) => [escHtml(r.label), `${num(r.count)} citations`])),
      `<h3>Pages that cite the most</h3>`,
      ranking(sc.topPages.map((p) => [link(p), `${num(p.refs)} references`])),
      `<h3>Across the most books</h3>`,
      ranking(sc.broadestPages.map((p) => [link(p), `${p.books} books`])),
      `<h3>Most references for their length</h3>`,
      ranking(sc.densest.map((p) => [link(p), `${dec(p.per1000)} per 1,000 words`])),
      `<h3>Translations</h3>`,
      `<p>${sc.translations.map(([t, n]) => `${escHtml(t)}: ${num(n)}`).join(" · ")}</p>`,
      sc.invalid.length
        ? `<h3>Citations that point past the end</h3>
<details>
<summary>${plural(sc.invalid.length, "citation names", "citations name")} a chapter or verse its book doesn't have</summary>
<p>These are probably typos (a <code>1Ch</code> meant as <code>2Ch</code>, say). They are linked all the same.</p>
<ul class="records">\n${sc.invalid.map((i) => `  <li>${escHtml(i.label)} on ${link(i)}</li>`).join("\n")}\n</ul>
</details>`
        : "",
      `<h3 id="chapter-by-chapter">Chapter by chapter</h3>`,
      `<p>Each square is a chapter. The darker the square, the more citations touch it.</p>`,
      `<p class="legend" aria-hidden="true">Citations: <i class="c0"></i> none <i class="c1"></i> 1 <i class="c2"></i> 2–3 <i class="c3"></i> 4–7 <i class="c4"></i> 8 or more</p>`,
      `<div class="heatmap" role="group" aria-label="Chapters of the Bible shaded by how often each is cited. The table below has the same numbers by book.">\n${heatmap}\n</div>`,
      table("Book by book", ["Book", "References", "Chapters cited", "Verses cited"], bookRows),
    ].join("\n"),
  );
}

// ─── The page ───

export async function writeStatistics({ output, renderLayout, stats }) {
  const intro = `<p>All of this is counted by the build itself, from the pages as they stand at <code>${escHtml(stats.commit)}</code> (tsgen ${escHtml(stats.version)}). Hidden and unlisted pages aren't counted anywhere on this page.</p>
<nav class="section-nav" aria-label="Sections"><ul>${[
    ["site", "The site"],
    ["words", "Words"],
    ["links", "Links"],
    ["categories", "Categories"],
    ["structure", "Pages"],
    ["scripture", "Scripture"],
  ]
    .map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`)
    .join("")}</ul></nav>`;

  const body = [
    intro,
    siteSection(stats),
    wordsSection(stats),
    linksSection(stats),
    categoriesSection(stats),
    structureSection(stats),
    scriptureSection(stats),
  ].join("\n");

  const html = renderLayout(body, {
    url: "/statistics",
    nsLabel: "Meta page",
    frontmatter: { title: "Statistics", permalink: "statistics" },
  });
  await output.emit("/statistics", html);
  info("Built (statistics): /statistics");
}
