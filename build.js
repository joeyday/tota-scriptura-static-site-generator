#!/usr/bin/env node
import { execFileSync } from 'child_process'
import fsSync from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import slugify from 'slugify'
import { BuildError } from './lib/errors.js'
import { createLayout } from './lib/layout.js'
import { info, setVerbose } from './lib/log.js'
import { findCategory } from './lib/links.js'
import { backlinksUrlFor, buildModel, nsName } from './lib/model.js'
import { createOutput } from './lib/output.js'
import { writeBacklinksPages } from './lib/pages/backlinks.js'
import { writeIndexes } from './lib/pages/indexes.js'
import { writeRandom } from './lib/pages/random.js'
import { writeSettings } from './lib/pages/settings.js'
import { writeAliasRedirects } from './lib/pages/redirects.js'
import { commentaryBook, writeCommentaryPages } from './lib/pages/commentary.js'
import { writeScriptureIndex } from './lib/pages/scripture.js'
import { writeSearch } from './lib/pages/search.js'
import { writeStatistics } from './lib/pages/statistics.js'
import { computeStatistics, countWords, measureHtml } from './lib/stats.js'
import { describe, fallbackHero, findHero } from './lib/html/describe.js'
import { unescHtml } from './lib/html/escape.js'
import { renderBody } from './lib/render.js'
import { createWatcher } from './lib/watch.js'
import { ASSET_EXTENSIONS, NEVER_PAGES, copyAssets, loadVault } from './lib/vault.js'

// The vault (content) is the working directory; the template ships with tsgen.
// Output goes to ./dist unless TSGEN_OUT names another directory (local use
// only, e.g. to keep build output out of the iCloud-synced vault; CI sets nothing).
const OUTPUT_DIR = process.env.TSGEN_OUT
  ? path.resolve(process.env.TSGEN_OUT)
  : 'dist'
const TEMPLATE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'template'
)
const TEMPLATE_PATH = path.join(TEMPLATE_DIR, 'layout.ejs')

// ─── Cache-buster ───
// The content repo's commit (CI sets GITHUB_SHA; locally, the vault's HEAD), so
// assets are refetched exactly when a deploy changes something. Without a repo,
// one timestamp for the whole build. `commit` is false for anything that is not a commit
// hash (the timestamp), which the statistics print but do not link.
function cacheBuster () {
  const hash = (value) => ({ value, commit: /^[0-9a-f]{7,}$/.test(value) })
  if (process.env.GITHUB_SHA) return hash(process.env.GITHUB_SHA.slice(0, 7))
  try {
    return hash(execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim())
  } catch {
    return { value: String(Math.floor(Date.now() / 1000)), commit: false }
  }
}

// "This topic page is under construction." (notes pages: "These notes are …")
const plannedNotice = (fileInfo) =>
  `<div class="message"><p><span class="fa-sharp fa-solid fa-person-digging"></span> <em>${
    fileInfo.isNote
      ? 'These notes are'
      : `This ${nsName(fileInfo.nsDir || 'meta').toLowerCase()} page is`
  } under construction.</em></p></div>`

// Every build starts from an empty output directory, so pages deleted from the
// vault don't linger. Refuses a directory that is the vault or holds it.
async function cleanOutputDir (dir) {
  const rel = path.relative(path.resolve(dir), process.cwd())
  if (rel === '' || !(rel.startsWith('..') || path.isAbsolute(rel))) {
    throw new BuildError(
      `Refusing to clear "${path.resolve(dir)}": it holds the vault. Point TSGEN_OUT somewhere else.`
    )
  }
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
}

