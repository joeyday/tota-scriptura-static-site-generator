import { backlinksUrlFor, nsName } from '../model.js'
import { escHtml } from '../html/escape.js'
import { info } from '../log.js'

const linkList = (links) =>
  '<ul>\n' +
  links
    .map((b) => `  <li><a href="${escHtml(b.url)}">${escHtml(b.title)}</a></li>`)
    .join('\n') +
  '\n</ul>'

export async function writeBacklinksPages ({
  output,
  renderLayout,
  filesToProcess,
  backlinksMap,
  notesByPage
}) {
  // ── Backlinks sub-pages ──────────────────────────────────────────────────────
  // One /pageurl/backlinks page for every non-hidden, non-notes page. It lists the
  // pages that link to the page, then (below, in its own section) the pages that
  // link to the page's notes page.

  let backlinksPageCount = 0
  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden || fileInfo.isNote) continue

    const pageUrl = fileInfo.finalUrlPath
    const blUrl = backlinksUrlFor(pageUrl)
    const noteUrl = notesByPage[pageUrl] || null
    const inbound = backlinksMap[pageUrl] || []
    const inboundNotes = (noteUrl && backlinksMap[noteUrl]) || []

    // "topic page", "category page", "meta page" (root pages)…
    const kind = `${fileInfo.nsDir || 'meta'} page`
    const pageList = inbound.length
      ? linkList(inbound)
      : `<p>No pages link to this ${kind}.</p>`
    // Headings only when there are two sections to tell apart.
    const listHtml = inboundNotes.length
      ? `<h2>Links to the ${kind}</h2>\n${pageList}\n<h2>Links to the notes</h2>\n${linkList(inboundNotes)}`
      : pageList

    const blHtml = renderLayout(listHtml, {
      url: blUrl,
      noindex: true, // thin pages: lists of links
      nsLabel: `${nsName(fileInfo.nsDir || 'meta')} page`,
      view: 'backlinks',
      pageUrl,
      noteUrl,
      frontmatter: {
        title: `${fileInfo.title} backlinks`,
        permalink: blUrl.replace(/^\//, '')
      }
    })

    await output.emit(blUrl, blHtml)
    backlinksPageCount++
  }
  info(
    `Backlinks pages: generated ${backlinksPageCount} page(s) (${Object.values(backlinksMap).reduce((s, a) => s + a.length, 0)} total inbound link(s) recorded).`
  )
  // ── End Backlinks sub-pages ──────────────────────────────────────────────────
}
