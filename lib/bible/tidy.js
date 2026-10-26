import { BuildError } from '../errors.js'
import { BIBLE_BOOKS, LEADING_TRANS_RE, TRANSLATIONS, bookInfoByCwms, cwmsByName, oneChapterCwms } from './refs.js'
import { scanBibleRefs } from './scan.js'
import { checkReference, referenceLabel } from './validate.js'

// ─── Tidying references (`tsgen refs`) ───
// tidyText leaves prose as it is and tidies the references in it. A list of references (a run of them
// with only ";" or "," between, in a sentence or on lines of their own) is written as one: duplicates
// gone, canonical order, each book by its standard abbreviation and named once, each chapter named once.
// Verses that touch are joined into a range only within a chapter, or when a range already crosses a
// chapter boundary ("Ge 1:30-2:2; 2:3" is "Ge 1:30-2:3", but "Ge 1:30-31; 2:1" stays as it is). A whole
// chapter or run of chapters ("Ge 1", "Ge 1-2") is its own entry and never merges with verses. A lone
// reference is only cleaned up: it keeps the book's full name when it is written in full, and the
// words between references ("and") stay. A translation after a reference stays with it, and only
// references of the same translation combine. The lists are on their own lines in a section.

// A verse position is chapter * 1000 + verse (no chapter has a thousand verses); a whole chapter has verse 0.
const position = (chapter, verse = 0) => chapter * 1000 + verse
const chapterOf = (pos) => Math.floor(pos / 1000)
const verseOf = (pos) => pos % 1000

// One scanned item as an entry of its book: { from, to, whole }
function toEntry (item) {
  const chapter = parseInt(item.chapter)
  if (item.verseStart === undefined) {
    return { from: position(chapter), to: position(parseInt(item.endChapter ?? chapter)), whole: true }
  }
  const verse = parseInt(item.verseStart)
  if (item.rangeVal === undefined) return { from: position(chapter, verse), to: position(chapter, verse), whole: false }
  if (item.endVerse === undefined) return { from: position(chapter, verse), to: position(chapter, parseInt(item.rangeVal)), whole: false }
  return { from: position(chapter, verse), to: position(parseInt(item.rangeVal), parseInt(item.endVerse)), whole: false }
}

// Verses that overlap, or that follow on within the chapter the previous one ended in, become one
function mergeVerses (entries) {
  const merged = []
  for (const entry of entries.sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = merged[merged.length - 1]
    if (last && (entry.from <= last.to || (entry.from === last.to + 1 && chapterOf(entry.from) === chapterOf(last.to)))) {
      last.to = Math.max(last.to, entry.to)
    } else {
      merged.push({ ...entry })
    }
  }
  return merged
}

// One book's entries: the text after its name ("1:1-2, 10; 2:2; 4-5") and how many entries it has
function writeEntries (entries) {
  const verses = mergeVerses(entries.filter((entry) => !entry.whole))
  const wholes = [...new Map(entries.filter((entry) => entry.whole).map((entry) => [`${entry.from}-${entry.to}`, entry])).values()]
  let chapter = null // the chapter a following verse number can leave out
  const sorted = [...wholes, ...verses].sort((a, b) => a.from - b.from || a.to - b.to)
  const text = sorted.map((entry, i) => {
    const [first, last] = [entry.from, entry.to]
    let shown
    let join = '; '
    if (entry.whole) {
      shown = first === last ? `${chapterOf(first)}` : `${chapterOf(first)}-${chapterOf(last)}`
      chapter = null
    } else if (chapterOf(first) !== chapterOf(last)) {
      shown = `${chapterOf(first)}:${verseOf(first)}-${chapterOf(last)}:${verseOf(last)}`
      chapter = chapterOf(last)
    } else {
      const span = first === last ? `${verseOf(first)}` : `${verseOf(first)}-${verseOf(last)}`
      if (chapterOf(first) === chapter) {
        shown = span
        join = ', '
      } else {
        shown = `${chapterOf(first)}:${span}`
      }
      chapter = chapterOf(first)
    }
    return (i === 0 ? '' : join) + shown
  }).join('')
  return { text, count: sorted.length }
}