async function build ({ showHidden = false, outputDir = OUTPUT_DIR } = {}) {
  await cleanOutputDir(outputDir)

  const { imageMap, svgs } = await copyAssets({
    outputDir,
    templateDir: TEMPLATE_DIR
  })
  const { fileMap, partials, filesToProcess, index, aliasRedirects } =
    await loadVault({ outputDir, showHidden })

  const {
    membersMap,
    featuredPages,
    draftPages,
    featuredWithMap,
    notesByPage,
    pageByNotes,
    allKnownUrls,
    draftUrls,
    featuredUrls,
    categoryUrls,
    notesUrls,
    alphabeticalByNs,
    listedNamespaces,
    backlinksMap,
    plannedUrls
  } = buildModel({ filesToProcess, index, fileMap, partials, imageMap, aliasRedirects })

  const buster = cacheBuster()
  const renderLayout = createLayout({
    template: await fs.readFile(TEMPLATE_PATH, 'utf-8'),
    draftUrls,
    categoryUrls,
    notesUrls,
    featuredUrls,
    plannedUrls,
    allKnownUrls,
    fallbackHero: fallbackHero(imageMap),
    cacheBust: buster.value
  })

  const searchDocs = []
  const commentaryPages = [] // the commentary pages named for a Bible book, which are written last, with Scripture index entries
  const pageStats = [] // per published page, for /statistics
  const linkProblems = []
  const draftLinkProblems = [] // from pages that --show-hidden shows: warnings only

  const output = await createOutput({ outputDir })

  // A hidden page that a published page links to builds as a placeholder: its
  // title and a notice, nothing else. It stays out of the Scripture index,
  // search and every list, and has no backlinks page.
  const emitPlaceholder = (fileInfo) =>
    output.emitPage(
      fileInfo.finalUrlPath,
      renderLayout(plannedNotice(fileInfo), {
        url: fileInfo.finalUrlPath,
        frontmatter: { title: fileInfo.title, planned: true },
        nsLabel: `${nsName(fileInfo.nsDir || 'meta')} page`,
        view: fileInfo.isNote ? 'notes' : 'page',
        pageUrl: fileInfo.isNote ? pageByNotes[fileInfo.finalUrlPath] : fileInfo.finalUrlPath,
        noteUrl: notesByPage[fileInfo.finalUrlPath] || null
      }),
      null
    )

  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) {
      if (plannedUrls.has(fileInfo.finalUrlPath)) {
        await emitPlaceholder(fileInfo)
      }
      continue
    }

    const htmlContent = renderBody(fileInfo, {
      partials,
      fileMap,
      index,
      imageMap,
      svgs,
      problems: fileInfo.shownHidden ? draftLinkProblems : linkProblems
    })

    const resolvedCategories = fileInfo.categories.map((catName) => {
      const target = findCategory(index, catName)
      return target
        ? { title: target.title, url: target.finalUrlPath }
        : {
            title: catName,
            url: `/${slugify(catName, { lower: true, strict: true })}`
          }
    })

    const allMembers = membersMap[fileInfo.finalUrlPath] || []
    const subcategories = []
    const pages = []
    for (const member of allMembers) {
      if (categoryUrls.has(member.url)) {
        subcategories.push(member)
      } else {
        pages.push(member)
      }
    }

    // The page itself, for a notes page's "Topic page" tab (null when its page is missing or hidden).
    const pageUrl = fileInfo.isNote
      ? pageByNotes[fileInfo.finalUrlPath]
      : fileInfo.finalUrlPath

    const heroOf = (page) =>
      page && page.finalUrlPath !== '/'
        ? findHero(page.parsed.content, imageMap)
        : null

    // A notes page shares its page's hero, never its own opening image (a diagram,
    // a map). The home page never shares its avatar. No hero: the fallback.
    const hero = heroOf(pageUrl && index.byUrl[pageUrl])

    // A commentary page is named for a Bible book (or the build fails).
    const book =
      fileInfo.relDir === 'commentary' && !fileInfo.isNote && !fileInfo.unlisted
        ? commentaryBook(fileInfo)
        : null

    const layoutLocals = {
      url: fileInfo.finalUrlPath,
      frontmatter: fileInfo.parsed.data,
      // The frontmatter's `description`, else the first paragraph with text.
      description:
        String(fileInfo.parsed.data.description || '').trim() || describe(htmlContent),
      hero,
      // The page's folder names its namespace: "topic" → "Topic page". Root pages: "Meta page".
      nsLabel: `${nsName(fileInfo.nsDir || 'meta')} page`,
      view: fileInfo.isNote ? 'notes' : 'page',
      pageUrl,
      noteUrl: notesByPage[fileInfo.finalUrlPath] || null,
      backlinksUrl: pageUrl && !fileInfo.hidden ? backlinksUrlFor(pageUrl) : null,
      categories: resolvedCategories,
      subcategories,
      pages,
      featuredWith: fileInfo.featuredWith || null,
      featured: fileInfo.featured || false,
      shownHidden: fileInfo.shownHidden || false
    }
    const finalHtml = renderLayout(htmlContent, layoutLocals)

    const outFilePath = output.fileFor(fileInfo.finalUrlPath)
    // Notes pages, reference pages (long citation tables) and unlisted pages stay out
    // of the Scripture index; category pages and Meta pages are in it. The references on
    // the pages left out (notes included) are counted apart: the site's total and a
    // table by namespace. The statistics' cited figures count only topic and
    // commentary pages, so they leave out the index's category and Meta pages too.
    const collected = !(
      fileInfo.unlisted ||
      fileInfo.relDir === 'reference' ||
      notesUrls.has(fileInfo.finalUrlPath)
    )
    const source = {
      name: fileInfo.filePath,
      warnOnly: !!fileInfo.shownHidden,
      // a table of contents from the headings, and its title
      toc: fileInfo.isNote ? 'Contents' : fileInfo.relDir === 'commentary' ? 'Outline' : null,
      // a topic page's terms are its headings; a commentary page's are bold text
      terms: fileInfo.nsDir !== 'commentary'
    }
    // A commentary page named for a book is only collected from for now; it is written
    // when the others have been collected (see writeCommentaryPages).
    await output.emitPage(
      fileInfo.finalUrlPath,
      finalHtml,
      collected
        ? { url: fileInfo.finalUrlPath, title: fileInfo.title }
        : fileInfo.unlisted
          ? null
          : { url: fileInfo.finalUrlPath, title: fileInfo.title, countOnly: true },
      book ? { ...source, hold: true } : source
    )
    if (book) commentaryPages.push({ fileInfo, html: htmlContent, book, layoutLocals, source })
    info(
      `Built: ${fileInfo.filePath} -> ${outFilePath} (URL: ${fileInfo.finalUrlPath})`
    )

    let words = 0
    if (!fileInfo.unlisted) {
      // Decoded, so an "&amp;" is neither a word in the statistics nor a search word ("amp")
      const bodyText = unescHtml(htmlContent
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim())
      words = countWords(bodyText)
      searchDocs.push({
        id: fileInfo.finalUrlPath,
        title: fileInfo.title,
        url: fileInfo.finalUrlPath,
        kind: `${nsName(fileInfo.nsDir || 'meta')}${fileInfo.isNote ? ' notes' : ''}`,
        body: bodyText
      })
    }
    pageStats.push({
      title: fileInfo.title,
      url: fileInfo.finalUrlPath,
      ns: fileInfo.nsDir || 'meta',
      isNote: !!fileInfo.isNote,
      listed: !fileInfo.unlisted,
      words,
      bytes: Buffer.byteLength(finalHtml),
      ...measureHtml(htmlContent)
    })
  }

  // Hidden pages are never rendered, so a bad link there doesn't count. Shown ones
  // (--show-hidden) only warn.
  for (const problem of draftLinkProblems) console.warn(`Warning: ${problem}`)
  for (const problem of output.headingWarnings) console.warn(`Warning: ${problem}`)
  for (const problem of output.referenceWarnings) console.warn(`Warning: ${problem}`)
  for (const problem of output.textWarnings) console.warn(`Warning: ${problem}`)
  // A reference to a chapter or verse its book doesn't have (a typo, or a number
  // read as a verse) fails the build like a broken link; `!` opts a reference out.
  const failures = []
  if (linkProblems.length > 0) {
    failures.push(`Broken links in published pages:\n${linkProblems.join('\n')}`)
  }
  if (output.headingProblems.length > 0) {
    failures.push(
      `Headings and terms with the same name that aren't next to each other (links to them couldn't tell them apart):\n${output.headingProblems.join('\n')}`
    )
  }
  if (output.referenceProblems.length > 0) {
    failures.push(
      `Scripture references that can't exist (write a ! before one to opt it out):\n${output.referenceProblems.join('\n')}`
    )
  }
  if (output.textProblems.length > 0) {
    failures.push(
      `Abbreviations, initials and images with no entry in abbreviations.json, initials.json or alt-text.json:\n${output.textProblems.join('\n')}`
    )
  }
  if (failures.length > 0) throw new BuildError(failures.join('\n\n'))

  await writeAliasRedirects({ output, aliasRedirects })

  await writeBacklinksPages({
    output,
    renderLayout,
    filesToProcess,
    backlinksMap,
    notesByPage
  })
  await writeIndexes({
    output,
    renderLayout,
    filesToProcess,
    listedNamespaces,
    alphabeticalByNs,
    featuredPages,
    draftPages,
    featuredWithMap
  })
  await writeSearch({ output, renderLayout, searchDocs, cacheBust: buster.value })
  await writeRandom({ output, renderLayout, listedNamespaces, alphabeticalByNs })
  await writeSettings({ output, renderLayout })
  await output.writeFile('.nojekyll', '')
  await writeScriptureIndex({ output, renderLayout })
  await writeCommentaryPages({ output, renderLayout, pages: commentaryPages })
  const { version } = JSON.parse(await fs.readFile(new URL('./package.json', import.meta.url), 'utf-8'))
  await writeStatistics({
    output,
    renderLayout,
    stats: computeStatistics({
      pages: pageStats,
      bodies: searchDocs,
      filesToProcess,
      refs: output.refs,
      otherRefs: output.otherRefs,
      backlinksMap,
      membersMap,
      alphabeticalByNs,
      notesByPage,
      imageMap,
      version,
      commit: buster.value,
      commitLinked: buster.commit
    })
  })

  // Generated pages are written after the check above; they hold only references
  // that came from checked pages, so this should never fire.
  const lateProblems = [...output.headingProblems, ...output.referenceProblems, ...output.textProblems]
  if (lateProblems.length > 0) {
    throw new BuildError(
      `Problems on generated pages:\n${lateProblems.join('\n')}`
    )
  }

  await output.finish()
  return { index, fileMap, commit: buster.commit ? buster.value : null, version }
}

