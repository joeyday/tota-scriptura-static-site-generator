import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveLink } from '../lib/links.js'
import { processBibleRefs } from '../lib/bible/process.js'
import { BIBLE_BOOKS } from '../lib/bible/refs.js'
import { VERSES_PER_CHAPTER } from '../lib/bible/versification.js'
import { addHeadingIds, smallAsides } from '../lib/html/passes.js'
import { mapText } from '../lib/html/walk.js'
import { md, protectFencedAttrs } from '../lib/markdown.js'
import { buildVault, makeVault } from './helpers/scratch-vault.js'
import { changeUntil, startServe, startStatic, waitFor } from './helpers/serve.js'

// One-line corners of the generator, each with the smallest input that reaches it.

const run = promisify(execFile)
const builds = []
const build = async (files, options) => {
  const result = await buildVault(files, options)
  builds.push(result)
  return result
}
const cleanups = []
after(async () => {
  await Promise.all(builds.map((b) => b.cleanup()))
  for (const cleanup of cleanups) await cleanup()
})
const page = (body, data = '', title = 'T') => `---\ntitle: ${title}\n${data}---\n${body}\n`
const png = Buffer.from('x')

// ─── Pure functions ───
test('mapText hands every tag to onTag, when given one', () => {
  const tags = []
  assert.equal(mapText('<p>a</p>', new Set(), (t) => t.toUpperCase(), (name, full) => tags.push([name, full])), '<p>A</p>')
  assert.deepEqual(tags, [['p', '<p>'], ['p', '</p>']])
})

test('a bare name shared only by notes pages is narrowed like any other', () => {
  const notes = (url, dir) => ({ finalUrlPath: url, nsDir: dir, isNote: true })
  const topic = notes('/topic/x/notes', 'topic')
  const commentary = notes('/commentary/x/notes', 'commentary')
  const index = { byPath: {}, byUrl: { [topic.finalUrlPath]: topic, [commentary.finalUrlPath]: commentary } }
  const fileMap = { x: [topic.finalUrlPath, commentary.finalUrlPath] }
  assert.deepEqual(resolveLink('X', fileMap, index, 'commentary'), { url: '/commentary/x/notes', shadowed: true })
  assert.deepEqual(resolveLink('X', fileMap, index, 'reference'), { url: '/topic/x/notes', shadowed: true })
})

test('a heading with an empty id attribute gets one', () => {
  assert.match(addHeadingIds('<h2 id="">Grace</h2>'), /<h2 id="">Grace<\/h2>/)
})

test('a stray closing tag in a definition is ignored by smallAsides', () => {
  assert.equal(smallAsides('<dd>a</b> (b)</dd>'), '<dd>a</b> <small>(b)</small></dd>')
})

test('a continuation that is a verse range past the end says what it was read as', () => {
  const { problems } = processBibleRefs('<p>Romans 1:1; 3:1–99</p>', { url: '/x', title: 'x' })
  assert.match(problems[0], /"3:1–99" \(read as Romans 3:1–99\)/)
})

test('fenced div attributes: an empty list, and single-quoted values', () => {
  assert.equal(md.render(protectFencedAttrs('::: { }\nHi\n:::')), '<div>\n<p>Hi</p>\n</div>\n')
  assert.match(md.render(protectFencedAttrs("::: {data-x='a b'}\nHi\n:::")), /<div data-x="a b">/)
})

