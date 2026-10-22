import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVault, makeVault } from './helpers/scratch-vault.js'
import { findChrome } from '../lib/book/pdf.js'
import { changeUntil, copyGenerator, freePort, startServe, startStatic, waitFor } from './helpers/serve.js'

// The preview server, run for real as `tsgen serve` in scratch vaults. These tests start
// processes and (the watching ones) wait out the watcher's quiet period, so they take a few
// seconds; they run side by side.

const page = (body, data = '', title = 'T') => `---\ntitle: ${title}\n${data}---\n${body}\n`

const cleanups = []
const vaultFor = async (files) => {
  const made = await makeVault(files)
  cleanups.push(made.cleanup)
  return made
}
const serve = async (made, options) => {
  const server = await startServe(made.vault, made.dist, options)
  cleanups.push(() => server.close())
  return server
}
// A built site served by serve.js alone.
const serveBuilt = async (files, options) => {
  const built = await buildVault(files)
  assert.equal(built.code, 0, built.output)
  cleanups.push(built.cleanup)
  const server = await startStatic(built.dist, options)
  cleanups.push(() => server.close())
  return { ...built, server }
}
after(async () => { for (const cleanup of cleanups) await cleanup() })

// A request fetch would tidy up first (it normalises "/../"), so it goes by hand.
const rawGet = (port, requestPath, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: requestPath, method }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
  })
  req.on('error', reject)
  req.end()
})

