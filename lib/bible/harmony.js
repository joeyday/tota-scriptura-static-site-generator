import { readFileSync } from 'node:fs'
import { VERSES_PER_CHAPTER } from './versification.js'

// ─── Harmony passages ───
// Places where whole sections of books run in parallel: the synoptic Gospels, Samuel and Kings with
// Chronicles, and the Psalms that are repeated in the histories. The table is `harmony.json`, which says
// how it is written and is meant to be read by other tools too. Each row pairs a main passage with a
// parallel, and `match` says how their verses go together: "each" one by one, in order (the two are
// the same length), or "all", each verse of one with every verse of the other.
//
// A verse is an id: book * 1,000,000 + chapter * 1,000 + verse, with the book's index in the order of
// BIBLE_BOOKS.

const OSIS = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev'.split(' ')

export const verseId = (bookIndex, chapter, verse) => bookIndex * 1000000 + chapter * 1000 + verse
export const bookOf = (id) => Math.floor(id / 1000000)
export const chapterOf = (id) => Math.floor((id % 1000000) / 1000)
export const verseOf = (id) => id % 1000
export const positionOf = (id) => id % 1000000

// ─── Reading the table ───
// "Matt.12.22" or "Matt.12.22-Matt.12.30" as the ids of its verses, in order
function expand (piece) {
  const [from, to = from] = piece.split('-').map((osis) => {
    const [book, chapter, verse] = osis.split('.')
    const bookIndex = OSIS.indexOf(book)
    const chapters = VERSES_PER_CHAPTER[bookIndex]
    if (!(chapters && chapter >= 1 && chapter <= chapters.length && verse >= 1 && verse <= chapters[chapter - 1])) {
      throw new Error(`harmony.json: ${osis} in "${piece}" doesn't exist`)
    }
    return verseId(bookIndex, Number(chapter), Number(verse))
  })
  if (to < from) throw new Error(`harmony.json: "${piece}" runs backwards`)
  const ids = []
  for (let id = from; id <= to; id++) {
    if (verseOf(id) <= VERSES_PER_CHAPTER[bookOf(id)][chapterOf(id) - 1]) ids.push(id)
    else id = verseId(bookOf(id), chapterOf(id) + 1, 0)
  }
  return ids
}

const verses = (member) => [member].flat().flatMap(expand)

let table = null // { rows, byVerse } once read
// rows: [{ main: [id…], parallel: [id…], each }]; byVerse: id → [{ row, isMain, index }]
function load () {
  if (table) return table
  const { sections } = JSON.parse(readFileSync(new URL('./harmony.json', import.meta.url), 'utf8'))
  const rows = sections.flatMap((section) => section.rows).map(({ main, parallel, match }) => {
    const row = { main: verses(main), parallel: verses(parallel), each: match === 'each' }
    if (match !== 'each' && match !== 'all') throw new Error(`harmony.json: match is "${match}" in ${main}`)
    if (row.each && row.main.length !== row.parallel.length) throw new Error(`harmony.json: ${main} and ${parallel} match each but aren't the same length`)
    return row
  })
  const byVerse = new Map()
  for (const row of rows) {
    for (const isMain of [true, false]) {
      row[isMain ? 'main' : 'parallel'].forEach((id, index) => {
        if (!byVerse.has(id)) byVerse.set(id, [])
        byVerse.get(id).push({ row, isMain, index })
      })
    }
  }
  table = { rows, byVerse }
  return table
}

// Every row, for the tests
export const harmonyRows = () => load().rows

// Whether this verse is in the table at all
export const hasHarmony = (id) => load().byVerse.has(id)

// The verses of `to` that go with verse `index` of `from`: the one beside it, or all of them
const partners = (row, index, to) => row.each ? [to[index]] : to

// ─── Looking verses up ───
// `passed` is a Map from verse id to whether the verse was cited as part of a whole chapter. Returns a
// Map from each main verse to { parallels, whole }: the Set of its parallels, and whether every verse
// that led to it was part of a whole chapter. A verse that is a main verse of its rows, or in none,
// stays; a verse that is a parallel is replaced by the verse it parallels. A main verse comes with
// every parallel the table has.
export function harmonize (passed) {
  const { byVerse } = load()
  const mains = new Map()
  const addMain = (id, whole) => {
    const main = mains.get(id)
    if (main) main.whole &&= whole
    else mains.set(id, { parallels: new Set(), whole })
  }
  for (const [id, whole] of passed) {
    const spots = byVerse.get(id)
    if (!spots) { addMain(id, whole); continue }
    for (const { row, isMain, index } of spots) {
      if (isMain) addMain(id, whole)
      else partners(row, index, row.main).forEach((main) => addMain(main, whole))
    }
  }
  for (const [id, { parallels }] of mains) {
    for (const { row, isMain, index } of byVerse.get(id) ?? []) {
      if (isMain) partners(row, index, row.parallel).forEach((parallel) => parallels.add(parallel))
    }
  }
  for (const { parallels } of mains.values()) for (const id of parallels) if (mains.has(id)) parallels.delete(id)
  return mains
}
