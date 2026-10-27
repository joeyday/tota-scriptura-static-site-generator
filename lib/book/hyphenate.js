// ─── Soft hyphens ───
// The book is hyphenated here, not by Chrome: Chrome on a Mac hyphenates with Apple's dictionary, and on Linux
// (a CI runner) it has none, so the same book came out with different lines on each. A soft hyphen is a place a
// line may break, shown only where it does, so the book's CSS keeps `hyphens: manual` and the breaks are these.
import english from 'hyphen/en-us/index.js'
import { mapText } from '../html/walk.js'

const SHY = '­'

// No break leaves fewer than this many letters on either side of the hyphen
const MIN_SIDE = 3

// Only plain lowercase English words of six letters or more: that leaves out a name or an acronym (capitals),
// anything transliterated or in Greek or Hebrew (not a-z), a contraction, and the parts of a hyphenated compound
// (the lookarounds: a letter, mark, digit, apostrophe or hyphen on either side).
const WORD = /(?<![\p{L}\p{M}\p{N}'’-])[a-z]{6,}(?![\p{L}\p{M}\p{N}'’-])/gu

// What is never hyphenated: code, an abbreviation (it is read whole), a footnote number, a heading (hyphens are
// off there on purpose) and a term in small capitals, which is a <dt> unless the commentary runs it into its text
const SKIP = ['code', 'pre', 'abbr', 'sup', 'script', 'style', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']

const hyphenated = (word) => {
  const parts = english.hyphenateSync(word, { hyphenChar: SHY }).split(SHY)
  let out = parts[0]
  let before = parts[0].length
  for (const part of parts.slice(1)) {
    out += (before >= MIN_SIDE && word.length - before >= MIN_SIDE ? SHY : '') + part
    before += part.length
  }
  return out
}

// html with soft hyphens in the words of its text. `commentary` is a commentary page, whose terms are run-in text.
export function hyphenate (html, { commentary = false } = {}) {
  const skip = new Set(commentary ? SKIP : [...SKIP, 'dt'])
  return mapText(html, skip, (text) => text.replace(WORD, hyphenated))
}