// ─── Spellings ───
// The scanner knows the site's spellings only. Here the usual abbreviations are read too, with or
// without a period and a space after a number ("Gen.", "1 Cor.", "Matt"), and become the standard one.
const LOOSE = {
  Ge: ['Gen', 'Gn'],
  Ex: ['Exod', 'Exo'],
  Lev: ['Lv', 'Levit'],
  Nu: ['Num', 'Nm', 'Numb'],
  Dt: ['Deut', 'Deu'],
  Jos: ['Josh'],
  Jdg: ['Judg', 'Jdgs'],
  Ru: ['Rth'],
  '1Sa': ['1Sam'],
  '2Sa': ['2Sam'],
  '1Ki': ['1Kgs', '1Kg'],
  '2Ki': ['2Kgs', '2Kg'],
  '1Ch': ['1Chr', '1Chron'],
  '2Ch': ['2Chr', '2Chron'],
  Ne: ['Neh'],
  Est: ['Esth'],
  Ps: ['Pss', 'Psa', 'Psm'],
  Pr: ['Prov', 'Prv'],
  Ecc: ['Eccl', 'Eccles', 'Qoh'],
  SS: ['Song', 'SOS', 'Cant'],
  Jer: ['Jr'],
  La: ['Lam'],
  Eze: ['Ezek', 'Ezk'],
  Da: ['Dan', 'Dn'],
  Ob: ['Obad', 'Oba'],
  Jnh: ['Jon'],
  Mic: ['Mc'],
  Na: ['Nah'],
  Hab: ['Hb'],
  Zep: ['Zeph', 'Zp'],
  Hag: ['Hg'],
  Zec: ['Zech', 'Zc'],
  Mal: ['Ml'],
  Mt: ['Matt'],
  Mk: ['Mrk', 'Mar'],
  Lk: ['Luk'],
  Jn: ['Joh'],
  Ac: ['Act'],
  Ro: ['Rom', 'Rm'],
  '1Co': ['1Cor'],
  '2Co': ['2Cor'],
  Gal: ['Ga'],
  Php: ['Phil', 'Phi', 'Pp'],
  '1Th': ['1Thess', '1Thes'],
  '2Th': ['2Thess', '2Thes'],
  '1Ti': ['1Tim'],
  '2Ti': ['2Tim'],
  Phm: ['Philem', 'Phlm'],
  Jas: ['Jm'],
  '1Pe': ['1Pet', '1Pt'],
  '2Pe': ['2Pet', '2Pt'],
  '1Jn': ['1Joh'],
  '2Jn': ['2Joh'],
  '3Jn': ['3Joh'],
  Rev: ['Rv']
}
const stripped = (name) => name.replace(/\s+/g, '')
// Every spelling, without spaces, to its book's standard abbreviation
const cwmsByLooseName = new Map()
for (const names of BIBLE_BOOKS) for (const name of names) cwmsByLooseName.set(stripped(name), names[names.length - 1])
for (const [cwms, names] of Object.entries(LOOSE)) for (const name of names) cwmsByLooseName.set(name, cwms)

// A book's full names: all its names but the last (its abbreviation), or the one it has
const fullNames = new Map(BIBLE_BOOKS.map((names) => [names[names.length - 1], names.length === 1 ? names : names.slice(0, -1)]))
const isFullName = (cwms, name) => fullNames.get(cwms).includes(name.replace(/\s+/g, ' '))

// A capitalized name (with a number before it, and "of" in "Song of Songs") with a number after it,
// and the period the name may have
const NAME_BEFORE_NUMBER = /(?<![\w.])([123]\s?)?([A-Z][a-z]+(?:\s+of\s+[A-Z][a-z]+)?)(\.?)(?=\s*\d)/g

// The line with every book name the scanner doesn't know made the one it does
function standardSpellings (line) {
  return line.replace(NAME_BEFORE_NUMBER, (all, number = '', word, period) => {
    const cwms = cwmsByLooseName.get(number.trim() + stripped(word))
    if (!cwms) return all
    const name = number + word
    if (!period && cwmsByName.has(name.toLowerCase().replace(/\s+/g, ' '))) return all
    return isFullName(cwms, name) ? name : cwms
  })
}

