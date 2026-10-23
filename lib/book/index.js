import fs from 'fs/promises'
import path from 'path'
import { BuildError } from '../errors.js'
import { info } from '../log.js'
import { composeBook } from './compose.js'
import { composeCover, coverSize } from './cover.js'
import { loadManifest } from './manifest.js'
import { renderCoverPdf, renderPdf } from './pdf.js'

const PREFACE_URL = '/about'

// The book is made from the site as already built in outputDir: the same pages, so the same
// words. It lands in bookDir (<outputDir>/book by default) as book.pdf, the typeset book. The layout it
// is typeset from, book.html, is kept only without the PDF (`pdf: false`) or with `keepHtml`; it
// finds the site's /asset/ as ../asset/, so a bookDir other than the default must sit beside an asset/.
// With the PDF come cover.pdf and cover-dark.pdf, the cover as one flat sheet (back, spine, front) whose spine is as thick
// as the typeset book is long.
export async function makeBook ({ outputDir, bookDir = path.join(outputDir, 'book'), cacheDir = path.join(path.dirname(path.resolve(outputDir)), `.${path.basename(path.resolve(outputDir))}-cache`), index, fileMap, commit = null, version = null, pdf = true, keepHtml = false, date = new Date() }) {
  const { parts, indexGroups } = await loadManifest({ index, fileMap })

  const articles = {}
  for (const part of parts) {
    for (const page of part.pages) {
      articles[page.finalUrlPath] = await fs.readFile(path.join(outputDir, page.finalUrlPath, 'index.html'), 'utf-8')
    }
  }

  // The preface is the vault's About page, when there is a published one
  const about = index.byUrl[PREFACE_URL]
  const preface = about && !about.hidden && !about.draft
    ? await fs.readFile(path.join(outputDir, PREFACE_URL, 'index.html'), 'utf-8')
    : null

  try {
    await fs.access(bookDir)
    throw new BuildError(`${bookDir} exists: a page at /book would be overwritten by the book`)
  } catch (err) {
    if (err instanceof BuildError) throw err
  }
  await fs.mkdir(bookDir)

  const htmlFile = path.join(bookDir, 'book.html')
  await fs.writeFile(htmlFile, composeBook({ parts, articles, preface, indexGroups, date, commit, version }))
  const topics = parts.reduce((n, part) => n + part.pages.length, 0)
  info(`Book: ${parts.length} part(s), ${topics} topic(s) laid out in ${htmlFile}`)
  if (!pdf) return { htmlFile, pdfFile: null, coverFile: null, darkCoverFile: null, pages: null }

  const pdfFile = path.join(bookDir, 'book.pdf')
  const { pages, first, laid, cached, held, tall } = await renderPdf({ htmlFile, pdfFile, cacheDir })
  if (!keepHtml) await fs.rm(htmlFile)
  info(`Book: ${pages} pages typeset in ${pdfFile}; page 1 is sheet ${first}`)
  info(`Book: ${laid} section(s) laid out, ${cached} from ${cacheDir}${held > 0 ? `; ${held} claim(s) broke badly and were laid out whole` : ''}${tall > 0 ? `; ${tall} too tall for that still break badly` : ''}`)

  // The cover, in the site's light theme and its dark one
  const covers = []
  const coverKeys = []
  for (const [name, dark] of [['cover', false], ['cover-dark', true]]) {
    const coverHtml = path.join(bookDir, `${name}.html`)
    const coverFile = path.join(bookDir, `${name}.pdf`)
    await fs.writeFile(coverHtml, composeCover({ pages, dark }))
    coverKeys.push(await renderCoverPdf({ htmlFile: coverHtml, pdfFile: coverFile, size: coverSize(pages), cacheDir }))
    await fs.rm(coverHtml)
    covers.push(coverFile)
  }
  // Covers of other books are dropped
  const coverEntries = path.join(cacheDir, 'cover')
  for (const name of await fs.readdir(coverEntries).catch(() => [])) if (!coverKeys.includes(name.replace(/\.pdf$/, ''))) await fs.rm(path.join(coverEntries, name))
  info(`Book: the covers are in ${covers.join(' and ')}`)
  return { htmlFile: keepHtml ? htmlFile : null, pdfFile, coverFile: covers[0], darkCoverFile: covers[1], pages, first }
}
