import { walkHtml } from "../html/walk.js";
import { collectedRef, createSectionTracker } from "./collect.js";
import { renderBibleLinks } from "./link.js";
import { BLOCK_TAGS, SKIP_TAGS } from "./refs.js";
import { scanBibleRefs } from "./scan.js";
import { checkReference, referenceLabel } from "./validate.js";

// ─── The Bible-reference pass ───
// One walk over a page's HTML does both jobs on each text run: the references
// are found once (scan.js), then linked and, for a content page, collected for
// the Scripture index. Returns { html, refs, problems }; `page` is { url, title }
// for a content page and null for a generated one (nothing collected). A
// reference that can't exist (a chapter or verse its book doesn't have) is a
// problem, which the output turns into a build failure; a `!` opts a reference out.
export function processBibleRefs(html, page) {
  const out = [];
  const refs = [];
  const problems = [];
  const tracker = page ? createSectionTracker() : null;
  const ctx = {
    lastCwms: null,
    lastChapter: null,
    chapterLevel: false,
    translation: "ESV",
  };

  walkHtml(html, SKIP_TAGS, {
    onText(text, skipped) {
      tracker?.text(text);
      // A reference needs a digit, and most text runs have none.
      if (skipped || !/\d/.test(text)) {
        out.push(text);
        return;
      }
      const items = scanBibleRefs(text, ctx);
      const where = page && {
        pageUrl: page.url,
        pageTitle: page.title,
        sectionId: tracker.section.id,
        sectionTitle: tracker.section.title,
      };
      for (const item of items) {
        if (item.optOut) continue;
        const reason = checkReference(item);
        if (reason) {
          // Never collected, so no generated page can hold a reference that can't
          // exist. A continuation ("71" after "Romans 12:1–15:13") says what it was
          // read as.
          const written = text.slice(item.start, item.end);
          problems.push(
            item.named
              ? `"${written}": ${reason}`
              : `"${written}" (read as ${referenceLabel(item)}): ${reason}`,
          );
        } else if (page) {
          refs.push(collectedRef(item, where));
        }
      }
      out.push(renderBibleLinks(text, items));
    },
    onTag(tagName, tagFull) {
      out.push(tagFull);
      if (!tagName) return; // HTML comment or CDATA
      tracker?.tag(tagName, tagFull);
      // Continuation refs don't carry across a block boundary
      if (BLOCK_TAGS.has(tagName)) {
        ctx.lastCwms = null;
        ctx.lastChapter = null;
        ctx.chapterLevel = false;
        ctx.translation = "ESV";
      }
    },
  });

  return { html: out.join(""), refs, problems };
}
