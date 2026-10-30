import { BuildError } from '../errors.js'
import { BIBLE_BOOKS, LEADING_TRANS_RE, TRANSLATIONS, bookInfoByCwms, cwmsByName, oneChapterCwms } from './refs.js'
import { scanBibleRefs } from './scan.js'
import { checkReference, referenceLabel } from './validate.js'
import { bookOf, harmonize, hasHarmony, positionOf, verseId } from './harmony.js'
import { VERSES_PER_CHAPTER } from './versification.js'

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
//
// Harmony passages (lib/bible/harmony.js) are written the same way: a list is tidied into main
// passages, each with the parallels of the other books in "(cf. …)" after it ("2Sa 7:22 (cf. 1Ch 17:20)"),
// whichever of them was written and in whichever order. A list on lines of its own gets its parallels
// added, a list in prose only when it has two references or more, or a "(cf. …)" of its own that is all
// parallels. Any other "(cf. …)" is left alone.

// Ranges are written with an en dash, and read with a hyphen, an en dash or an em dash.
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

// The parallels of two entries that become one: a Set of verse ids, or none
const joinParallels = (a, b) => a && b ? new Set([...a, ...b]) : a ?? b

// Verses that overlap, or that follow on within the chapter the previous one ended in, become one
function mergeVerses (entries) {
  const merged = []
  for (const entry of entries.sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = merged[merged.length - 1]
    if (last && (entry.from <= last.to || (entry.from === last.to + 1 && chapterOf(entry.from) === chapterOf(last.to)))) {
      last.to = Math.max(last.to, entry.to)
      last.parallels = joinParallels(last.parallels, entry.parallels)
    } else {
      merged.push({ ...entry })
    }
  }
  return merged
}

// One book's entries as units: the text after its name ("1:1-2, 10; 2:2; 4-5"), cut at each ";", and
// how many entries it has. A unit is what the parallels of its verses go after: a run of verses in one
// chapter, or a whole chapter, or a range across chapters.
function writeEntries (entries) {
  const verses = mergeVerses(entries.filter((entry) => !entry.whole))
  const wholes = new Map()
  for (const entry of entries.filter((entry) => entry.whole)) {
    const key = `${entry.from}-${entry.to}`
    wholes.set(key, wholes.has(key) ? { ...entry, parallels: joinParallels(wholes.get(key).parallels, entry.parallels) } : entry)
  }
  let chapter = null // the chapter a following verse number can leave out
  const sorted = [...wholes.values(), ...verses].sort((a, b) => a.from - b.from || a.to - b.to)
  const units = []
  sorted.forEach((entry, i) => {
    const [first, last] = [entry.from, entry.to]
    let shown
    let join = '; '
    if (entry.whole) {
      shown = first === last ? `${chapterOf(first)}` : `${chapterOf(first)}–${chapterOf(last)}`
      chapter = null
    } else if (chapterOf(first) !== chapterOf(last)) {
      shown = `${chapterOf(first)}:${verseOf(first)}–${chapterOf(last)}:${verseOf(last)}`
      chapter = chapterOf(last)
    } else {
      const span = first === last ? `${verseOf(first)}` : `${verseOf(first)}–${verseOf(last)}`
      if (chapterOf(first) === chapter) {
        shown = span
        join = ', '
      } else {
        shown = `${chapterOf(first)}:${span}`
      }
      chapter = chapterOf(first)
    }
    if (i === 0 || join === '; ') {
      units.push({ text: shown, parallels: entry.parallels, whole: entry.whole })
    } else {
      const unit = units[units.length - 1]
      unit.text += join + shown
      unit.parallels = joinParallels(unit.parallels, entry.parallels)
    }
  })
  return { units, text: units.map((unit) => unit.text).join('; '), count: sorted.length }
}

// ─── Harmony ───
const bookCwms = (bookIndex) => BIBLE_BOOKS[bookIndex][BIBLE_BOOKS[bookIndex].length - 1]

// The ids of the verses an entry covers: a whole chapter is all of its verses
function entryVerses (bookIndex, entry) {
  const chapters = VERSES_PER_CHAPTER[bookIndex]
  const ids = []
  for (let chapter = chapterOf(entry.from); chapter <= chapterOf(entry.to); chapter++) {
    const first = chapter === chapterOf(entry.from) && !entry.whole ? verseOf(entry.from) : 1
    const last = chapter === chapterOf(entry.to) && !entry.whole ? verseOf(entry.to) : chapters[chapter - 1]
    for (let verse = first; verse <= last; verse++) ids.push(verseId(bookIndex, chapter, verse))
  }
  return ids
}

