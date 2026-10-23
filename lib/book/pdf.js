import crypto from 'crypto'
import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { BuildError } from '../errors.js'
import { badClaims } from './claims.js'
import { splitBook } from './compose.js'
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

// ─── Typesetting, a section at a time ───
// Every section of the book (lib/book/compose.js: the front matter, the contents, the preface, each Part's page, each
// topic, the two indexes) starts on a right-hand page, so how it breaks across pages depends on nothing outside it:
// not on the pages before it (only on whether a blank page precedes it, which its predecessor's page count decides)
// and not on page numbers, which are filled in after the layout (numberPages). So each section is typeset on its own,
// by Paged.js in one loaded page, and the pages it made are remembered, keyed by everything they depend on; the
// book is those pages in order, with a blank before any section that would start on a left-hand page, and then
// numbered and printed. Editing a topic lays out that topic again and nothing else, even when it gets longer.
//
// Paged.js breaks some claims badly (a term alone at the foot of a page, one line of a description alone on the
// next), so after a section's layout the claims in it that did are found (lib/book/claims.js) and the section is laid
// out again with those held whole, until none is left or MAX_LAYOUTS is reached.
const MAX_LAYOUTS = 5

const sha = (...parts) => {
  const hash = crypto.createHash('sha1')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

// The stylesheets a page links (in its head) and the fonts they name, as bytes
async function linkedFiles (htmlFile, head) {
  const files = []
  for (const [, href] of head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) {
    const file = path.resolve(path.dirname(htmlFile), href)
    const css = await fs.promises.readFile(file)
    files.push(css)
    for (const [, font] of css.toString().matchAll(/url\('([^']+)'\)/g)) files.push(await fs.promises.readFile(path.resolve(path.dirname(file), font)))
  }
  return files
}

// This code, which decides how a page is laid out and cut down
const sourceFiles = () => ['./pdf.js', './claims.js'].map((name) => fs.promises.readFile(fileURLToPath(new URL(name, import.meta.url))))

// What every section's pages depend on besides its own HTML: Chrome, Paged.js, the stylesheets the book links and the
// fonts they name, and the code that lays a section out
async function environmentKey (htmlFile, head, polyfill, chromeVersion) {
  return sha(chromeVersion, await fs.promises.readFile(polyfill), ...await Promise.all(sourceFiles()), ...await linkedFiles(htmlFile, head))
}

// Typesets htmlFile into pdfFile. Returns { pages, first, folios, laid, cached, held, tall }: the number of pages, the
// physical page that is numbered 1, the number each page shows ('' for none), how many sections were laid out and
// how many came from cacheDir (when there is one), how many claims were held whole (see above) and how many still
// break badly because they are too tall for that.
export async function renderPdf ({ htmlFile, pdfFile, cacheDir = null }) {
  const { puppeteer, polyfill, chrome } = await load()
  const { head, sections } = splitBook(await fs.promises.readFile(htmlFile, 'utf8'))
  const shell = path.join(path.dirname(htmlFile), 'book-shell.html')
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    protocolTimeout: 30 * 60 * 1000,
    args: ['--allow-file-access-from-files']
  })
  try {
    const environment = await environmentKey(htmlFile, head, polyfill, await browser.version())
    const entries = path.join(cacheDir ?? '', 'book', environment)
    const images = new Map() // the files a section shows, which change how it breaks
    const keyOf = async (html) => {
      const files = []
      for (const [, src] of html.matchAll(/ src="([^"]+)"/g)) {
        if (!images.has(src)) images.set(src, await fs.promises.readFile(path.resolve(path.dirname(htmlFile), src)).catch(() => ''))
        files.push(images.get(src))
      }
      return sha(html, ...files)
    }
    const items = []
    for (const source of sections) {
      const key = await keyOf(source)
      const saved = cacheDir ? await fs.promises.readFile(path.join(entries, `${key}.json`), 'utf8').then(JSON.parse).catch(() => null) : null
      const cached = typeof saved?.html === 'string' && Number.isInteger(saved.pages) ? saved : null // (an entry half written is no entry)
      items.push({ key, source, cached })
    }

    // The page is the book's head with nothing in its body, so that the stylesheets and the assets are where the
    // book's are
    await fs.promises.writeFile(shell, `${head}</body>\n</html>\n`)
    const page = await browser.newPage()
    page.setDefaultTimeout(30 * 60 * 1000)
    await page.evaluateOnNewDocument(() => { window.PagedConfig = { auto: false } })
    await page.goto(pathToFileURL(shell).href)
    await page.addScriptTag({ path: polyfill })
    await page.evaluate(`window.badClaims = ${badClaims}`)
    const laid = await page.evaluate(layOut, items.map(({ source, cached }) => (cached ? { cached } : { source })), MAX_LAYOUTS)
    if (laid.error) throw new BuildError(`Paged.js could not lay out the book:\n${laid.error.split('\n').slice(0, 6).join('\n')}`)

    if (cacheDir) {
      await fs.promises.mkdir(entries, { recursive: true })
      for (const [i, item] of items.entries()) {
        if (!item.cached) await fs.promises.writeFile(path.join(entries, `${item.key}.json`), JSON.stringify({ pages: laid.sections[i].pages, html: laid.sections[i].html }))
      }
      // What this book doesn't use is dropped, along with the entries of other environments
      const used = new Set(items.map(({ key }) => `${key}.json`))
      for (const name of await fs.promises.readdir(entries)) if (!used.has(name)) await fs.promises.rm(path.join(entries, name))
      for (const name of await fs.promises.readdir(path.join(cacheDir, 'book'))) if (name !== environment) await fs.promises.rm(path.join(cacheDir, 'book', name), { recursive: true })
    }

    const numbered = await page.evaluate(numberPages)
    if (numbered.unresolved > 0) throw new BuildError(`${numbered.unresolved} page reference(s) in the book point at something that isn't in it`)
    await page.pdf({ path: pdfFile, preferCSSPageSize: true, printBackground: true })
    const fresh = laid.sections.filter((section) => section.html)
    return {
      pages: numbered.pages,
      first: numbered.first + 1,
      folios: numbered.folios,
      laid: fresh.length,
      cached: items.length - fresh.length,
      held: fresh.reduce((sum, section) => sum + section.held, 0),
      tall: fresh.reduce((sum, section) => sum + section.tall, 0)
    }
  } finally {
    await fs.promises.rm(shell, { force: true })
    await browser.close()
  }
}

