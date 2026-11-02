// Builds the Obsidian plugin (obsidian/) into obsidian/dist/, and with a vault path installs it
// into <vault>/.obsidian/plugins/tota-scriptura/:  npm run plugin [-- "<path to the vault>"]
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

// The plugin runs where there is no file system, and lib/bible only reads one for harmony.json,
// which the plugin gives it, so `node:fs` is an empty module in the bundle.
const noFs = {
  name: 'no-fs',
  setup (b) {
    b.onResolve({ filter: /^node:fs$/ }, () => ({ path: 'node:fs', namespace: 'no-fs' }))
    b.onLoad({ filter: /.*/, namespace: 'no-fs' }, () => ({ contents: 'export const readFileSync = () => { throw new Error("no file system") }' }))
  }
}

export async function buildPlugin (outDir = path.join(root, 'obsidian', 'dist')) {
  await fs.mkdir(outDir, { recursive: true })
  await build({
    entryPoints: [path.join(root, 'obsidian', 'main.js')],
    outfile: path.join(outDir, 'main.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    external: ['obsidian', '@codemirror/state', '@codemirror/view'],
    plugins: [noFs],
    define: { 'import.meta.url': '"file:///"' },
    logLevel: 'warning'
  })
  for (const file of ['manifest.json', 'styles.css']) {
    await fs.copyFile(path.join(root, 'obsidian', file), path.join(outDir, file))
  }
  return outDir
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = await buildPlugin()
  console.log(`Built the plugin in ${dist}`)
  const vault = process.argv[2]?.replace(/^~(?=\/)/, os.homedir())
  if (vault) {
    const target = path.join(vault, '.obsidian', 'plugins', 'tota-scriptura')
    await fs.mkdir(target, { recursive: true })
    for (const file of ['main.js', 'manifest.json', 'styles.css']) await fs.copyFile(path.join(dist, file), path.join(target, file))
    console.log(`Installed it in ${target}`)
  }
}