// ─── Watching ─────────────────────────────────────────────────────────────────
// serve rebuilds (the whole site, which takes about half a second) when the vault
// or the template changes. A rebuild goes into a staging directory and replaces the
// served one only when it succeeds, so a mistake that fails the build leaves the
// last good site up. Pages open in a browser then reload themselves.

const STAGE_DIR = path.join(path.dirname(OUTPUT_DIR), `.${path.basename(OUTPUT_DIR)}-next`)
const OLD_DIR = path.join(path.dirname(OUTPUT_DIR), `.${path.basename(OUTPUT_DIR)}-old`)

// Files that can change the site: pages, data, assets (and the template's layout).
const WATCHED_EXTENSIONS = new Set(['.md', '.json', '.ejs', ...ASSET_EXTENSIONS])

function isSiteFile (relPath, skipNames) {
  const parts = relPath.split('/')
  if (parts.some((p) => p.startsWith('.') || skipNames.has(p))) return false
  if (NEVER_PAGES.has(parts[parts.length - 1].toLowerCase())) return false
  return WATCHED_EXTENSIONS.has(path.extname(relPath).toLowerCase())
}

// ─── The book, while serving ───
// A book takes about ten seconds to typeset cold (a few when its sections are remembered), so serve builds it in the background, from a private
// copy of the site's assets (a site rebuild swaps the served directory under it), and puts the PDF at
// /book/book.pdf when it is done. Until then (and while a newer one is being made) the last good PDF
// stays up. Changes that arrive meanwhile are made into one more book, not a queue of them.

