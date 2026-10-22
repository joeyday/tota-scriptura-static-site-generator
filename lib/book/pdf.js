import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { pathToFileURL } from 'url'
import { BuildError } from '../errors.js'
import { numberPages } from './folios.js'

// ─── The PDF ───
// Paged.js (a polyfill for CSS paged media: running page numbers, target-counter(), footnotes,
// recto chapter starts) lays the book out in headless Chrome, which then prints it. Both are
// optional: the site build never needs them, so tsgen asks for them only when a book is made.

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

const INSTALL = 'npm install --no-save pagedjs puppeteer-core'

async function load () {
  const require = createRequire(import.meta.url)
  let puppeteer
  let polyfill
  try {
    puppeteer = (await import('puppeteer-core')).default
    // pagedjs' "exports" hides its files, so find the polyfill beside its main one
    polyfill = path.join(path.dirname(require.resolve('pagedjs')), '..', 'dist', 'paged.polyfill.js')
  } catch {
    throw new BuildError(`The book needs pagedjs and puppeteer-core, which the site build doesn't: run \`${INSTALL}\``)
  }
  const chrome = findChrome()
  if (!chrome) {
    throw new BuildError('The book needs Chrome or Chromium: install it, or set CHROME_PATH to its executable (it is not at ' + (process.env.CHROME_PATH ?? 'a usual place') + ')')
  }
  return { puppeteer, polyfill, chrome }
}

// Typesets htmlFile into pdfFile. Returns { pages, first, folios }: the number of pages, the physical
// page that is numbered 1, and the number each page shows ('' for none).
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
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle0' })
    await page.addScriptTag({ path: polyfill })
    const result = await page.evaluate(async () => {
      try {
        await document.fonts.ready
        const flow = await window.PagedPolyfill.preview()
        return { pages: flow.total }
      } catch (err) {
        return { error: (err && err.stack) || String(err) }
      }
    })
    if (result.error) throw new BuildError(`Paged.js could not lay out the book:\n${result.error.split('\n').slice(0, 6).join('\n')}`)
    const numbered = await page.evaluate(numberPages)
    if (numbered.unresolved > 0) throw new BuildError(`${numbered.unresolved} page reference(s) in the book point at something that isn't in it`)
    await page.pdf({ path: pdfFile, preferCSSPageSize: true, printBackground: true })
    return { pages: result.pages, first: numbered.first + 1, folios: numbered.folios }
  } finally {
    await browser.close()
  }
}
