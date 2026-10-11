import { bookInfoByCwms } from "./refs.js";

// ─── Collecting references for the Scripture index ───
// The refs the linker links are also what the Scripture index lists: each one,
// with the page and the h2/h3 section it appears in.

// Build the canonical short display form for a Bible ref (e.g. "3:16–17", "3").
function buildDisplayShort(
  chapter,
  verseStart,
  rangeVal,
  endVerse,
  endChapter,
) {
  if (verseStart === undefined || verseStart === null) {
    if (endChapter) return `${chapter}\u2013${endChapter}`; // chapter-only range
    return String(chapter);
  }
  if (!rangeVal) return `${chapter}:${verseStart}`;
  if (!endVerse) return `${chapter}:${verseStart}\u2013${rangeVal}`; // same-ch range
  return `${chapter}:${verseStart}\u2013${rangeVal}:${endVerse}`; // cross-ch range
}

// The anchors on a book's page in the Scripture index: an entry's id is its short display
// form with URL-friendly punctuation ("3.16", "3.9-17"), and each chapter that has an entry
// starting in it has a "ch-3" anchor on its first one. The statistics link to these.
export const entryId = (displayShort) => displayShort.replaceAll(":", ".").replaceAll("\u2013", "-");
export const chapterId = (chapter) => `ch-${chapter}`;
export const bookIndexUrl = (slug, id) => `/index/scripture/${slug}#${id}`;

// The index entry for one item from scanBibleRefs. `where` is
// { pageUrl, pageTitle, sectionId, sectionTitle }.
export function collectedRef(item, where) {
  const info = bookInfoByCwms.get(item.cwms);
  const { chapter, verseStart, rangeVal, endVerse, endChapter } = item;
  return {
    bookIndex: info.bookIndex,
    bookSlug: info.bookSlug,
    bookName: info.bookName,
    bookCwms: info.bookCwms,
    chapterNum: parseInt(chapter),
    verseStart: verseStart !== undefined ? parseInt(verseStart) : undefined,
    rangeVal: rangeVal || undefined,
    endVerse: endVerse || undefined,
    endChapter: endChapter || undefined,
    translation: item.translation,
    pageUrl: where.pageUrl,
    pageTitle: where.pageTitle,
    sectionId: where.sectionId,
    sectionTitle: where.sectionTitle,
    // Always the full form ("1:3" in Philemon): the Scripture index and the
    // statistics print it and the linker reads it back, which also shows a book of
    // one chapter without its chapter.
    displayShort: buildDisplayShort(chapter, verseStart, rangeVal, endVerse, endChapter),
  };
}

// Tracks the h2/h3 section the walk is in, to give refs fragment context. Feed
// it every text run and every tag; `id` and `title` are those of the last
// heading that has closed (null before the first).
export function createSectionTracker() {
  // The h2/h3 we're currently inside, and its text so far
  let headingTag = null;
  let headingId = null;
  let headingText = [];

  const section = { id: null, title: null };

  return {
    section,
    text(text) {
      if (headingTag) headingText.push(text);
    },
    tag(tagName, tagFull) {
      if ((tagName !== "h2" && tagName !== "h3") || tagFull.endsWith("/>")) return;
      if (!tagFull.startsWith("</")) {
        // Opening heading: start collecting its text content
        const idM = tagFull.match(/\bid\s*=\s*["']?([^"'\s>]+)["']?/);
        headingTag = tagName;
        headingId = idM ? idM[1] : null;
        headingText = [];
      } else if (headingTag === tagName) {
        // Closing heading: finalise the section context
        section.id = headingId;
        section.title = headingText.join("").replace(/<[^>]*>/g, "").trim();
        headingTag = null;
        headingId = null;
        headingText = [];
      }
    },
  };
}