describe('the static server (serve.js)', { concurrency: true }, () => {
  test('serves pages like GitHub Pages: /foo/ is foo/index.html, and /foo redirects to /foo/', async () => {
    const { server } = await serveBuilt({ 'topic/Grace.md': page('Grace.') })
    assert.match(server.output(), /Serving .* at http:\/\/localhost:\d+\/ {2}\(Ctrl-C to stop\)/)

    const ok = await server.get('/topic/grace/')
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    const html = await ok.text()
    assert.match(html, /Grace\./)
    assert.doesNotMatch(html, /EventSource/) // no reload script without watching

    const redirect = await server.get('/topic/grace?x=1', { redirect: 'manual' })
    assert.equal(redirect.status, 301)
    assert.equal(redirect.headers.get('location'), '/topic/grace/?x=1')

    const head = await server.get('/topic/grace/', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(html))
    assert.equal(await head.text(), '')
  })

  test('serves files with their content types', async () => {
    const { server, dist } = await serveBuilt({ 'topic/Grace.md': page('Grace.') })
    const type = async (p) => (await server.get(p)).headers.get('content-type')
    assert.equal(await type('/asset/style.css'), 'text/css; charset=utf-8')
    assert.equal(await type('/asset/search.js'), 'text/javascript; charset=utf-8')
    assert.equal(await type('/search-index.json'), 'application/json; charset=utf-8')
    assert.equal(await type('/asset/favicon-96x96.png'), 'image/png')
    assert.equal(await type('/asset/favicon.ico'), 'image/x-icon')
    await fs.writeFile(path.join(dist, 'asset', 'mystery.xyz'), 'x')
    assert.equal(await type('/asset/mystery.xyz'), 'application/octet-stream')
  })

  test('an unknown path gets 404.html with a 404 status, or plain text without one', async () => {
    const { server: withPage } = await serveBuilt({ '404.md': page('Lost.', '', 'Not found') })
    const found = await withPage.get('/nope')
    assert.equal(found.status, 404)
    assert.match(await found.text(), /Lost\./)

    const { server: without } = await serveBuilt({})
    const plain = await without.get('/nope')
    assert.equal(plain.status, 404)
    assert.equal(plain.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(await plain.text(), '404 Not Found')
    // A directory with no index.html is not found either.
    assert.equal((await without.get('/asset/')).status, 404)
  })

  test('nothing outside the output directory is served, and a bad escape is not found', async () => {
    const { server, root } = await serveBuilt({})
    await fs.writeFile(path.join(root, 'secret.txt'), 'secret')
    for (const p of ['/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%E0%A4%A']) {
      const res = await rawGet(server.port, p)
      assert.equal(res.status, 404, p)
      assert.doesNotMatch(res.body, /secret/, p)
    }
  })

  test('only GET and HEAD are allowed', async () => {
    const { server } = await serveBuilt({})
    const res = await server.get('/', { method: 'POST' })
    assert.equal(res.status, 405)
    assert.equal(res.headers.get('allow'), 'GET, HEAD')
  })

  test('a file that cannot be read is a 500, and the server carries on', async () => {
    const { server, dist } = await serveBuilt({})
    const file = path.join(dist, 'search-index.json')
    await fs.chmod(file, 0o000)
    try {
      const res = await server.get('/search-index.json')
      assert.equal(res.status, 500)
      assert.equal(await res.text(), '500 Internal Server Error')
      await waitFor(() => /Serve error/.test(server.output()), { what: `the error message:\n${server.output()}` })
    } finally {
      await fs.chmod(file, 0o644)
    }
    assert.equal((await server.get('/search-index.json')).status, 200)
  })

  test('a port that is taken is a clear error, and the exit code is 1', async () => {
    const { server: first, dist } = await serveBuilt({})
    const second = await startStatic(dist, { port: first.port })
    const [code] = await second.exit
    assert.equal(code, 1)
    assert.match(second.output(), new RegExp(`Port ${first.port} is already in use`))
  })

  test('another error from listening is passed on as it is', async () => {
    const { dist } = await serveBuilt({})
    const second = await startStatic(dist, { port: 1 }) // not a port a normal user may bind (EACCES)
    const [code] = await second.exit
    assert.equal(code, 1)
    assert.match(second.output(), /EACCES|permission denied/i)
  })

  test('watching: pages carry the reload script, and the reload stream announces the boot and each reload', async () => {
    const { server } = await serveBuilt({ 'topic/Grace.md': page('Grace.') }, { watching: true })
    assert.match(await (await server.get('/topic/grace/')).text(), /new EventSource\("\/__tsgen\/reload"\)/)
    // Only HTML gets the script.
    assert.doesNotMatch(await (await server.get('/search-index.json')).text(), /EventSource/)
    // A page that is not found carries it too.
    assert.match(await (await server.get('/nope')).text(), /EventSource|404 Not Found/)

    const events = await server.get('/__tsgen/reload')
    assert.equal(events.headers.get('content-type'), 'text/event-stream')
    const reader = events.body.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    const read = async () => { seen += decoder.decode((await reader.read()).value ?? new Uint8Array()) }
    await read()
    assert.match(seen, /^data: [0-9a-z]+\n\n/)
    server.reload()
    while (!seen.includes('data: reload')) await read()
    await reader.cancel()
  })

  test('without watching there is no reload stream', async () => {
    const { server } = await serveBuilt({})
    assert.equal((await server.get('/__tsgen/reload')).status, 404)
  })

  test('the server exits cleanly when told to', async () => {
    const { server } = await serveBuilt({})
    await server.close()
    const [code] = await server.exit
    assert.equal(code, 0)
  })
})

describe('the command line flags of serve', { concurrency: true }, () => {
  const usage = async (...args) => {
    const made = await vaultFor({})
    const server = await startServe(made.vault, made.dist, { args })
    cleanups.push(() => server.close())
    const [code] = await server.exit
    return { code, output: server.output() }
  }

  test('a bad port, an unknown flag and a flag with a value it should not have are usage errors', async () => {
    for (const bad of [['--port', 'abc'], ['--port', '0'], ['--port', '70000'], ['--bogus'], ['--verbose=1'], ['--no-watch=1'], ['--show-hidden=1']]) {
      const { code, output } = await usage('--no-watch', ...bad)
      assert.equal(code, 1, bad.join(' '))
      assert.match(output, /Usage: tsgen/, bad.join(' '))
    }
  })

  test('--port=N is accepted, and --verbose prints the "Built" lines', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('g') })
    const port = await freePort()
    const server = await startServe(made.vault, made.dist, { args: ['--no-watch', '--verbose'], port: `=${port}` })
    cleanups.push(() => server.close())
    assert.match(server.output(), /Built: topic\/Grace\.md/)
    assert.equal((await server.get('/')).status, 404) // the home page is /home-page here
    const quiet = await vaultFor({ 'topic/Grace.md': page('g') })
    const q = await startServe(quiet.vault, quiet.dist, { args: ['--no-watch'] })
    cleanups.push(() => q.close())
    assert.doesNotMatch(q.output(), /Built: topic/)
  })

  test('a build that fails stops serve with exit code 1 and says why', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('[[Nowhere]]') })
    const server = await startServe(made.vault, made.dist, { args: ['--no-watch'] })
    cleanups.push(() => server.close())
    const [code] = await server.exit
    assert.equal(code, 1)
    assert.match(server.output(), /Build failed:[\s\S]*\[\[Nowhere\]\] matches no page/)
  })

  test('--show-hidden builds hidden pages for the preview', async () => {
    const made = await vaultFor({ 'topic/Secret.md': page('Shh.', 'hidden: true\n') })
    const server = await serve(made, { args: ['--no-watch', '--show-hidden'] })
    assert.match(server.output(), /Showing hidden pages \(--show-hidden\)\./)
    assert.match(await (await server.get('/topic/secret/')).text(), /Shh\./)
  })

  test('--show-hidden: problems on a shown draft are warnings, not failures', async () => {
    const made = await vaultFor({ 'topic/Draft.md': page('[[Nowhere]] and Romans 17 and NASA.', 'hidden: true\n') })
    const server = await serve(made, { args: ['--no-watch', '--show-hidden'] })
    const out = server.output()
    assert.match(out, /Warning: .*\[\[Nowhere\]\] matches no page/)
    assert.match(out, /Warning: "topic\/Draft\.md": "Romans 17"/)
    assert.match(out, /Warning: "topic\/Draft\.md": NASA is not in abbreviations\.json/)
    assert.equal((await server.get('/topic/draft/')).status, 200)
  })
})

