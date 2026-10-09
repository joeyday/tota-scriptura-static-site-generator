import { BIBLE_BOOKS, bookInfoByCwms } from "./bible/refs.js";
import { OT_BOOK_COUNT, VERSES_PER_CHAPTER } from "./bible/versification.js";
import { sortableTitle } from "./titles.js";

// ─── Statistics ───
// Everything the /statistics page shows, computed from structures the build has
// already made: the page records, the link and category maps, the collected
// Scripture references, and a few counts taken while each page was rendered.
// Nothing here reads a file or walks the corpus again. Output must be the same
// for the same content, so no clocks and no timings.

// ─── Counted while a page renders ───

// One pass over a page's rendered body for the structures worth counting.
const STRUCTURE_RE = /<(h2|h3|table|blockquote|figure)[\s>]|class="(footnote-item|callout)"/g;

export function measureHtml(html) {
  const counts = { headings: 0, tables: 0, blockquotes: 0, figures: 0, footnotes: 0, callouts: 0 };
  STRUCTURE_RE.lastIndex = 0;
  let hit;
  while ((hit = STRUCTURE_RE.exec(html)) !== null) {
    switch (hit[1] ?? hit[2]) {
      case "h2":
      case "h3":
        counts.headings++;
        break;
      case "table":
        counts.tables++;
        break;
      case "blockquote":
        counts.blockquotes++;
        break;
      case "figure":
        counts.figures++;
        break;
      case "footnote-item":
        counts.footnotes++;
        break;
      case "callout":
        counts.callouts++;
        break;
    }
  }
  return counts;
}

// Words in text whose whitespace is already single spaces (the search body).
export function countWords(text) {
  if (!text) return 0;
  let words = 1;
  for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1)) words++;
  return words;
}

// ─── Small helpers ───

const sum = (list, pick = (x) => x) => list.reduce((n, x) => n + pick(x), 0);
// The n largest by `pick`, largest first; ties keep their order in the list.
// One pass that keeps a short sorted list, not a sort of the whole thing.
function topBy(list, pick, n) {
  const best = []; // { item, value }, descending
  for (const item of list) {
    const value = pick(item);
    if (best.length === n && value <= best[n - 1].value) continue;
    let i = best.length;
    while (i > 0 && best[i - 1].value < value) i--;
    best.splice(i, 0, { item, value });
    if (best.length > n) best.pop();
  }
  return best.map((b) => b.item);
}
const bottomBy = (list, pick, n) =>
  [...list].sort((a, b) => pick(a) - pick(b)).slice(0, n);
