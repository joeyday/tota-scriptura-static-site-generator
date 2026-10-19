import { md } from './markdown.js'
import { headingSlug } from './html/passes.js'
import { prepareSource } from './source.js'

// Obsidian links to a paragraph with [[Page#^abc123]], and writes the id (` ^abc123`) at the
// end of the paragraph's line. A term's definition is such a paragraph, and Obsidian can't link
// to the term itself, so the id on a definition stands for its term: the link goes to the id
// tsgen gave the term, and the ` ^abc123` itself never shows.

// A block id at the end of a line, with the space before it.
export const BLOCK_ID_RE = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/gm

const cache = new WeakMap()

// What a page can be linked to inside: { ids, blocks }. `ids` is the set of ids its h2 and h3
// headings get (and its terms, unless the page is a commentary page: a commentary page's terms
// aren't headings), found by rendering each as the page will, so they match addHeadingIds.
// `blocks` is { blockId: id } for the definitions that end in a block id: the id of the term
// above them. A wikilink inside a heading or term counts as its display text.
export function pageAnchors (fileInfo, partials) {
  let anchors = cache.get(fileInfo)
  if (anchors) return anchors
  const terms = fileInfo.relDir !== 'commentary'
  anchors = { ids: new Set(), blocks: {} }
  const source = prepareSource(fileInfo.parsed.content, partials)
  const text = source.restore(source.text).replace(
    /\[\[(.*?)\]\]/g,
    (_, inner) => inner.slice(inner.indexOf('|') + 1)
  )
  const slugOf = (inline) => headingSlug(md.renderer.renderInline(inline.children, md.options, {})).base
  let term = null
  let inTerm = false
  let heading = null // the open h2 or h3
  const tokens = md.parse(text, {})
  for (const token of tokens) {
    if (token.type === 'heading_open') heading = /^h[23]$/.test(token.tag) ? token : null
    else if (token.type === 'heading_close') heading = null
    else if (token.type === 'dt_open') inTerm = true
    else if (token.type === 'dt_close') inTerm = false
    else if (token.type === 'dl_close') term = null
    else if (token.type === 'inline' && heading) anchors.ids.add(heading.attrGet('id') ?? slugOf(token))
    else if (token.type === 'inline' && inTerm) {
      term = token
      if (terms) anchors.ids.add(token.attrGet?.('id') ?? slugOf(token))
    } else if (token.type === 'inline' && term && terms) {
      const id = /[ \t]\^([A-Za-z0-9-]+)$/.exec(token.content)?.[1]
      if (id) anchors.blocks[id] = slugOf(term)
    }
  }
  cache.set(fileInfo, anchors)
  return anchors
}
