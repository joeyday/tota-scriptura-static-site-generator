import { buildReflyUrl } from '../lib/bible/link.js'
import { scanBibleRefs } from '../lib/bible/scan.js'
import { checkReference } from '../lib/bible/validate.js'

// ─── Finding references in Markdown source ───
// What the editing view needs: where the references are in the text being written, and where each
// links to. The site's scanner does the finding (lib/bible), on a line at a time.

// What in a line is not prose, to be blanked before looking: inline code, wikilinks and embeds,
// links and images, HTML tags and web addresses. A reference in a link's text is already a link.
const NOT_PROSE_RE = /`[^`\n]*`|!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]+>|https?:\/\/[^\s)>\]]+/g

// The references in one line, as { from, to, url }: offsets in the line, and the link the site
// writes for each. A `!` opts one out; one that can't exist (Romans 17) is not found. Continuations
// ("Jn 3:16, 18; 5:24") carry along inside the line, which is where they carry on the site too.
export function bibleRefsInLine (text) {
  const prose = text.replace(NOT_PROSE_RE, (blank) => ' '.repeat(blank.length))
  if (!/\d/.test(prose)) return []
  const ctx = { lastCwms: null, lastChapter: null, chapterLevel: false, translation: 'ESV' }
  return scanBibleRefs(prose, ctx)
    .filter((item) => !item.optOut && !checkReference(item))
    .map((item) => ({
      from: item.start,
      to: item.end,
      url: buildReflyUrl(item.cwms, item.chapter, item.verseStart, item.rangeVal, item.endVerse, item.endChapter, item.translation)
    }))
}

// Which of a note's lines are prose, one true or false each: not the front matter, a fenced code
// block or a math block.
export function proseLines (lines) {
  const fence = /^\s*(`{3,}|~{3,})/
  let frontMatter = false
  let code = null // the fence that opened the block we are in
  let math = false
  return lines.map((line, i) => {
    if (i === 0 && line.trim() === '---') return !(frontMatter = true)
    if (frontMatter) {
      if (/^(---|\.\.\.)\s*$/.test(line)) frontMatter = false
      return false
    }
    const opening = fence.exec(line)
    if (code) {
      if (opening && opening[1][0] === code[0] && opening[1].length >= code.length && line.trim() === opening[1]) code = null
      return false
    }
    if (opening) {
      code = opening[1]
      return false
    }
    if (line.trim() === '$$') {
      math = !math
      return false
    }
    return !math
  })
}
