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
// A whole-number percentage, for a label; a share that rounds to nothing says so.
const pctLabel = (part, whole) => {
  const share = whole ? (part / whole) * 100 : 0;
  return share > 0 && share < 0.5 ? "&lt;1%" : `${Math.round(share)}%`;
};
const pct = (part, whole) => (whole ? `${dec((part / whole) * 100)}%` : "0%");
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const kb = (bytes) => `${dec(bytes / 1024)} KB`;

const link = (item) => `<a href="${escHtml(item.url)}">${escHtml(item.title)}</a>`;

// The theme colors in hue order, with pink (hue 5, the wrap-around) last. Books and letters take them in turn.
const HUES = ["red", "orange", "yellow", "puke", "green", "teal", "slate", "blue", "indigo", "violet", "magenta", "pink"];

// The tiles take the theme colors in turn across the whole page, each row picking up where
// the last left off. Reset when the page starts so the output is the same every build.
let tileCount = 0;

// A tile's icon classes. "name" is a Sharp Solid icon; "kit:name" is one of the kit's own
// custom icons, which carry fa-kit instead of the style classes. Extra classes can follow
// ("tags fa-rotate-90").
const iconClasses = (spec) => {
  const [first, ...extra] = spec.split(" ");
  const custom = first.startsWith("kit:");
  const name = custom ? first.slice("kit:".length) : first;
  return [custom ? "fa-kit" : "fa-sharp fa-solid", `fa-${name}`, ...extra].join(" ");
};

// A row of big-number tiles. [label, value, icon] triples (see iconClasses); a tile whose
// icon isn't chosen yet has none.
const facts = (pairs) =>
  `<dl class="facts">\n${pairs
    .map(([label, value, icon]) => {
      const hue = HUES[tileCount++ % HUES.length];
      const mark = icon ? `<span class="${iconClasses(icon)}" aria-hidden="true"></span>` : "";
      return `  <div style="--tile: var(--color-${hue})"><dt>${label}</dt><dd>${value}</dd>${mark}</div>`;
    })
    .join("\n")}\n</dl>`;

// "x / y" for a tile: the whole is set small, beside the big number.
const outOf = (part, whole) => `${part}<span class="of"> / ${whole}</span>`;

// The mark on a figure that is one of the references "in content".
const asterisk = '<span class="asterisk">*</span>';

// An explainer paragraph, set as fine print: one with no figures of its own.
const note = (html) => `<p class="note">${html}</p>`;

// An ordered ranking: [html, count] pairs.
const ranking = (rows, unit = "") =>
  `<ol class="ranking">\n${rows
    .map(([html, count]) => `  <li>${html} <span class="count">${count}${unit}</span></li>`)
    .join("\n")}\n</ol>`;


// A letter's hue follows its place in the alphabet; anything else (a digit, "#") keeps the primary.
const letterHue = (letter) => (/^[A-Z]$/.test(letter) ? HUES[(letter.charCodeAt(0) - 65) % HUES.length] : "");

const bar = (fraction, hue = "") =>
  `<span class="bar${hue && ` hue-${hue}`}" style="--p:${dec(Math.min(Math.max(fraction, 0), 1) * 100)}%" aria-hidden="true"></span>`;

// A table under an h3 of its own (the page's tables mark off sections, so they get headings
// rather than captions); the table is labelled by it.
const table = (title, head, rows) => {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // A column of numbers (a dash stands for none, an asterisk may mark one) is right-aligned, header and all.
  const isNumber = (cell) => /^\*?\s*(?:[\d,.]+%?|–)\s*\*?$/.test(cell.replace(/<[^>]*>/g, "").trim());
  const numeric = head.map((_, i) => rows.every((cells) => isNumber(String(cells[i]))));
  const attrs = (i) => (numeric[i] ? ' class="num"' : "");
  return `<h3 id="${id}">${title}</h3>
<div class="table-scroll"><table aria-labelledby="${id}">
<thead><tr>${head.map((h, i) => `<th scope="col"${attrs(i)}>${h}</th>`).join("")}</tr></thead>
<tbody>
${rows.map((cells) => `<tr>${cells.map((c, i) => `<td${attrs(i)}>${c}</td>`).join("")}</tr>`).join("\n")}
</tbody>
</table></div>`;
};

const section = (id, title, body) =>
  `<section id="${id}">\n<h2>${title}</h2>\n${body}\n</section>`;

