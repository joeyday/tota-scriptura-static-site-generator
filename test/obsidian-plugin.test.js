/* global MouseEvent, getComputedStyle */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { findChrome } from '../lib/book/pdf.js'
import { buildPlugin } from '../scripts/build-plugin.mjs'
import { bibleRefsInLine, proseLines } from '../obsidian/find-refs.js'

// ─── The Obsidian plugin (obsidian/) ───
test('the plugin bundles with no file system and leaves Obsidian to the app', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tsgen-plugin-'))
  try {
    await buildPlugin(dir)
    const main = await fs.readFile(path.join(dir, 'main.js'), 'utf8')
    assert.match(main, /require\("obsidian"\)/)
    assert.match(main, /require\("@codemirror\/view"\)/) // the editor's own, not a second copy
    assert.doesNotMatch(main, /class EditorView/)
    assert.doesNotMatch(main, /require\(["'](node:)?fs["']\)/)
    assert.doesNotMatch(main, /import\.meta/)
    for (const file of ['manifest.json', 'styles.css']) await fs.access(path.join(dir, file))
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')).id, 'tota-scriptura')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('the plugin has the harmony table without reading a file', async () => {
  // main.js can't run without Obsidian, so the part that matters is run on its own: the table is
  // given, and tidying a harmony pair uses it.
  const bundle = await build({
    stdin: {
      contents: `
        import harmony from './lib/bible/harmony.json'
        import { useHarmonyTable } from './lib/bible/harmony.js'
        import { tidyText } from './lib/bible/tidy.js'
        useHarmonyTable(harmony)
        globalThis.tidied = tidyText('1Ch 17:20; 2Sa 7:22')`,
      resolveDir: path.join(import.meta.dirname, '..')
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    define: { 'import.meta.url': '"file:///"' },
    plugins: [{
      name: 'no-fs',
      setup (b) {
        b.onResolve({ filter: /^node:fs$/ }, () => ({ path: 'node:fs', namespace: 'no-fs' }))
        b.onLoad({ filter: /.*/, namespace: 'no-fs' }, () => ({ contents: 'export const readFileSync = () => { throw new Error("no file system") }' }))
      }
    }]
  })
  const sandbox = { globalThis: {} }
  new Function('globalThis', 'module', 'exports', bundle.outputFiles[0].text)(sandbox.globalThis, { exports: {} }, {}) // eslint-disable-line no-new-func
  assert.equal(sandbox.globalThis.tidied, '2Sa 7:22 (cf. 1Ch 17:20)')
})

const skip = !findChrome() && 'no Chrome to run the DOM in'
test('references in rendered text are linked as the site links them', { skip, timeout: 120000 }, async () => {
  const bundle = await build({
    entryPoints: [path.join(import.meta.dirname, '..', 'obsidian', 'link-dom.js')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'linkDom',
    platform: 'browser'
  })
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true })
  try {
    const tab = await browser.newPage()
    await tab.setContent('<body></body>')
    await tab.addScriptTag({ content: bundle.outputFiles[0].text })
    const link = (html) => tab.evaluate((h) => {
      const div = document.createElement('div')
      div.innerHTML = h
      document.body.append(div)
      window.linkDom.linkBibleRefs(div)
      return div.innerHTML
    }, html)

    const out = await link('<p>See Jn 3:16, 18; 5:24 KJV and <code>Jn 3:17</code>, <a href="x">Ro 8:1</a>, !Mt 5:3 and Romans 17:1 or Phm 1:3.</p><p>, 20</p>')
    const hrefs = [...out.matchAll(/href="https:\/\/ref\.ly\/([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(hrefs, ['Jn3.16;KJV', 'Jn3.18;KJV', 'Jn5.24;KJV', 'Phm1.3;ESV'])
    assert.match(out, /<a href="https:\/\/ref\.ly\/Jn3\.16;KJV" class="external bible-ref"[^>]*>Jn&nbsp;3:16<\/a>/)
    assert.match(out, /<code>Jn 3:17<\/code>/) // code is left alone
    assert.match(out, /<a href="x">Ro 8:1<\/a>/) // so is a link
    assert.match(out, /, Mt 5:3 and/) // a ! opts out and loses its mark
    assert.match(out, /Romans 17:1 or/) // a reference that can't exist is not a link
    assert.match(out, /<p>, 20<\/p>/) // the next block does not continue the last

    // Obsidian's own markup around text is kept
    const kept = await link('<ul><li>Jn 3:16</li><li>and 1Co 13</li></ul>')
    assert.equal([...kept.matchAll(/class="external bible-ref"/g)].length, 2)
    assert.match(kept, /^<ul><li><a /)
  } finally {
    await browser.close()
  }
})

// ─── References in the editing view ───
test('the editing view finds the references the site would link, and where they are', () => {
  const text = 'See Jn 3:16, 18; 5:24 KJV and 1Co 13.'
  const refs = bibleRefsInLine(text)
  assert.deepEqual(refs.map((ref) => text.slice(ref.from, ref.to)), ['Jn 3:16', '18', '5:24', '1Co 13'])
  assert.deepEqual(refs.map((ref) => ref.url), [
    'https://ref.ly/Jn3.16;KJV', 'https://ref.ly/Jn3.18;KJV', 'https://ref.ly/Jn5.24;KJV', 'https://ref.ly/1Co13;ESV'
  ])
  // a semicolon starts a chapter and a comma a verse, as everywhere
  assert.deepEqual(bibleRefsInLine('Heb 4:2; 11').map((ref) => ref.url), ['https://ref.ly/Heb4.2;ESV', 'https://ref.ly/Heb11;ESV'])
  assert.deepEqual(bibleRefsInLine('Phm 1:3–5').map((ref) => ref.url), ['https://ref.ly/Phm1.3-5;ESV'])
})

test('the editing view leaves alone what is not prose, what is opted out and what cannot exist', () => {
  for (const line of [
    'Code `Jn 3:16` here', '[[Jn 3:16]] and ![[Jn 3:16.png]]', '[Jn 3:16](https://example.com/Jn3:16)', '<https://x.org/Jn 3:16>',
    'https://example.com/Jn3:16', '!Mt 5:3', 'Romans 17:1', 'no digits here', ''
  ]) assert.deepEqual(bibleRefsInLine(line), [], line)
  // and finds the rest of the line
  assert.equal(bibleRefsInLine('`Jn 3:16` but Ro 8:1').length, 1)
})

test('front matter, fenced code and math are not prose', () => {
  assert.deepEqual(proseLines(['---', 'title: Jn 3:16', '---', 'Jn 3:16', '```js', 'Jn 3:16', '```', '~~~', 'x', '~~~~', 'Jn 3:17', '$$', 'Jn 3:18', '$$', 'Jn 3:19']),
    [false, false, false, true, false, false, false, false, false, false, true, false, false, false, true])
  // a line of three dashes that is not the first is a rule
  assert.deepEqual(proseLines(['Jn 3:16', '---', 'Jn 3:17']), [true, true, true])
})

test('the editing view marks references in a real editor, and a click opens one', { skip, timeout: 120000 }, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { EditorState } from '@codemirror/state'
        import { EditorView } from '@codemirror/view'
        import { bibleRefExtension } from './obsidian/link-cm.js'
        window.edit = (doc, { modifier = false, active = true } = {}) => {
          const parent = document.body.appendChild(document.createElement('div'))
          return new EditorView({
            parent,
            state: EditorState.create({ doc, extensions: [bibleRefExtension({ active: () => active, needsModifier: () => modifier })] })
          })
        }`,
      resolveDir: path.join(import.meta.dirname, '..')
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser'
  })
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true })
  try {
    const tab = await browser.newPage()
    await tab.setContent('<body></body>')
    await tab.addScriptTag({ content: bundle.outputFiles[0].text })
    const marked = await tab.evaluate(() => {
      window.edit('---\ntitle: Jn 3:16\n---\nSee Jn 3:16, 18 and `Ro 8:1` and Romans 17:1.\n```\nJn 3:17\n```\n')
      return [...document.querySelectorAll('.cm-bible-ref')].map((el) => [el.textContent, el.dataset.href])
    })
    assert.deepEqual(marked, [['Jn 3:16', 'https://ref.ly/Jn3.16;ESV'], ['18', 'https://ref.ly/Jn3.18;ESV']])

    // a click opens the link (a tap on a phone), and with a modifier needed, only with one
    const opened = await tab.evaluate(() => {
      const calls = []
      window.open = (url) => calls.push(url)
      const click = (el, init = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
      const plain = document.querySelector('.cm-bible-ref')
      click(plain)
      document.body.innerHTML = ''
      window.edit('Jn 3:16', { modifier: true })
      const guarded = document.querySelector('.cm-bible-ref')
      click(guarded)
      click(guarded, { metaKey: true })
      return calls
    })
    assert.deepEqual(opened, ['https://ref.ly/Jn3.16;ESV', 'https://ref.ly/Jn3.16;ESV'])

    // and nothing is marked where the extension is not active (Source mode)
    assert.equal(await tab.evaluate(() => {
      document.body.innerHTML = ''
      window.edit('Jn 3:16', { active: false })
      return document.querySelectorAll('.cm-bible-ref').length
    }), 0)
  } finally {
    await browser.close()
  }
})

test("the plugin's blue is the site's external-link blue", async () => {
  const site = await fs.readFile(path.join(import.meta.dirname, '..', 'template', 'style.css'), 'utf8')
  const plugin = await fs.readFile(path.join(import.meta.dirname, '..', 'obsidian', 'styles.css'), 'utf8')
  const hue = /--color-slate: oklch\(var\(--l\) var\(--c\) (\d+)\)/.exec(site)[1]
  assert.match(site, /--color-link-external: var\(--color-slate\)/)
  assert.deepEqual([...plugin.matchAll(/oklch\(0\.5 0\.16 (\d+)\)/g)].map((m) => m[1]), [hue, hue])
})

test('the link color is a setting: applied when the plugin loads, kept, and reset', { skip, timeout: 120000 }, async () => {
  // main.js is run with a stand-in for Obsidian's side of it
  const bundle = await build({
    entryPoints: [path.join(import.meta.dirname, '..', 'obsidian', 'main.js')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'plugin',
    platform: 'browser',
    define: { 'import.meta.url': '"file:///"' },
    plugins: [{
      name: 'stand-ins',
      setup (b) {
        b.onResolve({ filter: /^node:fs$/ }, () => ({ path: 'node:fs', namespace: 'stand-in' }))
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stand-in' }))
        b.onLoad({ filter: /^node:fs$/, namespace: 'stand-in' }, () => ({ contents: 'export const readFileSync = () => {}' }))
        b.onLoad({ filter: /^obsidian$/, namespace: 'stand-in' }, () => ({
          contents: `
            export class Plugin {
              constructor (app) { this.app = app; this.saved = [] }
              async loadData () { return window.stored ?? null }
              async saveData (data) { this.saved.push({ ...data }) }
              addCommand (command) { (window.commands ??= []).push(command) }
              addSettingTab (tab) { this.tab = tab }
              registerMarkdownPostProcessor () {}
              registerEditorExtension () {}
            }
            export class PluginSettingTab {
              constructor (app, plugin) { this.containerEl = Object.assign(document.createElement('div'), { empty () { this.replaceChildren() } }) }
            }
            export class Setting {
              constructor () { (window.settings ??= []).push(this) }
              setName (name) { this.name = name; return this }
              setDesc () { return this }
              addColorPicker (use) {
                const picker = { setValue: (value) => { this.shown = value; return picker }, onChange: (change) => { this.change = change; return picker } }
                use(picker)
                return this
              }
              addToggle (use) {
                const toggle = { setValue: (value) => { this.shown = value; return toggle }, onChange: (change) => { this.change = change; return toggle } }
                use(toggle)
                return this
              }
              addExtraButton (use) {
                const button = { setIcon: () => button, setTooltip: () => button, onClick: (click) => { this.reset = click; return button } }
                use(button)
                return this
              }
            }
            export const addIcon = (id, svg) => { (window.icons ??= {})[id] = svg }
            export class Notice {}
            export const Platform = { isDesktop: true }
            export const editorLivePreviewField = {}`
        }))
      }
    }]
  })
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true })
  try {
    const tab = await browser.newPage()
    await tab.setContent('<body></body>')
    await tab.addScriptTag({ content: bundle.outputFiles[0].text })
    const state = () => tab.evaluate(() => document.body.style.getPropertyValue('--tota-scripture-link-base'))

    // both commands have an icon
    const commands = await tab.evaluate(async () => {
      const TotaPlugin = window.plugin.default
      await new TotaPlugin({}).onload()
      return { commands: window.commands.map(({ id, icon }) => ({ id, icon })), icons: Object.keys(window.icons) }
    })
    assert.deepEqual(commands.commands, [{ id: 'tidy-references', icon: 'tota-mop-sparkles' }, { id: 'tidy-references-plain', icon: 'tota-mop' }])
    assert.deepEqual(commands.icons, ['tota-mop', 'tota-mop-sparkles']) // and the icons they name are the plugin's own

    // nothing chosen: the site's blue stays, and the picker starts on it
    const first = await tab.evaluate(async () => {
      const TotaPlugin = window.plugin.default
      window.p = new TotaPlugin({})
      await window.p.onload()
      window.settings = []
      window.p.tab.display()
      return window.settings.map((setting) => ({ name: setting.name, shown: setting.shown }))
    })
    assert.deepEqual(first, [{ name: 'Scripture link color', shown: '#016f82' }, { name: 'Underline Scripture links', shown: true }])
    assert.equal(await tab.evaluate(() => document.body.classList.contains('tota-underline-links')), true)
    assert.equal(await state(), '')

    // a color chosen is applied at once and saved
    await tab.evaluate(() => window.settings[0].change('#aa3300'))
    assert.equal(await state(), '#aa3300')
    assert.deepEqual(await tab.evaluate(() => window.p.saved), [{ linkColor: '#aa3300', underlineLinks: true }])

    // reset puts the site's blue back
    await tab.evaluate(() => window.settings[0].reset())
    assert.equal(await state(), '')
    assert.deepEqual(await tab.evaluate(() => window.p.saved.at(-1)), { linkColor: null, underlineLinks: true })

    // the underline can be turned off, and the choice is kept
    const underlined = () => tab.evaluate(() => document.body.classList.contains('tota-underline-links'))
    await tab.evaluate(() => window.settings[1].change(false))
    assert.equal(await underlined(), false)
    assert.deepEqual(await tab.evaluate(() => window.p.saved.at(-1)), { linkColor: null, underlineLinks: false })

    // a saved color is applied when the plugin loads, and removed when it unloads
    await tab.evaluate(async () => {
      window.stored = { linkColor: '#336699', underlineLinks: false }
      const TotaPlugin = window.plugin.default
      window.p = new TotaPlugin({})
      await window.p.onload()
    })
    assert.equal(await state(), '#336699')
    assert.equal(await underlined(), false)
    await tab.evaluate(() => window.p.onunload())
    assert.equal(await state(), '')
  } finally {
    await browser.close()
  }
})

test("the links are underlined, or only on hover, whatever Obsidian's own link rules say", { skip, timeout: 120000 }, async () => {
  const css = await fs.readFile(path.join(import.meta.dirname, '..', 'obsidian', 'styles.css'), 'utf8')
  // the rules of Obsidian's app.css that underline every link
  const obsidian = 'body { --link-decoration: underline; --link-decoration-hover: underline; --link-color: green; --link-color-hover: green } a { color: var(--link-color); text-decoration-line: var(--link-decoration) } a:hover { color: var(--link-color-hover); text-decoration-line: var(--link-decoration-hover) }'
  const html = (bodyClass) => `<style>${obsidian}</style><style>${css}</style><body class="theme-light ${bodyClass}"><p><a class="external bible-ref" href="#">Jn 3:16</a> <span class="cm-bible-ref">Jn 3:17</span></p></body>`
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true })
  try {
    const look = (tab, selector) => tab.$eval(selector, (el) => ({ line: getComputedStyle(el).textDecorationLine, color: getComputedStyle(el).color }))
    // (a page in the background does not render, so each is used on its own and closed)
    const desktop = await browser.newPage()
    for (const selector of ['a.bible-ref', '.cm-bible-ref']) {
      // with the setting on (the body has the class), underlined
      await desktop.setContent(html('tota-underline-links'))
      assert.equal((await look(desktop, selector)).line, 'underline', selector)
      assert.notEqual((await look(desktop, selector)).color, 'rgb(0, 128, 0)') // not the theme's link color
      // with it off, plain until hovered
      await desktop.setContent(html(''))
      assert.equal((await look(desktop, selector)).line, 'none', selector)
      await desktop.hover(selector)
      assert.equal((await look(desktop, selector)).line, 'underline', `${selector} on hover`)
    }
    await desktop.close()

    const touch = await browser.newPage()
    await touch.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true }) // no hover
    for (const selector of ['a.bible-ref', '.cm-bible-ref']) {
      await touch.setContent(html('tota-underline-links'))
      assert.equal((await look(touch, selector)).line, 'underline', `${selector} on a touch screen`)
      // with it off, plain even when tapped, since a tapped link stays "hovered"
      await touch.setContent(html(''))
      await touch.hover(selector)
      assert.equal((await look(touch, selector)).line, 'none', `${selector} hovered on a touch screen`)
    }
  } finally {
    await browser.close()
  }
})