describe('serve with watching', { concurrency: true }, () => {
  test('pages carry the reload script, and a change to a page rebuilds and tells open pages to reload', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('Version one.') })
    const server = await serve(made)
    const html = await (await server.get('/topic/grace/')).text()
    assert.match(html, /new EventSource\("\/__tsgen\/reload"\)/)
    assert.match(html, /Version one\./)

    const events = await server.get('/__tsgen/reload')
    assert.equal(events.headers.get('content-type'), 'text/event-stream')
    const reader = events.body.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    const read = async () => { seen += decoder.decode((await reader.read()).value ?? new Uint8Array()) }
    await read()
    assert.match(seen, /^data: [0-9a-z]+\n\n/)

    await changeUntil(
      (n) => fs.writeFile(path.join(made.vault, 'topic', 'Grace.md'), page(n === 0 ? 'Version two.' : `Version two, again ${n}.`)),
      () => /Rebuilt in/.test(server.output())
    )
    while (!seen.includes('data: reload')) await read()
    assert.match(server.output(), /Changed: topic\/Grace\.md/)
    assert.match(server.output(), /Rebuilt in \d+\.\d+ s\./)
    assert.match(await (await server.get('/topic/grace/')).text(), /Version two/)
    await reader.cancel()
  })

  test('a build that fails keeps the last good site up, and fixing it recovers', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('Good.') })
    const server = await serve(made)
    await changeUntil(
      (n) => fs.writeFile(path.join(made.vault, 'topic', 'Grace.md'), page(`[[Nowhere]] ${n}`)),
      () => /still serving the last good build/.test(server.output())
    )
    assert.match(server.output(), /\[\[Nowhere\]\] matches no page/)
    assert.match(await (await server.get('/topic/grace/')).text(), /Good\./)
    await changeUntil(
      (n) => fs.writeFile(path.join(made.vault, 'topic', 'Grace.md'), page(`Fixed. ${n}`)),
      async () => /Fixed\./.test(await (await server.get('/topic/grace/')).text())
    )
  })

  test('changes the watcher does not care about do not rebuild', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('g') })
    const server = await serve(made)
    await fs.writeFile(path.join(made.vault, 'notes.txt'), 'x')
    await fs.writeFile(path.join(made.vault, '.hidden.md'), 'x')
    await fs.mkdir(path.join(made.vault, 'node_modules'))
    await fs.writeFile(path.join(made.vault, 'node_modules', 'pkg.md'), 'x')
    await fs.writeFile(path.join(made.vault, 'README.md'), 'x')
    await new Promise((resolve) => setTimeout(resolve, 3500))
    assert.doesNotMatch(server.output(), /Changed:/)
  })

  test('Ctrl-C stops the supervisor and the server, and removes the staging directories', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('g') })
    const server = await serve(made)
    const [code, signal] = await server.stop('SIGINT')
    assert.ok(code === 0 || signal === 'SIGINT', `${code} ${signal}`)
    const left = (await fs.readdir(made.root)).filter((n) => n.startsWith('.dist-'))
    assert.deepEqual(left, [])
  })

  test('SIGTERM stops it too', async () => {
    const made = await vaultFor({})
    const server = await serve(made)
    const [code, signal] = await server.stop('SIGTERM')
    assert.ok(code === 0 || signal === 'SIGTERM', `${code} ${signal}`)
  })

  test('a build that fails at the start stops serve (the supervisor passes the exit code on)', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('[[Nowhere]]') })
    const server = await startServe(made.vault, made.dist, {})
    cleanups.push(() => server.close())
    const [code] = await server.exit
    assert.equal(code, 1)
    assert.match(server.output(), /Build failed:/)
  })
})

