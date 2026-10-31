import { oneChapterCwms } from './refs.js'
import { buildDisplayShort } from './collect.js'
import { referenceLabel } from './validate.js'

// ─── Turning references into links ───
// renderBibleLinks rewrites a run of plain text, linking the references that
// scanBibleRefs found in it.

function buildReflyUrl (
  cwms,
  chapter,
  verseStart,
  rangeVal,
  endVerse,
  endChapter,
  translation = 'ESV'
) {
  // rangeVal = endVerse (same-chapter) or endChapter (cross-chapter verse ref)
  // endVerse = undefined (same-chapter) or the end verse (cross-chapter)
  // endChapter = end chapter for chapter-only ranges (no verse)
  // URL: https://ref.ly/{cwms}{chapter}[.{verse}[-{endVerse}|{endChapter}.{endVerse}]|[-{endChapter}]];{translation}
  let ref = `${cwms}${chapter}`
  if (verseStart) {
    ref += `.${verseStart}`
    if (rangeVal) {
      if (endVerse) {
        // Cross-chapter: rangeVal is end chapter, endVerse is end verse
        ref += `-${rangeVal}.${endVerse}`
      } else {
        // Same-chapter: rangeVal is end verse
        ref += `-${rangeVal}`
      }
    }
  } else if (endChapter) {
    // Chapter-only range, e.g. "Romans 1–2" → Ro1-2
    ref += `-${endChapter}`
  }
  return `https://ref.ly/${ref};${translation}`
}

function makeBibleRefLink (url, rawText, label) {
  let lt = rawText.replace(/\s/g, '\u00a0')
  lt = lt.replace(/(\d)\s*[-\u2014]\s*(\d)/g, '$1\u2013$2')
  const aria = label ? ` aria-label="${label}"` : ''
  return `<a href="${url}" class="external bible-ref" target="_blank" rel="noopener noreferrer"${aria}>${lt}</a>`
}

// A reference without its book ("3:16–17"; "3" in a book of one chapter), for a page that says the
// book some other way, such as a column heading. A continuation never had one.
function withoutBook (item, written) {
  if (!item.named) return written
  const short = buildDisplayShort(item.chapter, item.verseStart, item.rangeVal, item.endVerse, item.endChapter)
  const oneChapter = oneChapterCwms.has(item.cwms) && item.chapter === '1' && item.verseStart !== undefined && item.endVerse === undefined
  return oneChapter ? short.replace(/^1:/, '') : short
}

const TRAILING_TRANSLATION_RE = /(<\/a>)\s+(ESV|KJV|NASB|NIV|NKJV|NLT|NRSV)\b/g

// With `bookNames` off the links read without their book and say it in full in their aria-label
// ("Matthew 3:16–17", and the translation when it is not the ESV).
export function renderBibleLinks (text, items, bookNames = true) {
  if (items.length === 0) return text
  let result = ''
  let pos = 0
  for (const item of items) {
    result += text.slice(pos, item.start)
    if (item.optOut) {
      // Show the text without the leading "!"
      result += text.slice(item.start + 1, item.end)
    } else {
      const url = buildReflyUrl(
        item.cwms,
        item.chapter,
        item.verseStart,
        item.rangeVal,
        item.endVerse,
        item.endChapter,
        item.translation
      )
      const written = item.display ?? text.slice(item.start, item.end)
      result += bookNames
        ? makeBibleRefLink(url, written)
        : makeBibleRefLink(url, withoutBook(item, written), referenceLabel(item) + (item.translation === 'ESV' ? '' : ` ${item.translation}`))
    }
    pos = item.end
  }
  result += text.slice(pos)
  // Move each trailing translation abbreviation inside the preceding closing </a>
  // e.g. "3:1–4</a> KJV" → "3:1–4 KJV</a>"
  return result.replace(TRAILING_TRANSLATION_RE, ' $2$1')
}