// This runs inside the page, so it can't use anything from this file's scope. Puts the sections in the body, in
// order: a cached one is its saved pages, any other is laid out by Paged.js (and again with its badly broken claims
// held whole). Before a section that would start on a left-hand page goes a blank page. Resolves to { sections }, one
// { pages, html, held, tall } for each, without `html` (its saved pages) for the ones that were cached; or to { error }.
async function layOut (items, maxLayouts) {
  try {
    await document.fonts.ready
    const sheets = new window.Paged.Previewer().removeStyles()
    document.body.innerHTML = ''
    // A blank page as Paged.js makes one, and the styles it makes for the pages, which are the same for every section
    // and so are kept from this layout only
    const probe = document.createElement('div')
    document.body.appendChild(probe)
    const template = document.createElement('template')
    template.innerHTML = '<section class="topic">a</section><section class="topic">b</section>'
    await new window.Paged.Previewer().preview(template.content, sheets, probe)
    const blank = probe.querySelectorAll('.pagedjs_page')[1].outerHTML
    probe.remove()
    const kept = new Set(document.querySelectorAll('style'))

    const sections = []
    let total = 0
    for (const item of items) {
      if (total % 2 === 1) {
        document.body.insertAdjacentHTML('beforeend', blank)
        total++
      }
      if (item.cached) {
        document.body.insertAdjacentHTML('beforeend', item.cached.html)
        total += item.cached.pages
        sections.push({ pages: item.cached.pages })
        continue
      }
      const holds = []
      for (let layouts = 1; ; layouts++) {
        const host = document.createElement('div')
        host.className = 'section-host'
        document.body.appendChild(host)
        const content = document.createElement('template')
        content.innerHTML = item.source
        const held = holds.length === 0 ? [] : [{ [window.location.href]: `${holds.map((id) => `[data-c="${id}"]`).join(', ')} { break-inside: avoid; }` }]
        const flow = await new window.Paged.Previewer().preview(content.content, [...sheets, ...held], host)
        for (const style of document.querySelectorAll('style')) if (!kept.has(style)) style.remove()
        const found = window.badClaims(host)
        if (found.bad.length === 0 || layouts === maxLayouts) {
          sections.push({ pages: flow.total, html: host.outerHTML, held: holds.length, tall: found.tall })
          total += flow.total
          break
        }
        host.remove()
        holds.push(...found.bad)
      }
    }
    return { sections }
  } catch (err) {
    return { error: (err && err.stack) || String(err) }
  }
}

// Prints the cover page, htmlFile, to pdfFile. It is one sheet that needs no typesetter, only Chrome,
// but its icon comes from the Font Awesome kit (the Pro SVGs can't be kept in this repo), which the
// kit's script swaps in over the network; a cover without it is a mistake, so that fails the book.
export async function renderCoverPdf ({ htmlFile, pdfFile, size, wait = 15000, cacheDir = null }) {
  const { puppeteer, chrome } = await load()
  // The cover is the same for the same HTML, stylesheets, fonts, Chrome and code (and Font Awesome kit, which is
  // not looked at: a changed icon shows once the cache is cleared)
  const html = await fs.promises.readFile(htmlFile, 'utf8')
  const stat = await fs.promises.stat(chrome)
  const key = cacheDir ? sha(html, JSON.stringify(size), `${chrome} ${stat.size} ${stat.mtimeMs}`, ...await Promise.all(sourceFiles()), ...await linkedFiles(htmlFile, html)) : null
  const cached = key && path.join(cacheDir, 'cover', `${key}.pdf`)
  if (cached && await fs.promises.copyFile(cached, pdfFile).then(() => true, () => false)) return key
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
  if (cached) {
    await fs.promises.mkdir(path.dirname(cached), { recursive: true })
    await fs.promises.copyFile(pdfFile, cached)
  }
  return key
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