const median = (nums) => {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Words too common to be worth ranking.
const STOP_WORDS = new Set(
  (
    "a about after all also an and any are as at be because been but by can could did do does for from had has have he " +
    "her him his how i if in into is it its me more most my no not of on one only or other our out she so some such " +
    "than that the their them then there these they this those through to up us was we were what when which who " +
    "cf vs ch ff pp etc eg ie viz also see however thus yet very much many may must shall should still " +
    "will with would you your s t d re ve ll m"
  ).split(" "),
);

// ─── Scripture ───

const bookInfo = [];
for (const info of bookInfoByCwms.values()) bookInfo[info.bookIndex] = info;
// The abbreviations in citations ("Jn 3:16") aren't words the site uses.
for (const cwms of bookInfoByCwms.keys()) STOP_WORDS.add(cwms.toLowerCase());

const verseLabel = (book, chapter, verse) =>
  `${bookInfo[book].bookName} ${chapter}:${verse}`;

function scriptureStats(refs, pagesByUrl, collectedPages) {
  // Per verse: citations that name it. Per chapter: whole-chapter citations,
  // and citations that touch it at all.
  const explicit = VERSES_PER_CHAPTER.map((chapters) => chapters.map((n) => new Uint32Array(n)));
  const whole = VERSES_PER_CHAPTER.map((chapters) => new Uint32Array(chapters.length));
  const touched = VERSES_PER_CHAPTER.map((chapters) => new Uint32Array(chapters.length));
  const refsByBook = new Array(BIBLE_BOOKS.length).fill(0);
  const uniqueRefs = new Set();
  const translations = new Map();
  const invalid = new Map(); // "Book ref|page" → { label, page, url }
  let longestVerseRange = null;
  let longestChapterRange = null;

  const perPage = new Map(); // url → { refs, books:Set }
  for (const ref of refs) {
    const book = ref.bookIndex;
    refsByBook[book]++;
    uniqueRefs.add(`${book}|${ref.displayShort}`);
    translations.set(ref.translation, (translations.get(ref.translation) ?? 0) + 1);
    let page = perPage.get(ref.pageUrl);
    if (!page) perPage.set(ref.pageUrl, (page = { refs: 0, books: new Set() }));
    page.refs++;
    page.books.add(book);

    const chapters = VERSES_PER_CHAPTER[book];
    const chapter = ref.chapterNum;
    const { verseStart, rangeVal, endChapter } = ref;
    const fail = () => {
      const label = `${bookInfo[book].bookName} ${ref.displayShort}`;
      invalid.set(`${label}|${ref.pageUrl}`, { label, title: ref.pageTitle, url: ref.pageUrl });
    };
    if (chapter < 1 || chapter > chapters.length) {
      fail();
      continue;
    }

    if (verseStart === undefined) {
      // A whole chapter, or a run of them.
      const last = endChapter ? parseInt(endChapter) : chapter;
      if (last < chapter || last > chapters.length) {
        fail();
        continue;
      }
      for (let c = chapter; c <= last; c++) {
        whole[book][c - 1]++;
        touched[book][c - 1]++;
      }
      const span = last - chapter + 1;
      if (!longestChapterRange || span > longestChapterRange.span) {
        longestChapterRange = { span, label: `${bookInfo[book].bookName} ${ref.displayShort}`, title: ref.pageTitle, url: ref.pageUrl };
      }
      continue;
    }

    // Verses: a single verse, a run in one chapter, or a run across chapters.
    const startVerse = verseStart;
    const crossChapter = ref.endVerse !== undefined;
    const lastChapter = crossChapter ? parseInt(rangeVal) : chapter;
    const lastVerse = crossChapter ? parseInt(ref.endVerse) : rangeVal ? parseInt(rangeVal) : startVerse;
    if (
      startVerse < 1 ||
      startVerse > chapters[chapter - 1] ||
      lastChapter < chapter ||
      lastChapter > chapters.length ||
      lastVerse < 1 ||
      lastVerse > chapters[lastChapter - 1] ||
      (lastChapter === chapter && lastVerse < startVerse)
    ) {
      fail();
      continue;
    }
    let span = 0;
    for (let c = chapter; c <= lastChapter; c++) {
      const from = c === chapter ? startVerse : 1;
      const to = c === lastChapter ? lastVerse : chapters[c - 1];
      for (let v = from; v <= to; v++) explicit[book][c - 1][v - 1]++;
      touched[book][c - 1]++;
      span += to - from + 1;
    }
    if (!longestVerseRange || span > longestVerseRange.span) {
      longestVerseRange = { span, label: `${bookInfo[book].bookName} ${ref.displayShort}`, title: ref.pageTitle, url: ref.pageUrl };
    }
  }

  // Coverage per book, and the verse-by-verse walk through the canon.
  const books = [];
  const topVerses = []; // the ten most cited verses so far: { b, c, v, count }
  let versesCitedMoreThanOnce = 0;
  let run = 0; // current stretch of verses nobody cites
  let runStart = null;
  let longestGap = { verses: 0, from: null, to: null };
  let lastUncited = null;
  for (let b = 0; b < VERSES_PER_CHAPTER.length; b++) {
    const chapters = VERSES_PER_CHAPTER[b];
    let chaptersCited = 0;
    let versesCovered = 0;
    let versesNamed = 0;
    for (let c = 0; c < chapters.length; c++) {
      if (touched[b][c] > 0) chaptersCited++;
      for (let v = 0; v < chapters[c]; v++) {
        const named = explicit[b][c][v];
        const covered = named > 0 || whole[b][c] > 0;
        if (named > 0) {
          versesNamed++;
          if (named > 1) versesCitedMoreThanOnce++;
          if (topVerses.length < 10 || named > topVerses[9].count) {
            let i = topVerses.length;
            while (i > 0 && topVerses[i - 1].count < named) i--;
            topVerses.splice(i, 0, { b, c, v, count: named });
            if (topVerses.length > 10) topVerses.pop();
          }
        }
        if (covered) {
          versesCovered++;
          if (run > longestGap.verses) {
            longestGap = { verses: run, from: runStart, to: lastUncited };
          }
          run = 0;
        } else {
          if (run === 0) runStart = [b, c + 1, v + 1];
          lastUncited = [b, c + 1, v + 1];
          run++;
        }
      }
    }
    books.push({
      name: bookInfo[b].bookName,
      slug: bookInfo[b].bookSlug,
      testament: b < OT_BOOK_COUNT ? "Old" : "New",
      refs: refsByBook[b],
      chapters: chapters.length,
      chaptersCited,
      verses: sum(chapters),
      versesCovered,
      versesNamed,
      chapterCounts: Array.from(touched[b]),
    });
  }
  if (run > longestGap.verses) longestGap = { verses: run, from: runStart, to: lastUncited };
  const labelOf = ([b, c, v]) => verseLabel(b, c, v);

  const part = (list) => ({
    books: list.length,
    booksCited: list.filter((x) => x.refs > 0).length,
    refs: sum(list, (x) => x.refs),
    chapters: sum(list, (x) => x.chapters),
    chaptersCited: sum(list, (x) => x.chaptersCited),
    verses: sum(list, (x) => x.verses),
    versesCovered: sum(list, (x) => x.versesCovered),
    versesNamed: sum(list, (x) => x.versesNamed),
  });
  const ot = part(books.slice(0, OT_BOOK_COUNT));
  const nt = part(books.slice(OT_BOOK_COUNT));
  const all = part(books);

  const chapterRows = [];
  for (const book of books) {
    book.chapterCounts.forEach((count, i) => {
      if (count > 0) chapterRows.push({ label: `${book.name} ${i + 1}`, count });
    });
  }

  const pagesCiting = [...perPage.entries()].map(([url, p]) => ({
    url,
    title: pagesByUrl.get(url)?.title ?? url,
    refs: p.refs,
    books: p.books.size,
    words: pagesByUrl.get(url)?.words ?? 0,
  }));
  const dense = pagesCiting
    .filter((p) => p.words >= 300)
    .map((p) => ({ ...p, per1000: (p.refs / p.words) * 1000 }));

  return {
    total: refs.length,
    inNotes: refs.filter((r) => !r.indexed).length,
    unique: uniqueRefs.size,
    pagesCiting: perPage.size,
    pagesEligible: collectedPages,
    translations: [...translations.entries()].sort((a, b) => b[1] - a[1]),
    all,
    ot,
    nt,
    books,
    neverCitedBooks: books.filter((b) => b.refs === 0).map((b) => b.name),
    topBooks: topBy(books.filter((b) => b.refs > 0), (b) => b.refs, 10),
    topChapters: topBy(chapterRows, (r) => r.count, 10),
    topVerses: topVerses.map((r) => ({
      label: verseLabel(r.b, r.c + 1, r.v + 1),
      count: r.count,
    })),
    versesCitedMoreThanOnce,
    longestVerseRange,
    longestChapterRange,
    longestGap: longestGap.verses
      ? { verses: longestGap.verses, from: labelOf(longestGap.from), to: labelOf(longestGap.to) }
      : longestGap,
    topPages: topBy(pagesCiting, (p) => p.refs, 10),
    broadestPages: topBy(pagesCiting, (p) => p.books, 5),
    densest: topBy(dense, (p) => p.per1000, 5),
    invalid: [...invalid.values()],
  };
}

// ─── Everything ───

// pages:   one entry per published page, from the build loop:
//          { title, url, ns, isNote, listed, collected, words, bytes, ownHero, ...measureHtml }
// bodies:  the search documents ({ url, body }) of the listed pages
// refs:    the collected Scripture references
export function computeStatistics({
  pages,
  bodies,
  filesToProcess,
  refs,
  backlinksMap,
  membersMap,
  alphabeticalByNs,
  notesByPage,
  pageByNotes,
  plannedUrls,
  imageMap,
  partialCount,
  aliasRedirects,
  version,
  commit,
}) {
  const pagesByUrl = new Map(pages.map((p) => [p.url, p]));
  const listed = pages.filter((p) => p.listed);
  const content = listed.filter((p) => !p.isNote);
  const notes = listed.filter((p) => p.isNote);
  const nsOf = (record) => record.nsDir || "meta";

  // ── The site ──
  const published = filesToProcess.filter((f) => !f.hidden);
  const namespaces = {};
  for (const f of published) {
    const row = (namespaces[nsOf(f)] ??= { pages: 0, notes: 0, words: 0, notesWords: 0 });
    if (f.isNote) row.notes++;
    else row.pages++;
  }
  for (const p of listed) {
    const row = namespaces[p.ns];
    if (!row) continue;
    if (p.isNote) row.notesWords += p.words;
    else row.words += p.words;
  }
  const withNotes = (ns) =>
    published.filter((f) => !f.isNote && nsOf(f) === ns && notesByPage[f.finalUrlPath]).length;
  for (const [ns, row] of Object.entries(namespaces)) row.withNotes = withNotes(ns);

  const site = {
    published: published.filter((f) => !f.isNote).length,
    notes: published.filter((f) => f.isNote).length,
    hidden: filesToProcess.filter((f) => f.hidden).length,
    placeholders: plannedUrls.size,
    unlisted: published.filter((f) => f.unlisted).length,
    drafts: published.filter((f) => f.draft).length,
    featured: published.filter((f) => f.featured).length,
    featuredWith: published.filter((f) => f.featuredWith).length,
    aliases: aliasRedirects.length,
    pagesWithAliases: published.filter((f) => f.aliases.length > 0).length,
    mostAliases: topBy(published.filter((f) => f.aliases.length > 0), (f) => f.aliases.length, 3).map((f) => ({
      title: f.title,
      url: f.finalUrlPath,
      count: f.aliases.length,
    })),
    notesWithoutPage: published.filter((f) => f.isNote && !pageByNotes[f.finalUrlPath]).length,
    partials: partialCount,
    imagesInVault: Object.keys(imageMap).filter((k) => k.startsWith("image/")).length,
    ownHero: pages.filter((p) => p.ownHero).length,
    fallbackHero: pages.filter((p) => !p.ownHero).length,
    namespaces,
  };

  // ── Words ──
  const wordsOf = (list) => list.map((p) => p.words);
  const totalWords = sum(listed, (p) => p.words);
  const buckets = [
    ["Under 100", 0, 100],
    ["100–499", 100, 500],
    ["500–999", 500, 1000],
    ["1,000–1,999", 1000, 2000],
    ["2,000 or more", 2000, Infinity],
  ].map(([label, lo, hi]) => ({
    label,
    content: content.filter((p) => p.words >= lo && p.words < hi).length,
    notes: notes.filter((p) => p.words >= lo && p.words < hi).length,
  }));
  const frequency = new Map();
  const divine = { LORD: 0, GOD: 0, YHWH: 0, "I AM": 0 };
  const fun = { questions: 0, exclamations: 0, greek: 0, hebrew: 0 };
  for (const { body } of bodies) {
    fun.questions += body.match(/\?/g)?.length ?? 0;
    fun.exclamations += body.match(/!/g)?.length ?? 0;
    fun.greek += body.match(/[\u0370-\u03FF\u1F00-\u1FFF]+/g)?.length ?? 0;
    fun.hebrew += body.match(/[\u0590-\u05FF]+/g)?.length ?? 0;
    for (const token of body.toLowerCase().match(/[a-z]+/g) ?? []) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
    for (const name of body.match(/\b(?:LORD|GOD|YHWH|I AM)\b/g) ?? []) divine[name]++;
  }
  const rankedWords = [...frequency.entries()]
    .filter(([word]) => !STOP_WORDS.has(word) && word.length > 1)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const words = {
    total: totalWords,
    listedPages: listed.length,
    mean: listed.length ? Math.round(totalWords / listed.length) : 0,
    median: Math.round(median(wordsOf(listed))),
    contentTotal: sum(content, (p) => p.words),
    notesTotal: sum(notes, (p) => p.words),
    readingHours: totalWords / 230 / 60,
    longest: topBy(listed, (p) => p.words, 5),
    longestContent: topBy(content, (p) => p.words, 5),
    shortest: bottomBy(content.filter((p) => p.words > 0), (p) => p.words, 5),
    buckets,
    vocabulary: frequency.size,
    topWords: rankedWords.slice(0, 25),
    divine,
    fun,
  };

  // ── Titles ──
  const titled = content;
  const letters = {};
  for (const item of alphabeticalByNs.topic ?? []) {
    if (item.redirect) continue;
    const letter = sortableTitle(item.title).trim()[0]?.toUpperCase() ?? "#";
    letters[letter] = (letters[letter] ?? 0) + 1;
  }
  const titles = {
    longest: topBy(titled, (p) => p.title.length, 3),
    shortest: bottomBy(titled, (p) => p.title.length, 3),
    averageLength: titled.length ? sum(titled, (p) => p.title.length) / titled.length : 0,
    letters,
  };

  // ── Links ──
  const inbound = new Map(); // url → distinct pages linking to it
  const outbound = new Map(); // url → distinct pages it links to
  let linkPairs = 0;
  let fromNotes = 0;
  for (const [target, sources] of Object.entries(backlinksMap)) {
    inbound.set(target, sources.length);
    for (const s of sources) {
      linkPairs++;
      outbound.set(s.url, (outbound.get(s.url) ?? 0) + 1);
      if (pagesByUrl.get(s.url)?.isNote) fromNotes++;
    }
  }
  const linkable = content.filter((p) => p.ns !== "category");
  const withInbound = (p) => inbound.get(p.url) ?? 0;
  const withOutbound = (p) => outbound.get(p.url) ?? 0;
  const links = {
    pairs: linkPairs,
    fromNotes,
    mostLinkedTo: topBy(linkable, withInbound, 10).map((p) => ({ ...p, count: withInbound(p) })),
    mostLinking: topBy(pages.filter((p) => p.listed), withOutbound, 10).map((p) => ({ ...p, count: withOutbound(p) })),
    orphans: linkable.filter((p) => withInbound(p) === 0),
    linkNowhere: linkable.filter((p) => withOutbound(p) === 0).length,
    linkable: linkable.length,
    averageInbound: linkable.length ? sum(linkable, withInbound) / linkable.length : 0,
  };

  // ── Categories ──
  const categoryRecords = filesToProcess.filter((f) => f.isCategory && !f.hidden);
  const categoryUrls = new Set(categoryRecords.map((f) => f.finalUrlPath));
  const depthMemo = new Map();
  const depthOf = (url, trail = new Set()) => {
    if (depthMemo.has(url)) return depthMemo.get(url);
    if (trail.has(url)) return 1;
    trail.add(url);
    let deepest = 0;
    for (const m of membersMap[url] ?? []) {
      if (categoryUrls.has(m.url)) deepest = Math.max(deepest, depthOf(m.url, trail));
    }
    trail.delete(url);
    depthMemo.set(url, deepest + 1);
    return deepest + 1;
  };
  const sized = categoryRecords
    .filter((f) => !f.unlisted)
    .map((f) => ({ title: f.title, url: f.finalUrlPath, members: (membersMap[f.finalUrlPath] ?? []).length }));
  const categorizable = content.filter((p) => p.ns !== "category" && p.ns !== "meta");
  const byUrl = new Map(published.map((f) => [f.finalUrlPath, f]));
  const categoryCount = (p) => byUrl.get(p.url)?.categories.length ?? 0;
  const categories = {
    listed: sized.length,
    unlisted: categoryRecords.filter((f) => f.unlisted).length,
    largest: topBy(sized, (c) => c.members, 5),
    smallest: bottomBy(sized.filter((c) => c.members > 0), (c) => c.members, 3),
    averageMembers: sized.length ? sum(sized, (c) => c.members) / sized.length : 0,
    deepest: sized.length ? Math.max(...sized.map((c) => depthOf(c.url))) : 0,
    uncategorized: categorizable.filter((p) => categoryCount(p) === 0),
    inSeveral: categorizable.filter((p) => categoryCount(p) > 1).length,
    mostCategories: topBy(categorizable, categoryCount, 3).map((p) => ({ ...p, count: categoryCount(p) })),
  };

  // ── Structure and weight ──
  const structure = {};
  for (const key of ["headings", "tables", "blockquotes", "figures", "footnotes", "callouts"]) {
    structure[key] = {
      total: sum(pages, (p) => p[key]),
      most: topBy(pages, (p) => p[key], 1).filter((p) => p[key] > 0)[0] ?? null,
    };
  }
  const weight = {
    pages: pages.length,
    totalBytes: sum(pages, (p) => p.bytes),
    averageBytes: pages.length ? sum(pages, (p) => p.bytes) / pages.length : 0,
    heaviest: topBy(pages, (p) => p.bytes, 3),
  };

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
    scripture: scriptureStats(refs, pagesByUrl, pages.filter((p) => p.collected).length),
  };
}