// In a book of one chapter a lone number is a verse here ("Phm 3-5" is "Phm 1:3-5", "Jude 3, 5" is
// "Jude 1:3, 5"), though the site reads it as a chapter that doesn't exist. "Phm 1" is still the whole letter.
const asVerse = (item) => oneChapterCwms.has(item.cwms) && item.verseStart === undefined && item.chapter !== '1'
  ? { ...item, chapter: '1', verseStart: item.chapter, rangeVal: item.endChapter, endChapter: undefined }
  : item

// The items of one line, each named one with the book's name as it is written
function scanLine (line) {
  const ctx = { lastCwms: null, lastChapter: null, chapterLevel: false, translation: 'ESV' }
  return scanBibleRefs(line, ctx).map((item) => item.named
    ? { ...item, written: /^(\d?\s*[A-Za-z][A-Za-z ]*?)\s*\d/.exec(line.slice(item.start, item.end))?.[1].replace(/\s+/g, ' ') }
    : item)
}

// A list of items as text: "Ge 1:1-2, 10; 2:2 KJV; Jn 3:16"
function writeItems (items) {
  const books = new Map() // "cwms translation" → { info, translation, entries, written }
  for (const scanned of items) {
    const item = asVerse(scanned)
    const problem = checkReference(item)
    if (problem) throw new BuildError(`${referenceLabel(item)}: ${problem}`)
    const key = `${item.cwms} ${item.translation}`
    if (!books.has(key)) books.set(key, { info: bookInfoByCwms.get(item.cwms), translation: item.translation, entries: [], written: item.written })
    books.get(key).entries.push(toEntry(item))
  }
  const groups = [...books.values()].sort((a, b) => a.info.bookIndex - b.info.bookIndex || a.translation.localeCompare(b.translation))
  const lone = groups.length === 1 && writeEntries(groups[0].entries).count === 1
  return groups.map(({ info, translation, entries, written }) => {
    const name = lone && isFullName(info.bookCwms, written) ? written : info.bookCwms
    return `${name} ${writeEntries(entries).text}${translation === 'ESV' ? '' : ` ${translation}`}`
  }).join('; ')
}

// The text of any lines: the references in it as one list. A reference to a chapter or verse that
// doesn't exist fails, as it does on the site. '' when there are none.
export function tidyReferences (text) {
  return writeItems(text.split(/\r?\n/).flatMap((line) => scanLine(standardSpellings(line)).filter((item) => !item.optOut)))
}

// ─── Prose and lists ───
const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+/
const TRANSLATION = new RegExp(`\\b(?:${TRANSLATIONS.join('|')})\\b`, 'g')
// What may lie between two references of a list: a translation, then separators
const GAP = new RegExp(`^(?:\\s*(?:${TRANSLATIONS.join('|')})\\b)?[\\s;,]*$`)

// A line of nothing but references: at least one, and no prose, opt-out or other text beside them
function isReferenceLine (line) {
  const text = standardSpellings(line.replace(BULLET, ''))
  const items = scanLine(text)
  if (items.length === 0 || items.some((item) => item.optOut)) return false
  let rest = text
  for (const { start, end } of items.toReversed()) rest = rest.slice(0, start) + ' ' + rest.slice(end)
  return /^[\s;,.]*$/.test(rest.replace(TRANSLATION, ''))
}

// A line of prose, with each list of references in it tidied where it stands
function tidyProse (line) {
  const text = standardSpellings(line)
  const items = scanLine(text)
  let out = ''
  let pos = 0
  for (let i = 0; i < items.length; i++) {
    if (items[i].optOut) continue
    let last = i
    while (last + 1 < items.length && !items[last + 1].optOut && GAP.test(text.slice(items[last].end, items[last + 1].start))) last++
    const end = items[last].end + (LEADING_TRANS_RE.exec(text.slice(items[last].end))?.[0].length ?? 0)
    out += text.slice(pos, items[i].start) + writeItems(items.slice(i, last + 1))
    pos = end
    i = last
  }
  return out + text.slice(pos)
}

// `text` is anything. The prose, and the blank lines between, stay as they are.
export function tidyText (text) {
  const out = []
  let list = []
  const flush = () => {
    if (list.length > 0) out.push(tidyReferences(list.join('\n')))
    list = []
  }
  for (const line of text.split('\n')) {
    if (isReferenceLine(line)) {
      list.push(line.replace(BULLET, ''))
    } else {
      flush()
      out.push(tidyProse(line))
    }
  }
  flush()
  return out.join('\n')
}
