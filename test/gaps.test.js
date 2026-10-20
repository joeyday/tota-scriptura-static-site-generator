import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { processBibleRefs } from '../lib/bible/process.js'
import { md, protectFencedAttrs } from '../lib/markdown.js'
import { buildVault, makeVault } from './helpers/scratch-vault.js'
import { changeUntil, startServe, startStatic, waitFor } from './helpers/serve.js'

// What the other test files leave: odd corners of the Bible checker, the markdown rules, URL
// assignment, the cache-buster, commentary slicing, and the rebuild that overlaps another.

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

function assertFails (result, pattern) {
  assert.notEqual(result.code, 0, `expected the build to fail:\n${result.output}`)
  assert.match(result.output, /Build failed:/)
  assert.match(result.output, pattern)
}

// ─── What a bad reference is called in the message ───
describe('reference labels in messages', () => {
  const problems = (text) => processBibleRefs(`<p>${text}</p>`, { url: '/x', title: 'x' }).problems

  test('a named reference is quoted as written', () => {
    assert.deepEqual(problems('Romans 12:1–15:99'), ['"Romans 12:1–15:99": Romans 15 has 33 verses'])
  })

  test('a continuation says what it was read as, for a verse, a cross-chapter run and a chapter run', () => {
    assert.match(problems('Romans 1:1; 3:1–5:99')[0], /"3:1–5:99" \(read as Romans 3:1–5:99\): Romans 5 has 21 verses/)
    assert.match(problems('Romans 1:1; 3:99')[0], /"3:99" \(read as Romans 3:99\): Romans 3 has 31 verses/)
    assert.match(problems('Romans 3, 5–99')[0], /"5–99" \(read as Romans 5–99\): Romans has 16 chapters/)
    assert.match(problems('Romans 3, 99')[0], /"99" \(read as Romans 99\): Romans has 16 chapters/)
    assert.match(problems('Romans 1:1; 3:1–5:99')[0], /Romans has|Romans 5 has/)
  })

  test('each way a reference can be impossible has its own message', () => {
    const one = (text) => problems(text)
    assert.match(one('Romans 5–3')[0], /the range runs backwards/)
    assert.match(one('Romans 12:9–2')[0], /the range runs backwards/)
    assert.match(one('Romans 5:3–2:1')[0], /the range runs backwards/)
    assert.match(one('Romans 5:3–5:1')[0], /the range runs backwards/)
    assert.match(one('Romans 3:0')[0], /verses start at 1/)
    assert.match(one('Romans 3:1–20:2')[0], /Romans has 16 chapters/)
    assert.match(one('Romans 3:1–4:0')[0], /verses start at 1/)
    assert.match(one('Romans 0')[0], /Romans has 16 chapters/)
    assert.match(one('Romans 3–20')[0], /Romans has 16 chapters/)
    assert.match(one('Jude 1–2')[0], /Jude has one chapter; for verses 1–2 write Jude 1:1–2/)
    assert.match(one('Jude 2')[0], /Jude has one chapter, so this is chapter 2; for a verse write Jude 1:2/)
    assert.match(one('Jude 1:99')[0], /Jude 1 has 25 verses/)
  })

  test('singular and plural counts read naturally', () => {
    assert.match(problems('Philemon 1:99')[0], /Philemon 1 has 25 verses/)
    assert.match(problems('Obadiah 1:99')[0], /Obadiah 1 has 21 verses/)
    assert.match(problems('Psalm 117:9')[0], /Psalms 117 has 2 verses/)
  })
})

// ─── markdown-it ───
test('::: with a bare word is a div with that class', () => {
  assert.match(md.render(protectFencedAttrs('::: warning\nCareful\n:::')), /^<div class="warning">/)
})