describe('the supervisor restarts the server when tsgen\'s own code changes', { concurrency: true }, () => {
  test('an edit to lib/ restarts it (the page reloads itself), a syntax error waits for the next edit', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('g') })
    const generator = path.join(made.root, 'generator')
    const buildJs = await copyGenerator(generator)
    const server = await serve(made, { buildJs })

    const boot = async () => {
      const response = await server.get('/__tsgen/reload')
      const reader = response.body.getReader()
      const text = new TextDecoder().decode((await reader.read()).value)
      await reader.cancel()
      return text
    }
    const first = await boot()
    const titles = path.join(generator, 'lib', 'titles.js')
    const original = await fs.readFile(titles, 'utf-8')

    await fs.writeFile(titles, `${original}\n// edited\n`)
    await waitFor(() => /\(tsgen's own code\)\. Restarting\./.test(server.output()), { what: `a restart:\n${server.output()}` })
    await waitFor(async () => { try { return (await boot()) !== first } catch { return false } }, { what: 'the restarted server' })

    await fs.writeFile(titles, `${original}\nexport const = broken\n`)
    await waitFor(() => /tsgen exited with code 1\. Waiting for a change to its code to start it again\./.test(server.output()), { what: `the failure message:\n${server.output()}` })

    await fs.writeFile(titles, original)
    await waitFor(async () => { try { return (await server.get('/topic/grace/')).status === 200 } catch { return false } }, { what: 'the server to come back' })
    const [code, signal] = await server.stop('SIGINT')
    assert.ok(code === 0 || signal === 'SIGINT', `${code} ${signal}`)
  })
})

// These touch a file of tsgen's own code (changing its modification time, nothing else), which
// every running supervisor notices, so they run last, when no other server is up.
describe('the supervisor, on tsgen\'s own code', { concurrency: false }, () => {
  test('it starts the server over after a change, and again if the server has died', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('g') })
    const server = await serve(made)
    const [first] = await waitFor(() => { const c = server.children(); return c.length > 0 && c }, { what: 'the server process' })

    const touch = () => { const now = new Date(); return fs.utimes(fileURLToPath(new URL('../lib/titles.js', import.meta.url)), now, now) }
    await touch()
    await waitFor(() => /\(tsgen's own code\)\. Restarting\./.test(server.output()), { what: `a restart:\n${server.output()}` })
    const [second] = await waitFor(() => { const c = server.children().filter((pid) => pid !== first); return c.length > 0 && c }, { what: 'a new server process' })
    await waitFor(async () => { try { return (await server.get('/topic/grace/')).status === 200 } catch { return false } }, { what: 'the restarted server' })

    // A server that dies on its own is reported, and waits for the next change.
    process.kill(second, 'SIGKILL')
    await waitFor(() => /tsgen exited \(SIGKILL\)\. Waiting for a change to its code to start it again\./.test(server.output()), { what: `the report:\n${server.output()}` })
    await touch()
    const [third] = await waitFor(() => { const c = server.children().filter((pid) => pid !== second); return c.length > 0 && c }, { what: 'a server started again' })
    await waitFor(async () => { try { return (await server.get('/topic/grace/')).status === 200 } catch { return false } }, { what: 'the server to answer again' })

    // Ctrl-C with no server running (it was killed): the supervisor leaves by itself.
    process.kill(third, 'SIGKILL')
    await waitFor(() => (server.output().match(/tsgen exited \(SIGKILL\)/g) ?? []).length >= 2, { what: 'the second report' })
    const [code, signal] = await server.stop('SIGINT')
    assert.ok(code === 0 || signal === 'SIGINT', `${code} ${signal}`)
  })
})

