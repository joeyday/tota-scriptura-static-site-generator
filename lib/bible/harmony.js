import { readFileSync } from 'node:fs'
import { bookInfoByCwms } from './refs.js'
import { VERSES_PER_CHAPTER } from './versification.js'

// ─── Harmony passages ───
// Places where whole sections of books run in parallel: the synoptic Gospels, Samuel and Kings with
// Chronicles, and the Psalms that are repeated in the histories. The table is `harmony.txt`: one row
// per line, each row two or more members joined by "=", each member a book and the verses it spends
// on the passage ("Mt 3:1-6 = Mk 1:2-6 = Lk 3:1-6"). Members of a row are matched verse by verse, in
// order, when they are the same length; where they aren't, a verse of one is matched with the whole of
// the other (a Gospel that tells in one verse what another tells in two); a row that starts with "~"
// is matched that way whatever its lengths. A member may be several pieces ("Ps 106:1, 47-48"), and the
// rows are cut wherever the books drift apart.
//
// A verse is an id: book * 1,000,000 + chapter * 1,000 + verse, with the book in the order of
// BIBLE_BOOKS. A row's main member is the first canonically, except that Psalms is main against any
// book that reproduces it.

const PSALMS = bookInfoByCwms.get('Ps').bookIndex

export const verseId = (bookIndex, chapter, verse) => bookIndex * 1000000 + chapter * 1000 + verse
export const bookOf = (id) => Math.floor(id / 1000000)
export const chapterOf = (id) => Math.floor((id % 1000000) / 1000)
export const verseOf = (id) => id % 1000
export const positionOf = (id) => id % 1000000

// ─── Reading the table ───
// One member as the ids of its verses, in order
function parseMember (text, line) {
  const [, cwms, spec] = /^(\d?[A-Za-z]+)\s+(.+)$/.exec(text) ?? []
  const info = bookInfoByCwms.get(cwms)
  if (!info) throw new Error(`harmony.txt: unknown book in "${line}"`)
  const chapters = VERSES_PER_CHAPTER[info.bookIndex]
  const ids = []
  const add = (chapter, from, to) => {
    if (!(chapter >= 1 && chapter <= chapters.length && from >= 1 && to >= from && to <= chapters[chapter - 1])) {
      throw new Error(`harmony.txt: ${cwms} ${chapter}:${from}-${to} doesn't exist, in "${line}"`)
    }
    for (let verse = from; verse <= to; verse++) ids.push(verseId(info.bookIndex, chapter, verse))
  }
  const wholeChapter = (chapter) => add(chapter, 1, chapters[chapter - 1] ?? 0)
  for (const part of spec.split(/\s*;\s*/)) {
    let chapter = null // the chapter a bare verse number belongs to
    for (const piece of part.split(/\s*,\s*/)) {
      let m
      if ((m = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(piece))) {
        const [c1, v1, c2, v2] = m.slice(1).map(Number)
        add(c1, v1, chapters[c1 - 1] ?? 0)
        for (let c = c1 + 1; c < c2; c++) wholeChapter(c)
        add(c2, 1, v2)
        chapter = c2
      } else if ((m = /^(\d+):(\d+)(?:-(\d+))?$/.exec(piece))) {
        chapter = Number(m[1])
        add(chapter, Number(m[2]), Number(m[3] ?? m[2]))
      } else if (chapter !== null && (m = /^(\d+)(?:-(\d+))?$/.exec(piece))) {
        add(chapter, Number(m[1]), Number(m[2] ?? m[1]))
      } else if ((m = /^(\d+)(?:-(\d+))?$/.exec(piece))) {
        for (let c = Number(m[1]); c <= Number(m[2] ?? m[1]); c++) wholeChapter(c)
      } else {
        throw new Error(`harmony.txt: can't read "${piece}" in "${line}"`)
      }
    }
  }
  return ids
}

let table = null // { rows, byVerse } once read
// rows: [{ members: [[id…]…], main }]; byVerse: id → [{ row, member, index }]
function load () {
  if (table) return table
  const rows = []
  const byVerse = new Map()
  const source = readFileSync(new URL('./harmony.txt', import.meta.url), 'utf8')
  for (const line of source.split('\n')) {
    let text = line.replace(/#.*/, '').trim()
    if (!text) continue
    const block = text.startsWith('~')
    text = text.replace(/^~\s*/, '')
    const members = text.split(/\s*=\s*/).map((member) => parseMember(member, text))
    if (members.length < 2) throw new Error(`harmony.txt: a row needs two members: "${text}"`)
    const hasOther = (member) => members.some((other) => bookOf(other[0]) !== bookOf(member[0]))
    const psalm = members.findIndex((member) => bookOf(member[0]) === PSALMS && hasOther(member))
    const row = { block, members, main: psalm >= 0 ? psalm : members.reduce((best, member, i) => member[0] < members[best][0] ? i : best, 0) }
    rows.push(row)
    members.forEach((ids, member) => ids.forEach((id, index) => {
      if (!byVerse.has(id)) byVerse.set(id, [])
      byVerse.get(id).push({ row, member, index })
    }))
  }
  table = { rows, byVerse }
  return table
}

// Every row, for the tests
export const harmonyRows = () => load().rows

// Whether this verse is in the table at all
export const hasHarmony = (id) => load().byVerse.has(id)

// The verses of `to` that go with verse `index` of `from`: the one beside it, or all when the lengths differ
const aligned = (row, from, index, to) => !row.block && from.length === to.length ? [to[index]] : to

// ─── Looking verses up ───
// `passed` is a Map from verse id to whether the verse was cited as part of a whole chapter. Returns a
// Map from each main verse to { parallels, whole }: the Set of its parallels, and whether every verse
// that led to it was part of a whole chapter. A verse that is a main member of its rows, or in none,
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
    for (const { row, member, index } of spots) {
      if (member === row.main) addMain(id, whole)
      else aligned(row, row.members[member], index, row.members[row.main]).forEach((main) => addMain(main, whole))
    }
  }
  for (const [id, { parallels }] of mains) {
    for (const { row, member, index } of byVerse.get(id) ?? []) {
      if (member !== row.main) continue
      row.members.forEach((ids, other) => {
        if (other !== row.main) aligned(row, row.members[member], index, ids).forEach((parallel) => parallels.add(parallel))
      })
    }
  }
  for (const { parallels } of mains.values()) for (const id of parallels) if (mains.has(id)) parallels.delete(id)
  return mains
}
