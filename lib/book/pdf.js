import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { pathToFileURL } from 'url'
import { BuildError } from '../errors.js'
import { badClaims } from './claims.js'
import { numberPages } from './folios.js'

// ─── The PDF ───
// Paged.js (a polyfill for CSS paged media: running page numbers, target-counter(), footnotes,
// recto chapter starts) lays the book out in headless Chrome, which then prints it. Both are
// tsgen's own dependencies, loaded only when a book is made, so a build with --no-book does without them.

const CHROME_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
}

// CHROME_PATH wins, and an executable that isn't there is an error, not a reason to look elsewhere.
export function findChrome () {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null
  return (CHROME_CANDIDATES[process.platform] ?? []).find((file) => fs.existsSync(file)) ?? null
}

export async function load () {
  const require = createRequire(import.meta.url)
  // (imported here, not at the top, so a build with --no-book never loads either)
  const puppeteer = (await import('puppeteer-core')).default
  // pagedjs' "exports" hides its files, so find the polyfill beside its main one
  const polyfill = path.join(path.dirname(require.resolve('pagedjs')), '..', 'dist', 'paged.polyfill.js')
  const chrome = findChrome()
  if (!chrome) {
    throw new BuildError('The book needs Chrome or Chromium: install it, set CHROME_PATH to its executable, or build with --no-book (it is not at ' + (process.env.CHROME_PATH ?? 'a usual place') + ')')
  }
  return { puppeteer, polyfill, chrome }
}

// Typesets htmlFile into pdfFile. Returns { pages, first, folios, held, tall, layouts }: the number of pages, the physical
// page that is numbered 1, the number each page shows ('' for none), how many claims were laid out again as whole
// blocks (see below) and how many still break badly because they are too tall for that.
//
// Paged.js breaks some claims badly (a term alone at the foot of a page, one line of a description alone on the
// next), so after the layout the claims that did are found (lib/book/claims.js) and the book is laid out again with
// those held whole, until none is left or MAX_LAYOUTS is reached. A book with no bad break is laid out once.
const MAX_LAYOUTS = 5

export async function renderPdf ({ htmlFile, pdfFile }) {
  const { puppeteer, polyfill, chrome } = await load()
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    protocolTimeout: 30 * 60 * 1000,
    args: ['--allow-file-access-from-files']
  })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(30 * 60 * 1000)
    await page.evaluateOnNewDocument(() => { window.PagedConfig = { auto: false } })
    const held = new Set()
    let result
    let tall = 0
    let layouts = 1
    for (; ; layouts++) {
      await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle0' })
      if (held.size > 0) await page.addStyleTag({ content: `${[...held].map((id) => `[data-c="${id}"]`).join(', ')} { break-inside: avoid; }` })
      await page.addScriptTag({ path: polyfill })
      result = await page.evaluate(async () => {
        try {
          await document.fonts.ready
          const flow = await window.PagedPolyfill.preview()
          return { pages: flow.total }
        } catch (err) {
          return { error: (err && err.stack) || String(err) }
        }
      })
      if (result.error) throw new BuildError(`Paged.js could not lay out the book:\n${result.error.split('\n').slice(0, 6).join('\n')}`)
      const found = await page.evaluate(badClaims)
      tall = found.tall
      if (found.bad.length === 0 || layouts === MAX_LAYOUTS) break
      for (const id of found.bad) held.add(id)
    }
    const numbered = await page.evaluate(numberPages)
    if (numbered.unresolved > 0) throw new BuildError(`${numbered.unresolved} page reference(s) in the book point at something that isn't in it`)
    await page.pdf({ path: pdfFile, preferCSSPageSize: true, printBackground: true })
    return { pages: result.pages, first: numbered.first + 1, folios: numbered.folios, held: held.size, tall, layouts }
  } finally {
    await browser.close()
  }
}

// Prints the cover page, htmlFile, to pdfFile. It is one sheet that needs no typesetter, only Chrome,
// but its icon comes from the Font Awesome kit (the Pro SVGs can't be kept in this repo), which the
// kit's script swaps in over the network; a cover without it is a mistake, so that fails the book.
export async function renderCoverPdf ({ htmlFile, pdfFile, size, wait = 15000 }) {
  const { puppeteer, chrome } = await load()
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--allow-file-access-from-files'] })
  try {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    try {
      await page.waitForSelector('svg.svg-inline--fa', { timeout: wait })
    } catch {
      throw new BuildError("The cover's icon didn't load: it comes from the Font Awesome kit, which needs the network")
    }
    await page.pdf({ path: pdfFile, preferCSSPageSize: true, printBackground: true })
  } finally {
    await browser.close()
  }
  await setPageSizeOf(pdfFile, size)
}

// Chrome's page is a fraction of a point larger than the cover's sheet (it sizes a page to its own units, and
// paints a whole number of CSS pixels from the page's top left), and a viewer, which draws a page in whole
// pixels, shows what the paint doesn't reach, and the rest of its last row and column, as a hairline of white
// around the cover. So the page is cut down to the sheet's size, a whole number of points ({ widthPt, heightPt }),
// from the page's top left corner, where the paint begins. The new box is usually no longer than the old one and is
// padded to its length; when the sheet is a whole number of points wide, Chrome writes the width bare and the new
// box is longer, so the file's offsets are moved by the difference (exported for the test).
export function setPageSize (pdf, { widthPt, heightPt }) {
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)
  if (!box) throw new BuildError("The cover's page size could not be found in the PDF Chrome printed")
  const [, width, height] = box
  if (+width < widthPt - 0.01 || +height < heightPt - 0.01) throw new BuildError(`The cover was printed on a ${width} × ${height} pt page, smaller than its ${widthPt} × ${heightPt} pt sheet`)
  const bottom = Math.floor((height - heightPt) * 100) / 100 // the box's lower edge: its upper edge is the page's top
  const size = `/MediaBox [0 ${bottom} ${widthPt} ${height}]`.padEnd(box[0].length)
  const grown = size.length - box[0].length
  const out = pdf.slice(0, box.index) + size + pdf.slice(box.index + box[0].length)
  return grown === 0 ? out : moveOffsets(out, box.index, grown)
}

// A PDF finds its objects by byte offset, in the cross-reference table (20 bytes an entry, in subsections) and the
// startxref after it. Moves the ones past `from` along by `by` bytes, after something there grew.
function moveOffsets (pdf, from, by) {
  const table = pdf.lastIndexOf('\nxref\n') + 1
  if (table === 0) throw new BuildError("The cover's PDF has no cross-reference table to correct")
  let at = table + 5
  let head
  let out = pdf.slice(0, at)
  while ((head = /^(\d+) (\d+)\n/.exec(pdf.slice(at, at + 24)))) {
    out += head[0]
    at += head[0].length
    for (let i = 0; i < +head[2]; i++, at += 20) {
      const entry = pdf.slice(at, at + 20)
      out += entry[17] === 'n' && +entry.slice(0, 10) > from ? String(+entry.slice(0, 10) + by).padStart(10, '0') + entry.slice(10) : entry
    }
  }
  return out + pdf.slice(at).replace(/startxref\n\d+/, `startxref\n${table}`)
}

async function setPageSizeOf (pdfFile, size) {
  await fs.promises.writeFile(pdfFile, setPageSize(await fs.promises.readFile(pdfFile, 'latin1'), size), 'latin1')
}
