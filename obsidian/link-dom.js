import { BLOCK_TAGS, SKIP_TAGS } from '../lib/bible/refs.js'
import { renderBibleLinks } from '../lib/bible/link.js'
import { scanBibleRefs } from '../lib/bible/scan.js'
import { checkReference } from '../lib/bible/validate.js'

// ─── Linking the references in rendered text ───
// The site's linker (lib/bible) run over the DOM Obsidian renders: each text node that holds a
// reference has it replaced by the same link the site writes. Only text nodes are touched, so
// Obsidian's own links, embeds and handlers stay as they are. A reference that can't exist (a
// chapter or verse its book doesn't have) is left as plain text.
//
// `root` is a rendered block or section; continuation references ("Jn 3:16, 18; 5:24") carry
// along inside one block and start over at the next, as they do on the site.
export function linkBibleRefs (root) {
  const document = root.ownerDocument
  const walker = document.createTreeWalker(root, 0x1 | 0x4, {
    acceptNode: (node) =>
      node.nodeType === 1 && SKIP_TAGS.has(node.localName) ? 2 /* skip the subtree */ : 1
  })
  // The text nodes in order, each with whether a block begins before it.
  const found = []
  let blockBreak = true
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) {
      if (BLOCK_TAGS.has(node.localName)) blockBreak = true
    } else {
      if (/\d/.test(node.nodeValue)) found.push({ node, blockBreak })
      blockBreak = false
    }
  }

  let ctx
  const template = document.createElement('template')
  for (const { node, blockBreak } of found) {
    if (blockBreak || !ctx) ctx = { lastCwms: null, lastChapter: null, chapterLevel: false, translation: 'ESV' }
    const text = node.nodeValue
    const items = scanBibleRefs(text, ctx).filter((item) => item.optOut || !checkReference(item))
    if (items.length === 0) continue
    template.innerHTML = renderBibleLinks(text, items)
    node.replaceWith(template.content)
  }
}
