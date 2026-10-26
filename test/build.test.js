import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVault } from './helpers/scratch-vault.js'

// Each test builds a tiny scratch vault with the real generator, in its own
// working directory, and checks that the build passes or fails for the right reason.
// A failing build exits non-zero and prints "Build failed: <what is wrong>".

const builds = []
const build = async (files, options) => {
  const result = await buildVault(files, options)
  builds.push(result)
  return result
}
after(() => Promise.all(builds.map((b) => b.cleanup())))

const titled = (title, data = '') => `---\ntitle: ${title}\n${data}---\nText.\n`
const page = (body, data = '') => `---\ntitle: T\n${data}---\n${body}\n`

function assertFails (result, pattern) {
  assert.notEqual(result.code, 0, `expected the build to fail:\n${result.output}`)
  assert.match(result.output, /Build failed:/)
  assert.match(result.output, pattern)
}

describe('a good build', { concurrency: true }, () => {
  test('writes pages, resolves a wikilink and exits cleanly', async () => {
    const b = await build({
      'topic/Grace.md': page('Grace is [[Mercy]].'),
      'topic/Mercy.md': page('Mercy.')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/grace'), /<a [^>]*href="\/topic\/mercy"[^>]*>Mercy<\/a>/)
    for (const url of ['/search', '/statistics', '/index/scripture', '/search-index.json']) {
      assert.ok(await b.exists(url), url)
    }
  })

  test('a Scripture reference becomes a link, and a ! opts one out', async () => {
    const b = await build({ 'topic/Grace.md': page('See John 3:16 and !Romans 17.') })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/topic/grace')
    assert.match(html, /href="https:\/\/ref\.ly\/Jn3\.16;ESV"/)
    assert.match(html, /Romans 17\./)
  })

  test('an alias redirects to its page', async () => {
    const b = await build({ 'topic/Grace.md': page('Grace.', 'aliases:\n  - Favour\n') })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/favour'), /\/topic\/grace/)
  })

  test('a hidden page is not built', async () => {
    const b = await build({ 'topic/Secret.md': page('Shh.', 'hidden: true\n') })
    assert.equal(b.code, 0, b.output)
    assert.equal(await b.exists('/topic/secret'), false)
  })
})

describe('mistakes that fail the build', { concurrency: true }, () => {
  test('a broken wikilink', async () => {
    const b = await build({ 'topic/Grace.md': page('See [[Nowhere]].') })
    assertFails(b, /Broken links in published pages[\s\S]*\[\[Nowhere\]\] matches no page/)
  })

  test('an ambiguous wikilink', async () => {
    const b = await build({
      'topic/Grace.md': page('See [[Faith]].'),
      'reference/Faith.md': page('r'),
      'category/Faith.md': page('c')
    })
    assertFails(b, /\[\[Faith\]\] matches several pages; qualify it/)
  })

  test('a link to a heading the page does not have', async () => {
    const b = await build({
      'topic/Grace.md': page('See [[Mercy#Nope]].'),
      'topic/Mercy.md': page('## Real\n\ntext')
    })
    assertFails(b, /\[\[Mercy#Nope\]\] matches no heading, term or definition id/)
  })

  test('a link to a heading it does have builds', async () => {
    const b = await build({
      'topic/Grace.md': page('See [[Mercy#Real]].'),
      'topic/Mercy.md': page('## Real\n\ntext')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/grace'), /href="\/topic\/mercy#real"/)
  })

  test('two pages at one URL', async () => {
    const b = await build({
      'topic/A.md': page('a', 'permalink: same\n'),
      'topic/B.md': page('b', 'permalink: same\n')
    })
    assertFails(b, /"topic\/[AB]\.md" and "topic\/[AB]\.md" both build \/topic\/same/)
  })

  test('an alias that would replace a page', async () => {
    const b = await build({
      'topic/Grace.md': page('g', 'aliases:\n  - Mercy\n'),
      'topic/Mercy.md': page('m')
    })
    assertFails(b, /Alias of "topic\/Grace\.md" would replace the page "topic\/Mercy\.md"/)
  })

  test('an alias with a slash, and an alias on a notes page', async () => {
    const slash = await build({ 'topic/Grace.md': page('g', 'aliases:\n  - a/b\n') })
    assertFails(slash, /has a "\/"; an alias is a name in the page's own folder/)
    const notes = await build({
      'topic/Grace.md': page('g'),
      'topic/notes/Grace.md': page('n', 'aliases:\n  - Gr\n')
    })
    assertFails(notes, /is a notes page and can't have aliases/)
  })

  test('bad frontmatter: never closed, not a mapping, a capital key, a non-text title', async () => {
    assertFails(await build({ 'topic/A.md': '---\ntitle: A\nBody\n' }), /Bad frontmatter in "topic\/A\.md": frontmatter is never closed/)
    assertFails(await build({ 'topic/A.md': '---\n- a\n---\nBody\n' }), /must be a set of key: value pairs/)
    assertFails(await build({ 'topic/A.md': '---\nTitle: A\n---\nBody\n' }), /the key "Title" must be lowercase/)
    assertFails(await build({ 'topic/A.md': '---\ntitle: [a, b]\n---\nBody\n' }), /"title" must be text/)
    assertFails(await build({ 'topic/A.md': '---\norder: first\n---\nBody\n' }), /"order" must be a number/)
  })

  test('Markdown in a folder that is not a page folder', async () => {
    const b = await build({ 'essays/A.md': page('a') })
    assertFails(b, /Markdown in unknown folder\(s\): "essays"/)
  })

  test('a Scripture reference that cannot exist', async () => {
    const b = await build({ 'topic/Grace.md': page('See Romans 17 and Phm 3.') })
    assertFails(b, /Scripture references that can't exist[\s\S]*"Romans 17": Romans has 16 chapters[\s\S]*"Phm 3": Philemon has one chapter/)
  })

  test('an abbreviation, initials or image with no entry', async () => {
    const b = await build({
      'topic/Grace.md': page('NASA and R.C. Sproul.\n\n![[pic.png]]'),
      'image/pic.png': Buffer.from('x')
    })
    assertFails(b, /NASA is not in abbreviations\.json/)
    assert.match(b.output, /initials "R\.C\." need an entry in initials\.json: "R\.C\. Sproul"/)
    assert.match(b.output, /image pic\.png has no entry in alt-text\.json/)
  })

  test('the same abbreviation, initials and image with entries build', async () => {
    const b = await build({
      'abbreviations.json': JSON.stringify({ NASA: 'Space agency', CSS: 'c', ESV: 'e', HTML: 'h', KB: 'k', MB: 'm' }),
      'initials.json': JSON.stringify({ 'R.C. Sproul': 'Robert Charles Sproul' }),
      'alt-text.json': JSON.stringify({ 'Trees-and-buildings.png': 'Trees', 'pic.png': 'A picture' }),
      'topic/Grace.md': page('NASA and R.C. Sproul.\n\n![[pic.png]]'),
      'image/pic.png': Buffer.from('x')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/topic/grace')
    assert.match(html, /<abbr title="Space agency">NASA<\/abbr>/)
    assert.match(html, /<abbr title="Robert Charles Sproul">R\.C\.<\/abbr>/)
    assert.match(html, /alt="A picture"/)
  })

  test('headings with one name that are not next to each other', async () => {
    const b = await build({ 'topic/Grace.md': page('## Grace\n\na\n\n## Law\n\nb\n\n## Grace\n\nc') })
    assertFails(b, /Headings and terms with the same name that aren't next to each other[\s\S]*"Grace" \(#grace\)/)
  })

  test('a broken EJS template', async () => {
    const b = await build({ 'topic/Grace.md': page('<%= nope.nope %>') })
    assertFails(b, /EJS render error in "topic\/Grace\.md"/)
  })

  test('a missing required JSON file, and invalid JSON', async () => {
    assertFails(await build({ 'abbreviations.json': null }), /abbreviations\.json not found/)
    assertFails(await build({ 'initials.json': '{' }), /initials\.json is not valid JSON/)
    assertFails(await build({ 'alt-text.json': '[]' }), /alt-text\.json must be a JSON object/)
    assertFails(await build({ 'abbreviations.json': '{"CSS": ""}' }), /abbreviations\.json needs an expansion for: CSS/)
  })

  test('a missing fallback share image', async () => {
    const b = await build({ 'image/Trees-and-buildings.png': null })
    assertFails(b, /The fallback share image image\/Trees-and-buildings\.png is missing/)
  })

  test('a commentary page that is not named for a Bible book', async () => {
    const b = await build({ 'commentary/Notebook.md': page('Text') })
    assertFails(b, /Commentary page "commentary\/Notebook\.md" is not named for a Bible book/)
  })
})

describe('images', { concurrency: true }, () => {
  const alt = JSON.stringify({ 'Trees-and-buildings.png': 'Trees', 'pic.png': 'A picture', 'wide.png': 'Wide' })
  const png = Buffer.from('x')

  test('an embed by bare name or by path, with a size, and a link to an image', async () => {
    const b = await build({
      'alt-text.json': alt,
      'image/pic.png': png,
      'image/wide.png': png,
      'topic/Grace.md': page('![[pic.png]]\n\n![[image/wide.png|300x100]]\n\n[[pic.png|the picture]]')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/topic/grace')
    assert.match(html, /<figure><img src="\/asset\/pic\.png" alt="A picture"><\/figure>/)
    assert.match(html, /<img src="\/asset\/wide\.png" alt="Wide" width="300" height="100">/)
    assert.match(html, /<a class="internal" href="\/asset\/pic\.png">the picture<\/a>/)
  })

  test('an image that does not exist', async () => {
    const b = await build({ 'topic/Grace.md': page('![[nope.png]] and [[also-nope.jpg]]') })
    assertFails(b, /Broken links in published pages[\s\S]*!\[\[nope\.png\]\] matches no image/)
    assert.match(b.output, /\[\[also-nope\.jpg\]\] matches no image/)
  })

  test('an SVG is inlined, and one that is not an SVG fails', async () => {
    const good = await build({
      'image/d.svg': '<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"><rect/></svg>',
      'topic/Grace.md': page('![[d.svg|50x40]]')
    })
    assert.equal(good.code, 0, good.output)
    assert.match(await good.read('/topic/grace'), /<figure class="diagram"><svg width="50" height="40" viewBox="0 0 1 1"><rect\/><\/svg><\/figure>/)
    const bad = await build({ 'image/d.svg': '<div></div>', 'topic/Grace.md': page('![[d.svg]]') })
    assertFails(bad, /An SVG must start with <svg>/)
  })

  test('two images with one name, in any case, collide: asset names are flat', async () => {
    const b = await build({ 'image/a/pic.png': png, 'image/b/PIC.png': png })
    assertFails(b, /Asset name collision[\s\S]*"image\/[ab]\/(pic|PIC)\.png" and "image\/[ab]\/(pic|PIC)\.png"; asset names are flat/)
  })
})

describe('pages and their relations', { concurrency: true }, () => {
  test('a notes folder next to a page is its notes page', async () => {
    const b = await build({
      'topic/Grace.md': page('Grace.'),
      'topic/notes/Grace.md': page('Notes on grace.')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/grace/notes'), /Notes on grace\./)
    assert.match(await b.read('/topic/grace'), /href="\/topic\/grace\/notes"/)
  })

  test('a link resolves, and the target lists the linking page as a backlink', async () => {
    const b = await build({
      'topic/Grace.md': page('See [[Mercy]].'),
      'topic/Mercy.md': page('Mercy.')
    })
    assert.equal(b.code, 0, b.output)
    const backlinks = await b.read('/topic/mercy/backlinks')
    assert.match(backlinks, /href="\/topic\/grace"/)
  })

  test('a link to a term\'s block id goes to the id tsgen gave the term, and the id never shows', async () => {
    const b = await build({
      'topic/Grace.md': page('See [[Mercy#^abc123]].'),
      'topic/Mercy.md': page('Loving-kindness\n: Steadfast love ^abc123')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/grace'), /href="\/topic\/mercy#loving-kindness"/)
    const mercy = await b.read('/topic/mercy')
    assert.match(mercy, /<dt id="loving-kindness">/)
    assert.doesNotMatch(mercy, /abc123/)
  })

  test('a category lists its members; an empty one is unlisted', async () => {
    const b = await build({
      'category/Doctrine.md': page('Doctrines.'),
      'category/Empty.md': page('Nothing here.'),
      'topic/Grace.md': page('Grace.', 'categories:\n  - "[[Doctrine]]"\n')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/category/doctrine'), /href="\/topic\/grace"/)
    assert.match(await b.read('/topic/grace'), /href="\/category\/doctrine"/)
    assert.doesNotMatch(await b.read('/index/category'), /Empty/)
  })

  test('`order` sets the order of a category\'s pages and subcategories and of the categorical index, and nowhere else', async () => {
    const inDoctrine = 'categories:\n  - "[[Doctrine]]"\n'
    const b = await build({
      'category/Doctrine.md': titled('Doctrine', 'order: 2\n'),
      'category/Apples.md': titled('Apples', 'order: 1.5\n'),
      'category/Zebra.md': titled('Zebra'),
      'category/Sub B.md': titled('Sub B', `${inDoctrine}order: 1\n`),
      'category/Sub A.md': titled('Sub A', inDoctrine),
      'topic/Delta.md': titled('Delta', `${inDoctrine}order: 1\n`),
      'topic/Alpha.md': titled('Alpha', inDoctrine),
      'topic/Charlie.md': titled('Charlie', `${inDoctrine}order: -3\n`),
      'topic/Bravo.md': titled('Bravo', `${inDoctrine}order: 1\n`),
      'topic/Echo.md': titled('Echo', 'categories:\n  - "[[Apples]]"\n'),
      'topic/Foxtrot.md': titled('Foxtrot', 'categories:\n  - "[[Zebra]]"\n'),
      'topic/Sub.md': titled('Sub', 'categories:\n  - "[[Sub A]]"\n  - "[[Sub B]]"\n')
    })
    assert.equal(b.code, 0, b.output)
    const order = (html, names) => names.map((n) => html.indexOf(`>${n}</a>`))
    const inOrder = (positions) => positions.every((p, i) => p > 0 && (i === 0 || p > positions[i - 1]))
    // Lowest first, those without one last, equal orders alphabetical
    assert.ok(inOrder(order(await b.read('/category/doctrine'), ['Sub B', 'Sub A', 'Charlie', 'Bravo', 'Delta', 'Alpha'])))
    // The categorical index: Apples (1.5), Doctrine (2), then Zebra
    assert.ok(inOrder(order(await b.read('/index/category'), ['Apples', 'Doctrine', 'Zebra'])))
    // The alphabetical index stays alphabetical
    assert.ok(inOrder(order(await b.read('/index/topic'), ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])))
  })

  test('a partial is expanded; a missing one only warns', async () => {
    const b = await build({
      'partial/Greeting.md': 'Hello, {{1}}!',
      'topic/Grace.md': page('{{Greeting|world}} {{Missing}}')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/grace'), /Hello, world!/)
    assert.match(b.output, /partial "Missing" not found/)
    assert.equal(await b.exists('/partial/greeting'), false)
  })

  test('template tags see the frontmatter', async () => {
    const b = await build({ 'topic/Grace.md': page('Rank: <%= frontmatter.rank %>', 'rank: 7\n') })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/grace'), /Rank: 7/)
  })

  test('code is left alone: no link, template, partial or comment inside it', async () => {
    const b = await build({
      'topic/Grace.md': page('`[[Nowhere]] <%= nope %> {{Missing}}`\n\n```\n[[Nowhere]]\n```\n\n%% [[Nowhere]] %%')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/grace'), /<code>\[\[Nowhere\]\] &lt;%= nope %&gt; \{\{Missing\}\}<\/code>/)
  })

  test('a link to a hidden page builds a placeholder for it', async () => {
    const b = await build({
      'topic/Grace.md': page('See [[Secret]].'),
      'topic/Secret.md': page('Shh.', 'hidden: true\n')
    })
    assert.equal(b.code, 0, b.output)
    const secret = await b.read('/topic/secret')
    assert.match(secret, /under construction/)
    assert.doesNotMatch(secret, /Shh\./)
  })

  test('a Scripture reference on a topic page reaches the Scripture index', async () => {
    const b = await build({ 'topic/Grace.md': page('## Grace\n\nSee Jn 3:16.') })
    assert.equal(b.code, 0, b.output)
    const index = await b.read('/index/scripture/john')
    assert.match(index, /3:16/)
    assert.match(index, /href="\/topic\/grace#grace"/)
  })

  test('the same vault builds the same site twice', async () => {
    const files = { 'topic/Grace.md': page('See [[Mercy]] and Jn 3:16.'), 'topic/Mercy.md': page('Mercy.') }
    const [a, b] = await Promise.all([build(files), build(files)])
    assert.equal(a.code, 0, a.output)
    for (const url of ['/topic/grace', '/search-index.json', '/statistics', '/index/scripture/john']) {
      assert.equal(await a.read(url), await b.read(url), url)
    }
  })
})