// Page titles listed in full, trimmed to `limit` with a count of the rest.
const titleList = (items, limit) => {
  const shown = items.slice(0, limit).map(link).join("&nbsp;· ");
  const rest = items.length - limit;
  return rest > 0 ? `${shown}&nbsp;· and ${num(rest)} more` : shown;
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
        ["Total Scripture references", num(scripture.indexed + scripture.notesTotal), "book-bible"],
        ["Words", num(words.total), "keyboard"],
        ["Content pages", num(site.published), "book"],
        ["Notes pages", num(site.notes), "notebook"],
        ["Links", num(stats.links.pairs), "link-simple"],
        ["Working drafts", num(site.drafts), "pencil"],
        ["Featured pages", num(site.featured + site.featuredWith), "star"],
        ["Images", num(site.imagesInVault), "images"],
      ]),
      table(
        "Pages by namespace",
        ["Namespace", "Pages", "With notes", "Words", "In notes"],
        rows,
      ),
    ].join("\n"),
  );
}

function scriptureSection(stats) {
  const sc = stats.scripture;
  const wholeBible = sc.all;
  const part = (label, p) => [
    `${label}<br><small>${p.booksCited} of ${p.books} books</small>`,
    `${num(p.chaptersCited)} of ${num(p.chapters)}<br><small>${pct(p.chaptersCited, p.chapters)}</small>`,
    `${num(p.versesCited)} of ${num(p.verses)}<br><small>${pct(p.versesCited, p.verses)}</small> ${bar(p.versesCited / p.verses)}`,
  ];
  const coverage = table(
    "Testament by testament",
    ["", "Chapters cited", "Verses cited"],
    [part("Old Testament", sc.ot), part("New Testament", sc.nt)],
  );

  const bookColor = new Map(sc.books.map((b, i) => [b.name, HUES[i % HUES.length]]));

  const heat = (count) => (count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 7 ? 3 : 4);
  // One row per book, in canonical order (the Old Testament's, then the New's).
  const heatmap = sc.books
    .map((b) => {
      const cited = b.refs > 0;
      const name = cited ? `<a href="/index/scripture/${b.slug}">${escHtml(b.name)}</a>` : escHtml(b.name);
      const squares = b.chapterCounts
        .map(
          (count, i) =>
            `<i class="c${heat(count)}" title="${escHtml(b.name)} ${i + 1}: ${count === 0 ? "not cited" : plural(count, "citation")}"></i>`,
        )
        .join("");
      // The chapters, then the verses, as percentages; the fractions are in a tooltip (a title,
      // like the abbreviations').
      const figures = cited
        ? `<span title="${b.chaptersCited} / ${b.chapters} ${b.chapters === 1 ? "chapter" : "chapters"}">chapters ${pctLabel(b.chaptersCited, b.chapters)}</span> &middot; <span title="${num(b.versesCited)} / ${num(b.verses)} ${b.verses === 1 ? "verse" : "verses"}">verses ${pctLabel(b.versesCited, b.verses)}</span>`
        : "Not cited";
      // The numbers go with the name, on the left; the squares have the right side to themselves.
      return `<div class="book hue-${bookColor.get(b.name)}"><span class="info"><span class="name${cited ? "" : " uncited"}">${name}${
        cited ? ` <span class="refs">${num(b.refs)} ${b.refs === 1 ? "citation" : "citations"}</span>` : ""
      }</span><span class="figures">${figures}</span></span><span class="chapters">${squares}</span></div>`;
    })
    .join("\n");

  const rankedBooks = ranking(
    sc.topBooks.map((b) => [`<a href="/index/scripture/${b.slug}">${escHtml(b.name)}</a>`, `${num(b.refs)} references`]),
  );

  const records = [];
  if (sc.longestVerseRange) {
    records.push(
      // A count after a reference ("Romans 3, 71 verses") would be read as a verse,
      // so each record puts the number first.
      `The longest passage cited, at ${plural(sc.longestVerseRange.span, "verse")}, is ${escHtml(sc.longestVerseRange.label)}, on ${link(sc.longestVerseRange)}.`,
    );
  }
  if (sc.longestChapterRange && sc.longestChapterRange.span > 1) {
    records.push(
      `The citation that spans the most chapters, ${plural(sc.longestChapterRange.span, "chapter")}, is ${escHtml(sc.longestChapterRange.label)}, on ${link(sc.longestChapterRange)}.`,
    );
  }
  if (sc.longestGap.verses > 0) {
    records.push(
      `The longest stretch with no citations is ${plural(sc.longestGap.verses, "verse")}, from ${escHtml(sc.longestGap.from)} to ${escHtml(sc.longestGap.to)}.`,
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
        [`Verses cited in main content (${pctLabel(wholeBible.versesCited, TOTAL_VERSES)})`, outOf(num(wholeBible.versesCited), num(TOTAL_VERSES))],
        [`Chapters cited (${pctLabel(wholeBible.chaptersCited, TOTAL_CHAPTERS)})`, outOf(num(wholeBible.chaptersCited), num(TOTAL_CHAPTERS))],
        [`Books cited (${pctLabel(wholeBible.booksCited, wholeBible.books)})`, outOf(wholeBible.booksCited, wholeBible.books), "kit:books-chart-pie-simple"],
        ["References", num(sc.total), "book-bible"],
        ["Unique references", num(sc.unique), "fingerprint"],
      ]),
      note(`A chapter is considered <em>cited</em> when any main content page references it; John chapter 3 would be counted in a mention like !John 1–3 or in something more specific like !John 3:16. A verse is considered <em>cited</em> only when a main content page mentions it directly or within a range of fifteen verses or fewer. John chapter 3 verse 16 would be counted in a direct mention like !John 3:16 or in a range like !John 3:9–17. Chapter-only references (e.g. !John 3) don’t count as citing any verses in the chapter, even if the chapter is shorter than fifteen verses. This would be too easy to cheese if long references counted (i.e. a citation of !Ge 1:1–!Rev 22:21 would be the ultimate cheat code).`),
      table(
        "Scripture references by namespace",
        ["Namespace", "On page", "In notes"],
        Object.keys(NAMESPACES).map((ns) => {
          const row = sc.byNamespace[ns] ?? { refs: 0, inNotes: 0 };
          // The pages the figures after the table count: topic, commentary and summary
          // pages. Meta and category pages are in the Scripture index but not in those
          // figures, and reference pages aren't in the index.
          const inContent = ns !== "reference" && ns !== "category" && ns !== "meta";
          return [NAMESPACES[ns], `${num(row.refs)}${inContent ? asterisk : ""}`, num(row.inNotes)];
        }),
      ),
      note(`Figures with an asterisk (${asterisk}) count as Scripture references in main content. Remaining Bible references in this table are excluded below.`),
      `<h3 id="book-by-book">Book by book</h3>`,
      `<p>Each square is a chapter. The darker the square, the more Scripture references mention that chapter in main content pages. Chapter and verse percentages are the fractions of the book’s total chapters and verses that are cited (hover for the math).</p>`,
      `<p class="legend" aria-hidden="true">Citations: <i class="c0"></i> none <i class="c1"></i> 1 <i class="c2"></i> 2–3 <i class="c3"></i> 4–7 <i class="c4"></i> 8 or more</p>`,
      `<div class="heatmap" role="group" aria-label="Chapters of the Bible shaded by how often each is cited, with each book's share of verses and chapters cited and its references.">\n${heatmap}\n</div>`,
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
      `<p class="cloud">${sc.translations
        .map(([t, n]) => `${escHtml(t)}&nbsp;<span class="count">${num(n)}</span>`)
        .join("&nbsp;· ")}</p>`,
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
        ["Words", num(words.total), "keyboard"],
        ["Median page length", num(words.median), "chart-simple"],
        ["Unique words", num(words.vocabulary), "fingerprint"],
        ["Hours to read at 250 WPM", dec(words.readingHours), "kit:book-open-lines-clock"],
        [`In notes (${pctLabel(words.notesTotal, words.total)})`, num(words.notesTotal), "chart-pie-simple"],
      ]),
      `<p>Printed at 500 words per page, the site would be about ${num(words.total / 500)} pages long.</p>`,
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
        .join("&nbsp;· ")}</p>`,
      note(`Common short words and Bible book names, abbreviations, and translations are excluded.`),
      `<p>Of the divine names, LORD appears ${num(words.divine.LORD)} times, GOD ${num(words.divine.GOD)}, YHWH ${num(words.divine.YHWH)} and I AM ${num(words.divine["I AM"])}. The site asks ${num(words.fun.questions)} questions and has ${num(words.fun.exclamations)} exclamation marks, and it quotes ${num(words.fun.greek)} Greek words and ${num(words.fun.hebrew)} Hebrew ones.</p>`,
      `<h3>Titles</h3>`,
      `<p>The average title is ${dec(titles.averageLength)} characters. The longest: ${titles.longest
        .map((p) => `${link(p)} (${p.title.length})`)
        .join("; ")}. The shortest: ${titles.shortest
        .map((p) => `${link(p)} (${p.title.length})`)
        .join("; ")}.</p>`,
      `<h4 class="visually-hidden">Topic titles by first letter</h4>
      <ol class="letters" style="--rows:${Math.ceil(letters.length / 2)}" aria-label="Topic titles by first letter">
      ${letters
        .map(
          ([letter, n]) =>
            `  <li><span class="letter">${escHtml(letter)}</span>${bar(n / tallest, letterHue(letter))}<span class="count">${n}</span></li>`,
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
        ["Links between pages", num(links.pairs), "link-simple"],
        [`From notes (${pctLabel(links.fromNotes, links.pairs)})`, num(links.fromNotes), "kit:notebook-circle-arrow"],
        ["Average links to each page", dec(links.averageInbound), "chart-simple"],
        ["Pages with no incoming links", num(links.orphans.length)],
        ["Pages with no outgoing links", num(links.linkNowhere)],
      ]),
      note("A link is counted once per pair of pages, however many times the one page links to the other."),
      `<h3>Most linked to</h3>`,
      ranking(links.mostLinkedTo.map((p) => [link(p), `${p.count} in`])),
      `<h3>Linking out the most</h3>`,
      ranking(links.mostLinking.map((p) => [link(p), `${p.count} out`])),
      `<h3>Pages nothing links to</h3>`,
      links.orphans.length
        ? `<p class="titles">${titleList(links.orphans, 15)}</p>`
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
        ["Category pages", num(categories.listed), "tags fa-rotate-90"],
        ["Pages per category", dec(categories.averageMembers)],
        ["Pages in multiple categories", num(categories.inSeveral)],
        ["Uncategorized pages", num(categories.uncategorized.length)],
        ["Levels deep", num(categories.deepest)],
      ]),
      `<h3>Largest categories</h3>`,
      ranking(categories.largest.map((c) => [link(c), `${c.members} pages`])),
      `<h3>Most categories on one page</h3>`,
      ranking(categories.mostCategories.map((p) => [link(p), `${p.count} categories`])),
      `<h3>Uncategorized pages</h3>`,
      categories.uncategorized.length
        ? `<p class="titles">${titleList(categories.uncategorized, 15)}</p>`
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
    "What’s on the pages",
    [
      table("Structures across all pages", ["", "Total", "Most on one page"], rows),
      `<h3>Page weight</h3>`,
      `<p>The ${num(weight.pages)} pages weigh ${dec(weight.totalBytes / 1048576)} MB of HTML together, ${kb(weight.averageBytes)} each on average. The heaviest: ${weight.heaviest
        .map((p) => `${link(p)} (${kb(p.bytes)})`)
        .join("; ")}.</p>`,
    ].join("\n"),
  );
}