// ─── URLs ───
describe('URLs and names', { concurrency: true }, () => {
  test('a root page named Home or Index is the home page', async () => {
    const home = await build({ 'Home.md': page('Welcome.'), 'Home page.md': null })
    assert.equal(home.code, 0, home.output)
    assert.match(await home.read('/'), /Welcome\./)
    const index = await build({ 'Index.md': page('Welcome.'), 'Home page.md': null })
    assert.equal(index.code, 0, index.output)
    assert.match(await index.read('/'), /Welcome\./)
  })

  test('a permalink sets the URL, and its leading slashes are dropped', async () => {
    const b = await build({ 'topic/Grace.md': page('g', 'permalink: /favour\n') })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/favour'), /<title>T/)
    assert.equal(await b.exists('/topic/grace'), false)
  })

  test('a notes page with no page of its own still gets the URL its page would have', async () => {
    const b = await build({
      'topic/notes/Orphan.md': page('Alone.'),
      'notes/Loose.md': page('Loose.')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/orphan/notes'), /Alone\./)
    assert.match(await b.read('/loose/notes'), /Loose\./)
  })

  test('the home page\'s notes live at /notes', async () => {
    const b = await build({ 'Home.md': page('Welcome.'), 'Home page.md': null, 'notes/Home.md': page('About the home.') })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/notes'), /About the home\./)
  })

  test('two pages\' aliases that redirect one URL are a mistake; one page\'s repeated alias is not', async () => {
    const clash = await build({
      'topic/A.md': page('a', 'aliases:\n  - Same\n'),
      'topic/B.md': page('b', 'aliases:\n  - Same\n')
    })
    assertFails(clash, /Aliases of "topic\/[AB]\.md" and "topic\/[AB]\.md" both redirect \/topic\/same/)
    const repeated = await build({ 'topic/A.md': page('a', 'aliases:\n  - Same\n  - same\n') })
    assert.equal(repeated.code, 0, repeated.output)
  })

  test('a link with .md on the name works, and counts as a backlink', async () => {
    const b = await build({
      'topic/Grace.md': page('See [[Mercy.md]].'),
      'topic/Mercy.md': page('m')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/topic/grace'), /href="\/topic\/mercy"/)
    assert.match(await b.read('/topic/mercy/backlinks'), /href="\/topic\/grace"/)
  })

  test('a bare name that several pages share links to the closest one, with a warning', async () => {
    const b = await build({
      'About.md': page('See [[Faith]].'),
      'topic/Faith.md': page('t'),
      'reference/Faith.md': page('r')
    })
    assert.equal(b.code, 0, b.output)
    assert.match(await b.read('/about'), /href="\/topic\/faith"/)
    assert.match(b.output, /Warning: Bare wikilink "Faith" in "About\.md" matches several pages — using \/topic\/faith; qualify it/)
  })

  test('a file iCloud has not downloaded stops the build', async () => {
    const b = await build({ 'topic/.Grace.md.icloud': '' })
    assertFails(b, /isn't downloaded from iCloud; download it and build again/)
  })
})

// ─── The cache-buster ───
describe('the cache-buster', { concurrency: true }, () => {
  const buster = async (b) => /style\.css\?(\w+)/.exec(await b.read('/'))?.[1]

  test('is CI\'s commit when GITHUB_SHA is set', async () => {
    const b = await build({ 'Home.md': page('x'), 'Home page.md': null }, { env: { GITHUB_SHA: '1234567890abcdef' } })
    assert.equal(await buster(b), '1234567')
  })

  test('is the vault repository\'s short commit hash otherwise', async () => {
    const git = (vault, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: vault })
    let head
    const b = await build({ 'Home.md': page('x'), 'Home page.md': null }, {
      env: { GITHUB_SHA: '' },
      prepare: async (vault) => {
        await git(vault, 'init', '-q')
        await git(vault, 'add', '.')
        await git(vault, 'commit', '-q', '-m', 'x')
        head = (await git(vault, 'rev-parse', '--short=7', 'HEAD')).stdout.trim()
      }
    })
    assert.equal(b.code, 0, b.output)
    assert.equal(await buster(b), head)
    assert.match(await b.read('/statistics'), new RegExp(head)) // the statistics name the build's commit
  })

  test('is the time, in seconds, with no repository at all', async () => {
    const before = Math.floor(Date.now() / 1000)
    const b = await build({ 'Home.md': page('x'), 'Home page.md': null }, { env: { GITHUB_SHA: '', GIT_DIR: '/nonexistent', GIT_CEILING_DIRECTORIES: '/' } })
    assert.equal(b.code, 0, b.output)
    const stamp = Number(await buster(b))
    assert.ok(stamp >= before && stamp <= before + 60, stamp)
  })

  // A timestamp is all digits, which the statistics page takes for a commit: it prints
  // it as one and links to a GitHub commit that does not exist.
  test('the statistics call a build with no commit "a local build"', { todo: 'a timestamp looks like a hex commit hash' }, async () => {
    const b = await build({ 'Home.md': page('x'), 'Home page.md': null }, { env: { GITHUB_SHA: '', GIT_DIR: '/nonexistent', GIT_CEILING_DIRECTORIES: '/' } })
    const html = await b.read('/statistics')
    assert.match(html, /a local build/)
    assert.doesNotMatch(html, /\/commit\//)
  })
})

// ─── Problems on the generated pages ───
test('a generated page that needs an abbreviation the vault lacks fails the build, naming the page', async () => {
  const b = await build({
    'abbreviations.json': '{}',
    'topic/Grace.md': page('See Jn 3:16.')
  })
  assertFails(b, /Problems on generated pages:[\s\S]*"\/settings": CSS is not in abbreviations\.json/)
  assert.match(b.output, /"\/statistics": ESV is not in abbreviations\.json/)
})

// ─── Statistics ───
test('the statistics name the citation that spans the most chapters', async () => {
  const b = await build({ 'topic/Grace.md': page('See Romans 3–5 and Romans 8:1–2.') })
  assert.equal(b.code, 0, b.output)
  const html = await b.read('/statistics')
  assert.match(html, /The citation that spans the most chapters, 3 chapters, is <a [^>]*href="\/index\/scripture\/romans#3-5"[^>]*>Romans\s3–5<\/a>/)
})

// ─── Commentary ───
describe('commentary slicing', { concurrency: true }, () => {
  const commentary = [
    'Introduction.',
    '',
    '---',
    '',
    '## Greeting (Tit 1:1–4)',
    '',
    'About the greeting.',
    '',
    'Tit 1:5',
    ': The first term.',
    '',
    'Tit 1:6',
    ': The second.',
    '',
    'Tit 1:7',
    ': The third.',
    '',
    'A term with no verse of its own',
    ': It stays with the slice before it.',
    '',
    '## Later (Tit 2:1)',
    '',
    'Closing words.'
  ].join('\n')

  test('entries sit between the slices for the verses before and after them, in order', async () => {
    const b = await build({
      'commentary/Titus.md': page(commentary, '', 'Titus'),
      'topic/Grace.md': page('See Tit 1:3, Tit 1:6, Tit 2:1 and Tit 3:1.')
    })
    assert.equal(b.code, 0, b.output)
    const full = await b.read('/commentary/titus')
    const html = full.slice(full.indexOf('<article')) // the head repeats the page's first words
    const at = (text) => {
      const i = html.indexOf(text)
      assert.ok(i >= 0, `missing: ${text}`)
      return i
    }
    const order = [
      at('Introduction.'), at('Greeting'), at('id="1.3"'), at('The first term.'), at('The second.'),
      at('id="1.6"'), at('The third.'), at('It stays with the slice before it.'), at('Later'),
      at('Closing words.'), at('id="2.1"'), at('id="3.1"') // an entry follows the slice for its own verse
    ]
    assert.deepEqual(order, [...order].sort((a, b) => a - b))
    assert.match(html, /<hr>/)
  })

  test('terms that nothing came between are one list again', async () => {
    const b = await build({
      'commentary/Titus.md': page(commentary, '', 'Titus'),
      'topic/Grace.md': page('See Tit 3:1.')
    })
    assert.equal(b.code, 0, b.output)
    const html = await b.read('/commentary/titus')
    // "Tit 1:5", "1:6" and "1:7" are three slices but, with no entries between, one <dl>.
    const list = /<dl>\s*<dt>[\s\S]*?Tit\u00a01:5[\s\S]*?<\/dl>/.exec(html)[0]
    assert.match(list, /The second\./)
    assert.match(list, /The third\./)
  })

  test('a commentary page\'s terms are not headings, so they get no ids', async () => {
    const b = await build({
      'commentary/Titus.md': page('Tit 1:5\n: A term.', '', 'Titus'),
      'topic/Grace.md': page('See Tit 3:1.')
    })
    assert.doesNotMatch(await b.read('/commentary/titus'), /<dt id=/)
  })
})

// ─── The rebuild that overlaps another, and the port in use ───
describe('serve edge cases', { concurrency: true }, () => {
  test('a change made while a rebuild runs is built by the next rebuild, not lost', async () => {
    // Each of these pages takes `delay` ms to render (a template that waits), so a rebuild
    // is slow and the second change is made in the middle of it. (The build does not let go of
    // the event loop while it renders, so the watcher only hears of the change afterwards; the
    // `building` guard in build.js is for a build slow in its file reads, and nothing here
    // reaches it.)
    const slow = (delay) => Object.fromEntries([1, 2, 3, 4].map((n) => [
      `topic/Slow${n}.md`,
      page(`<% const t = Date.now(); while (Date.now() - t < ${delay}) {} %>Version ${delay}.`, '', `Slow ${n}`)
    ]))
    const made = await makeVault(slow(0))
    cleanups.push(made.cleanup)
    const server = await startServe(made.vault, made.dist, {})
    cleanups.push(() => server.close())

    await changeUntil(async (n) => {
      for (const [name, content] of Object.entries(slow(600 + n))) await fs.writeFile(path.join(made.vault, name), content)
    }, () => /Changed:/.test(server.output()))
    for (const [name, content] of Object.entries(slow(0))) await fs.writeFile(path.join(made.vault, name), content)
    await waitFor(() => (server.output().match(/Rebuilt in/g) ?? []).length >= 2, { timeout: 40000, what: `two rebuilds:\n${server.output()}` })
    assert.ok((server.output().match(/Changed:/g) ?? []).length >= 2)
    assert.match(await (await server.get('/topic/slow1/')).text(), /Version 0\./)
  })

  test('the command line says when its port is taken, and exits 1', async () => {
    const built = await buildVault({})
    builds.push(built)
    const first = await startStatic(built.dist)
    cleanups.push(() => first.close())
    const made = await makeVault({})
    cleanups.push(made.cleanup)
    const second = await startServe(made.vault, made.dist, { args: ['--no-watch'], port: first.port })
    const [code] = await second.exit
    assert.equal(code, 1)
    assert.match(second.output(), new RegExp(`Port ${first.port} is already in use \\(is another tsgen serve running\\? try --port\\)`))
  })
})
