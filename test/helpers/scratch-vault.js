import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BUILD_JS = fileURLToPath(new URL('../../build.js', import.meta.url))

// A 1×1 PNG, for the fallback share image every build needs.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

// What every build needs and the generated pages use: the three JSON maps (the
// generated pages write CSS, HTML, KB and MB, /statistics writes ESV once there is a
// Scripture reference, and they show the fallback image), the
// fallback image and a home page.
const BASE = {
  'abbreviations.json': JSON.stringify({ CSS: 'Cascading Style Sheets', ESV: 'English Standard Version', HTML: 'HyperText Markup Language', KB: 'kilobytes', MB: 'megabytes' }),
  'initials.json': '{}',
  'alt-text.json': JSON.stringify({ 'Trees-and-buildings.png': 'Trees and buildings' }),
  'image/Trees-and-buildings.png': PNG,
  'Home page.md': '---\ntitle: Home\n---\nHello\n'
}

// Writes a scratch vault holding BASE plus `files` ({ 'topic/Grace.md': 'text' }; a value
// of null removes a base file) into a fresh temporary directory. Resolves to
// { root, vault, dist, cleanup() }; the build's output goes to `dist`, beside the vault.
export async function makeVault (files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tsgen-test-'))
  const vault = path.join(root, 'vault')
  const all = { ...BASE, ...files }
  await fs.mkdir(vault, { recursive: true })
  for (const [name, data] of Object.entries(all)) {
    if (data === null) continue
    const file = path.join(vault, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, data)
  }
  return { root, vault, dist: path.join(root, 'dist'), cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}

// Builds a scratch vault (see makeVault) and runs the generator on it, in its own
// working directory like the real build; `args` go to the CLI, `env` adds to its
// environment and `prepare(vault)` runs first. The book is off (--no-book is added) unless
// `book: true`, since most tests are about the site and a book takes seconds. Resolves to
// { code, output, read(url), exists(url), cleanup() }; `output` is stdout and stderr together.
export async function buildVault (files = {}, { args = [], env = {}, prepare, book = false } = {}) {
  const { root, vault, dist, cleanup } = await makeVault(files)
  await prepare?.(vault)

  let code = 0
  let output = ''
  try {
    const argv = book ? args : args.length === 0 ? ['build', '--no-book'] : [...args, '--no-book']
    const result = await run('node', [BUILD_JS, ...argv], {
      cwd: vault,
      env: { ...process.env, TSGEN_OUT: dist, GITHUB_SHA: 'abcdef0', ...env }
    })
    output = result.stdout + result.stderr
  } catch (err) {
    code = err.code
    output = (err.stdout ?? '') + (err.stderr ?? '')
  }

  // The file a URL is written to: a page is <url>/index.html (but /404 is 404.html);
  // a URL whose last segment has a dot (search-index.json, .nojekyll) is the file itself.
  const fileFor = (url) => {
    if (url === '/404') return path.join(dist, '404.html')
    if (path.basename(url).includes('.')) return path.join(dist, url)
    return path.join(dist, url, 'index.html')
  }
  return {
    root,
    vault,
    dist,
    code,
    output,
    read: (url) => fs.readFile(fileFor(url), 'utf-8'),
    exists: (url) => fs.access(fileFor(url)).then(() => true, () => false),
    cleanup
  }
}
