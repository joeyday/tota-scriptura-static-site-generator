import { BuildError } from '../errors.js'
import { collectedRef } from '../bible/collect.js'

// ─── Marking the Bible references in a topic ───
// The built page already has every reference the site's scanner found, as a link whose address says
// what it is ("https://ref.ly/2Jn1.1;ESV"), so each link is read, not the text rescanned (a text like
// "2Jn 1, 13", the site's way of showing 2Jn 1:1 and 1:13, can't be read back). Each is wrapped in a
// numbered <span class="ref"> so the Scripture index can say which page it ended up on once the book is
// laid out; the links themselves are unwrapped later with all the others. An opted-out reference is
// plain text on the built page and is not collected, as on the site. `refs` collects what the index
// needs: { ...the collected reference, id }.

// ref.ly/{cwms}{chapter}[.{verse}[-{end verse}|-{end chapter}.{end verse}]|-{end chapter}];{translation}
// (the inverse of buildReflyUrl in lib/bible/link.js)
const REFLY = /^(\d?[A-Za-z]+)(\d+)(?:\.(\d+)(?:-(\d+)(?:\.(\d+))?)?|-(\d+))?;(\w+)$/
const BIBLE_LINK = /<a href="https:\/\/ref\.ly\/([^"]+)" class="external bible-ref"[^>]*>([\s\S]*?)<\/a>/g

export function markRefs (html, slug, refs) {
  let n = 0
  return html.replace(BIBLE_LINK, (all, address, text) => {
    const m = REFLY.exec(address)
    if (!m) throw new BuildError(`The book can't read the Bible reference link "${address}" in ${slug}`)
    const [, cwms, chapter, verseStart, rangeVal, endVerse, endChapter, translation] = m
    const id = `r${++n}`
    refs.push({ ...collectedRef({ cwms, chapter, verseStart, rangeVal, endVerse, endChapter, translation }, { pageUrl: `${slug}--${id}` }), id: `${slug}--${id}` })
    return `<span class="ref" id="${id}">${text}</span>`
  })
}
