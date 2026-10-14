import path from 'path'
import ejs from 'ejs'
import { BuildError } from './errors.js'
import { escHtml } from './html/escape.js'
import { resolveLink } from './links.js'
import { md, protectFencedAttrs } from './markdown.js'
import { prepareSource } from './source.js'
import { IMAGE_EXTENSIONS } from './vault.js'

// Renders one page's Markdown source to HTML (no layout): partials, wikilinks,
// body EJS, small text, then markdown-it. These are plain text passes over the
// raw Markdown; code spans and blocks are masked so they stay literal.
// A wikilink that resolves to no page (or to several) is pushed onto `problems`;
// the caller fails the build, since only published pages are rendered.
// An SVG embedded in a page is inlined, not linked as an <img>: inline, its CSS sees the page's
// theme (the dark override, the text color, the fonts). Its own <style> and ids belong to the
// page then, so a diagram scopes its rules under its own class. The XML prolog goes, blank lines
// go (they would end the Markdown HTML block), and a size from the embed ("|300x216") replaces
// the root's own.
function inlineSvg (markup, width, height) {
  const svg = markup.replace(/^\s*(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|\s)*/i, '').replace(/\n\s*\n/g, '\n').trim()
  if (!svg.startsWith('<svg')) throw new BuildError(`An SVG must start with <svg>: ${svg.slice(0, 40)}`)
  if (!width) return svg
  return svg.replace(/^<svg\b[^>]*>/, (tag) =>
    tag.replace(/\s(?:width|height)="[^"]*"/g, '').replace('<svg', `<svg width="${width}"${height ? ` height="${height}"` : ''}`)
  )
}

export function renderBody (fileInfo, { partials, fileMap, index, imageMap, svgs, problems }) {
  // The one place a page's partial problems are reported (the backlinks pre-pass
  // expands the same source silently).
  const source = prepareSource(fileInfo.parsed.content, partials, (problem) =>
    console.warn(`Warning: "${fileInfo.filePath}": ${problem}`)
  )
  let markdownContent = source.text

  markdownContent = markdownContent.replace(
    /(!?)\[\[(.*?)\]\]/g,
    (match, bang, inner) => {
      const isEmbed = bang === '!'
      let target = inner
      let text = inner
      if (inner.includes('|')) {
        const parts = inner.split('|')
        target = parts[0]
        text = parts.slice(1).join('|')
      }

      let searchTarget = target.trim()

      const ext = path.extname(searchTarget).toLowerCase()
      if (IMAGE_EXTENSIONS.has(ext)) {
        const imgUrl = imageMap[searchTarget.toLowerCase()]
        if (!imgUrl) {
          problems.push(
            `"${fileInfo.filePath}": ${match} matches no image; images live in image/ or template/, as image/name.png or just name.png`
          )
          return `<span class="broken">${escHtml(match)}</span>`
        }
        // The picker's "image/Town.png" is named "Town.png" for alt text and link text.
        const fileName = searchTarget.split('/').pop()
        if (isEmbed && svgs[imgUrl]) {
          const dim = text.match(/^(\d+)(?:x(\d+))?$/)
          return `<figure class="diagram">${inlineSvg(svgs[imgUrl], dim?.[1], dim?.[2])}</figure>`
        }
        if (isEmbed) {
          let attrs = ''
          const dimMatch = text.match(/^(\d+)(?:x(\d+))?$/)
          if (dimMatch) {
            attrs += ` width="${dimMatch[1]}"`
            if (dimMatch[2]) attrs += ` height="${dimMatch[2]}"`
            return `<figure><img src="${escHtml(imgUrl)}" alt="${escHtml(fileName)}"${attrs}></figure>`
          }
          const alt = text === inner ? fileName : text
          return `<figure><img src="${escHtml(imgUrl)}" alt="${escHtml(alt)}"></figure>`
        } else {
          const linkText = text === inner ? fileName : text
          return `[${linkText}](${imgUrl})`
        }
      }

      if (searchTarget.toLowerCase().endsWith('.md')) {
        searchTarget = searchTarget.substring(0, searchTarget.length - 3)
      }

      const resolved = resolveLink(searchTarget, fileMap, index, fileInfo.nsDir)
      if (resolved.shadowed) {
        console.warn(
          `Warning: Bare wikilink "${searchTarget}" in "${fileInfo.filePath}" matches several pages — using ${resolved.url}; qualify it`
        )
      }
      if (resolved.url) {
        return `[${text}](${resolved.url})`
      }
      problems.push(
        resolved.ambiguous
          ? `"${fileInfo.filePath}": [[${searchTarget}]] matches several pages; qualify it`
          : `"${fileInfo.filePath}": [[${searchTarget}]] matches no page`
      )
      return `<span class="broken">${text}</span>`
    }
  )

  // Only pages with template tags pay for EJS. A broken template fails the
  // build rather than publishing a blank page.
  if (markdownContent.includes('<%')) {
    try {
      markdownContent = ejs.render(markdownContent, {
        frontmatter: fileInfo.parsed.data,
        fileMap,
        imageMap
      })
    } catch (err) {
      throw new BuildError(
        `EJS render error in "${fileInfo.filePath}": ${err.message}`
      )
    }
  }

  markdownContent = markdownContent.replace(
    /(?<!~)~(?!~)([^~\n]+?)(?<!~)~(?!~)/g,
    '<small>$1</small>'
  )

  markdownContent = source.restore(protectFencedAttrs(markdownContent))
  const htmlContent = md.render(markdownContent)
  return htmlContent
}