const BOOK_DIR = path.join(path.dirname(OUTPUT_DIR), `.${path.basename(OUTPUT_DIR)}-book`)

function bookInBackground () {
  let busy = false
  let waiting = null // the latest build to make a book from, when one arrived while busy

  async function run (built) {
    if (busy) {
      waiting = built
      return
    }
    busy = true
    const started = performance.now()
    try {
      const { makeBook } = await import('./lib/book/index.js')
      // The pages are read as the book starts; the assets are copied, so a rebuild can't pull them away
      await fs.rm(BOOK_DIR, { recursive: true, force: true })
      await fs.mkdir(BOOK_DIR, { recursive: true })
      await fs.cp(path.join(OUTPUT_DIR, 'asset'), path.join(BOOK_DIR, 'asset'), { recursive: true })
      const { pdfFile, coverFile, darkCoverFile, pages } = await makeBook({ outputDir: OUTPUT_DIR, bookDir: path.join(BOOK_DIR, 'book'), ...built })
      const served = path.join(OUTPUT_DIR, 'book')
      await fs.mkdir(served, { recursive: true })
      for (const [file, name] of [[pdfFile, 'book.pdf'], [coverFile, 'cover.pdf'], [darkCoverFile, 'cover-dark.pdf']]) {
        await fs.copyFile(file, path.join(served, `.${name}`))
        await fs.rename(path.join(served, `.${name}`), path.join(served, name))
      }
      console.log(`Book: ${pages} pages typeset in ${((performance.now() - started) / 1000).toFixed(1)} s, at /book/book.pdf (the covers are /book/cover.pdf and /book/cover-dark.pdf).`)
    } catch (err) {
      console.error('Book failed (still serving the last good one, if any):', err instanceof BuildError ? err.message : err)
    } finally {
      await fs.rm(BOOK_DIR, { recursive: true, force: true })
      busy = false
      if (waiting) {
        const next = waiting
        waiting = null
        run(next)
      }
    }
  }
  return { run, cleanUp: () => fsSync.rmSync(BOOK_DIR, { recursive: true, force: true }) }
}