// ─── The page ───

export async function writeStatistics({ output, renderLayout, stats }) {
  tileCount = 0;
  const intro = `<p>Statistics about <strong>Tota Scriptura</strong> are counted automagically by the static site generator; accurate as of commit <code>${escHtml(stats.commit)}</code> (version ${escHtml(stats.version)}).</p>
<div class="namespace-menu" role="group" aria-label="Jump to a section">${[
    [["scripture", "Scripture"], ["words", "Words"], ["links", "Links"]],
    [["categories", "Categories"], ["structure", "Pages"]],
  ]
    .map(
      (row, i) =>
        `\n<ul>${i === 0 ? '<li class="label">Jump to:</li>' : ""}${row
          .map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`)
          .join("")}</ul>`,
    )
    .join("")}\n</div>`;

  const body = [
    intro,
    siteSection(stats),
    scriptureSection(stats),
    wordsSection(stats),
    linksSection(stats),
    categoriesSection(stats),
    structureSection(stats),
  ].join("\n");

  const html = renderLayout(body, {
    url: "/statistics",
    nsLabel: "Meta page",
    stylesheet: "statistics.css",
    kit: "ecf9c95079",
    frontmatter: { title: "Statistics", permalink: "statistics" },
  });
  await output.emit("/statistics", html);
  info("Built (statistics): /statistics");
}
