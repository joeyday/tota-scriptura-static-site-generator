import fs from 'fs/promises'
import path from 'path'
import { BuildError } from '../errors.js'
import { info } from '../log.js'
import { composeBook } from './compose.js'
import { loadManifest } from './manifest.js'
import { renderPdf } from './pdf.js'

const PREFACE_URL = '/about'

// The book is made from the site as already built in outputDir: the same pages, so the same
// words. It lands in <outputDir>/book/ as book.html (the layout) and book.pdf (the typeset book).
export async function makeBook ({ outputDir, index, fileMap, commit = null, version = null, pdf = true, date = new Date() }) {
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

  const bookDir = path.join(outputDir, 'book')
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
  if (!pdf) return { htmlFile, pdfFile: null, pages: null }

  const pdfFile = path.join(bookDir, 'book.pdf')
  const { pages, first } = await renderPdf({ htmlFile, pdfFile })
  info(`Book: ${pages} pages typeset in ${pdfFile}; page 1 is sheet ${first}`)
  return { htmlFile, pdfFile, pages, first }
}