function watchAndRebuild ({ showHidden, reloadPages, book }) {
  let building = false

  // A rebuild always says what started it and how long it took (the other build
  // output is verbose-only), so a rebuild nobody asked for can be traced.
  async function rebuild (files) {
    if (building) {
      // The quiet period ended while a build was still running: those changes wait
      // out a fresh quiet period instead of starting a build the moment this one ends.
      watcher.notify(files)
      return
    }
    const shown = files.slice(0, 5).join(', ')
    console.log(`Changed: ${shown}${files.length > 5 ? ` and ${files.length - 5} more` : ''}`)
    building = true
    const started = performance.now()
    try {
      const built = await build({ showHidden, outputDir: STAGE_DIR })
      await fs.rm(OLD_DIR, { recursive: true, force: true })
      await fs.rename(OUTPUT_DIR, OLD_DIR)
      await fs.rename(STAGE_DIR, OUTPUT_DIR)
      // The book made so far stays up while the next one is typeset
      await fs.rename(path.join(OLD_DIR, 'book'), path.join(OUTPUT_DIR, 'book')).catch(() => {})
      await fs.rm(OLD_DIR, { recursive: true, force: true })
      console.log(`Rebuilt in ${((performance.now() - started) / 1000).toFixed(2)} s.`)
      reloadPages()
      book?.run(built)
    } catch (err) {
      console.error(
        'Build failed (still serving the last good build):',
        err instanceof BuildError ? err.message : err
      )
    } finally {
      building = false
    }
  }

  const watcher = createWatcher({ onChange: rebuild })

  const outputNames = new Set(['dist', 'node_modules', path.basename(OUTPUT_DIR)])
  watcher.watch('.', (rel) => isSiteFile(rel, outputNames))
  watcher.watch(TEMPLATE_DIR, (rel) => isSiteFile(rel, new Set()))

  // The staging directories are dot-folders inside the vault; don't leave them behind.
  const cleanUp = () => {
    watcher.stop()
    book?.cleanUp()
    fsSync.rmSync(STAGE_DIR, { recursive: true, force: true })
    fsSync.rmSync(OLD_DIR, { recursive: true, force: true })
  }
  process.on('SIGINT', () => {
    cleanUp()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cleanUp()
    process.exit(0)
  })
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
// tsgen [build]     build the site and the book (what CI runs). The book (book.json in the vault
//                   names its parts and topics) is laid out from the built pages and typeset
//                   with Paged.js in headless Chrome: <output>/book/book.pdf. With:
//   --no-book       build the site only; the book takes about ten seconds cold.
//   --book-html     stop the book at its layout, <output>/book/book.html, which is kept (to
//                   look at it without typesetting).
// tsgen serve       build, then serve the output locally (see serve.js) and rebuild
//                   whenever the vault or the template changes (and restart itself
//                   whenever tsgen's own code changes, see lib/supervise.js), with:
//   --show-hidden   build pages marked `hidden` too, for previewing rough drafts.
//                   Only serve takes it, so a deploy can't publish them by accident.
//   --verbose       print every "Built …" line; without it serve prints only warnings,
//                   errors and the address it serves at.
//   --port <n>      serve on port n instead of 4000 (also --port=n).
//   --no-watch      serve the first build without rebuilding on changes.
//   --no-book       serve the site only. Otherwise the book is typeset in the background,
//                   again after every rebuild, and served at /book/book.pdf.

const USAGE =
  'Usage: tsgen [build [--no-book] [--book-html] | serve [--no-book] [--show-hidden] [--verbose] [--no-watch] [--port <n>]]'
const [command = 'build', ...args] = process.argv.slice(2)
let showHidden = false
let verbose = false
let watching = true
let port
let withBook = true
let bookHtml = false
let usageOk = command === 'build' || command === 'serve'
for (let i = 0; usageOk && i < args.length; i++) {
  const [flag, inlineValue] = args[i].split(/=(.*)/s)
  if (flag === '--no-book' && inlineValue === undefined) withBook = false
  else if (command === 'build') {
    if (flag === '--book-html' && inlineValue === undefined) bookHtml = true
    else usageOk = false
  } else if (flag === '--show-hidden' && inlineValue === undefined) showHidden = true
  else if (flag === '--verbose' && inlineValue === undefined) verbose = true
  else if (flag === '--no-watch' && inlineValue === undefined) watching = false
  else if (flag === '--port') {
    const value = inlineValue ?? args[++i]
    port = Number(value)
    if (!/^\d+$/.test(value ?? '') || port < 1 || port > 65535) usageOk = false
  } else usageOk = false
}
if (!usageOk) {
  console.error(USAGE)
  process.exit(1)
}
// `serve` that watches runs under a supervisor, which restarts it when tsgen's own code
// changes (a rebuild can't pick that up). The supervised copy carries on below.
if (command === 'serve' && watching && !process.env.TSGEN_SUPERVISED) {
  const { supervise } = await import('./lib/supervise.js')
  supervise()
  await new Promise(() => {}) // the supervisor exits the process when the server stops
}

setVerbose(command === 'build' || verbose)
if (showHidden) console.log('Showing hidden pages (--show-hidden).')

let built
try {
  built = await build({ showHidden })
} catch (err) {
  console.error('Build failed:', err instanceof BuildError ? err.message : err)
  process.exit(1)
}

if (command === 'build' && withBook) {
  try {
    const { makeBook } = await import('./lib/book/index.js')
    await makeBook({ outputDir: OUTPUT_DIR, ...built, pdf: !bookHtml, keepHtml: bookHtml })
  } catch (err) {
    console.error('Book failed:', err instanceof BuildError ? err.message : err)
    process.exit(1)
  }
}

if (command === 'serve') {
  try {
    const { serve } = await import('./serve.js')
    const { reloadPages } = await serve(OUTPUT_DIR, port, { watching })
    const book = withBook ? bookInBackground() : null
    if (book) {
      console.log('Book: typesetting in the background; it will be at /book/book.pdf.')
      book.run(built)
    }
    if (watching) watchAndRebuild({ showHidden, reloadPages, book })
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