// A book's verses (a Map from id to { whole, parallels }) as entries: a chapter whose verses are all
// whole is a whole chapter, and the rest are runs of verses (across a chapter boundary where they
// reach it)
function entriesOf (bookIndex, verses) {
  const chapters = VERSES_PER_CHAPTER[bookIndex]
  const ids = [...verses.keys()].sort((a, b) => a - b)
  const inChapter = new Map()
  for (const id of ids) inChapter.set(chapterOf(positionOf(id)), [...inChapter.get(chapterOf(positionOf(id))) ?? [], id])
  const wholeChapters = [...inChapter].filter(([chapter, list]) => list.length === chapters[chapter - 1] && list.every((id) => verses.get(id).whole))
  const parallelsOf = (list) => list.map((id) => verses.get(id).parallels).reduce(joinParallels, undefined)
  const entries = []
  for (const [chapter, list] of wholeChapters) {
    const last = entries[entries.length - 1]
    if (last?.whole && chapterOf(last.to) === chapter - 1) {
      last.to = position(chapter)
      last.parallels = joinParallels(last.parallels, parallelsOf(list))
    } else {
      entries.push({ from: position(chapter), to: position(chapter), whole: true, parallels: parallelsOf(list) })
    }
  }
  const whole = new Set(wholeChapters.map(([chapter]) => chapter))
  let run = null
  for (const id of ids.filter((id) => !whole.has(chapterOf(positionOf(id))))) {
    const pos = positionOf(id)
    const follows = run && (pos === run.to + 1 || (verseOf(run.to) === chapters[chapterOf(run.to) - 1] && pos === position(chapterOf(run.to) + 1, 1)))
    if (follows) {
      run.to = pos
      run.parallels = joinParallels(run.parallels, verses.get(id).parallels)
    } else {
      run = { from: pos, to: pos, whole: false, parallels: verses.get(id).parallels }
      entries.push(run)
    }
  }
  return entries
}

// The parallels of a unit as a list: "Mk 1:3; Lk 3:4". A whole chapter's parallels are whole chapters
// where they cover them.
function writeParallels (ids, whole, translation) {
  const byBook = new Map()
  for (const id of ids) {
    if (!byBook.has(bookOf(id))) byBook.set(bookOf(id), new Map())
    byBook.get(bookOf(id)).set(id, { whole })
  }
  return [...byBook].sort((a, b) => a[0] - b[0]).map(([bookIndex, verses]) =>
    `${bookCwms(bookIndex)} ${writeEntries(entriesOf(bookIndex, verses)).text}${translation === 'ESV' ? '' : ` ${translation}`}`
  ).join('; ')
}

