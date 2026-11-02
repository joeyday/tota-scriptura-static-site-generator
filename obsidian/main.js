import { Notice, Platform, Plugin, PluginSettingTab, Setting, addIcon, editorLivePreviewField } from 'obsidian'
import harmony from '../lib/bible/harmony.json'
import { useHarmonyTable } from '../lib/bible/harmony.js'
import { tidyText } from '../lib/bible/tidy.js'
import { ICONS, MOP, MOP_SPARKLES } from './icons.js'
import { bibleRefExtension } from './link-cm.js'
import { linkBibleRefs } from './link-dom.js'

useHarmonyTable(harmony)

// The picker shows this until a color is chosen: the site's blue in sRGB (the blue itself is
// `oklch(0.5 0.16 215)`, which a wide-gamut screen shows a little more vividly than any hex can).
const SITE_BLUE = '#016f82'
const COLOR_VARIABLE = '--tota-scripture-link-base'
const UNDERLINE_CLASS = 'tota-underline-links'

// ─── Tota Scriptura, in Obsidian ───
// The site's Bible-reference code (lib/bible), run in the app: references are linked as the site
// links them in Reading view and marks them in Live Preview, and `tsgen refs` is a command. See obsidian/README.md.
export default class TotaScripturePlugin extends Plugin {
  async onload () {
    this.settings = { linkColor: null, underlineLinks: true, ...await this.loadData() }
    this.applyLinkColor()
    this.applyUnderline()
    this.addSettingTab(new TotaScriptureSettings(this.app, this))
    this.registerMarkdownPostProcessor((element) => linkBibleRefs(element))
    this.registerEditorExtension(bibleRefExtension({
      active: (state) => state.field(editorLivePreviewField),
      needsModifier: () => Platform.isDesktop
    }))

    for (const [id, svg] of Object.entries(ICONS)) addIcon(id, svg)
    for (const [id, name, icon, harmonies] of [
      ['tidy-references', 'Tidy Bible references', MOP_SPARKLES, true],
      ['tidy-references-plain', 'Tidy Bible references, without harmony passages', MOP, false]
    ]) {
      this.addCommand({
        id,
        name,
        icon,
        editorCallback: (editor) => this.tidy(editor, harmonies)
      })
    }
  }

  onunload () {
    document.body.style.removeProperty(COLOR_VARIABLE)
    document.body.classList.remove(UNDERLINE_CLASS)
  }

  // Links are underlined (a class on the body, for styles.css) unless the setting is off, and then
  // only while the pointer is over one.
  applyUnderline () {
    document.body.classList.toggle(UNDERLINE_CLASS, this.settings.underlineLinks)
  }

  async chooseUnderline (underline) {
    this.settings.underlineLinks = underline
    this.applyUnderline()
    await this.saveData(this.settings)
  }

  // A chosen color goes to styles.css as a variable; with none chosen the site's blue stays.
  applyLinkColor () {
    if (this.settings.linkColor) document.body.style.setProperty(COLOR_VARIABLE, this.settings.linkColor)
    else document.body.style.removeProperty(COLOR_VARIABLE)
  }

  async chooseLinkColor (color) {
    this.settings.linkColor = color
    this.applyLinkColor()
    await this.saveData(this.settings)
  }

  // Tidies the selection, or the whole note when nothing is selected, as `tsgen refs` does.
  tidy (editor, harmonies) {
    const selection = editor.getSelection()
    const text = selection || editor.getValue()
    let tidied
    try {
      tidied = tidyText(text, harmonies)
    } catch (err) {
      new Notice(err.message, 10000) // eslint-disable-line no-new
      return
    }
    if (tidied === text) {
      new Notice('Nothing to tidy.') // eslint-disable-line no-new
    } else if (selection) {
      editor.replaceSelection(tidied)
    } else {
      const last = editor.lastLine()
      editor.replaceRange(tidied, { line: 0, ch: 0 }, { line: last, ch: editor.getLine(last).length })
    }
  }
}

// ─── The settings ───
class TotaScriptureSettings extends PluginSettingTab {
  constructor (app, plugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display () {
    this.containerEl.empty()
    new Setting(this.containerEl)
      .setName('Scripture link color')
      .setDesc("The color of the Bible references the plugin links, in Reading view and Live Preview. It is lightened on a dark theme, as the site's blue is. Until you choose one, it is the site's blue.")
      .addColorPicker((picker) => picker
        .setValue(this.plugin.settings.linkColor ?? SITE_BLUE)
        .onChange((color) => this.plugin.chooseLinkColor(color)))
      .addExtraButton((button) => button
        .setIcon('reset')
        .setTooltip("Reset to the site's blue")
        .onClick(async () => {
          await this.plugin.chooseLinkColor(null)
          this.display()
        }))
    new Setting(this.containerEl)
      .setName('Underline Scripture links')
      .setDesc('The links are underlined. Turn this off and a link is underlined only while the pointer is over it.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.underlineLinks)
        .onChange((underline) => this.plugin.chooseUnderline(underline)))
  }
}