// ─── Output directory and commit ───
describe('the build\'s environment', { concurrency: true }, () => {
  test('without TSGEN_OUT the site goes to ./dist in the vault', async () => {
    const b = await build({ 'topic/Grace.md': page('g') }, { env: { TSGEN_OUT: '' } })
    assert.equal(b.code, 0, b.output)
    await fs.access(path.join(b.vault, 'dist', 'topic', 'grace', 'index.html'))
  })

  test('a commit that is not a hash is plain text, unlinked, in the statistics', async () => {
    const b = await build({}, { env: { GITHUB_SHA: 'localdev-build' } })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/statistics')
    assert.match(html, /accurate as of commit localde, built/)
    assert.doesNotMatch(html, /\/commit\//)
  })

  test('an unreadable file is a failure that names the error, not a stack of its own making', async () => {
    const made = await makeVault({ 'topic/Locked.md': page('l') })
    cleanups.push(made.cleanup)
    const file = path.join(made.vault, 'topic', 'Locked.md')
    await fs.chmod(file, 0o000)
    try {
      const result = await run('node', [path.join(import.meta.dirname, '..', 'build.js')], { cwd: made.vault, env: { ...process.env, TSGEN_OUT: made.dist } }).catch((err) => err)
      assert.equal(result.code, 1)
      assert.match(result.stderr, /Build failed: Error: EACCES/)
    } finally {
      await fs.chmod(file, 0o644)
    }
  })
})

// ─── Hidden pages linked from published ones ───
describe('placeholders', { concurrency: true }, () => {
  test('a hidden page, a hidden notes page and a hidden root page each get their own notice', async () => {
    const b = await build({
      'About.md': page('See [[Secret]] and [[Quiet]].'),
      'topic/Grace.md': page('See [[topic/notes/Grace]].'),
      'topic/notes/Grace.md': page('hidden notes', 'hidden: true\n'),
      'Secret.md': page('s', 'hidden: true\n'),
      'topic/Quiet.md': page('q', 'hidden: true\n')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/secret'), /This meta page is under construction\./)
    assert.match(await b.read('/topic/quiet'), /This topic page is under construction\./)
    assert.match(await b.read('/topic/grace/notes'), /These notes are under construction\./)
  })

  test('a page whose notes are linked lists those links apart on its backlinks page', async () => {
    const b = await build({
      'topic/Grace.md': page('g'),
      'topic/notes/Grace.md': page('n'),
      'topic/Mercy.md': page('See [[topic/notes/Grace]] and [[Grace]].')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/topic/grace/backlinks')
    assert.match(html, /<h2[^>]*>Links to the topic page<\/h2>/)
    assert.match(html, /<h2[^>]*>Links to the notes<\/h2>/)
  })
})

// ─── Images ───
describe('image embeds', { concurrency: true }, () => {
  const alt = JSON.stringify({ 'Trees-and-buildings.png': 'T', 'pic.png': 'A picture' })

  test('an SVG keeps its own size, or takes a width, or a width and height', async () => {
    const svg = '<svg viewBox="0 0 1 1" width="9" height="9"><rect/></svg>'
    const b = await build({
      'image/d.svg': svg,
      'topic/Grace.md': page('![[d.svg]]\n\n![[d.svg|50]]\n\n![[d.svg|50x40]]')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/topic/grace')
    assert.match(html, /<figure class="diagram"><svg viewBox="0 0 1 1" width="9" height="9"><rect\/><\/svg><\/figure>/)
    assert.match(html, /<svg width="50" viewBox="0 0 1 1"><rect\/>/)
    assert.match(html, /<svg width="50" height="40" viewBox="0 0 1 1"><rect\/>/)
  })

  test('an image embed takes its alt from the text after the bar, or a width alone', async () => {
    const b = await build({
      'alt-text.json': alt,
      'image/pic.png': png,
      'topic/Grace.md': page('![[pic.png|100]]\n\n![[pic.png|A caption]]')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/topic/grace')
    assert.match(html, /<img src="\/asset\/pic\.png" alt="A picture" width="100">/)
    assert.match(html, /<img src="\/asset\/pic\.png" alt="A picture">/) // alt-text.json always wins
  })
})

// ─── Frontmatter and aliases ───
describe('names', { concurrency: true }, () => {
  test('a number is accepted as a title', async () => {
    const b = await build({ 'topic/Year.md': '---\ntitle: 1984\n---\nbody\n' })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/year'), /<h1>1984<\/h1>/)
  })

  test('an alias of a root page redirects at the root, and its notes page follows', async () => {
    const b = await build({
      'About.md': page('a', 'aliases:\n  - Colophon\n'),
      'notes/About.md': page('n')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/colophon'), /url=\/about"/)
    assert.match(await b.read('/colophon/notes'), /url=\/about\/notes"/)
  })

  test('a hidden page\'s aliases build nothing', async () => {
    const b = await build({ 'topic/Secret.md': page('s', 'hidden: true\naliases:\n  - Hush\n') })
    assert.equal(b.code, 0, b.output)
    assert.equal(await b.exists('/topic/hush'), false)
  })

  test('"featured with" a page that is not there is ignored', async () => {
    const b = await build({ 'topic/Grace.md': page('g', 'featured with: Nowhere\n') })
    assert.equal(b.code, 0, b.output)
    assert.doesNotMatch(await b.read('/index/featured'), /grace/)
  })

  test('two links with fragments to one page read its headings once', async () => {
    const b = await build({
      'topic/Grace.md': page('See [[Mercy#One]] and [[Mercy#Two]].'),
      'topic/Mercy.md': page('## One\n\na\n\n## Two\n\nb')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/topic/grace')
    assert.match(html, /href="\/topic\/mercy#one"/)
    assert.match(html, /href="\/topic\/mercy#two"/)
  })
})

// ─── Serving something that is neither a file nor a directory ───
test('serve.js does not serve a named pipe', async () => {
  const built = await buildVault({})
  builds.push(built)
  await run('mkfifo', [path.join(built.dist, 'pipe')])
  const server = await startStatic(built.dist)
  cleanups.push(() => server.close())
  assert.equal((await server.get('/pipe')).status, 404)
})

// ─── --show-hidden: problems are warnings ───
describe('serve --show-hidden', { concurrency: true }, () => {
  test('every kind of problem on a shown draft is a warning, and the draft is built', async () => {
    const made = await makeVault({
      'topic/Draft.md': page('[[Nowhere]] Romans 17 NASA R.C. Sproul\n\n## Same\n\na\n\n## Other\n\nb\n\n## Same\n\nc\n\n![[pic.png]]', 'hidden: true\naliases:\n  - Grace\n'),
      'image/pic.png': png,
      'topic/Grace.md': page('g'),
      'topic/Clash.md': page('c', 'hidden: true\npermalink: grace\n')
    })
    cleanups.push(made.cleanup)
    const server = await startServe(made.vault, made.dist, { args: ['--show-hidden'] })
    cleanups.push(() => server.close())
    const out = server.output()
    assert.match(out, /Showing hidden pages \(--show-hidden\)\./)
    assert.match(out, /Warning: "topic\/Draft\.md": \[\[Nowhere\]\] matches no page/)
    assert.match(out, /Warning: "topic\/Draft\.md": "Romans 17"/)
    assert.match(out, /Warning: "topic\/Draft\.md": "Same" \(#same\) names two headings/)
    assert.match(out, /Warning: "topic\/Draft\.md": NASA is not in abbreviations\.json/)
    assert.match(out, /Warning: "topic\/Draft\.md": initials "R\.C\."/)
    assert.match(out, /Warning: "topic\/Draft\.md": image pic\.png has no entry in alt-text\.json/)
    assert.match(out, /Warning: Alias of "topic\/Draft\.md" would replace the page "topic\/Grace\.md"/)
    assert.match(out, /Warning: "topic\/Clash\.md" and "topic\/Grace\.md" both build \/topic\/grace/)
    assert.equal((await server.get('/topic/draft/')).status, 200)
  })

  test('aliases that clash with a shown draft\'s are warnings too', async () => {
    const made = await makeVault({
      'topic/A.md': page('a', 'aliases:\n  - Same\n'),
      'topic/B.md': page('b', 'hidden: true\naliases:\n  - Same\n')
    })
    cleanups.push(made.cleanup)
    const server = await startServe(made.vault, made.dist, { args: ['--show-hidden'] })
    cleanups.push(() => server.close())
    assert.match(server.output(), /Warning: Aliases of "topic\/B\.md" and "topic\/A\.md" both redirect \/topic\/same/)
  })

  test('a rebuild that fails for a reason of its own says what', async () => {
    const made = await makeVault({ 'topic/Grace.md': page('g') })
    cleanups.push(made.cleanup)
    const server = await startServe(made.vault, made.dist, {})
    cleanups.push(() => server.close())
    // Add the file and let that rebuild finish; only then lock it and change another page, so
    // the next rebuild reads it. (Locking a file as it is made goes unnoticed by the watcher on Linux.)
    const file = path.join(made.vault, 'topic', 'Locked.md')
    await changeUntil((n) => fs.writeFile(file, page(`l ${n}`)), () => /Rebuilt in/.test(server.output()))
    await fs.chmod(file, 0o000)
    try {
      await fs.writeFile(path.join(made.vault, 'topic', 'Grace.md'), page('changed'))
      await waitFor(() => /Build failed \(still serving the last good build\): Error: EACCES/.test(server.output()), { what: `the failure:\n${server.output()}` })
    } finally {
      await fs.chmod(file, 0o644)
    }
  })

  test('a rebuild names the first five changed files and counts the rest', async () => {
    const made = await makeVault({ 'topic/Grace.md': page('g') })
    cleanups.push(made.cleanup)
    const server = await startServe(made.vault, made.dist, {})
    cleanups.push(() => server.close())
    await changeUntil(async (n) => {
      for (let i = 1; i <= 7; i++) await fs.writeFile(path.join(made.vault, 'topic', `New${i}.md`), page(`n ${n}`))
    }, () => /Changed: .* and 2 more/.test(server.output()))
  })
})

// ─── A statistics page with a bit of everything ───
test('a statistics page for a site that cites every book, has Hebrew, odd titles and several letters', async () => {
  const everyBook = BIBLE_BOOKS.map((names) => `${names[0]} 1:1`).join('; ')
  const b = await build({
    // The index prints Song of Solomon's code, SS, which is an abbreviation like any other.
    'abbreviations.json': JSON.stringify({ CSS: 'c', ESV: 'e', HTML: 'h', KB: 'k', MB: 'm', SS: 'Song of Solomon' }),
    'topic/Alpha.md': page(`${everyBook}. שלום and λόγος and LORD. `.repeat(2), 'categories:\n  - Doctrine\n', 'Alpha'),
    'topic/1984.md': page('numbers first', 'categories:\n  - Doctrine\n', '1984'),
    'topic/Zebra.md': page('z', '', 'Zebra'),
    'category/Doctrine.md': page('d', 'categories:\n  - Outer\n', 'Doctrine'),
    'category/Outer.md': page('o', '', 'Outer')
  })
  assert.equal(b.code, 0, b.output)
  const html = await b.read('/statistics')
  assert.match(html, /Every book of the Bible is cited at least once\./)
  assert.doesNotMatch(html, /never cited/)
  assert.match(html, /Hebrew/i)
})

// ─── More of the Scripture index and the statistics ───
test('a reference to a second chapter of a book of one chapter says it has 1 chapter', () => {
  const { problems } = processBibleRefs('<p>Jude 1:1\u20132:3</p>', { url: '/x', title: 'x' })
  assert.deepEqual(problems, ['"Jude 1:1\u20132:3": Jude has 1 chapter'])
})

test('a book\'s entries are ordered by chapter, then verse, then the end of the range', async () => {
  const b = await build({
    'topic/Grace.md': page('John 3:16\u201320; John 3:16\u201318; John 3:16; John 3:16\u20134:2; John 3:16\u20134:1; John 3:2\u20134; John 3:2\u20134:1; John 3; John 2:1; John 3:2.')
  })
  assert.equal(b.code, 0, b.output)
  const ids = [...(await b.read('/index/scripture/john')).matchAll(/<dt class="scripture-reference" id="([^"]+)"/g)].map((m) => m[1])
  // From the same verse the longer range comes first: by where it ends, a run across
  // chapters ahead of one within a chapter, a single verse last.
  assert.deepEqual(ids, ['2.1', '3', '3.2-4.1', '3.2-4', '3.2', '3.16-4.2', '3.16-4.1', '3.16-20', '3.16-18', '3.16'])
})

test('a heading that holds a wikilink is linked by its display text', async () => {
  const b = await build({
    'topic/Grace.md': page('See [[Mercy#About Grace]].'),
    'topic/Mercy.md': page('## About [[Grace|Grace]]\n\ntext')
  })
  assert.equal(b.code, 0, b.output)
  assert.match(await b.read('/topic/grace'), /href="\/topic\/mercy#about-grace"/)
})

test('the home page\'s alias redirects its notes at /notes', async () => {
  const b = await build({
    'Home.md': page('h', 'aliases:\n  - Start\n'),
    'Home page.md': null,
    'notes/Home.md': page('n')
  })
  assert.equal(b.code, 0, b.output)
  assert.match(await b.read('/start/notes'), /url=\/notes"/)
})

test('categories that contain each other do not loop the statistics', async () => {
  const b = await build({
    'category/A.md': page('a', 'categories:\n  - B\n', 'A'),
    'category/B.md': page('b', 'categories:\n  - A\n', 'B'),
    'topic/Grace.md': page('g', 'categories:\n  - A\n  - B\n')
  })
  assert.equal(b.code, 0, b.output)
  assert.ok(await b.exists('/statistics'))
})

test('a site with no words at all has 0% in its notes', async () => {
  const b = await build({ 'Home page.md': '---\ntitle: Home\n---\n' })
  assert.equal(b.code, 0, b.output)
  assert.match(await b.read('/statistics'), /Words in notes[\s\S]*?0%/)
})

test('a list of more than forty pages is cut off with a count of the rest', async () => {
  const pages = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`topic/Page${String(i).padStart(2, '0')}.md`, page('lonely', '', `Page ${i}`)]))
  const b = await build(pages)
  assert.equal(b.code, 0, b.output)
  assert.match(await b.read('/statistics'), /and \d+ more/)
})

test('a site that cites every verse of the Bible has no stretch uncited', async () => {
  // Each chapter in ranges of at most fifteen verses, which count as citing them.
  const sentences = BIBLE_BOOKS.map((names, book) => {
    const name = names.at(-1) // the code, which every form of the book's name shares
    const chapters = VERSES_PER_CHAPTER[book].map((verses, c) => {
      const ranges = []
      for (let from = 1; from <= verses; from += 15) ranges.push(`${c + 1}:${from}\u2013${Math.min(from + 14, verses)}`)
      return ranges.join('; ')
    })
    return `${name} ${chapters.join('; ')}.`
  })
  const b = await build({
    'abbreviations.json': JSON.stringify({ CSS: 'c', ESV: 'e', HTML: 'h', KB: 'k', MB: 'm', SS: 's' }),
    'topic/Everything.md': page(sentences.join('\n\n'))
  })
  assert.equal(b.code, 0, b.output)
  const html = await b.read('/statistics')
  assert.doesNotMatch(html, /longest stretch with no citations/)
  assert.match(html, /31,102 \/ 31,102|31,102<span class="of"> \/ 31,102/)
})

test('the statistics list the first letters of the topics in code-point order, even when accents sort them elsewhere', async () => {
  const b = await build({
    'topic/Eden.md': page('e', '', 'Eden'),
    'topic/Elan.md': page('e', '', '\u00C9lan'),
    'topic/Fall.md': page('f', '', 'Fall')
  })
  assert.equal(b.code, 0, b.output)
  const html = await b.read('/statistics')
  assert.ok(html.indexOf('>E<') < html.indexOf('>F<') && html.indexOf('>F<') < html.indexOf('>\u00C9<'), 'E, F, \u00C9')
})
