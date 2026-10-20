import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVault } from './helpers/scratch-vault.js'

// Builds of tiny scratch vaults, read for the pages the generator writes itself:
// the indexes, redirects, random, the Scripture index and commentary pages.

const builds = []
const build = async (files, options) => {
  const result = await buildVault(files, options)
  builds.push(result)
  return result
}
after(() => Promise.all(builds.map((b) => b.cleanup())))

const page = (body, data = '', title = 'T') => `---\ntitle: ${title}\n${data}---\n${body}\n`

// The hrefs of the links in the list items of an index page, in order.
const listed = (html) => [...html.matchAll(/<li>\s*<a [^>]*?href="([^"]+)"/g)].map((m) => m[1])

describe('indexes', { concurrency: true }, () => {
  test('the alphabetical index ignores leading articles and case, and lists aliases as "see" entries', async () => {
    const b = await build({
      'topic/The Law.md': page('l', 'aliases:\n  - Torah\n', 'The Law'),
      'topic/apple.md': page('a', '', 'apple'),
      'topic/Zeal.md': page('z', '', 'Zeal'),
      'topic/A Banana.md': page('b', '', 'A Banana')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/index/alphabetical/topic')
    assert.deepEqual(listed(html).filter((u) => u.startsWith('/topic/')),
      ['/topic/apple', '/topic/a-banana', '/topic/the-law', '/topic/zeal'])
    assert.match(html, /<li>Torah <small>\(see <a [^>]*href="\/topic\/the-law"[^>]*>The Law<\/a>\)<\/small><\/li>/)
    assert.ok(html.indexOf('Torah') > html.indexOf('The Law') && html.indexOf('Torah') < html.indexOf('Zeal'))
  })

  test('the namespace menu links the other listed namespaces; one with nothing listed is left out', async () => {
    const b = await build({ 'topic/A.md': page('a'), 'reference/R.md': page('r') })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/index/alphabetical/topic')
    assert.match(html, /<li class="selected" aria-current="page">Topics<\/li>/)
    assert.match(html, /<a [^>]*href="\/index\/alphabetical\/reference"[^>]*>Reference<\/a>/)
    assert.doesNotMatch(html, /alphabetical\/commentary/)
    assert.equal(await b.exists('/index/alphabetical/commentary'), false)
  })

  test('/index/alphabetical redirects to the topic list', async () => {
    const b = await build({ 'topic/A.md': page('a') })
    assert.match(await b.read('/index/alphabetical'), /http-equiv="refresh" content="0; url=\/index\/alphabetical\/topic"/)
  })

  test('featured, "featured with" and drafts', async () => {
    const b = await build({
      'topic/Grace.md': page('g', 'featured: true\n'),
      'topic/Mercy.md': page('m', 'featured with: "[[Grace]]"\n'),
      'topic/Wip.md': page('w', 'draft: true\n'),
      'topic/Plain.md': page('p')
    })
    assert.equal(b.code, 0, b.output)
    const featured = await b.read('/index/featured')
    assert.match(featured, /href="\/topic\/grace"[^>]*>T<\/a> <small>\(and <a [^>]*href="\/topic\/mercy"/)
    assert.doesNotMatch(featured, /\/topic\/plain|\/topic\/wip/)
    assert.deepEqual(listed(await b.read('/index/drafts')).filter((u) => u.startsWith('/topic/')), ['/topic/wip'])
    // The alphabetical index stars featured pages (and those featured with one).
    const alphabetical = await b.read('/index/alphabetical/topic')
    assert.equal([...alphabetical.matchAll(/featured-badge/g)].length, 2)
    // A link to a draft or featured page is classed.
    const home = await build({ 'topic/Grace.md': page('[[Wip]]'), 'topic/Wip.md': page('w', 'draft: true\n') })
    assert.match(await home.read('/topic/grace'), /<a class="internal draft" href="\/topic\/wip">/)
  })

  test('an unlisted page is out of the indexes, search and random, but still built', async () => {
    const b = await build({ 'topic/Quiet.md': page('q', 'unlisted: true\n'), 'topic/Loud.md': page('l') })
    assert.equal(b.code, 0, b.output)
    assert.ok(await b.exists('/topic/quiet'))
    assert.doesNotMatch(await b.read('/index/alphabetical/topic'), /quiet/)
    assert.doesNotMatch(await b.read('/search-index.json'), /quiet/)
    assert.doesNotMatch(await b.read('/random'), /quiet/)
  })

  test('the 404 page is never listed or searchable', async () => {
    const b = await build({ '404.md': page('Lost', 'unlisted: false\n', 'Not found') })
    assert.equal(b.code, 0, b.output)
    assert.ok(await b.exists('/404'))
    assert.doesNotMatch(await b.read('/search-index.json'), /Lost/)
    assert.doesNotMatch(await b.read('/index/alphabetical/meta'), /Not found/)
  })

  test('categories: top-level ones are listed, subcategories sit inside, and empty ones vanish up the tree', async () => {
    const b = await build({
      'category/Doctrine.md': page('d', '', 'Doctrine'),
      'category/Soteriology.md': page('s', 'categories:\n  - Doctrine\n', 'Soteriology'),
      'category/Hollow.md': page('h', '', 'Hollow'),
      'category/Hollower.md': page('h2', 'categories:\n  - Hollow\n', 'Hollower'),
      'topic/Grace.md': page('g', 'categories:\n  - "[[Soteriology]]"\n', 'Grace')
    })
    assert.equal(b.code, 0, b.output)
    const categorical = await b.read('/index/categorical')
    assert.deepEqual(listed(categorical).filter((u) => u.startsWith('/category/')), ['/category/doctrine'])
    const doctrine = await b.read('/category/doctrine')
    assert.match(doctrine, /href="\/category\/soteriology"/)
    assert.match(await b.read('/category/soteriology'), /href="\/topic\/grace"/)
    // Hollower has no members, so it is unlisted, which empties Hollow in turn.
    assert.doesNotMatch(await b.read('/index/alphabetical/category'), /hollow/i)
  })

  test('a page naming a category that does not exist only warns', async () => {
    const b = await build({ 'topic/Grace.md': page('g', 'categories:\n  - Nowhere\n') })
    assert.equal(b.code, 0, b.output)
    assert.match(b.output, /Could not find category "Nowhere" in "topic\/Grace\.md"/)
  })
})

describe('other generated pages', { concurrency: true }, () => {
  test('an alias writes a redirect page, for the notes page too', async () => {
    const b = await build({
      'topic/Grace.md': page('g', 'aliases:\n  - Favour\n'),
      'topic/notes/Grace.md': page('n')
    })
    assert.equal(b.code, 0, b.output)
    const redirect = await b.read('/topic/favour')
    assert.match(redirect, /http-equiv="refresh" content="0; url=\/topic\/grace"/)
    assert.match(redirect, /rel="canonical" href="https:\/\/totascriptura\.org\/topic\/grace"/)
    assert.match(await b.read('/topic/favour/notes'), /url=\/topic\/grace\/notes/)
  })

  test('/random lists topic and commentary pages, not categories, meta pages, references or aliases', async () => {
    const b = await build({
      'topic/Grace.md': page('g', 'aliases:\n  - Favour\n'),
      'category/C.md': page('c'),
      'reference/R.md': page('r'),
      'About.md': page('a')
    })
    assert.equal(b.code, 0, b.output)
    const pages = JSON.parse(/var pages = (\[.*?\]);/.exec(await b.read('/random'))[1])
    assert.deepEqual(pages, ['/topic/grace'])
  })

  test('the search index holds each listed page once, with its kind and plain-text body', async () => {
    const b = await build({
      'topic/Grace.md': page('Some *grace* &amp; more.'),
      'topic/notes/Grace.md': page('Notes.')
    })
    const docs = JSON.parse(await b.read('/search-index.json'))
    const grace = docs.find((d) => d.url === '/topic/grace')
    assert.equal(grace.kind, 'Topic')
    assert.match(grace.body, /^Some grace & more\./)
    assert.equal(docs.find((d) => d.url === '/topic/grace/notes').kind, 'Topic notes')
  })

  test('the settings and search pages exist, and every page links its stylesheet with the cache-buster', async () => {
    const b = await build({ 'topic/Grace.md': page('g') })
    for (const url of ['/settings', '/search', '/topic/grace']) assert.ok(await b.exists(url), url)
    assert.match(await b.read('/topic/grace'), /\/asset\/style\.css\?abcdef0/)
  })

  test('.nojekyll is written', async () => {
    const b = await build({})
    assert.ok(await b.exists('/.nojekyll'))
  })

  test('the page description is the frontmatter\'s, else the first paragraph', async () => {
    const b = await build({
      'topic/A.md': page('First paragraph here.\n\nSecond.'),
      'topic/B.md': page('Body.', 'description: Written by hand\n')
    })
    assert.match(await b.read('/topic/a'), /<meta name="description" content="First paragraph here\."/)
    assert.match(await b.read('/topic/b'), /<meta name="description" content="Written by hand"/)
  })

  test('<title> is not touched by the text passes', async () => {
    const b = await build({
      'abbreviations.json': JSON.stringify({ NT: 'New Testament', CSS: 'c', ESV: 'e', HTML: 'h', KB: 'k', MB: 'm' }),
      'topic/Nt.md': page('NT text', '', 'The NT & LORD')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/topic/nt')
    assert.match(html, /<title>[^<]*The NT &amp; LORD[^<]*<\/title>/)
    assert.match(html, /<abbr title="New Testament">NT<\/abbr> text/)
  })
})

describe('the Scripture index and commentary pages', { concurrency: true }, () => {
  test('the index lists books in canonical order, with their entries in canonical order', async () => {
    const b = await build({
      'topic/A.md': page('Revelation 1:1, Romans 8:28, Romans 3:23, Genesis 1:1.', '', 'A')
    })
    assert.equal(b.code, 0, b.output)
    const books = listed(await b.read('/index/scripture'))
    assert.deepEqual(books.filter((u) => u.startsWith('/index/scripture/')),
      ['/index/scripture/genesis', '/index/scripture/romans', '/index/scripture/revelation'])
    const romans = await b.read('/index/scripture/romans')
    assert.ok(romans.indexOf('id="3.23"') < romans.indexOf('id="8.28"'))
    assert.match(romans, /Jump to chapter/)
    assert.match(romans, /<span id="ch-3"><\/span>/)
    // Neighbouring books link back and forward.
    assert.match(romans, /&laquo; Genesis/)
    assert.match(romans, /Revelation &raquo;/)
  })

  test('an entry lists each page and section it appears in once', async () => {
    const b = await build({
      'topic/A.md': page('## One\n\nJn 3:16 and John 3:16.\n\n## Two\n\nJohn 3:16.', '', 'Alpha'),
      'topic/B.md': page('John 3:16.', '', 'Beta')
    })
    const john = await b.read('/index/scripture/john')
    assert.equal([...john.matchAll(/<li><a [^>]*href="\/topic\//g)].length, 3) // A#one, A#two, B
    assert.match(john, /href="\/topic\/a#one"/)
    assert.match(john, /href="\/topic\/a#two"/)
    assert.match(john, /href="\/topic\/b"/)
  })

  test('notes, reference and unlisted pages stay out of the index', async () => {
    const b = await build({
      'topic/A.md': page('Romans 1:1.'),
      'topic/notes/A.md': page('Genesis 1:1.'),
      'reference/R.md': page('Exodus 1:1.'),
      'topic/Q.md': page('Leviticus 1:1.', 'unlisted: true\n')
    })
    assert.equal(b.code, 0, b.output)
    const books = listed(await b.read('/index/scripture')).filter((u) => u.startsWith('/index/scripture/'))
    assert.deepEqual(books, ['/index/scripture/romans'])
  })

  test('a commentary page named for a book interleaves the other pages\' entries, not its own', async () => {
    const b = await build({
      'commentary/Titus.md': page('## Greeting\n\nTit 1:1 is where it starts.\n\n## Later\n\nMore.', '', 'Titus'),
      'topic/Grace.md': page('See Tit 1:5 and Titus 2:11.', '', 'Grace')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/commentary/titus')
    assert.match(html, /<dl class="scripture-entries">/)
    assert.match(html, /<dt class="scripture-reference" id="1\.5">[\s\S]*?Tit\u00a01:5<\/a><\/dt>/) // the linker joins a reference with non-breaking spaces
    assert.match(html, /<dt class="scripture-reference" id="2\.11">/)
    assert.match(html, /href="\/topic\/grace"/)
    assert.doesNotMatch(html, /id="1\.1"/) // its own reference is right there in the text
    assert.match(html, /id="show-scripture-index"/)
    // The Scripture index page for the book lists all three.
    const index = await b.read('/index/scripture/titus')
    for (const id of ['1.1', '1.5', '2.11']) assert.match(index, new RegExp(`id="${id.replace('.', '\\.')}"`))
  })

  test('a commentary page with nothing from other pages has no switch', async () => {
    const b = await build({ 'commentary/Titus.md': page('Tit 1:1 only.', '', 'Titus') })
    assert.equal(b.code, 0, b.output)
    assert.doesNotMatch(await b.read('/commentary/titus'), /show-scripture-index/)
  })

  test('a commentary page that nothing references fails, saying so', async () => {
    const b = await build({ 'commentary/Titus.md': page('No references here.', '', 'Titus') })
    assert.notEqual(b.code, 0)
    assert.match(b.output, /Nothing references Titus, not even "commentary\/Titus\.md"/)
  })
})

describe('the command line', { concurrency: true }, () => {
  test('build takes no flags: --show-hidden belongs to serve', async () => {
    const b = await build({}, { args: ['build', '--show-hidden'] })
    assert.equal(b.code, 1)
    assert.match(b.output, /Usage: tsgen/)
  })

  test('an unknown command prints the usage', async () => {
    const b = await build({}, { args: ['deploy'] })
    assert.equal(b.code, 1)
    assert.match(b.output, /Usage: tsgen/)
  })

  test('the build refuses to clear a directory that holds the vault', async () => {
    const b = await build({}, { env: { TSGEN_OUT: '.' } })
    assert.equal(b.code, 1)
    assert.match(b.output, /Refusing to clear .*: it holds the vault/)
  })
})