// The main passages of the groups, with their parallels. A passage of the table, cited as a parallel
// or as a main, is replaced by its main passage and the parallels the table has for it; the rest of
// the list stays as it was.
function applyHarmony (books) {
  const byTranslation = new Map()
  for (const group of books.values()) byTranslation.set(group.translation, [...byTranslation.get(group.translation) ?? [], group])
  for (const [translation, groups] of byTranslation) {
    const passed = new Map()
    for (const group of groups) {
      group.entries = group.entries.filter((entry) => {
        const ids = entryVerses(group.info.bookIndex, entry)
        if (!ids.some(hasHarmony)) return true
        for (const id of ids) passed.set(id, (passed.get(id) ?? true) && entry.whole)
        return false
      })
    }
    const verses = new Map() // book index → id → { whole, parallels }
    for (const [id, { parallels, whole }] of harmonize(passed)) {
      if (!verses.has(bookOf(id))) verses.set(bookOf(id), new Map())
      verses.get(bookOf(id)).set(id, { whole, parallels: parallels.size ? parallels : undefined })
    }
    for (const [bookIndex, bookVerses] of verses) {
      const key = `${bookCwms(bookIndex)} ${translation}`
      if (!books.has(key)) books.set(key, { info: bookInfoByCwms.get(bookCwms(bookIndex)), translation, entries: [] })
      books.get(key).entries.push(...entriesOf(bookIndex, bookVerses))
    }
  }
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

// A list of items as text: "Ge 1:1-2, 10; 2:2 KJV; Jn 3:16". Harmony passages in it are written as main
// passages with their parallels, "2Sa 7:22 (cf. 1Ch 17:20)", when `harmony` is set. A book is named
// again after a "(cf. …)", since the parallels have come between.
function writeItems (items, harmony = false) {
  const books = new Map() // "cwms translation" → { info, translation, entries, written }
  for (const scanned of items) {
    const item = asVerse(scanned)
    const problem = checkReference(item)
    if (problem) throw new BuildError(`${referenceLabel(item)}: ${problem}`)
    const key = `${item.cwms} ${item.translation}`
    if (!books.has(key)) books.set(key, { info: bookInfoByCwms.get(item.cwms), translation: item.translation, entries: [], written: item.written })
    books.get(key).entries.push(toEntry(item))
  }
  if (harmony) applyHarmony(books)
  const groups = [...books.values()].filter((group) => group.entries.length > 0)
    .sort((a, b) => a.info.bookIndex - b.info.bookIndex || a.translation.localeCompare(b.translation))
  const lone = groups.length === 1 && writeEntries(groups[0].entries).count === 1
  return groups.map(({ info, translation, entries, written }) => {
    const name = lone && written && isFullName(info.bookCwms, written) ? written : info.bookCwms
    const suffix = translation === 'ESV' ? '' : ` ${translation}`
    const segments = [[]] // each ends at a unit that has parallels
    for (const unit of writeEntries(entries).units) {
      segments[segments.length - 1].push(unit)
      if (unit.parallels) segments.push([])
    }
    return segments.filter((units) => units.length > 0).map((units) => {
      const parallels = units[units.length - 1].parallels
      const cf = parallels ? ` (cf. ${writeParallels(parallels, units[units.length - 1].whole, translation)})` : ''
      return `${name} ${units.map((unit) => unit.text).join('; ')}${suffix}${cf}`
    }).join('; ')
  }).join('; ')
}

// The text of any lines: the references in it as one list. A reference to a chapter or verse that
// doesn't exist fails, as it does on the site. '' when there are none.
export function tidyReferences (text, harmonies = true) {
  return writeItems(text.split(/\r?\n/).flatMap((line) => scanLine(standardSpellings(line)).filter((item) => !item.optOut)), harmonies)
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

// What may open and close a "(cf. …)", with the translation its last reference may have
const CF_OPEN = new RegExp(`^(?:\\s*(?:${TRANSLATIONS.join('|')})\\b)?\\s*\\(cf\\.\\s*$`)
const CF_CLOSE = new RegExp(`^(?:\\s*(?:${TRANSLATIONS.join('|')})\\b)?\\s*\\)`)

// The verses an item cites, by id, each with whether it was cited as a whole chapter
function itemVerses (item) {
  const entry = toEntry(asVerse(item))
  return entryVerses(bookInfoByCwms.get(item.cwms).bookIndex, entry).map((id) => [id, entry.whole])
}

// Whether every verse of a "(cf. …)" is one harmony already gives for the references before it: a
// parallel of one of them, or the passage they are parallel to. Such a parenthesis says nothing the
// list won't, and is written over.
function isHarmonyParen (before, paren) {
  return paren.every((item) => {
    const related = new Set()
    for (const other of before.filter((other) => other.translation === item.translation)) {
      for (const [id, { parallels }] of harmonize(new Map(itemVerses(other)))) {
        related.add(id)
        parallels.forEach((parallel) => related.add(parallel))
      }
    }
    return itemVerses(item).every(([id]) => related.has(id))
  })
}

// A line of prose, with each list of references in it tidied where it stands. A "(cf. …)" that is all
// parallels of the references before it is written over by the parallels harmony gives them.
function tidyProse (line, harmonies) {
  const text = standardSpellings(line)
  const items = scanLine(text)
  let out = ''
  let pos = 0
  for (let i = 0; i < items.length; i++) {
    if (items[i].optOut) continue
    let last = i
    let tail = items[i].end // where the list has got to, bar a translation
    let cf = false
    const written = new Set() // the references of "(cf. …)"s that harmony writes again
    for (;;) {
      const next = items[last + 1]
      if (!next || next.optOut) break
      const gap = text.slice(tail, next.start)
      if (GAP.test(gap)) {
        last++
        tail = next.end
      } else if (harmonies && CF_OPEN.test(gap)) {
        let close = last + 1
        while (close + 1 < items.length && !items[close + 1].optOut && GAP.test(text.slice(items[close].end, items[close + 1].start))) close++
        const closing = CF_CLOSE.exec(text.slice(items[close].end))
        if (!closing || !isHarmonyParen(items.slice(i, last + 1), items.slice(last + 1, close + 1))) break
        for (let n = last + 1; n <= close; n++) written.add(items[n])
        last = close
        tail = items[close].end + closing[0].length
        cf = true
      } else {
        break
      }
    }
    const end = tail + (cf && tail !== items[last].end ? 0 : LEADING_TRANS_RE.exec(text.slice(tail))?.[0].length ?? 0)
    // A list that opens a "(cf. …)" of the writer's own is left as it is
    const harmony = harmonies && (cf || last > i) && !/\(cf\.\s*$/.test(text.slice(0, items[i].start))
    out += text.slice(pos, items[i].start) + writeItems(items.slice(i, last + 1).filter((item) => !item.optOut && !written.has(item)), harmony)
    pos = end
    i = last
  }
  return out + text.slice(pos)
}

// `text` is anything. The prose, and the blank lines between, stay as they are.
export function tidyText (text, harmonies = true) {
  const out = []
  let list = []
  const flush = () => {
    if (list.length > 0) out.push(tidyReferences(list.join('\n'), harmonies))
    list = []
  }
  for (const line of text.split('\n')) {
    if (isReferenceLine(line)) {
      list.push(line.replace(BULLET, ''))
    } else {
      flush()
      out.push(tidyProse(line, harmonies))
    }
  }
  flush()
  return out.join('\n')
}