describe('the supervisor and the watcher, on more of tsgen\'s own files', { concurrency: false }, () => {
  const touch = (...parts) => { const now = new Date(); return fs.utimes(fileURLToPath(new URL(`../${parts.join('/')}`, import.meta.url)), now, now) }

  test('a change to many files is named by the first five and a count; build.js and serve.js count too', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('g') })
    const server = await serve(made)
    for (const file of ['lib/titles.js', 'lib/errors.js', 'lib/log.js', 'lib/io.js', 'lib/code.js']) await touch(...file.split('/'))
    await touch('build.js')
    await touch('serve.js')
    await waitFor(() => /\(tsgen's own code\)\. Restarting\./.test(server.output()), { what: `a restart:\n${server.output()}` })
    assert.match(server.output(), /Changed: .* and \d+ more \(tsgen's own code\)/)
    await waitFor(async () => { try { return (await server.get('/topic/grace/')).status === 200 } catch { return false } }, { what: 'the server to come back' })
  })

  test('a change to a file of the template rebuilds the site', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('g') })
    const server = await serve(made)
    await changeUntil(() => touch('template', 'print.js'), () => /Changed: print\.js/.test(server.output()))
    await waitFor(() => /Rebuilt in/.test(server.output()), { what: 'the rebuild to finish' })
  })

  test('a server that is killed before it has ever run ends the supervisor, with code 1', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('g') })
    const server = await startServe(made.vault, made.dist, {})
    cleanups.push(() => server.close())
    const [child] = server.children()
    process.kill(child, 'SIGKILL')
    const [code] = await server.exit
    assert.equal(code, 1)
  })
})

describe('the book while serving', { concurrency: true }, () => {
  const manifest = JSON.stringify({ parts: [{ title: 'P', topics: ['Grace'] }] })
  const files = { 'topic/Grace.md': page('Grace.', '', 'Grace'), 'book.json': manifest }

  test('is typeset in the background: the site is up at once, and a book that fails does not stop it', async () => {
    const made = await vaultFor({ 'topic/Grace.md': page('Grace.', '', 'Grace') }) // no book.json
    const server = await serve(made, { book: true, args: ['--no-watch'] })
    assert.match(server.output(), /Book: typesetting in the background; it will be at \/book\/book\.pdf\./)
    assert.match(await (await server.get('/topic/grace/')).text(), /Grace\./)
    await waitFor(() => /Book failed \(still serving the last good one, if any\): book\.json not found/.test(server.output()), { what: 'the book to fail' })
    assert.equal((await server.get('/topic/grace/')).status, 200)
    assert.equal((await server.get('/book/book.pdf')).status, 404)
  })

  test('--no-book serves the site alone', async () => {
    const made = await vaultFor(files)
    const server = await serve(made, { args: ['--no-watch'] })
    assert.doesNotMatch(server.output(), /Book/)
  })

  test('is served at /book/book.pdf, and the last one stays up while the next is typeset', { skip: !findChrome() && 'no Chrome to typeset with', timeout: 180000 }, async () => {
    const made = await vaultFor(files)
    const server = await serve(made, { book: true })
    await waitFor(() => /Book: \d+ pages typeset in/.test(server.output()), { timeout: 90000, what: `the book to be typeset:\n${server.output()}` })
    const pdf = await server.get('/book/book.pdf')
    assert.equal(pdf.status, 200)
    assert.equal(pdf.headers.get('content-type'), 'application/pdf')
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-')
    assert.equal((await server.get('/book/book.html')).status, 404) // only the PDF is published

    // an edit rebuilds the site at once and the book after it; the old PDF is there meanwhile
    await changeUntil(
      (n) => fs.writeFile(path.join(made.vault, 'topic', 'Grace.md'), page(`Grace, again ${n}.`, '', 'Grace')),
      () => /Rebuilt in/.test(server.output())
    )
    assert.equal((await server.get('/book/book.pdf')).status, 200)
    await waitFor(() => (server.output().match(/Book: \d+ pages typeset in/g) ?? []).length >= 2, { timeout: 90000, what: 'the book to be typeset again' })
    assert.equal((await server.get('/book/book.pdf')).status, 200)
  })
})
